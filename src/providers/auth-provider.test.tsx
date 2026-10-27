// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './auth-provider'
const mocks=vi.hoisted(()=>({ getSession:vi.fn(async()=>({data:{session:null}})) }))
vi.mock('../lib/supabase',()=>({hasSupabaseConfiguration:true,supabase:{auth:{getSession:mocks.getSession,onAuthStateChange:(callback:(event:string,session:null)=>void)=>{callback('INITIAL_SESSION',null);return {data:{listener:null,subscription:{unsubscribe:()=>{}}}}},signOut:async()=>({error:null})}}}))
function Identity(){const auth=useAuth();return <div>{auth.loading?'Carregando':auth.user?`${auth.user.id} / ${auth.memberships[0]?.role}`:'Sem sessão'}</div>}
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks()})
it('reopens the local technician workspace offline, even when initial session callback is null',async()=>{
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true})
  localStorage.setItem('fd-sst-offline-identity-v1',JSON.stringify({user:{id:'offline-tech'},profile:{id:'offline-tech',active:true,global_role:null},memberships:[{company_id:'company',role:'technician'}],expires:Date.now()+60000}))
  render(<AuthProvider><Identity/></AuthProvider>)
  expect(await screen.findByText('offline-tech / technician')).toBeTruthy()
  expect(mocks.getSession).not.toHaveBeenCalled()
})
it('does not use an expired offline identity',async()=>{
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true})
  localStorage.setItem('fd-sst-offline-identity-v1',JSON.stringify({user:{id:'expired'},expires:0}))
  render(<AuthProvider><Identity/></AuthProvider>);expect(await screen.findByText('Sem sessão')).toBeTruthy()
})
