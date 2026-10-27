import { useMemo, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CheckSquare, ChevronRight, ClipboardList, Factory, FileText, Home, LogOut, MapPin, Menu, Plus, ShieldCheck, Users, Wrench } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useAuth } from './providers/auth-provider'
import { supabase } from './lib/supabase'
import { createAppointment, listAppointments, listClients, saveClient } from './services/fd-sst'
import { Button, EmptyState, LoadingState, Modal, Notice } from './components/ui'
import { MasterAccessPage } from './components/master-access'
import { TechnicianManagementPage } from './components/technician-management'
import { TechnicianActivitiesPage, TechnicianAgendaPage, TechnicianClientsPage, TechnicianHome, TechnicianMorePage } from './components/technician-work'
import { TechnicianToolsPage } from './components/field-tools'
import { AttendanceWorkflow } from './components/attendance-workflow'
import type { Appointment, Client, Membership } from './types/domain'

export function App() {
  const { configured, loading, user, profile, memberships, identityError } = useAuth()
  if (!configured) return <SetupRequired />
  if (loading) return <LoadingState />
  if (!user) return <Login />
  if (identityError) return <IdentityUnavailable />
  if (!profile?.active) return <AccessBlocked />
  if (profile.global_role === 'master') return <MasterArea />
  if (!memberships.length) return <EmptyState title="Acesso ainda não vinculado">Seu usuário foi autenticado, mas ainda não pertence a uma empresa ativa. Peça ao Master ou ao administrador que conclua o convite.</EmptyState>
  return <CompanyArea memberships={memberships} />
}

function SetupRequired() {
  return <main className="setup-page"><section className="setup-card"><div className="brand-mark">FD</div><h1>FD SST</h1><p>O front-end está pronto, mas não há conexão pública com o Supabase configurada.</p><ol><li>Crie ou conecte um projeto Supabase exclusivo para o FD SST.</li><li>Aplique a migração inicial da pasta <code>supabase/migrations</code>.</li><li>Copie <code>.env.example</code> para <code>.env</code> e preencha apenas a URL e a chave publicável.</li></ol><Notice kind="info">Nenhum dado demonstrativo é exibido nesta tela.</Notice></section></main>
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const signIn = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true)
    const { error: authError } = await supabase!.auth.signInWithPassword({ email, password })
    setLoading(false); if (authError) setError(authError.message)
  }
  return <main className="login-page"><section className="login-panel"><div className="login-brand"><div className="brand-mark">FD</div><span>FD SST</span></div><h1>Acesse sua área de trabalho</h1><p>Gestão de Segurança e Saúde no Trabalho.</p><form onSubmit={signIn}><label>E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{error && <Notice kind="error">{error}</Notice>}<Button disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</Button></form><p className="login-help">Esqueceu a senha? Peça ao administrador da sua empresa para criar uma nova. Não há confirmação de e-mail para entrar.</p></section></main>
}

function AccessBlocked() { return <main className="setup-page"><EmptyState title="Acesso desativado">Este usuário não está ativo. Fale com o administrador da empresa.</EmptyState></main> }

function IdentityUnavailable() { return <main className="setup-page"><EmptyState title="Não foi possível carregar o acesso">Verifique sua conexão e atualize a página. Sua conta não foi desativada.</EmptyState></main> }

function MasterArea() {
  return <main className="admin-layout"><aside className="sidebar"><Brand /><nav><NavItem to="/app/master" end icon={<Home />} label="Visão geral" /><NavItem to="/app/master/companies" icon={<Factory />} label="Empresas" /><NavItem to="/app/master/access" icon={<Users />} label="Acessos" /></nav><SignOut /></aside><section className="admin-content"><Routes><Route path="/app/master" element={<MasterDashboard />} /><Route path="/app/master/companies" element={<MasterDashboard />} /><Route path="/app/master/access" element={<MasterAccessPage />} /><Route path="*" element={<Navigate to="/app/master" replace />} /></Routes></section></main>
}

