import 'fake-indexeddb/auto'
import {beforeEach,describe,expect,it,vi} from 'vitest'
const remote=vi.hoisted(()=>({user:'tech-a',upload:vi.fn(),save:vi.fn(),content:vi.fn()}))
vi.mock('../lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:remote.user}},error:null})}}}))
vi.mock('./fd-sst',()=>({uploadTechnicianEvidence:remote.upload,saveTechnicianFieldRecord:remote.save,listAttendanceContent:remote.content}))
import {cachedAttendanceContent,finalizeWithPhotos,pendingPhotos,queuePhoto,syncAttendancePhotos,syncAllAttendancePhotos} from './attendance-photo-store'
const scope={companyId:'company-a',userId:'tech-a'}
const online=(value:boolean)=>Object.defineProperty(navigator,'onLine',{value,configurable:true})
beforeEach(()=>{
 vi.clearAllMocks();remote.user='tech-a';remote.upload.mockResolvedValue(undefined);remote.save.mockResolvedValue({ok:true});remote.content.mockResolvedValue({evidence:[]})
 Object.defineProperty(globalThis,'window',{value:{dispatchEvent:vi.fn()},configurable:true})
 online(true)
})
const file=()=>new File(['original-pixels'],'inspection.jpg',{type:'image/jpeg'})
describe('durable attendance photo queue',()=>{
 it('reopens an offline original with its observation and isolates user, tenant and appointment',async()=>{
  online(false);const id=crypto.randomUUID()
  await queuePhoto(scope,id,file(),'Caixa no corredor','Depósito')
  const rows=await pendingPhotos(scope,id)
  expect(rows).toHaveLength(1);expect(await rows[0].blob.text()).toBe('original-pixels');expect(rows[0].observation).toBe('Caixa no corredor')
  expect(await pendingPhotos({...scope,userId:'other'},id)).toEqual([])
  expect(await pendingPhotos({...scope,companyId:'other'},id)).toEqual([])
  expect(await pendingPhotos(scope,crypto.randomUUID())).toEqual([])
  await syncAttendancePhotos(scope,id);expect(remote.upload).not.toHaveBeenCalled()
 })
 it('uploads before finalizing and prevents a stale tab from adding another photo',async()=>{
  const id=crypto.randomUUID(),order:string[]=[]
  await queuePhoto(scope,id,file(),'Observação')
  remote.upload.mockImplementation(async()=>{order.push('upload')});remote.save.mockImplementation(async()=>{order.push('finalize');return {ok:true}})
  await finalizeWithPhotos(scope,id,'Fim')
  expect(order).toEqual(['upload','finalize']);expect(await pendingPhotos(scope,id)).toEqual([])
  expect(remote.upload.mock.calls[0][0]).toMatchObject({expectedUserId:scope.userId,appointmentId:id})
  await expect(queuePhoto(scope,id,file(),'Outra')).rejects.toThrow('já foi finalizado')
 })
 it('retains the original after a network failure and never finalizes early',async()=>{
  const id=crypto.randomUUID();await queuePhoto(scope,id,file(),'Persistir')
  remote.upload.mockRejectedValue(new Error('Conexão interrompida'))
  await expect(finalizeWithPhotos(scope,id,'')).rejects.toThrow('Conexão interrompida')
  expect(remote.save).not.toHaveBeenCalled()
  const rows=await pendingPhotos(scope,id);expect(await rows[0].blob.text()).toBe('original-pixels');expect(rows[0].error).toContain('Conexão')
  remote.upload.mockResolvedValue(undefined);await finalizeWithPhotos(scope,id,'')
  expect(remote.save).toHaveBeenCalledOnce()
 })
 it('does not send photos under a different signed-in user',async()=>{
  const id=crypto.randomUUID();await queuePhoto(scope,id,file(),'Privada');remote.user='tech-b'
  await expect(syncAttendancePhotos(scope,id)).rejects.toThrow('mesma conta')
  expect(remote.upload).not.toHaveBeenCalled();expect(await pendingPhotos(scope,id)).toHaveLength(1)
 })
 it('coalesces concurrent resumption requests',async()=>{
  const id=crypto.randomUUID();await queuePhoto(scope,id,file(),'Única')
  await Promise.all([syncAttendancePhotos(scope,id),syncAttendancePhotos(scope,id)])
  expect(remote.upload).toHaveBeenCalledOnce()
 })
 it('persists a second capture while the first upload is slow, then drains both',async()=>{
  const id=crypto.randomUUID();await queuePhoto(scope,id,file(),'Primeira')
  let release!:()=>void
  remote.upload.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve}))
  const sending=syncAttendancePhotos(scope,id)
  await vi.waitFor(()=>expect(remote.upload).toHaveBeenCalledOnce())
  await queuePhoto(scope,id,file(),'Segunda')
  expect(await pendingPhotos(scope,id)).toHaveLength(2)
  release();await sending
  expect(remote.upload).toHaveBeenCalledTimes(2);expect(await pendingPhotos(scope,id)).toEqual([])
 })
 it('blocks offline finalization and keeps cached attendance separated by account',async()=>{
  const id=crypto.randomUUID();await cachedAttendanceContent(scope,id);online(false)
  expect(await cachedAttendanceContent(scope,id)).toEqual({evidence:[]})
  await expect(cachedAttendanceContent({...scope,userId:'other'},id)).rejects.toThrow('com internet')
  await expect(finalizeWithPhotos(scope,id,'')).rejects.toThrow('Conecte-se')
  expect(remote.save).not.toHaveBeenCalled()
 })
 it('continues a different visit when one photograph has an upload error',async()=>{
  // Separate account keeps earlier intentionally retained failed fixtures out.
  const isolated={companyId:crypto.randomUUID(),userId:'tech-a'},bad=crypto.randomUUID(),good=crypto.randomUUID()
  await queuePhoto(isolated,bad,file(),'Inválida');await queuePhoto(isolated,good,file(),'Válida')
  remote.upload.mockImplementation(async input=>{if(input.appointmentId===bad)throw new Error('Falha da foto')})
  await syncAllAttendancePhotos(isolated)
  expect(await pendingPhotos(isolated,bad)).toHaveLength(1);expect(await pendingPhotos(isolated,good)).toEqual([])
 })
})
