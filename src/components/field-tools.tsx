import { useState } from 'react'
import { AlertTriangle, CarFront, GraduationCap, Route, ThermometerSun } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, type UseFormRegister } from 'react-hook-form'
import type { Membership } from '../types/domain'
import { listAppointments, listClients, saveTechnicianFieldRecord } from '../services/fd-sst'
import { Button, Modal, Notice } from './ui'
import { useAuth } from '../providers/auth-provider'
import { supabase } from '../lib/supabase'

const localDateTime = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
type ClientSelectProps = { companyId: string; register: UseFormRegister<any> }
function ClientSelect({ companyId, register }: ClientSelectProps) {
  const { data: clients = [] } = useQuery({ queryKey: ['clients', companyId, 'all'], queryFn: () => listClients(companyId) })
  return <label>Cliente<select {...register('client_id', { required: true })} defaultValue=""><option value="" disabled>Selecione</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
}

export function TechnicianToolsPage({ membership }: { membership: Membership }) {
  const [open, setOpen] = useState<'travel' | 'heat' | 'accident' | 'training' | null>(null)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [historyType, setHistoryType] = useState<'travel' | 'heat' | 'accident' | 'training'>('travel')
  const { data: clients = [] } = useQuery({ queryKey: ['clients', membership.company_id, 'all'], queryFn: () => listClients(membership.company_id) })
  const history = useQuery({
    queryKey: ['field-history', membership.company_id, user?.id, historyType],
    enabled: !!user?.id,
    queryFn: async () => {
      if (!supabase || !user) throw new Error('Sessão indisponível')
      const config = { travel: ['travel_logs', 'technician_id', 'created_at'], heat: ['heat_assessments', 'created_by', 'measured_at'], accident: ['accident_investigations', 'created_by', 'occurred_at'], training: ['trainings', 'created_by', 'starts_at'] } as const
      const [table, owner, date] = config[historyType]
      const { data, error } = await supabase.from(table).select('*').eq('company_id', membership.company_id).eq(owner, user.id).order(date, { ascending: false }).limit(100)
      if (error) throw error
      return data ?? []
    },
  })
  const closeTool = () => { setOpen(null); void queryClient.invalidateQueries({ queryKey: ['field-history', membership.company_id, user?.id] }) }
  const tools = [
    ['travel', CarFront, 'Deslocamento e KM', 'Marque saída, chegada e quilometragem.'],
    ['heat', ThermometerSun, 'Calor (IBUTG)', 'Calcule e registre a avaliação térmica.'],
    ['accident', AlertTriangle, 'Acidente', 'Registre a investigação e recomendações.'],
    ['training', GraduationCap, 'Treinamentos', 'Cadastre treinamento e conteúdo aplicado.'],
  ] as const
  return <section className="tech-page"><header className="tech-title-row"><div><h1>Ferramentas de campo</h1><p>Registros rápidos da rotina técnica.</p></div></header><div className="field-tool-grid">{tools.map(([key, Icon, title, copy]) => <button key={key} className="field-tool-card" onClick={() => setOpen(key)}><Icon /><strong>{title}</strong><small>{copy}</small></button>)}</div><section className="card"><div className="section-title"><h2>Meus registros</h2></div><label>Tipo de registro<select value={historyType} onChange={(event) => setHistoryType(event.target.value as typeof historyType)}><option value="travel">Deslocamentos</option><option value="heat">Medições de calor</option><option value="accident">Investigações de acidente</option><option value="training">Treinamentos</option></select></label>{history.isLoading ? <p>Carregando registros...</p> : history.error ? <Notice kind="error">Não foi possível carregar os registros. Verifique sua conexão e tente novamente.</Notice> : !history.data?.length ? <p>Nenhum registro salvo nesta categoria.</p> : <div className="field-history">{history.data.map((record: any) => <details key={record.id} className="field-history-record"><summary><strong>{historyType === 'travel' ? `${record.distance_km ?? '—'} km` : historyType === 'heat' ? `IBUTG: ${record.calculated_ibutg ?? '—'}` : historyType === 'accident' ? record.occurrence_type || 'Investigação de acidente' : record.name}</strong><small>{new Date(record.measured_at || record.occurred_at || record.starts_at || record.created_at).toLocaleString('pt-BR')}</small></summary>{record.client_id && <p><b>Cliente:</b> {clients.find((client) => client.id === record.client_id)?.name || 'Não disponível'}</p>}{Object.entries(historyFields[historyType]).map(([key, label]) => record[key] !== null && record[key] !== undefined && record[key] !== '' ? <p key={key}><b>{label}:</b> {typeof record[key] === 'boolean' ? (record[key] ? 'Sim' : 'Não') : String(record[key])}</p> : null)}{historyType === 'heat' && <Notice kind="info">Resultado preliminar, sujeito à validação técnica.</Notice>}</details>)}</div>}</section>{open === 'travel' && <TravelModal membership={membership} onClose={closeTool} />}{open === 'heat' && <HeatModal companyId={membership.company_id} onClose={closeTool} />}{open === 'accident' && <AccidentModal companyId={membership.company_id} onClose={closeTool} />}{open === 'training' && <TrainingModal companyId={membership.company_id} onClose={closeTool} />}</section>
}

