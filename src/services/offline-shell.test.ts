import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
it('prepares versioned static assets and serves the cached shell offline without caching API data',async()=>{
  const handlers:Record<string,(event:any)=>void>={},saved=new Map<string,Response>()
  let offline=false
  const scope='https://example.com/fd-sst/'
  const cache={put:async(key:string,response:Response)=>saved.set(key,response),addAll:async(urls:string[])=>{for(const url of urls)saved.set(url,new Response('asset'))}}
  const self={registration:{scope},location:{origin:'https://example.com'},skipWaiting:async()=>{},clients:{claim:async()=>{}},addEventListener:(name:string,handler:(event:any)=>void)=>handlers[name]=handler}
  const caches={open:async()=>cache,match:async(key:string)=>saved.get(key),keys:async()=>[],delete:async()=>true}
  const fetch=async()=>{if(offline)throw new Error('offline');return new Response('<script src="/fd-sst/assets/app.js"></script><link href="/fd-sst/assets/app.css">')}
  runInNewContext(readFileSync('public/sw.js','utf8'),{self,caches,fetch,URL,Promise,Error})
  let work:Promise<unknown>=Promise.resolve()
  handlers.install({waitUntil:(value:Promise<unknown>)=>work=value});await work
  expect(saved.has(scope)).toBe(true);expect(saved.has(scope+'assets/app.js')).toBe(true)
  offline=true
  let response:Promise<Response>|undefined
  handlers.fetch({request:{url:scope,method:'GET',mode:'navigate'},respondWith:(value:Promise<Response>)=>response=value})
  expect(await (await response!).text()).toContain('app.js')
  response=undefined
  handlers.fetch({request:{url:'https://project.supabase.co/rest/v1/field_tool_records',method:'GET'},respondWith:(value:Promise<Response>)=>response=value})
  expect(response).toBeUndefined()
})
