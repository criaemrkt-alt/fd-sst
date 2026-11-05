// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import {File as NodeFile,Blob as NodeBlob} from 'node:buffer'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react'
import {QueryClient,QueryClientProvider,onlineManager} from '@tanstack/react-query'
const remote=vi.hoisted(()=>({upload:vi.fn(),save:vi.fn()}))
vi.mock('../lib/supabase',()=>({supabase:{auth:{getUser:async()=>({data:{user:{id:'tech'}},error:null})}}}))
vi.mock('../services/fd-sst',()=>({uploadTechnicianEvidence:remote.upload,saveTechnicianFieldRecord:remote.save,listAttendanceContent:async()=>({evidence:[],services:[],activities:[],notes:[],signature:null,checklists:[],answers:[]}),getPrivateObjectUrl:async()=>'',listChecklistTemplates:async()=>[],uploadTechnicianSignature:vi.fn()}))
import {cachedAttendanceContent,queuePhoto,pendingPhotos} from '../services/attendance-photo-store'
import {AttendancePhotosPanel,AttendancePhotoSync} from './attendance-photos'
import {AttendanceWorkflow} from './attendance-workflow'
import type {Membership,Appointment} from '../types/domain'
const online=(value:boolean)=>{Object.defineProperty(navigator,'onLine',{value,configurable:true});onlineManager.setOnline(value)}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('File',NodeFile);vi.stubGlobal('Blob',NodeBlob)
 URL.createObjectURL=vi.fn(()=> 'blob:test');URL.revokeObjectURL=vi.fn()
 remote.upload.mockResolvedValue(undefined);online(false)
})
afterEach(()=>{cleanup();onlineManager.setOnline(true);vi.unstubAllGlobals()})
describe('attendance offline photo experience',()=>{
 it('reopens the saved photo and observation after leaving the view',async()=>{
  const scope={companyId:crypto.randomUUID(),userId:'tech'},id=crypto.randomUUID()
  await queuePhoto(scope,id,new File(['original'],'camera.jpg',{type:'image/jpeg'}),'Saída obstruída','Corredor')
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  const view=()=> <QueryClientProvider client={client}><AttendancePhotosPanel scope={scope} appointmentId={id} /></QueryClientProvider>
  const first=render(view());expect(await screen.findByText('Saída obstruída')).toBeTruthy();first.unmount()
  render(view());expect(await screen.findByText('Local: Corredor')).toBeTruthy()
  expect(screen.getByRole('img',{name:'Saída obstruída'})).toBeTruthy();expect(remote.upload).not.toHaveBeenCalled()
 })
 it('sends automatically on reconnection without an extra workflow button',async()=>{
  const scope={companyId:crypto.randomUUID(),userId:'tech'},id=crypto.randomUUID()
  await queuePhoto(scope,id,new File(['original'],'camera.jpg',{type:'image/jpeg'}),'Observação para enviar')
  const membership={company_id:scope.companyId,user_id:scope.userId,role:'technician'} as Membership
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><AttendancePhotoSync membership={membership} /><AttendancePhotosPanel scope={scope} appointmentId={id} /></QueryClientProvider>)
  expect(await screen.findByText('Observação para enviar')).toBeTruthy()
  online(true);window.dispatchEvent(new Event('online'))
  await waitFor(()=>expect(remote.upload).toHaveBeenCalledOnce())
  await waitFor(async()=>expect(await pendingPhotos(scope,id)).toEqual([]))
  await waitFor(()=>expect(screen.queryByText('Observação para enviar')).toBeNull())
 })
 it('actually saves through the inspection form while React Query is offline and reopens from IndexedDB',async()=>{
  const scope={companyId:crypto.randomUUID(),userId:'tech'},id=crypto.randomUUID()
  online(true);await cachedAttendanceContent(scope,id);online(false)
  const membership={company_id:scope.companyId,user_id:scope.userId,role:'technician'} as Membership
  const appointment={id,company_id:scope.companyId,status:'in_progress',starts_at:'2026-11-05T10:00:00Z',clients:{name:'Visita offline'},service_type:'Inspeção'} as Appointment
  const view=()=> <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AttendanceWorkflow appointment={appointment} membership={membership} onBack={()=>undefined} /></QueryClientProvider>
  const first=render(view())
  fireEvent.click(await screen.findByRole('button',{name:'Inspeção'}))
  fireEvent.change(screen.getByLabelText('Foto da inspeção'),{target:{files:[new File(['source'],'offline.jpg',{type:'image/jpeg'})]}})
  fireEvent.change(screen.getByRole('textbox',{name:'Observação'}),{target:{value:'Observação gravada sem internet'}})
  fireEvent.click(screen.getByRole('button',{name:'Salvar inspeção'}))
  await waitFor(async()=>expect(await pendingPhotos(scope,id)).toHaveLength(1))
  first.unmount();render(view())
  expect(await screen.findByText('Observação gravada sem internet')).toBeTruthy()
  expect(remote.upload).not.toHaveBeenCalled()
 })
})
