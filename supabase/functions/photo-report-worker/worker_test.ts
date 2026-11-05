import {Image} from 'npm:imagescript@1.3.0'
import JSZip from 'npm:jszip@3.10.1'
import {writeFile} from 'node:fs/promises'
import process from 'node:process'
import {validateAnalysis,reportIsPartial,unavailableAnalysis} from './core.ts'
import {cloudflareVision} from './providers.ts'
import {annotate,workingImage} from './images.ts'
import {assemblePowerPoint} from './powerpoint.ts'
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message)}
const fixture=(confidence=.95)=>({findings:[{visible:'Caixa no corredor',risk:'Possível obstrução',severity:'medium',recommendation:'Verificar circulação presencialmente',confidence,box:{x:.2,y:.2,w:.3,h:.3},simulate:false}]})
Deno.test('coordinates, uncertainty, verified-only references and original preservation',async()=>{
 const certain=validateAnalysis({...fixture(),nr:'inventada'},'photo')
 assert(certain.findings[0].id==='photo-1','stable finding id')
 assert(!('nr' in certain.findings[0]),'unverified reference discarded')
 const uncertain=validateAnalysis(fixture(.5),'photo')
 assert(uncertain.findings[0].box===null,'uncertain region must not be marked')
 const original=new Image(160,120).fill(0x777777ff),before=original.bitmap.slice()
 const decoded=await Image.decode(await original.encodeJPEG(65))
 const unchanged=decoded.bitmap.slice();annotate(decoded,uncertain.findings)
 assert(decoded.bitmap.every((v:number,i:number)=>v===unchanged[i]),'uncertain image unchanged')
 annotate(decoded,certain.findings)
 assert(decoded.bitmap.some((v:number,i:number)=>v!==unchanged[i]),'certain box drawn')
 assert(original.bitmap.every((v:number,i:number)=>v===before[i]),'source image preserved')
})
Deno.test('disabled provider never calls external AI; quota pauses before fetch',async()=>{
 let reserves=0
 const unavailable=await cloudflareVision(()=>undefined,async()=>{reserves++;return false}).analyze(new Uint8Array(),'p')
 assert(unavailable.status==='unavailable'&&reserves===0,'no credential means no call')
 const values:Record<string,string>={CF_AI_ENABLED:'true',CF_AI_FREE_PLAN_CONFIRMED:'true',CF_ACCOUNT_ID:'test',CF_AI_TOKEN:'test'}
 let paused=false
 try{await cloudflareVision(k=>values[k],async()=>false).analyze(new Uint8Array(),'p')}catch(e){paused=(e as Error).message==='quota_exhausted'}
 assert(paused,'quota must stop before external call')
 assert(reportIsPartial([{status:'done',analysis:unavailable}]),'partial is explicit')
})
Deno.test('photo/model failure preserves original slide; illustrative simulations have an explicit label',async()=>{
 const jpeg=await new Image(120,100).fill(0x555555ff).encodeJPEG(55)
 const analysis=validateAnalysis(fixture(),'p');analysis.simulation_status='generated'
 const bytes=await assemblePowerPoint({appointment:{clients:{name:'Teste'}},technicians:'Teste',items:[{status:'failed',work_path:'original',observation:'Evidência mantida após falha de IA',analysis:null},{status:'done',work_path:'original-2',simulation_path:'simulated',analysis}],content:{},image:async()=>jpeg})
 const zip=await JSZip.loadAsync(bytes)
 const xml=(await Promise.all(Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).map(p=>zip.file(p)!.async('string')))).join('\n')
 assert(xml.includes('Evidência mantida após falha de IA'),'original observation preserved')
 assert(xml.includes('SIMULAÇÃO ILUSTRATIVA — GERADA POR IA'),'simulation label')
 assert(xml.includes('Concluído com ressalvas'),'partial state')
})
for(const count of [3,20,100])Deno.test(`real PPTX with ${count} distinct photos, observations and technician first`,async()=>{
 const photos=new Map<string,Uint8Array>()
 const items=[]
 for(let i=0;i<count;i++){
  const image=new Image(640,480).fill(((i+20)<<24|0x4488ff)>>>0)
  const {jpeg}=await workingImage(await image.encodeJPEG(65));photos.set(`photo-${i}`,jpeg)
  items.push({status:'done',work_path:`photo-${i}`,observation:`Observação única ${i}`,location_text:`Local ${i}`,analysis:unavailableAnalysis('Provedor não configurado')})
 }
 const started=performance.now()
 const bytes=await assemblePowerPoint({appointment:{clients:{name:'Cliente sintético'},starts_at:'2026-11-05T12:00:00Z',completed_at:'2026-11-05T13:00:00Z',service_type:'Inspeção'},technicians:'Técnica de Teste',items,content:{services:[],activities:[],notes:[]},image:async path=>photos.get(path)||null})
 const zip=await JSZip.loadAsync(bytes)
 if(count===3&&process.env.FD_REPORT_QA_OUTPUT)await writeFile(process.env.FD_REPORT_QA_OUTPUT,bytes)
 const second=await zip.file('ppt/slides/slide2.xml')!.async('string')
 assert(second.indexOf('TÉCNICO(S): Técnica de Teste')<second.indexOf('Cliente:'),'technician first')
 const slideFiles=Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p))
 const all=await Promise.all(slideFiles.map(p=>zip.file(p)!.async('string')))
 for(let i=0;i<count;i++)assert(all.some(s=>s.includes(`Observação única ${i}`)),`missing observation ${i}`)
 const media=Object.keys(zip.files).filter(p=>/^ppt\/media\/.+\.(jpeg|jpg)$/.test(p))
 assert(media.length===count,`all images embedded: ${media.length} of ${count}`)
 for(const p of media)assert((await zip.file(p)!.async('uint8array'))[0]===255,'valid JPEG embedded')
 console.log(JSON.stringify({photos:count,bytes:bytes.length,assembly_ms:Math.round(performance.now()-started)}))
})
Deno.test('100-photo assembly with high entropy JPEGs stays within storage budget',async()=>{
 const image=new Image(1200,900);let seed=41
 for(let i=0;i<image.bitmap.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;image.bitmap[i]=seed&255;image.bitmap[i+1]=(seed>>>8)&255;image.bitmap[i+2]=(seed>>>16)&255;image.bitmap[i+3]=255}
 const {jpeg}=await workingImage(await image.encodeJPEG(70))
 const items=Array.from({length:100},(_,i)=>({status:'done',work_path:`noise-${i}`,observation:`Foto de carga ${i}`,analysis:unavailableAnalysis('Teste sem chamada de IA')}))
 const started=performance.now()
 const bytes=await assemblePowerPoint({appointment:{clients:{name:'Teste de carga'}},technicians:'Teste',items,content:{},image:async()=>jpeg})
 const zip=await JSZip.loadAsync(bytes)
 assert(bytes.length<48*1024*1024,'storage budget')
 assert(Object.keys(zip.files).filter(p=>/^ppt\/slides\/slide\d+\.xml$/.test(p)).length>=100,'all slides exist')
 console.log(JSON.stringify({stress_photos:100,jpeg_bytes:jpeg.length,pptx_bytes:bytes.length,assembly_ms:Math.round(performance.now()-started)}))
})
