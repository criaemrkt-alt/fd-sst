import PptxGenJS from 'npm:pptxgenjs@4.0.1'
import { reportIsPartial, type PhotoAnalysis } from './core.ts'
const date=(v:string)=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não informado'
const str=(v:unknown)=>typeof v==='string'&&v.trim()?v:'Não informado'
export async function assemblePowerPoint(input:{appointment:any;technicians:string;items:any[];content:any;image:(path:string)=>Promise<Uint8Array|null>}) {
 const {appointment:a,technicians,items,content}=input
 const Presentation=PptxGenJS as unknown as {new():any}
 const ppt=new Presentation();ppt.layout='LAYOUT_WIDE';ppt.author='FD SST';ppt.title=`Relatório ${a.clients?.name||''}`;ppt.lang='pt-BR'
 const text=(s:any,t:string,x:number,y:number,w:number,h:number,size=17,bold=false)=>s.addText(t,{x,y,w,h,fontFace:'Aptos',fontSize:size,bold,color:'141719',margin:0,fit:'shrink',breakLine:false,valign:'top'})
 const slide=(title:string)=>{const s=ppt.addSlide();s.background={color:'FFFFFF'};s.addShape('rect',{x:0,y:0,w:13.333,h:.12,fill:{color:'FFC514'},line:{color:'FFC514'}});text(s,title,.5,.35,12,.5,25,true);text(s,'FD SST | Apoio à avaliação técnica presencial',.5,7.12,12,.18,9);return s}
 const lines=(title:string,body:string)=>{const paragraphs=body.match(/[\s\S]{1,1800}/g)||['Não informado'];for(const [i,part]of paragraphs.entries()){const s=slide(title+(i?' (continuação)':''));text(s,part,.6,1.2,12,5.7,17)}}
 const base64=(b:Uint8Array)=>{let out='';for(let i=0;i<b.length;i+=8192)out+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(out)}
 const addImage=async(s:any,path:string)=>{const bytes=await input.image(path);if(bytes)s.addImage({data:`image/${bytes[0]===137?'png':'jpeg'};base64,${base64(bytes)}`,x:.6,y:1.2,w:8,h:5.5,sizing:{type:'contain',x:.6,y:1.2,w:8,h:5.5}});else text(s,'Imagem indisponível nesta versão.',.6,2,8,1)}
 let s=slide('Relatório de atendimento técnico');text(s,str(a.clients?.name),.6,1.7,12,1,32,true);text(s,`Técnico(s): ${technicians}\n${date(a.starts_at)}\n${str(a.service_type)}`,.6,3.3,12,2,22)
 s=slide('Informações do atendimento');text(s,`TÉCNICO(S): ${technicians}\n\nCliente: ${str(a.clients?.name)}\nData e horário: ${date(a.starts_at)}\nLocal: ${str(a.location_text||a.clients?.address_line)}\nTipo: ${str(a.service_type)}\nCNAE: ${str(a.clients?.cnae_code||a.clients?.cnae_input)}\nFinalização: ${date(a.completed_at)}`,.6,1.25,12,5.6,20)
 const findings=items.flatMap(i=>i.analysis?.findings||[]),unavailable=items.filter(i=>i.status==='failed'||i.analysis?.status!=='analyzed').length
 lines('Resumo do processamento',`Fotos: ${items.length}\nPossíveis situações apontadas pela IA: ${findings.length}\nSimulações: ${items.filter(i=>i.simulation_path).length}\nFotos sem análise de IA disponível: ${unavailable}\n\n${reportIsPartial(items)?'Concluído com ressalvas. Há análises ou simulações não executadas. Consulte as observações de cada foto.':'Sugestões de IA sujeitas à validação técnica presencial.'}\n\nA ausência de apontamentos na foto não comprova segurança ou conformidade.`)
 lines('Registros originais do profissional',`Descrição inicial: ${str(a.description)}\nFinalização: ${str(a.finalization_note)}`)
 for(const [title,records,format]of [
  ['Serviços registrados',content.services,(r:any)=>`${str(r.service_name)}\n${str(r.notes)}`],
  ['Funções observadas',content.activities,(r:any)=>`${str(r.role_name)} | ${str(r.sector)}\n${str(r.description)}\n${str(r.notes)}`],
  ['Observações do profissional',content.notes,(r:any)=>`${str(r.note_kind)}\n${str(r.body)}`]
 ] as any[])for(const r of records||[])lines(title,format(r))
 for(const [index,item]of items.entries()){
  s=slide(`Inspeção ${index+1} | Foto original (cópia otimizada)`);if(item.work_path)await addImage(s,item.work_path);else text(s,'Foto indisponível: '+str(item.error_code),.6,1.5,8,1)
  text(s,`REGISTRO ORIGINAL\n${str(item.observation)}\n\nLocal: ${str(item.location_text)}`,8.9,1.2,3.8,5.6,16)
  if(item.source_details?.recommendation||item.source_details?.additional_notes)lines(`Inspeção ${index+1} | Registros complementares do profissional`,`Risco registrado: ${str(item.source_details.risk_level)}\nRecomendação: ${str(item.source_details.recommendation)}\nInformações adicionais: ${str(item.source_details.additional_notes)}`)
  const analysis=item.analysis as PhotoAnalysis|null
  if(item.annotated_path){s=slide(`Inspeção ${index+1} | Apontamentos da IA`);await addImage(s,item.annotated_path);text(s,'Números correspondem aos apontamentos nos próximos slides. Regiões incertas ficam somente em texto.',8.9,1.2,3.8,5.2,17)}
  if(item.simulation_path){s=slide('SIMULAÇÃO ILUSTRATIVA — GERADA POR IA');await addImage(s,item.simulation_path);text(s,'Possibilidade ilustrativa de adequação. Sujeita à validação profissional. Não comprova correção realizada.',8.9,1.2,3.8,5.2,18,true)}
  if(!analysis||analysis.status!=='analyzed')lines(`Inspeção ${index+1} | Análise não executada`,analysis?.note||'Situação que necessita de verificação técnica presencial. Foto indisponível para processamento.')
  else if(!analysis.findings.length)lines(`Inspeção ${index+1} | Limitações`,analysis.note+'\n\nNenhuma conclusão de segurança ou conformidade pode ser obtida somente desta fotografia.')
  for(const [n,f]of (analysis?.findings||[]).entries())lines(`Inspeção ${index+1} | Apontamento ${n+1}`,`SUGESTÃO DE IA\nVisível: ${f.visible}\nPossível risco: ${f.risk}\nGravidade estimada: ${f.severity}\nRecomendação para validação: ${f.recommendation}\nConfiança informada pelo modelo: ${Math.round(f.confidence*100)}%\nReferência normativa: não validada, nenhum item de NR atribuído.\nSituação que necessita de verificação técnica presencial.\n${f.box?'':'Região incerta: nenhuma marcação desenhada.'}\n${f.simulate?'Simulação não executada: serviço de edição não configurado.':''}`)
 }
 if(content.signature){lines('Ciência e assinatura',`Responsável: ${str(content.signature.signer_name)}\nCargo: ${str(content.signature.signer_job_title)}\nAssinatura registrada em: ${date(content.signature.signed_at)}`);s=slide('Assinatura registrada');await addImage(s,'signature')}
 lines('Conclusão e pendências','Priorize a validação presencial dos apontamentos de maior gravidade estimada. As observações do profissional permanecem separadas das sugestões da IA.\n\nNão há simulações de correção nesta versão quando o serviço de edição não estiver configurado. Qualquer simulação futura será ilustrativa, identificada e não servirá como evidência de correção realizada.\n\nConsulte os registros digitais completos e as fotos originais no FD SST.')
 return new Uint8Array(await ppt.write({outputType:'arraybuffer',compression:false}) as ArrayBuffer)
}
