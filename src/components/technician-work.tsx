import { useState } from 'react'
import { CalendarDays, CheckCircle2, LogOut, MapPin, MessageCircle, Phone, Plus, UserRound } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../providers/auth-provider'
import { createTechnicianAppointment, createTechnicianClient, listAppointments, listClients } from '../services/fd-sst'
import type { Appointment, Client, Membership } from '../types/domain'
import { Button, EmptyState, LoadingState, Modal, Notice } from './ui'

type TechnicianAppointmentForm = {
  client_id: string
  service_type: string
  starts_at: string
  ends_at: string
  location_text: string
  description: string
}

const toLocalInput = (date = new Date()) => {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

function invalidateWork(queryClient: ReturnType<typeof useQueryClient>, companyId: string, userId?: string) {
  void queryClient.invalidateQueries({ queryKey: ['technician-appointments', companyId, userId] })
  void queryClient.invalidateQueries({ queryKey: ['appointments', companyId] })
}

export function TechnicianHome({ membership }: { membership: Membership }) {
  const [creating, setCreating] = useState(false)
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const { data: appointments = [], isLoading, error } = useQuery({ queryKey: ['technician-appointments', membership.company_id, user?.id], queryFn: () => listAppointments(membership.company_id, user!.id) })
  const today = appointments.filter((item) => new Date(item.starts_at).toDateString() === new Date().toDateString())
  const next = appointments.filter((item) => !['completed', 'cancelled'].includes(item.status)).slice(0, 4)
  return <section className="tech-page tech-page-home">
    <header className="tech-welcome"><div><p className="eyebrow">Sua rotina de campo</p><h1>Olá{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}</h1><p>Crie atendimentos, acompanhe a agenda e registre cada visita.</p></div><Button onClick={() => setCreating(true)}><Plus size={18} /> Novo</Button></header>
    <div className="metric-grid tech-metrics"><Metric label="Hoje" value={today.length} tone="blue" /><Metric label="Em andamento" value={appointments.filter((a) => a.status === 'in_progress').length} tone="yellow" /><Metric label="Pendentes" value={appointments.filter((a) => ['scheduled', 'pending_confirmation', 'confirmed'].includes(a.status)).length} tone="red" /></div>
    <section className="card"><div className="section-title"><h2>Próximos atendimentos</h2><button className="text-action" onClick={() => navigate('/app/technician/agenda')}>Ver agenda</button></div>{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar sua agenda.</Notice> : <TechnicianAppointmentList appointments={next} />}</section>
    <section className="tech-quick-actions"><button onClick={() => setCreating(true)}><CalendarDays /><span>Novo atendimento</span><small>Inclui automaticamente na sua agenda</small></button><button onClick={() => navigate('/app/technician/clients')}><UserRound /><span>Clientes</span><small>Consulte ou cadastre no local</small></button></section>
    {creating && <TechnicianAppointmentModal companyId={membership.company_id} onClose={() => setCreating(false)} />}
  </section>
}

export function TechnicianAgendaPage({ membership }: { membership: Membership }) {
  const [creating, setCreating] = useState(false)
  const { user } = useAuth()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['technician-appointments', membership.company_id, user?.id], queryFn: () => listAppointments(membership.company_id, user!.id) })
  const upcoming = data.filter((item) => !['completed', 'cancelled'].includes(item.status))
  const completed = data.filter((item) => ['completed', 'cancelled'].includes(item.status))
  return <section className="tech-page"><header className="tech-title-row"><div><h1>Agenda</h1><p>Seus atendimentos atribuídos e planejados.</p></div><Button onClick={() => setCreating(true)}><Plus size={18} /> Novo</Button></header>{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar sua agenda.</Notice> : <><section className="card"><div className="section-title"><h2>Em aberto</h2><span>{upcoming.length}</span></div><TechnicianAppointmentList appointments={upcoming} /></section>{completed.length > 0 && <section className="card"><div className="section-title"><h2>Encerrados</h2><span>{completed.length}</span></div><TechnicianAppointmentList appointments={completed} /></section>}</>}{creating && <TechnicianAppointmentModal companyId={membership.company_id} onClose={() => setCreating(false)} />}</section>
}

export function TechnicianActivitiesPage({ membership }: { membership: Membership }) {
  const { user } = useAuth()
  const { data = [], isLoading, error } = useQuery({ queryKey: ['technician-appointments', membership.company_id, user?.id], queryFn: () => listAppointments(membership.company_id, user!.id) })
  const actionable = data.filter((item) => !['completed', 'cancelled'].includes(item.status))
  return <section className="tech-page"><header className="tech-title-row"><div><h1>Atividades</h1><p>Priorize o que precisa ser executado em campo.</p></div></header>{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar as atividades. Verifique sua conexão e tente novamente.</Notice> : actionable.length ? <section className="card"><div className="section-title"><h2>Para executar</h2><span>{actionable.length}</span></div><TechnicianAppointmentList appointments={actionable} /></section> : <EmptyState title="Tudo em dia">Você não possui atendimentos pendentes. Use “Novo” na agenda quando precisar planejar uma visita.</EmptyState>}</section>
}