function MasterDashboard() {
  const [creating, setCreating] = useState(false)
  const { data: companies = [], isLoading, error } = useQuery({ queryKey: ['master-companies'], queryFn: async () => { const { data, error: queryError } = await supabase!.from('companies').select('id, name, legal_name, city, state, status, created_at, company_memberships(count)').order('created_at', { ascending: false }); if (queryError) throw queryError; return data ?? [] } })
  return <section className="page"><PageHeading title="Empresas" subtitle="Cadastre empresas e controle quais permanecem ativas no sistema." action={<Button onClick={() => setCreating(true)}><Plus size={18} /> Nova empresa</Button>} /><Notice kind="info">Ao cadastrar, defina o administrador e a senha inicial. Esse acesso já nasce confirmado, sem e-mail de validação.</Notice>{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar as empresas cadastradas.</Notice> : companies.length === 0 ? <EmptyState title="Nenhuma empresa cadastrada">Cadastre a primeira empresa e defina o login do administrador.</EmptyState> : <section className="data-list">{companies.map((company: any) => <div className="data-row static-row" key={company.id}><span><strong>{company.name}</strong><small>{[company.city, company.state].filter(Boolean).join(' / ') || 'Local não informado'}</small></span><span className={`tag ${company.status === 'active' ? 'status-confirmed' : 'status-cancelled'}`}>{company.status === 'active' ? 'Ativa' : 'Inativa'}</span><CompanyStatusButton company={company} /></div>)}</section>}{creating && <CreateCompanyForm onClose={() => setCreating(false)} />}</section>
}

function CompanyStatusButton({ company }: { company: { id: string; status: 'active' | 'inactive' } }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({ mutationFn: async () => { const status = company.status === 'active' ? 'inactive' : 'active'; const { error } = await supabase!.functions.invoke('manage-company-access', { body: { action: 'set_company_status', company_id: company.id, status } }); if (error) throw error }, onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['master-companies'] }) })
  return <Button className="button-secondary" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{company.status === 'active' ? 'Desativar' : 'Ativar'}</Button>
}

function CreateCompanyForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { register, handleSubmit } = useForm<{ name: string; legal_name: string; cnpj: string; phone: string; email: string; city: string; state: string; admin_name: string; admin_email: string; admin_password: string }>()
  const mutation = useMutation({ mutationFn: async (values: { name: string; legal_name: string; cnpj: string; phone: string; email: string; city: string; state: string; admin_name: string; admin_email: string; admin_password: string }) => {
    const { admin_name, admin_email, admin_password, ...companyInput } = values
    const { data: company, error } = await supabase!.from('companies').insert(companyInput).select('id').single()
    if (error) throw error
    const { error: accessError } = await supabase!.functions.invoke('manage-company-access', { body: { action: 'create_admin', company_id: company.id, full_name: admin_name, email: admin_email, password: admin_password } })
    if (accessError) throw new Error(`Empresa cadastrada, mas o login do administrador falhou: ${accessError.message}`)
  }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['master-companies'] }); onClose() } })
  return <Modal title="Cadastrar empresa" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((values) => mutation.mutate(values))}><label>Nome fantasia<input {...register('name', { required: true })} required /></label><label>Razão social<input {...register('legal_name')} /></label><label>CNPJ<input inputMode="numeric" {...register('cnpj')} /></label><label>Telefone<input inputMode="tel" {...register('phone')} /></label><label>E-mail da empresa<input type="email" {...register('email')} /></label><label>Município<input {...register('city')} /></label><label>UF<input maxLength={2} {...register('state')} /></label><span /><fieldset className="full"><legend>Administrador inicial</legend><div className="form-grid"><label>Nome<input {...register('admin_name', { required: true })} required /></label><label>E-mail de login<input type="email" {...register('admin_email', { required: true })} required /></label><label className="full">Senha inicial<input type="password" minLength={8} autoComplete="new-password" {...register('admin_password', { required: true, minLength: 8 })} required /></label></div></fieldset>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending}>{mutation.isPending ? 'Cadastrando…' : 'Cadastrar empresa'}</Button></footer></form></Modal>
}

function CompanyArea({ memberships }: { memberships: Membership[] }) {
  const [activeCompanyId, setActiveCompanyId] = useState(memberships[0].company_id)
  const membership = memberships.find((item) => item.company_id === activeCompanyId) ?? memberships[0]
  return membership.role === 'admin'
    ? <AdminArea membership={membership} memberships={memberships} onCompanyChange={setActiveCompanyId} />
    : <TechnicianArea membership={membership} memberships={memberships} onCompanyChange={setActiveCompanyId} />
}

