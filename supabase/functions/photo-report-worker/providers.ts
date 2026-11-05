import { validateAnalysis, unavailableAnalysis, visionPrompt, type PhotoAnalysis } from './core.ts'
export interface VisionProvider { analyze(image:Uint8Array,photoId:string):Promise<PhotoAnalysis> }
export interface SimulationProvider { edit(image:Uint8Array,analysis:PhotoAnalysis):Promise<Uint8Array|null> }
// Paid/image-generation calls remain disabled until a compatible image-editing
// provider, its credentials and an explicitly authorized budget are configured.
export const noSimulation:SimulationProvider={async edit(){return null}}
export function cloudflareVision(env:(name:string)=>string|undefined,recordAttempt:()=>Promise<void>):VisionProvider {
 return {async analyze(image,photoId){
  if(env('CF_AI_ENABLED')!=='true'||env('CF_AI_FREE_PLAN_CONFIRMED')!=='true'||!env('CF_ACCOUNT_ID')||!env('CF_AI_TOKEN'))return unavailableAnalysis('Análise de IA não executada: provedor gratuito e credenciais ainda não configurados. Registros originais preservados.')
  await recordAttempt()
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${env('CF_ACCOUNT_ID')}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`,{method:'POST',headers:{Authorization:`Bearer ${env('CF_AI_TOKEN')}`,'Content-Type':'application/json'},body:JSON.stringify({image:Array.from(image),prompt:visionPrompt,max_tokens:1600}),signal:AbortSignal.timeout(45000)})
  if(response.status===429)throw new Error('quota_exhausted')
  if(!response.ok)throw new Error(`vision_http_${response.status}`)
  const body=await response.json();let raw=body.result?.response
  if(typeof raw==='string'){raw=JSON.parse(raw.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''))}
  return validateAnalysis(raw,photoId)
 }}
}