export function TechnicianMorePage({ membership }: { membership: Membership }) {
  const { user, profile, signOut } = useAuth()
  const signOutMutation = useMutation({ mutationFn: signOut })
  return <section className="tech-page"><header className="tech-title-row"><div><h1>Mais</h1><p>Seu acesso e atalhos de campo.</p></div></header><section className="card profile-card"><div className="profile-avatar">{(profile?.full_name || user?.email || 'T').slice(0, 1).toUpperCase()}</div><div><strong>{profile?.full_name || 'Técnico'}</strong><small>{membership.job_title || 'Profissional de SST'}</small><small>{user?.email}</small></div></section><section className="card"><div className="field-info"><span>Empresa</span><strong>{membership.companies?.name || 'Empresa vinculada'}</strong></div><div className="field-info"><span>Como usar</span><strong>Crie um atendimento na Agenda, inicie a visita e finalize ao concluir.</strong></div></section><section className="card tech-account-actions"><h2>Conta</h2><p>Encerre sua sessão neste celular ao terminar o uso.</p>{signOutMutation.error && <Notice kind="error">Não foi possível sair agora. Tente novamente.</Notice>}<Button className="button-secondary" disabled={signOutMutation.isPending} onClick={() => signOutMutation.mutate()}><LogOut size={18} /> {signOutMutation.isPending ? 'Saindo...' : 'Sair da conta'}</Button></section></section>
}

export function TechnicianClientsPage({ companyId }: { companyId: string }) {
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const { data: clients = [], isLoading, error } = useQuery({ queryKey: ['clients', companyId, search], queryFn: () => listClients(companyId, search) })
  return <section className="tech-page"><header className="tech-title-row"><div><h1>Clientes</h1><p>Consulte os dados que precisa para a visita.</p></div><Button onClick={() => setCreating(true)}><Plus size={18} /> Novo</Button></header><div className="toolbar"><input aria-label="Pesquisar clientes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar cliente" /></div>{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar os clientes.</Notice> : clients.length === 0 ? <EmptyState title="Nenhum cliente cadastrado">Cadastre o primeiro cliente para criar um atendimento.</EmptyState> : <section className="data-list">{clients.map((client) => <div className="data-row static-row" key={client.id}><span><strong>{client.name}</strong><small>{[client.city, client.state].filter(Boolean).join(' / ') || client.address_line || 'Local não informado'}</small></span>{client.phone && <a className="row-icon" href={`tel:${client.phone}`} aria-label={`Ligar para ${client.name}`}><Phone size={18} /></a>}</div>)}</section>}{creating && <TechnicianClientModal companyId={companyId} onClose={() => setCreating(false)} />}</section>
}

export function TechnicianAppointmentList({ appointments }: { appointments: Appointment[] }) {
  const navigate = useNavigate()
  if (!appointments.length) return <EmptyState title="Nenhum atendimento">Crie um novo atendimento para incluí-lo na sua agenda.</EmptyState>
  return <div className="appointment-list">{appointments.map((item) => <button key={item.id} className="appointment-row" onClick={() => navigate(`/app/technician/visit/${item.id}`)}><time>{new Date(item.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><span className="status-line" data-status={item.status} /><span className="appointment-copy"><strong>{item.clients?.name || 'Cliente'}</strong><small>{item.service_type} · {formatDate(item.starts_at)}</small></span><StatusBadge status={item.status} /></button>)}</div>
}

function TechnicianAppointmentModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const [addingClient, setAddingClient] = useState(false)
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data: clients = [], isLoading: clientsLoading } = useQuery({ queryKey: ['clients', companyId, 'all'], queryFn: () => listClients(companyId) })
  const { register, handleSubmit } = useForm<TechnicianAppointmentForm>({ defaultValues: { starts_at: toLocalInput(), ends_at: '', service_type: 'Inspeção SST', location_text: '', description: '' } })
  const mutation = useMutation({ mutationFn: createTechnicianAppointment, onSuccess: () => { invalidateWork(queryClient, companyId, user?.id); onClose() } })
  return <Modal title="Novo atendimento" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((values) => mutation.mutate({ ...values, company_id: companyId, starts_at: new Date(values.starts_at).toISOString(), ends_at: values.ends_at ? new Date(values.ends_at).toISOString() : undefined }))}><Notice kind="info">Este atendimento ficará atribuído a você e entrará na sua agenda.</Notice><label className="full">Cliente<div className="inline-select"><select {...register('client_id', { required: true })} defaultValue="" disabled={clientsLoading || !clients.length}><option value="" disabled>{clientsLoading ? 'Carregando...' : clients.length ? 'Selecione' : 'Cadastre um cliente'}</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><Button type="button" className="button-secondary" onClick={() => setAddingClient(true)}>Novo cliente</Button></div></label><label>Tipo de atendimento<input {...register('service_type', { required: true })} required /></label><label>Início<input type="datetime-local" {...register('starts_at', { required: true })} required /></label><label>Fim previsto<input type="datetime-local" {...register('ends_at')} /></label><label>Local<input {...register('location_text')} placeholder="Endereço ou ponto de encontro" /></label><label className="full">Observações<textarea rows={3} {...register('description')} placeholder="O que será realizado?" /></label>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending || !clients.length}>{mutation.isPending ? 'Salvando...' : 'Adicionar à agenda'}</Button></footer></form>{addingClient && <TechnicianClientModal companyId={companyId} onClose={() => setAddingClient(false)} />}</Modal>
}

function TechnicianClientModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { user } = useAuth(); const queryClient = useQueryClient()
  const { register, handleSubmit } = useForm<Pick<Client, 'name' | 'legal_name' | 'cnpj' | 'phone' | 'whatsapp' | 'email' | 'address_line' | 'city' | 'state' | 'business_activity' | 'cnae_input'>>()
  const mutation = useMutation({ mutationFn: createTechnicianClient, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clients', companyId] }); invalidateWork(queryClient, companyId, user?.id); onClose() } })
  return <Modal title="Novo cliente" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((values) => mutation.mutate({ ...values, company_id: companyId }))}><label>Nome / empresa<input {...register('name', { required: true })} required /></label><label>Razão social<input {...register('legal_name')} /></label><label>CNPJ<input inputMode="numeric" {...register('cnpj')} /></label><label>CNAE principal<input inputMode="numeric" {...register('cnae_input', { required: true })} placeholder="Ex.: 5611201" required /></label><label>Ramo de atuação<input {...register('business_activity')} /></label><label>E-mail de contato<input type="email" {...register('email')} /></label><label>Telefone<input type="tel" {...register('phone')} /></label><label>WhatsApp<input type="tel" {...register('whatsapp')} /></label><label className="full">Endereço<input {...register('address_line')} /></label><label>Município<input {...register('city')} /></label><label>UF<input maxLength={2} {...register('state')} /></label><Notice kind="info">O CNAE é obrigatório: ele cria o roteiro técnico adequado no início da visita.</Notice>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending}>{mutation.isPending ? 'Salvando...' : 'Salvar cliente'}</Button></footer></form></Modal>
}

export function TechnicianVisitActions({ appointment, onStatus, pending }: { appointment: Appointment; onStatus: (status: Appointment['status']) => void; pending: boolean }) {
  const client = appointment.clients
  const mapQuery = encodeURIComponent(appointment.location_text || client?.address_line || client?.name || '')
  return <><section className="visit-card"><div className="visit-details"><p><strong>Data e horário</strong><br />{formatDate(appointment.starts_at)}</p><p><strong>Local</strong><br />{appointment.location_text || client?.address_line || 'Não informado'}</p><p><strong>Status</strong><br /><StatusBadge status={appointment.status} /></p></div>{(client?.phone || client?.whatsapp || mapQuery) && <div className="visit-shortcuts">{client?.phone && <a href={`tel:${client.phone}`}><Phone size={17} /> Ligar</a>}{client?.whatsapp && <a href={`https://wa.me/${client.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={17} /> WhatsApp</a>}{mapQuery && <a href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`} target="_blank" rel="noreferrer"><MapPin size={17} /> Mapa</a>}</div>}{appointment.status === 'in_progress' ? <Button disabled={pending} onClick={() => onStatus('completed')}><CheckCircle2 size={18} /> Finalizar atendimento</Button> : appointment.status !== 'completed' && appointment.status !== 'cancelled' ? <Button disabled={pending} onClick={() => onStatus('in_progress')}><CalendarDays size={18} /> Iniciar atendimento</Button> : <Notice kind="success">Este atendimento foi concluído.</Notice>}</section></>
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div> }
export function StatusBadge({ status }: { status: Appointment['status'] }) { const labels = { scheduled: 'Agendado', pending_confirmation: 'A confirmar', confirmed: 'Confirmado', in_progress: 'Em andamento', completed: 'Concluído', cancelled: 'Cancelado' }; return <span className={`tag status-${status}`}>{labels[status]}</span> }
function formatDate(value: string) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