const historyFields = {
  travel: { departed_at: 'Saída', arrived_at: 'Chegada', ended_at: 'Encerramento', distance_km: 'Quilometragem', notes: 'Observações' },
  heat: { tbn: 'Bulbo natural', tg: 'Temperatura de globo', tbs: 'Bulbo seco', solar_exposure: 'Carga solar direta', activity_description: 'Atividade / posto', notes: 'Observações' },
  accident: { location_text: 'Local', worker_name: 'Colaborador', worker_role: 'Função', description: 'Descrição', circumstances: 'Circunstâncias', possible_causes: 'Possíveis causas', immediate_measures: 'Medidas imediatas', recommendations: 'Recomendações' },
  training: { location_text: 'Local', workload_minutes: 'Carga horária em minutos', instructor_name: 'Instrutor', syllabus: 'Conteúdo', notes: 'Observações' },
}

function RecordFooter({ pending, onClose, label }: { pending: boolean; onClose: () => void; label: string }) { return <><Notice kind="info">É necessário estar conectado à internet para salvar este registro. Não feche o formulário até confirmar o salvamento.</Notice><footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={pending}>{pending ? 'Salvando...' : label}</Button></footer></> }

function TravelModal({ membership, onClose }: { membership: Membership; onClose: () => void }) {
  const { user } = useAuth()
  const [started, setStarted] = useState(() => localStorage.getItem(`fd-sst-travel-${membership.company_id}`) || '')
  const { data: appointments = [] } = useQuery({ queryKey: ['technician-appointments', membership.company_id, user?.id], queryFn: () => listAppointments(membership.company_id, user!.id), enabled: !!user?.id })
  const { register, handleSubmit } = useForm<{ appointment_id: string; distance_km: string; notes: string }>({ defaultValues: { appointment_id: '', distance_km: '', notes: '' } })
  const mutation = useMutation({ mutationFn: (v: { appointment_id: string; distance_km: string; notes: string }) => saveTechnicianFieldRecord('save_travel', { company_id: membership.company_id, appointment_id: v.appointment_id || undefined, departed_at: started || localDateTime(), arrived_at: localDateTime(), ended_at: localDateTime(), distance_km: v.distance_km ? Number(v.distance_km) : null, distance_source: 'manual', notes: v.notes }), onSuccess: () => { localStorage.removeItem(`fd-sst-travel-${membership.company_id}`); onClose() } })
  const start = () => { const time = localDateTime(); localStorage.setItem(`fd-sst-travel-${membership.company_id}`, time); setStarted(time) }
  return <Modal title="Deslocamento e KM" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((v) => mutation.mutate(v))}><Notice kind="info">O horário é salvo neste aparelho até você finalizar e gravar o deslocamento.</Notice><label className="full">Atendimento (opcional)<select {...register('appointment_id')} defaultValue=""><option value="">Deslocamento sem atendimento</option>{appointments.filter((a) => a.status !== 'completed').map((a) => <option value={a.id} key={a.id}>{a.clients?.name || 'Cliente'} · {new Date(a.starts_at).toLocaleDateString('pt-BR')}</option>)}</select></label>{started ? <Notice kind="success">Saída iniciada em {new Date(started).toLocaleString('pt-BR')}.</Notice> : <Button type="button" className="button-secondary" onClick={start}><Route size={18} /> Iniciar deslocamento agora</Button>}<label>Quilometragem percorrida<input inputMode="decimal" type="number" min="0" step="0.1" {...register('distance_km')} /></label><label className="full">Observações<textarea rows={3} {...register('notes')} placeholder="Ex.: rota, pedágio, estacionamento" /></label>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<RecordFooter pending={mutation.isPending} onClose={onClose} label="Finalizar e salvar" /></form></Modal>
}

function HeatModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { register, handleSubmit, watch } = useForm<{ client_id: string; tbn: string; tg: string; tbs: string; solar_exposure: boolean; activity_description: string; notes: string }>({ defaultValues: { solar_exposure: false } })
  const values = watch(); const tbn = Number(values.tbn), tg = Number(values.tg), tbs = Number(values.tbs); const present = (value: string | undefined) => value !== undefined && value.trim() !== ''; const hasInputs = present(values.tbn) && present(values.tg) && Number.isFinite(tbn) && Number.isFinite(tg) && (!values.solar_exposure || (present(values.tbs) && Number.isFinite(tbs))); const result = hasInputs ? (values.solar_exposure ? .7 * tbn + .2 * tg + .1 * tbs : .7 * tbn + .3 * tg).toFixed(2) : null
  const mutation = useMutation({ mutationFn: (v: typeof values) => saveTechnicianFieldRecord('save_heat_assessment', { company_id: companyId, ...v, tbn: Number(v.tbn), tg: Number(v.tg), tbs: v.tbs ? Number(v.tbs) : null }), onSuccess: onClose })
  return <Modal title="Calor (IBUTG)" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((v) => mutation.mutate(v))}><ClientSelect companyId={companyId} register={register} /><label>Temperatura de bulbo natural (tbn)<input inputMode="decimal" type="number" step="0.1" {...register('tbn', { required: true })} required /></label><label>Temperatura de globo (tg)<input inputMode="decimal" type="number" step="0.1" {...register('tg', { required: true })} required /></label><label className="check-line full"><input type="checkbox" {...register('solar_exposure')} />Com carga solar direta</label>{values.solar_exposure && <label>Temperatura de bulbo seco (tbs)<input inputMode="decimal" type="number" step="0.1" {...register('tbs', { required: true })} required /></label>}<label className="full">Atividade / posto<textarea rows={2} {...register('activity_description')} placeholder="Ex.: operador de forno, ambiente externo" /></label>{result && <div className="calculation-result"><strong>IBUTG calculado: {result}</strong><small>{values.solar_exposure ? '0,7 tbn + 0,2 tg + 0,1 tbs' : '0,7 tbn + 0,3 tg'}</small></div>}<Notice kind="info">Registro preliminar: a conclusão de exposição exige validação técnica, taxa metabólica, aclimatização, vestimentas e demais condições aplicáveis.</Notice><label className="full">Observações<textarea rows={2} {...register('notes')} /></label>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<RecordFooter pending={mutation.isPending} onClose={onClose} label="Salvar avaliação" /></form></Modal>
}

function AccidentModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { register, handleSubmit } = useForm<{ client_id: string; occurred_at: string; location_text: string; worker_name: string; worker_role: string; occurrence_type: string; description: string; circumstances: string; possible_causes: string; immediate_measures: string; recommendations: string }>({ defaultValues: { occurred_at: localDateTime() } })
  const mutation = useMutation({ mutationFn: (v: any) => saveTechnicianFieldRecord('save_accident', { company_id: companyId, ...v, occurred_at: new Date(v.occurred_at).toISOString() }), onSuccess: onClose })
  return <Modal title="Investigação de acidente" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((v) => mutation.mutate(v))}><ClientSelect companyId={companyId} register={register} /><label>Data e hora<input type="datetime-local" {...register('occurred_at', { required: true })} required /></label><label>Colaborador<input {...register('worker_name')} /></label><label>Função<input {...register('worker_role')} /></label><label>Tipo de ocorrência<input {...register('occurrence_type')} placeholder="Ex.: queda, corte" /></label><label className="full">Local<input {...register('location_text')} /></label><label className="full">Descrição<input {...register('description', { required: true })} required /></label><label className="full">Circunstâncias<textarea rows={2} {...register('circumstances')} /></label><label className="full">Possíveis causas<textarea rows={2} {...register('possible_causes')} /></label><label className="full">Medidas imediatas<textarea rows={2} {...register('immediate_measures')} /></label><label className="full">Recomendações<textarea rows={2} {...register('recommendations')} /></label>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<RecordFooter pending={mutation.isPending} onClose={onClose} label="Salvar investigação" /></form></Modal>
}

function TrainingModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { register, handleSubmit } = useForm<{ client_id: string; name: string; starts_at: string; location_text: string; workload_minutes: string; instructor_name: string; syllabus: string; notes: string }>({ defaultValues: { starts_at: localDateTime() } })
  const mutation = useMutation({ mutationFn: (v: any) => saveTechnicianFieldRecord('save_training', { company_id: companyId, ...v, starts_at: new Date(v.starts_at).toISOString(), workload_minutes: v.workload_minutes ? Number(v.workload_minutes) : null }), onSuccess: onClose })
  return <Modal title="Novo treinamento" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((v) => mutation.mutate(v))}><ClientSelect companyId={companyId} register={register} /><label>Treinamento<input {...register('name', { required: true })} placeholder="Ex.: NR-35" required /></label><label>Início<input type="datetime-local" {...register('starts_at', { required: true })} required /></label><label>Carga horária (min)<input type="number" min="1" {...register('workload_minutes')} /></label><label>Instrutor<input {...register('instructor_name')} /></label><label className="full">Local<input {...register('location_text')} /></label><label className="full">Conteúdo programático<textarea rows={3} {...register('syllabus')} /></label><label className="full">Observações<textarea rows={2} {...register('notes')} /></label>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<RecordFooter pending={mutation.isPending} onClose={onClose} label="Salvar treinamento" /></form></Modal>
}
