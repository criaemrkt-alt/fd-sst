import { useMemo, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CheckSquare, ChevronRight, ClipboardList, Factory, FileText, Home, LogOut, Menu, Plus, ShieldCheck, Users, Wrench } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useAuth } from './providers/auth-provider'
import { supabase } from './lib/supabase'
import { createAppointment, listAppointments, listClients, saveClient, updateAppointmentStatus } from './services/fd-sst'
import { Button, EmptyState, LoadingState, Modal, Notice } from './components/ui'
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
  return <main className="login-page"><section className="login-panel"><div className="login-brand"><div className="brand-mark">FD</div><span>FD SST</span></div><h1>Acesse sua área de trabalho</h1><p>Gestão de Segurança e Saúde no Trabalho.</p><form onSubmit={signIn}><label>E-mail<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Senha<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>{error && <Notice kind="error">{error}</Notice>}<Button disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</Button></form><button className="link-button" onClick={() => void supabase!.auth.resetPasswordForEmail(email)}>Esqueci minha senha</button></section></main>
}

function AccessBlocked() { return <main className="setup-page"><EmptyState title="Acesso desativado">Este usuário não está ativo. Fale com o administrador da empresa.</EmptyState></main> }

function IdentityUnavailable() { return <main className="setup-page"><EmptyState title="Não foi possível carregar o acesso">Verifique sua conexão e atualize a página. Sua conta não foi desativada.</EmptyState></main> }

function MasterArea() {
  return <main className="admin-layout"><aside className="sidebar"><Brand /><nav><NavItem to="/app/master" icon={<Home />} label="Visão geral" /><NavItem to="/app/master/companies" icon={<Factory />} label="Empresas" /><NavItem to="/app/master/access" icon={<Users />} label="Acessos" /></nav><SignOut /></aside><section className="admin-content"><Routes><Route path="*" element={<MasterDashboard />} /></Routes></section></main>
}

function MasterDashboard() {
  const [creating, setCreating] = useState(false)
  const { data: companies = [], isLoading, error } = useQuery({ queryKey: ['master-companies'], queryFn: async () => { const { data, error: queryError } = await supabase!.from('companies').select('id, name, legal_name, city, state, status, created_at, company_memberships(count)').order('created_at', { ascending: false }); if (queryError) throw queryError; return data ?? [] } })
  return <section className="page"><PageHeading title="Empresas" subtitle="Gestão global do SaaS FD SST." action={<Button onClick={() => setCreating(true)}><Plus size={18} /> Nova empresa</Button>} /><Notice kind="info">O acesso Master é exclusivo e não pode ser criado por cadastro público.</Notice>{isLoading ? <LoadingState /> : error ? <Notice kind="error">Não foi possível carregar as empresas cadastradas.</Notice> : companies.length === 0 ? <EmptyState title="Nenhuma empresa cadastrada">Cadastre a primeira empresa e informe o ADM inicial para enviar o convite de acesso.</EmptyState> : <section className="data-list">{companies.map((company: any) => <div className="data-row static-row" key={company.id}><span><strong>{company.name}</strong><small>{[company.city, company.state].filter(Boolean).join(' / ') || 'Local não informado'}</small></span><span className={`tag ${company.status === 'active' ? 'status-confirmed' : 'status-cancelled'}`}>{company.status === 'active' ? 'Ativa' : 'Inativa'}</span><ChevronRight /></div>)}</section>}{creating && <CreateCompanyForm onClose={() => setCreating(false)} />}</section>
}

function CreateCompanyForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { register, handleSubmit } = useForm<{ name: string; legal_name: string; cnpj: string; phone: string; email: string; city: string; state: string; admin_name: string; admin_email: string }>()
  const mutation = useMutation({ mutationFn: async (values: { name: string; legal_name: string; cnpj: string; phone: string; email: string; city: string; state: string; admin_name: string; admin_email: string }) => {
    const { admin_name, admin_email, ...companyInput } = values
    const { data: company, error } = await supabase!.from('companies').insert(companyInput).select('id').single()
    if (error) throw error
    if (admin_email) {
      const { error: inviteError } = await supabase!.functions.invoke('invite-member', { body: { company_id: company.id, email: admin_email, full_name: admin_name, role: 'admin' } })
      if (inviteError) throw new Error(`Empresa cadastrada, mas o convite do ADM falhou: ${inviteError.message}`)
    }
  }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['master-companies'] }); onClose() } })
  return <Modal title="Cadastrar empresa" onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((values) => mutation.mutate(values))}><label>Nome fantasia<input {...register('name', { required: true })} required /></label><label>Razão social<input {...register('legal_name')} /></label><label>CNPJ<input inputMode="numeric" {...register('cnpj')} /></label><label>Telefone<input inputMode="tel" {...register('phone')} /></label><label>E-mail da empresa<input type="email" {...register('email')} /></label><label>Município<input {...register('city')} /></label><label>UF<input maxLength={2} {...register('state')} /></label><span /><fieldset className="full"><legend>Administrador inicial</legend><div className="form-grid"><label>Nome<input {...register('admin_name')} /></label><label>E-mail<input type="email" {...register('admin_email')} /></label></div></fieldset>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending}>{mutation.isPending ? 'Cadastrando…' : 'Cadastrar empresa'}</Button></footer></form></Modal>
}

function CompanyArea({ memberships }: { memberships: Membership[] }) {
  const [activeCompanyId, setActiveCompanyId] = useState(memberships[0].company_id)
  const membership = memberships.find((item) => item.company_id === activeCompanyId) ?? memberships[0]
  return membership.role === 'admin'
    ? <AdminArea membership={membership} memberships={memberships} onCompanyChange={setActiveCompanyId} />
    : <TechnicianArea membership={membership} memberships={memberships} onCompanyChange={setActiveCompanyId} />
}

function AdminArea({ membership, memberships, onCompanyChange }: { membership: Membership; memberships: Membership[]; onCompanyChange: (id: string) => void }) {
  return <main className="admin-layout"><aside className="sidebar"><Brand /><CompanySelect memberships={memberships} value={membership.company_id} onChange={onCompanyChange} /><nav><NavItem to="/app/admin" end icon={<Home />} label="Dashboard" /><NavItem to="/app/admin/appointments" icon={<CalendarDays />} label="Atendimentos" /><NavItem to="/app/admin/clients" icon={<Factory />} label="Clientes" /><NavItem to="/app/admin/technicians" icon={<Users />} label="Técnicos" /><NavItem to="/app/admin/templates" icon={<CheckSquare />} label="Modelos" /><NavItem to="/app/admin/company" icon={<Wrench />} label="Empresa" /></nav><SignOut /></aside><section className="admin-content"><Routes><Route index element={<AdminDashboard companyId={membership.company_id} />} /><Route path="appointments" element={<AppointmentsPage companyId={membership.company_id} />} /><Route path="clients" element={<ClientsPage companyId={membership.company_id} />} /><Route path="*" element={<PendingModule />} /></Routes></section></main>
}