function AdminArea({ membership, memberships, onCompanyChange }: { membership: Membership; memberships: Membership[]; onCompanyChange: (id: string) => void }) {
  const navigation = <><NavItem to="/app/admin" end icon={<Home />} label="Dashboard" /><NavItem to="/app/admin/agenda" icon={<CalendarDays />} label="Agenda" /><NavItem to="/app/admin/appointments" icon={<ClipboardList />} label="Atendimentos" /><NavItem to="/app/admin/clients" icon={<Factory />} label="Clientes" /><NavItem to="/app/admin/technicians" icon={<Users />} label="Técnicos" /><NavItem to="/app/admin/templates" icon={<CheckSquare />} label="Modelos" /><NavItem to="/app/admin/company" icon={<Wrench />} label="Empresa" /></>
  return <main className="admin-layout"><aside className="sidebar"><Brand /><CompanySelect memberships={memberships} value={membership.company_id} onChange={onCompanyChange} /><nav>{navigation}</nav><SignOut /></aside><header className="mobile-admin-header"><div><Brand /><SignOut /></div><CompanySelect memberships={memberships} value={membership.company_id} onChange={onCompanyChange} /></header><nav className="mobile-admin-nav" aria-label="Navegação administrativa">{navigation}</nav><section className="admin-content"><Routes><Route path="/app/admin" element={<AdminDashboard companyId={membership.company_id} />} /><Route path="/app/admin/agenda" element={<AdminAgendaPage companyId={membership.company_id} />} /><Route path="/app/admin/appointments" element={<AppointmentsPage companyId={membership.company_id} />} /><Route path="/app/admin/appointments/:id" element={<AdminAttendancePage membership={membership} />} /><Route path="/app/admin/clients" element={<ClientsPage companyId={membership.company_id} />} /><Route path="/app/admin/technicians" element={<TechnicianManagementPage companyId={membership.company_id} />} /><Route path="*" element={<PendingModule />} /></Routes></section></main>
}

function TechnicianArea({ membership, memberships, onCompanyChange }: { membership: Membership; memberships: Membership[]; onCompanyChange: (id: string) => void }) {
  return <main className="technician-layout"><header className="tech-header"><Brand /><CompanySelect memberships={memberships} value={membership.company_id} onChange={onCompanyChange} /></header><section className="tech-content"><Routes><Route path="/app/technician" element={<TechnicianDashboard membership={membership} />} /><Route path="/app/technician/agenda" element={<TechnicianAgenda membership={membership} />} /><Route path="/app/technician/visit/:id" element={<VisitPage membership={membership} />} /><Route path="/app/technician/clients" element={<TechnicianClientsPage companyId={membership.company_id} />} /><Route path="/app/technician/activities" element={<TechnicianActivitiesPage membership={membership} />} /><Route path="/app/technician/tools" element={<TechnicianToolsPage membership={membership} />} /><Route path="/app/technician/more" element={<TechnicianMorePage membership={membership} />} /><Route path="*" element={<Navigate to="/app/technician" replace />} /></Routes></section><nav className="bottom-nav"><NavItem to="/app/technician" end icon={<Home />} label="Início" /><NavItem to="/app/technician/agenda" icon={<CalendarDays />} label="Agenda" /><NavItem to="/app/technician/clients" icon={<Factory />} label="Clientes" /><NavItem to="/app/technician/tools" icon={<Wrench />} label="Ferramentas" /><NavItem to="/app/technician/more" icon={<Menu />} label="Mais" /></nav></main>
}

function AdminDashboard({ companyId }: { companyId: string }) {
  const { data: appointments = [], isLoading, error } = useQuery({ queryKey: ['appointments', companyId], queryFn: () => listAppointments(companyId) })
  const stats = useMemo(() => ({ today: appointments.filter((a) => new Date(a.starts_at).toDateString() === new Date().toDateString()).length, inProgress: appointments.filter((a) => a.status === 'in_progress').length, pending: appointments.filter((a) => a.status === 'pending_confirmation').length, completed: appointments.filter((a) => a.status === 'completed').length }), [appointments])
  return <section className="page"><PageHeading title="Dashboard" subtitle="Visão operacional da sua empresa." />{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar os indicadores.</Notice> : <><div className="metric-grid"><Metric label="Visitas hoje" value={stats.today} tone="blue" /><Metric label="Concluídas" value={stats.completed} tone="green" /><Metric label="Em andamento" value={stats.inProgress} tone="yellow" /><Metric label="Pendentes" value={stats.pending} tone="red" /></div><section className="card"><div className="section-title"><h2>Próximos atendimentos</h2><NavLink to="appointments">Ver agenda</NavLink></div><AppointmentList appointments={appointments.slice(0, 5)} /></section></>}</section>
}

