import {createClient} from 'npm:@supabase/supabase-js@2.57.4'
import {cloudflareVision} from './providers.ts'
import {annotate,workingImage} from './images.ts'
import {assemblePowerPoint} from './powerpoint.ts'
import {reportIsPartial} from './core.ts'
const env=(key:string)=>Deno.env.get(key)
const db=createClient(env('SUPABASE_URL')!,env('SUPABASE_SERVICE_ROLE_KEY')!)
const bucket='fd-sst-ai-reports'
const checked=async(p:PromiseLike<any>)=>{const result=await p;if(result.error)throw result.error;return result.data}
const vision=cloudflareVision(env,async()=>{const limit=Number(env('CF_AI_DAILY_CALL_LIMIT')||0);if(!Number.isInteger(limit)||limit<1||limit>200)return false;const {data,error}=await db.rpc('reserve_photo_report_call',{call_limit:limit});if(error)throw error;return data===true})
Deno.serve(async(request:Request)=>{
 if(request.method!=='POST')return new Response('Method not allowed',{status:405})
 const body=await request.json().catch(()=>({}))
 if(!/^[a-f0-9-]{36}$/.test(body.job_id||'')||!/^[a-f0-9-]{36}$/.test(body.token||''))return new Response('Unauthorized',{status:401})
 const claim=await db.rpc('accept_photo_report_dispatch',{target:body.job_id,dispatch_token:body.token})
 const job=claim.data?.[0];if(claim.error||!job)return new Response('Unauthorized',{status:401})
 const prefix=`${job.company_id}/${job.appointment_id}/${job.id}`
 try{
  const pending=await checked(db.from('photo_report_items').select('*').eq('job_id',job.id).eq('status','pending').order('sort_order').limit(1))
  if(pending.length){
   const item=pending[0]
   let warning:string|null=null
   await checked(db.from('photo_report_jobs').update({status:'analyzing'}).eq('id',job.id))
   if(item.attempts>=3){
    await checked(db.from('photo_report_items').update({status:'failed',error_code:'photo_worker_interrupted'}).eq('id',item.id))
   }else try{
    // Persist before decoding: even a runtime memory/CPU shutdown consumes an
    // item attempt, so one invalid photograph cannot trap the entire report.
    await checked(db.from('photo_report_items').update({attempts:item.attempts+1}).eq('id',item.id))
    const original=await checked(db.storage.from(item.original_bucket).download(item.original_path))
    if(original.size>12*1024*1024)throw new Error('photo_exceeds_worker_memory_budget')
    const {image,jpeg}=await workingImage(new Uint8Array(await original.arrayBuffer()))
    const workPath=`${prefix}/work/${item.id}.jpg`
    await checked(db.storage.from(bucket).upload(workPath,jpeg,{contentType:'image/jpeg',upsert:true}))
    const thumbnailPath=`${prefix}/thumbnails/${item.id}.jpg`
    const thumb=image.clone();thumb.resize(Math.max(1,Math.round(thumb.width*.2)),Math.max(1,Math.round(thumb.height*.2)))
    await checked(db.storage.from(bucket).upload(thumbnailPath,await thumb.encodeJPEG(50),{contentType:'image/jpeg',upsert:true}))
    // Keep a readable original slide even if the external model fails later.
    await checked(db.from('photo_report_items').update({work_path:workPath,thumbnail_path:thumbnailPath}).eq('id',item.id))
    const analysis=await vision.analyze(jpeg,item.evidence_id)
    if(analysis.status==='unavailable')warning=analysis.note
    let annotatedPath=null
    if(analysis.findings.some(f=>f.box)){
     annotatedPath=`${prefix}/annotations/${item.id}.jpg`
     const annotated=await workingImage(await annotate(image,analysis.findings).encodeJPEG(55))
     await checked(db.storage.from(bucket).upload(annotatedPath,annotated.jpeg,{contentType:'image/jpeg',upsert:true}))
    }
    await checked(db.from('photo_report_items').update({status:'done',analysis,work_path:workPath,thumbnail_path:thumbnailPath,annotated_path:annotatedPath,model:analysis.status==='analyzed'?'@cf/meta/llama-3.2-11b-vision-instruct':null,error_code:null,attempts:item.attempts+1}).eq('id',item.id))
   }catch(error){
    const code=error instanceof Error?error.message:'photo_processing_failed'
    if(code==='quota_exhausted'){
     await checked(db.from('photo_report_items').update({attempts:item.attempts}).eq('id',item.id))
     await checked(db.from('photo_report_jobs').update({lease_until:null,next_attempt_at:new Date(Date.now()+3600000).toISOString(),error_code:'quota_exhausted',warning:'Cota de IA atingida. Processamento pausado para nova tentativa.'}).eq('id',job.id));return Response.json({paused:true})
    }
    const safeCode=/^vision_http_\d{3}$/.test(code)||['invalid_model_schema','invalid_finding_fields','working_copy_size_limit','photo_exceeds_worker_memory_budget'].includes(code)?code:'photo_processing_failed'
    console.error(JSON.stringify({job_id:job.id,item_id:item.id,error_code:safeCode}))
    await checked(db.from('photo_report_items').update({attempts:item.attempts+1,status:item.attempts>=2?'failed':'pending',error_code:safeCode}).eq('id',item.id))
   }
   const {count,error}=await db.from('photo_report_items').select('id',{count:'exact',head:true}).eq('job_id',job.id).neq('status','pending');if(error)throw error
   await checked(db.from('photo_report_jobs').update({photo_done:count||0,warning,lease_until:null,next_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',job.id))
  }else{
   await checked(db.from('photo_report_jobs').update({status:'assembling'}).eq('id',job.id))
   const a=await checked(db.from('appointments').select('*,clients(*)').eq('id',job.appointment_id).single())
   if(a.status!=='completed')throw new Error('appointment_not_finalized')
   const assignments=await checked(db.from('appointment_technicians').select('technician_id').eq('appointment_id',a.id))
   const profiles=assignments.length?await checked(db.from('profiles').select('full_name').in('id',assignments.map((r:any)=>r.technician_id))):[]
   const items=await checked(db.from('photo_report_items').select('*').eq('job_id',job.id).order('sort_order'))
   const [services,activities,notes,signature]=await Promise.all(['service_records','function_activities','appointment_notes','appointment_signatures'].map(table=>checked(db.from(table).select('*').eq('appointment_id',a.id))))
   let missingImages=false
   const bytes=await assemblePowerPoint({appointment:a,technicians:profiles.map((p:any)=>p.full_name).filter(Boolean).join(', ')||'Não informado',items,content:{services,activities,notes,signature:signature[0]},image:async(path)=>{const sig=signature[0];const isSignature=path==='signature'&&sig;const r=await db.storage.from(isSignature?sig.storage_bucket:bucket).download(isSignature?sig.storage_path:path);if(!r.data){missingImages=true;return null}return new Uint8Array(await r.data.arrayBuffer())}})
   if(bytes.length<1000||bytes[0]!==80||bytes[1]!==75)throw new Error('invalid_pptx')
   if(bytes.length>48*1024*1024)throw new Error('pptx_storage_limit')
   const path=`${prefix}/report.pptx`
   await checked(db.storage.from(bucket).upload(path,bytes,{contentType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',upsert:true}))
   await checked(db.from('reports').upsert({company_id:job.company_id,appointment_id:a.id,report_type:'automatic_pptx',storage_bucket:bucket,storage_path:path,photo_job_id:job.id,byte_size:bytes.length,generated_by:a.finalized_by},{onConflict:'appointment_id,report_type'}))
   const partial=missingImages||reportIsPartial(items)
   await checked(db.from('photo_report_jobs').update({status:partial?'partial':'completed',report_path:path,report_bytes:bytes.length,photo_done:items.length,lease_until:null,error_code:null,warning:partial?'Há fotos sem análise ou simulação de IA. Consulte as ressalvas no PowerPoint.':null,updated_at:new Date().toISOString()}).eq('id',job.id))
  }
  return Response.json({ok:true})
 }catch(error){
  const code=error instanceof Error&&['invalid_pptx','pptx_storage_limit','appointment_not_finalized'].includes(error.message)?error.message:'worker_processing_failed'
  console.error(JSON.stringify({job_id:job.id,error_code:code}))
  await db.from('photo_report_jobs').update({lease_until:null,next_attempt_at:new Date(Date.now()+Math.min(60,2**Math.min(job.attempts,5))*60000).toISOString(),error_code:code,warning:'Falha recuperável. O servidor tentará novamente.',updated_at:new Date().toISOString()}).eq('id',job.id)
  return Response.json({retry:true},{status:500})
 }
})
