import {supabase} from '../lib/supabase'
import {localFind,localGet,localPut,localRemove,type ToolScope,scopeKey} from './field-tool-store'
import {listAttendanceContent,saveTechnicianFieldRecord,uploadTechnicianEvidence} from './fd-sst'

export interface PendingPhoto {
  id:string; companyId:string; userId:string; appointmentId:string
  blob:Blob; fileName:string; observation:string; locationText:string
  createdAt:string; error?:string
}
const prefix=(scope:ToolScope,appointmentId='')=>`attendance-photo:${scopeKey(scope)}:${appointmentId}`
const key=(scope:ToolScope,photo:PendingPhoto)=>`${prefix(scope,photo.appointmentId)}:${photo.id}`
const finalizedKey=(scope:ToolScope,id:string)=>`attendance-finalized:${scopeKey(scope)}:${id}`
const notify=(retry=true)=>window.dispatchEvent(new CustomEvent('attendance-photos-changed',{detail:{retry}}))
const locks=new Map<string,Promise<unknown>>()
async function locked<T>(scope:ToolScope,id:string,run:()=>Promise<T>):Promise<T>{
  const name=`fd-attendance:${scopeKey(scope)}:${id}`
  if(navigator.locks)return navigator.locks.request(name,run)
  const previous=locks.get(name)||Promise.resolve()
  const next=previous.catch(()=>undefined).then(run);locks.set(name,next)
  try{return await next}finally{if(locks.get(name)===next)locks.delete(name)}
}
export async function pendingPhotos(scope:ToolScope,appointmentId?:string){
  const photos=await localFind<PendingPhoto>(prefix(scope,appointmentId?appointmentId+':':''))
  return photos.filter(p=>p.companyId===scope.companyId&&p.userId===scope.userId&&(!appointmentId||p.appointmentId===appointmentId)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))
}
export async function queuePhoto(scope:ToolScope,appointmentId:string,file:File,observation:string,locationText=''){
  return locked(scope,`capture:${appointmentId}`,async()=>{
    if(await localGet(finalizedKey(scope,appointmentId)))throw new Error('Este atendimento já foi finalizado neste aparelho.')
    if(!file.type.startsWith('image/'))throw new Error('Selecione uma fotografia válida.')
    if(file.size>50*1024*1024)throw new Error('A fotografia excede o limite de 50 MB.')
    const photo:PendingPhoto={...scope,appointmentId,id:crypto.randomUUID(),blob:file,fileName:file.name,observation,locationText,createdAt:new Date().toISOString()}
    await localPut(key(scope,photo),photo);notify();return photo
  })
}
async function sameUser(scope:ToolScope){
  if(!supabase)throw new Error('Conexão indisponível.')
  const {data,error}=await supabase.auth.getUser()
  if(error||data.user?.id!==scope.userId)throw new Error('Entre novamente na mesma conta para enviar as fotos salvas neste aparelho.')
}
async function syncUnlocked(scope:ToolScope,appointmentId:string){
  if(!navigator.onLine)return
  await sameUser(scope)
  while(true){
    const [photo]=await pendingPhotos(scope,appointmentId)
    if(!photo)return
    try{
      await sameUser(scope)
      const file=new File([photo.blob],photo.fileName,{type:photo.blob.type})
      await uploadTechnicianEvidence({companyId:scope.companyId,appointmentId,file,observation:photo.observation,locationText:photo.locationText,evidenceId:photo.id,expectedUserId:scope.userId})
      await localRemove(key(scope,photo));notify(false)
    }catch(error){
      await localPut(key(scope,photo),{...photo,error:error instanceof Error?error.message:'Não foi possível enviar esta foto. Ela continua salva no aparelho.'});notify(false)
      // Keep the whole unsent queue, including the source blob, for resumption.
      throw error
    }
  }
}
const syncing=new Map<string,Promise<void>>()
export function syncAttendancePhotos(scope:ToolScope,appointmentId:string):Promise<void>{
  const id=`${scopeKey(scope)}:${appointmentId}`
  const current=syncing.get(id);if(current)return current
  const next=locked(scope,appointmentId,()=>syncUnlocked(scope,appointmentId)).finally(()=>{if(syncing.get(id)===next)syncing.delete(id)})
  syncing.set(id,next);return next
}
export async function syncAllAttendancePhotos(scope:ToolScope){
  if(!navigator.onLine)return
  for(const id of new Set((await pendingPhotos(scope)).map(p=>p.appointmentId))){
    try{await syncAttendancePhotos(scope,id)}catch{/* Error stays with this visit; other visits can continue. */}
  }
}
export async function finalizeWithPhotos(scope:ToolScope,appointmentId:string,note:string){
  return locked(scope,`capture:${appointmentId}`,()=>locked(scope,appointmentId,async()=>{
    if(!navigator.onLine)throw new Error('Conecte-se à internet para enviar as fotos e finalizar o atendimento.')
    await syncUnlocked(scope,appointmentId)
    if((await pendingPhotos(scope,appointmentId)).length)throw new Error('Ainda há fotos pendentes de envio. O atendimento continua em rascunho.')
    await sameUser(scope)
    const result=await saveTechnicianFieldRecord('finalize_appointment',{appointment_id:appointmentId,finalization_note:note})
    try{await localPut(finalizedKey(scope,appointmentId),true)}catch{/* The server already finalized the visit; local cache failure must not report a false rollback. */}
    notify(false);return result
  }))
}
export async function cachedAttendanceContent(scope:ToolScope,appointmentId:string){
  const cacheKey=`attendance-content:${scopeKey(scope)}:${appointmentId}`
  if(!navigator.onLine){
    const cached=await localGet<Awaited<ReturnType<typeof listAttendanceContent>>>(cacheKey)
    if(!cached)throw new Error('Abra este atendimento com internet antes de trabalhar sem conexão.')
    return cached
  }
  const content=await listAttendanceContent(appointmentId)
  try{await localPut(cacheKey,content)}catch{/* Online attendance remains usable if local storage is unavailable. */}
  return content
}