function AdminAgendaPage({ companyId }: { companyId: string }) {
  const today = new Date()
  const [selectedDate, setSelectedDate] = useState(toDateKey(today))
  const { data: appointments = [], isLoading, error } = useQuery({ queryKey: ['appointments', companyId], queryFn: () => listAppointments(companyId) })
  const days = useMemo(() => Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(today)
    date.setDate(today.getDate() + offset)
    return { key: toDateKey(date), weekday: new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(date).replace('.', ''), day: date.getDate(), month: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', '') }
  }), [])
  const dailyAppointments = appointments.filter((appointment) => toDateKey(new Date(appointment.starts_at)) === selectedDate && appointment.status !== 'cancelled')
  const current = appointments.filter((appointment) => appointment.status === 'in_progress')

  return <section className="page"><PageHeading title="Agenda dos técnicos" subtitle="Acompanhe onde cada técnico está e os próximos atendimentos programados." />{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar a agenda dos técnicos.</Notice> : <><section className="agenda-summary"><strong>{current.length ? `${current.length} técnico(s) em atendimento agora` : 'Nenhum técnico em atendimento agora'}</strong><span>O local exibido é o definido no agendamento. A localização GPS em tempo real não é compartilhada por esta agenda.</span></section><nav className="agenda-days" aria-label="Escolha o dia da agenda">{days.map((day) => <button type="button" key={day.key} className={day.key === selectedDate ? 'active' : ''} onClick={() => setSelectedDate(day.key)}><small>{day.weekday}</small><strong>{day.day}</strong><span>{day.month}</span></button>)}</nav><section className="agenda-list">{dailyAppointments.length ? dailyAppointments.map((appointment) => <AdminAgendaItem key={appointment.id} appointment={appointment} />) : <EmptyState title="Sem atendimentos neste dia">Escolha outra data ou agende um atendimento para os técnicos.</EmptyState>}</section></>}</section>
}

function AdminAgendaItem({ appointment }: { appointment: Appointment }) {
  const technicians = appointment.appointment_technicians?.map((item) => item.profiles?.full_name).filter(Boolean).join(', ') || 'Técnico ainda não atribuído'
  const location = appointment.location_text || appointment.clients?.address_line || appointment.clients?.name || 'Local não informado'
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
  return <article className="agenda-item"><time>{new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(appointment.starts_at))}</time><span className="status-line" data-status={appointment.status} /><div className="agenda-item-copy"><div><strong>{appointment.clients?.name || 'Cliente'}</strong><StatusBadge status={appointment.status} /></div><span>{appointment.service_type}</span><b>{technicians}</b><a href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={15} /> {location}</a></div></article>
}

function TechnicianDashboard({ membership }: { membership: Membership }) {
  return <TechnicianHome membership={membership} />
}

function ClientsPage({ companyId, compact = false }: { companyId: string; compact?: boolean }) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Client | null | 'new'>(null)
  const queryClient = useQueryClient()
  const { data: clients = [], isLoading, error } = useQuery({ queryKey: ['clients', companyId, search], queryFn: () => listClients(companyId, search) })
  const mutation = useMutation({ mutationFn: saveClient, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['clients', companyId] }); setEditing(null) } })
  return <section className={compact ? 'tech-page' : 'page'}><PageHeading title="Clientes" subtitle="Dados cadastrais e informações de SST." action={!compact ? <Button onClick={() => setEditing('new')}><Plus size={18} /> Novo cliente</Button> : undefined} /><div className="toolbar"><input aria-label="Pesquisar clientes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por empresa" />{!compact && <Button className="button-secondary" onClick={() => alert('A importação Excel será habilitada após a conexão do Supabase e a inclusão da biblioteca de importação.')}>Importar Excel</Button>}</div>{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar os clientes.</Notice> : clients.length === 0 ? <EmptyState title="Nenhum cliente encontrado">Cadastre o primeiro cliente para iniciar o histórico de SST e os agendamentos.</EmptyState> : <div className="data-list">{clients.map((item) => <button className="data-row" key={item.id} onClick={() => !compact && setEditing(item)}><span><strong>{item.name}</strong><small>{item.cnpj || 'CNPJ não informado'} · {item.city || 'Município não informado'}</small></span><span className="tag neutral">GR {item.risk_grade ?? '—'}</span><ChevronRight /></button>)}</div>}{editing && <ClientForm companyId={companyId} initial={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSave={(data) => mutation.mutate(data)} saving={mutation.isPending} error={mutation.error?.message} />}</section>
}

