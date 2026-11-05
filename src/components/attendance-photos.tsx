import {useEffect,useState} from 'react'
import {useQuery,useQueryClient} from '@tanstack/react-query'
import type {Membership} from '../types/domain'
import {pendingPhotos,syncAllAttendancePhotos,syncAttendancePhotos,type PendingPhoto} from '../services/attendance-photo-store'
import type {ToolScope} from '../services/field-tool-store'
import {Button,Notice} from './ui'

export function AttendanceConnectivityNotice(){
  const [online,setOnline]=useState(navigator.onLine)
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}},[])
  return online?null:<Notice kind="info">Sem conexão. Novas fotos e suas observações podem ser salvas neste aparelho. Abra e inicie o atendimento com internet antes de sair a campo. Os demais campos e a finalização precisam de conexão.</Notice>
}

export function AttendancePhotoSync({membership}:{membership:Membership}){
  const client=useQueryClient()
  useEffect(()=>{
    const scope={companyId:membership.company_id,userId:membership.user_id}
    const sync=async(event?:Event)=>{
      if(!navigator.onLine||(event instanceof CustomEvent&&event.detail?.retry===false))return
      try{
        if(!(await pendingPhotos(scope)).length)return
        await syncAllAttendancePhotos(scope)
        await Promise.all([client.invalidateQueries({queryKey:['attendance-photos']}),client.invalidateQueries({queryKey:['attendance-content']})])
      }catch{/* Pending photographs and errors remain on the device. */}
    }
    void sync()
    const listener=(event:Event)=>void sync(event)
    window.addEventListener('online',listener);window.addEventListener('focus',listener);window.addEventListener('attendance-photos-changed',listener)
    const timer=window.setInterval(()=>void sync(),60000)
    return()=>{window.clearInterval(timer);window.removeEventListener('online',listener);window.removeEventListener('focus',listener);window.removeEventListener('attendance-photos-changed',listener)}
  },[membership.company_id,membership.user_id,client])
  return null
}
function LocalPhoto({photo}:{photo:PendingPhoto}){
  const [url,setUrl]=useState('')
  useEffect(()=>{const value=URL.createObjectURL(photo.blob);setUrl(value);return()=>URL.revokeObjectURL(value)},[photo.blob])
  return <article className="evidence-card">{url&&<img loading="lazy" decoding="async" src={url} alt={photo.observation||'Fotografia salva no aparelho'} />}<strong>{photo.observation||'Sem observação'}</strong>{photo.locationText&&<small>Local: {photo.locationText}</small>}<small>Salva neste aparelho · aguardando confirmação do servidor</small>{photo.error&&<Notice kind="error">{photo.error}</Notice>}</article>
}
export function AttendancePhotosPanel({scope,appointmentId}:{scope:ToolScope;appointmentId:string}){
  const client=useQueryClient(),[sending,setSending]=useState(false),[error,setError]=useState('')
  const query=useQuery({networkMode:'always',queryKey:['attendance-photos',scope.companyId,scope.userId,appointmentId],queryFn:()=>pendingPhotos(scope,appointmentId)})
  useEffect(()=>{const update=()=>void client.invalidateQueries({queryKey:['attendance-photos',scope.companyId,scope.userId,appointmentId]});window.addEventListener('attendance-photos-changed',update);return()=>window.removeEventListener('attendance-photos-changed',update)},[scope.companyId,scope.userId,appointmentId,client])
  const retry=async()=>{
    setSending(true);setError('')
    try{await syncAttendancePhotos(scope,appointmentId);await client.invalidateQueries({queryKey:['attendance-content',appointmentId]})}catch(error){setError(error instanceof Error?error.message:'As fotos continuam salvas neste aparelho. Confira a conexão e a mensagem de cada foto.')}finally{setSending(false)}
  }
  if(query.error)return <Notice kind="error">Não foi possível acessar as fotos salvas neste aparelho. Verifique as permissões de armazenamento antes de finalizar.</Notice>
  if(!query.data?.length)return null
  return <section className="attendance-section"><h2>Fotos aguardando envio ({query.data.length})</h2><p>As imagens e observações estão salvas neste aparelho. A sincronização ocorre ao voltar a conexão com o aplicativo aberto. A finalização aguarda a confirmação de envio de todas elas.</p><Notice kind="info">Abra e inicie o atendimento com internet antes de trabalhar sem conexão. Serviços, funções, checklist e assinatura ainda precisam de internet para salvar alterações.</Notice>{error&&<Notice kind="error">{error}</Notice>}<div className="evidence-grid">{query.data.map(photo=><LocalPhoto key={photo.id} photo={photo} />)}</div><Button className="button-secondary" disabled={sending} onClick={()=>void retry()}>{sending?'Enviando fotos…':'Tentar sincronizar agora'}</Button></section>
}
