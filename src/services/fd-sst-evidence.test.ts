import {beforeEach,describe,expect,it,vi} from 'vitest'
const api=vi.hoisted(()=>({user:'tech',existing:null as null|{id:string;created_by:string},upload:vi.fn(),remove:vi.fn(),invoke:vi.fn()}))
vi.mock('../lib/supabase',()=>({supabase:{
 auth:{getUser:async()=>({data:{user:{id:api.user}},error:null})},
 storage:{from:()=>({upload:api.upload,remove:api.remove})},functions:{invoke:api.invoke},
 from:()=>{const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:api.existing,error:null})};return query},
}}))
import {uploadTechnicianEvidence} from './fd-sst'
const input=()=>({companyId:'company',appointmentId:'visit',file:new File(['source'],'photo.jpg',{type:'image/jpeg'}),observation:'Observação',evidenceId:crypto.randomUUID(),expectedUserId:'tech'})
beforeEach(()=>{vi.clearAllMocks();api.user='tech';api.existing=null;api.upload.mockResolvedValue({error:null});api.invoke.mockResolvedValue({data:{ok:true},error:null})})
describe('idempotent attendance evidence upload',()=>{
 it('uses the same private storage key when a retry finds an already uploaded file',async()=>{
  const photo=input();api.upload.mockResolvedValue({error:{statusCode:'409',message:'The resource already exists'}})
  await uploadTechnicianEvidence(photo)
  expect(api.upload.mock.calls[0][0]).toBe(`company/visit/${photo.evidenceId}-photo.jpg`)
  expect(api.invoke).toHaveBeenCalledOnce();expect(api.remove).not.toHaveBeenCalled()
 })
 it('keeps an uploaded object if confirmation is interrupted',async()=>{
  api.invoke.mockResolvedValue({data:null,error:{message:'Resposta perdida'}})
  await expect(uploadTechnicianEvidence(input())).rejects.toThrow('Resposta perdida')
  expect(api.remove).not.toHaveBeenCalled()
 })
 it('acknowledges a previously confirmed row without another upload or metadata write',async()=>{
  api.existing={id:'saved',created_by:'tech'}
  expect(await uploadTechnicianEvidence(input())).toBe('saved')
  expect(api.upload).not.toHaveBeenCalled();expect(api.invoke).not.toHaveBeenCalled()
 })
 it('does not transmit a saved photo after the account changes',async()=>{
  api.user='other';await expect(uploadTechnicianEvidence(input())).rejects.toThrow('mesma conta')
  expect(api.upload).not.toHaveBeenCalled()
 })
})