function ClientForm({ companyId, initial, onClose, onSave, saving, error }: { companyId: string; initial?: Client; onClose: () => void; onSave: (value: Partial<Client> & Pick<Client, 'company_id' | 'name'>) => void; saving: boolean; error?: string }) {
  const { register, handleSubmit } = useForm<Partial<Client>>({ defaultValues: initial })
  return <Modal title={initial ? 'Editar cliente' : 'Novo cliente'} onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((values) => onSave({ ...values, id: initial?.id, company_id: companyId, name: values.name!.trim() }))}><label>Nome da empresa<input {...register('name', { required: true })} required /></label><label>Razão social<input {...register('legal_name')} /></label><label>CNPJ<input inputMode="numeric" {...register('cnpj')} /></label><label>Telefone<input inputMode="tel" {...register('phone')} /></label><label>WhatsApp<input inputMode="tel" {...register('whatsapp')} /></label><label>E-mail<input type="email" {...register('email')} /></label><label>CNAE principal<input inputMode="numeric" {...register('cnae_input', { required: true })} placeholder="Ex.: 5611201" required /></label><label>Ramo de atuação<input {...register('business_activity')} /></label><label className="full">Endereço<input {...register('address_line')} /></label><label>Município<input {...register('city')} /></label><label>UF<input maxLength={2} {...register('state')} /></label><Notice kind="info">O CNAE é obrigatório: ele libera o roteiro técnico detalhado ao iniciar cada visita.</Notice>{error && <Notice kind="error">{error}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={saving}>{saving ? 'Salvando…' : 'Salvar cliente'}</Button></footer></form></Modal>
}

function AppointmentsPage({ companyId }: { companyId: string }) {
  const [openForm, setOpenForm] = useState(false)
  const navigate = useNavigate()
  const { data: appointments = [], isLoading, error } = useQuery({ queryKey: ['appointments', companyId], queryFn: () => listAppointments(companyId) })
  return <section className="page"><PageHeading title="Atendimentos" subtitle="Agenda, confirmação e distribuição para técnicos." action={<Button onClick={() => setOpenForm(true)}><Plus size={18} /> Agendar atendimento</Button>} />{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar os atendimentos.</Notice> : <section className="card"><AppointmentList appointments={appointments} onOpen={(item) => navigate(`/app/admin/appointments/${item.id}`)} /></section>}{openForm && <AppointmentForm companyId={companyId} onClose={() => setOpenForm(false)} />}</section>
}

function AppointmentForm({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { data: clients = [] } = useQuery({ queryKey: ['clients', companyId, 'all'], queryFn: () => listClients(companyId) })
  const { data: technicians = [] } = useQuery({ queryKey: ['technicians', companyId], queryFn: async () => { const { data, error } = await supabase!.from('company_memberships').select('user_id, profiles(full_name)').eq('company_id', companyId).eq('role', 'technician').eq('active', true); if (error) throw error; return data ?? [] } })
  const queryClient = useQueryClient(); const { register, handleSubmit } = useForm<{ client_id: string; service_type: string; starts_at: string; ends_at: string; location_text: string; description: string; technician_ids: string[] }>({ defaultValues: { technician_ids: [] } })
  const mutation = useMutation({ mutationFn: createAppointment, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['appointments', companyId] }); onClose() } })
  return <Modal title="Agendar atendimento" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((values) => mutation.mutate({ ...values, company_id: companyId, starts_at: new Date(values.starts_at).toISOString(), ends_at: values.ends_at ? new Date(values.ends_at).toISOString() : undefined }))}><label>Cliente<select {...register('client_id', { required: true })} defaultValue=""><option value="" disabled>Selecione</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label>Tipo de atendimento<input {...register('service_type', { required: true })} placeholder="Ex.: Inspeção SST" required /></label><label>Início<input type="datetime-local" {...register('starts_at', { required: true })} required /></label><label>Fim previsto<input type="datetime-local" {...register('ends_at')} /></label><label className="full">Local<input {...register('location_text')} /></label><fieldset className="full"><legend>Técnicos responsáveis</legend>{technicians.map((tech: any) => <label className="check-line" key={tech.user_id}><input type="checkbox" value={tech.user_id} {...register('technician_ids')} />{tech.profiles?.full_name || 'Técnico sem nome'}</label>)}</fieldset><label className="full">Observações<textarea {...register('description')} rows={3} /></label>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending}>{mutation.isPending ? 'Agendando…' : 'Salvar agendamento'}</Button></footer></form></Modal>
}

