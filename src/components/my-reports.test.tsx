// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {MyReports} from './my-reports'
const mocks=vi.hoisted(()=>({jobs:[] as Record<string,unknown>[],info:vi.fn(),sign:vi.fn()}))
vi.mock('../services/fd-sst',()=>({listAppointments:async()=>[{id:'visit',service_type:'Inspeção',clients:{name:'Cliente teste'}}]}))
vi.mock('../lib/supabase',()=>({supabase:{from:()=>({select:()=>({eq:()=>({order:()=>({limit:async()=>({data:mocks.jobs,error:null})})})})}),storage:{from:()=>({info:mocks.info,createSignedUrl:mocks.sign})}}}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
function open(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><MyReports companyId="company" /></QueryClientProvider>)}
describe('automatic reports download',()=>{
 it('enables a verified stored file and preserves partial warning',async()=>{
  mocks.jobs=[{id:'job',appointment_id:'visit',created_at:'2026-11-05',status:'partial',photo_done:1,photo_total:1,report_path:'company/visit/job/report.pptx',report_bytes:10000,warning:'IA indisponível'}]
  mocks.info.mockResolvedValue({data:{size:10000},error:null});open()
  const button=await screen.findByRole('button',{name:'Baixar PowerPoint (.pptx)'})
  await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false))
  expect(screen.getByText('Concluído com ressalvas')).toBeTruthy()
  expect(screen.getByText('IA indisponível')).toBeTruthy()
  expect(mocks.sign).not.toHaveBeenCalled()
 })
 it('keeps missing or truncated artifacts disabled',async()=>{
  mocks.jobs=[{id:'job',appointment_id:'visit',created_at:'2026-11-05',status:'completed',photo_done:20,photo_total:20,report_path:'missing.pptx',report_bytes:10000}]
  mocks.info.mockResolvedValue({data:{size:100},error:null});open()
  const button=await screen.findByRole('button',{name:'Baixar PowerPoint (.pptx)'})
  expect((button as HTMLButtonElement).disabled).toBe(true)
 })
})
