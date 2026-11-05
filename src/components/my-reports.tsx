import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {supabase} from '../lib/supabase'
import {listAppointments} from '../services/fd-sst'
import {Button,EmptyState,Notice} from './ui'
const labels:Record<string,string>={queued:'Aguardando processamento',analyzing:'Processando fotografias',assembling:'Montando PowerPoint',completed:'Concluído',partial:'Concluído com ressalvas',failed:'Falha no processamento'}
export function MyReports({companyId,companyName}:{companyId:string;companyName?:string}){
 const [error,setError]=useState(''),[downloading,setDownloading]=useState('')
 const query=useQuery({queryKey:['photo-reports',companyId],refetchInterval:query=>query.state.data?.some(job=>['queued','analyzing','assembling'].includes(job.status))?15000:false,queryFn:async()=>{
  const [jobs,appointments]=await Promise.all([supabase!.from('photo_report_jobs').select('*').eq('company_id',companyId).order('created_at',{ascending:false}).limit(50),listAppointments(companyId)])
  if(jobs.error)throw jobs.error
  return Promise.all((jobs.data||[]).map(async job=>{
   let fileReady=false
   if(['completed','partial'].includes(job.status)&&job.report_path&&job.report_bytes){
    const file=await supabase!.storage.from('fd-sst-ai-reports').info(job.report_path)
    fileReady=!file.error&&Number(file.data?.size??file.data?.metadata?.size)===Number(job.report_bytes)
   }
   return {...job,fileReady,appointment:appointments.find(a=>a.id===job.appointment_id)}
  }))
 }})
 const download=async(job:NonNullable<typeof query.data>[number])=>{
  setError('');setDownloading(job.id)
  try{
   const {data,error:signError}=await supabase!.storage.from('fd-sst-ai-reports').createSignedUrl(job.report_path,120,{download:`Relatorio_${job.appointment_id}.pptx`})
   if(signError||!data)throw signError||new Error('Arquivo indisponível.')
   const link=document.createElement('a');link.href=data.signedUrl;link.rel='noreferrer';link.click()
  }catch{setError('Não foi possível baixar o arquivo. Verifique a conexão e tente novamente.')}finally{setDownloading('')}
 }
 return <section className="tech-page"><header className="tech-title-row"><div><h1>Meus Relatórios</h1><p>{companyName} · O processamento continua no servidor após a finalização.</p></div></header>{error&&<Notice kind="error">{error}</Notice>}{query.isLoading?<p>Carregando relatórios…</p>:query.error?<Notice kind="error">Não foi possível consultar os relatórios.</Notice>:!query.data?.length?<EmptyState title="Nenhum relatório">Os próximos atendimentos finalizados aparecerão aqui automaticamente.</EmptyState>:query.data.map(job=><article className="card" key={job.id}><h2>{job.appointment?.clients?.name||'Atendimento'}</h2><p>{job.appointment?.service_type} · {new Date(job.appointment?.starts_at||job.created_at).toLocaleString('pt-BR')}</p><strong>{labels[job.status]||job.status}</strong><p>Fotografias processadas: {job.photo_done} de {job.photo_total}</p>{job.warning&&<Notice kind="info">{job.warning}</Notice>}{job.error_code&&<small>Referência para suporte: {job.error_code}</small>}<div><Button disabled={!job.fileReady||downloading===job.id} onClick={()=>void download(job)}>{downloading===job.id?'Preparando download…':'Baixar PowerPoint (.pptx)'}</Button></div></article>)}</section>
}