function TechnicianAgenda({ membership }: { membership: Membership }) { return <TechnicianAgendaPage membership={membership} /> }

function VisitPage({ membership }: { membership: Membership }) { const { id } = useParams(); const { user } = useAuth(); const navigate = useNavigate(); const { data = [], isLoading } = useQuery({ queryKey: ['technician-appointments', membership.company_id, user?.id], queryFn: () => listAppointments(membership.company_id, user!.id) }); const item = data.find((appointment) => appointment.id === id); if (isLoading) return <LoadingState />; if (!item) return <EmptyState title="Atendimento não disponível">Você não possui acesso a este atendimento.</EmptyState>; return <AttendanceWorkflow appointment={item} membership={membership} onBack={() => navigate('/app/technician/agenda')} /> }

function AdminAttendancePage({ membership }: { membership: Membership }) { const { id } = useParams(); const navigate = useNavigate(); const { data = [], isLoading } = useQuery({ queryKey: ['appointments', membership.company_id], queryFn: () => listAppointments(membership.company_id) }); const item = data.find((appointment) => appointment.id === id); if (isLoading) return <LoadingState />; if (!item) return <EmptyState title="Atendimento não disponível">Este atendimento não pertence à empresa selecionada.</EmptyState>; if (item.status !== 'completed') return <section className="page"><PageHeading title={item.clients?.name || 'Atendimento'} subtitle="Visão operacional" /><Notice kind="info">Este atendimento está em andamento. O conteúdo técnico permanece privado até o técnico finalizar.</Notice><Button className="button-secondary" onClick={() => navigate('/app/admin/appointments')}>Voltar para atendimentos</Button></section>; return <AttendanceWorkflow appointment={item} membership={membership} onBack={() => navigate('/app/admin/appointments')} /> }

function AppointmentList({ appointments, tech = false, onOpen }: { appointments: Appointment[]; tech?: boolean; onOpen?: (appointment: Appointment) => void }) { const navigate = useNavigate(); if (!appointments.length) return <EmptyState title="Nenhum atendimento">Não há registros para este período.</EmptyState>; return <div className="appointment-list">{appointments.map((item) => <button key={item.id} className="appointment-row" onClick={() => onOpen ? onOpen(item) : tech && navigate(`/app/technician/visit/${item.id}`)}><time>{new Date(item.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><span className="status-line" data-status={item.status} /><span className="appointment-copy"><strong>{item.clients?.name || 'Cliente'}</strong><small>{item.service_type} · {formatDate(item.starts_at)}</small></span><StatusBadge status={item.status} />{(tech || onOpen) && <ChevronRight size={18} />}</button>)}</div> }

function StatusBadge({ status }: { status: Appointment['status'] }) { const labels = { scheduled: 'Agendado', pending_confirmation: 'A confirmar', confirmed: 'Confirmado', in_progress: 'Em andamento', completed: 'Concluído', cancelled: 'Cancelado' }; return <span className={`tag status-${status}`}>{labels[status]}</span> }
function Metric({ label, value, tone }: { label: string; value: number; tone: string }) { return <div className={`metric ${tone}`}><strong>{value}</strong><span>{label}</span></div> }
function PageHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) { return <header className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</header> }
function PendingModule() { return <section className="page"><PageHeading title="Módulo em preparação" subtitle="Esta área depende da próxima etapa de implementação." /><Notice kind="info">A estrutura de banco e as permissões já foram previstas na migração. Este módulo não é apresentado como funcional até possuir interface, persistência e testes.</Notice></section> }
function Brand() { return <div className="brand"><div className="brand-mark">FD</div><span>FD SST</span></div> }
function CompanySelect({ memberships, value, onChange }: { memberships: Membership[]; value: string; onChange: (id: string) => void }) { return memberships.length > 1 ? <select className="company-select" value={value} onChange={(event) => onChange(event.target.value)}>{memberships.map((item) => <option key={item.company_id} value={item.company_id}>{item.companies?.name || 'Empresa'}</option>)}</select> : null }
function NavItem({ to, icon, label, end = false }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) { return <NavLink to={to} end={end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>{icon}<span>{label}</span></NavLink> }
function SignOut() { return <button className="sign-out" onClick={() => void supabase!.auth.signOut()}><LogOut size={18} /> Sair</button> }
function formatDate(value: string) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
function toDateKey(value: Date) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
