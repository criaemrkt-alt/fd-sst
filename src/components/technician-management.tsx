import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Button, EmptyState, LoadingState, Modal, Notice } from './ui'

type Technician = {
  user_id: string
  full_name: string | null
  email: string | null
  job_title: string | null
  phone: string | null
  active: boolean
  role: 'technician'
}

type TechnicianForm = { full_name: string; email: string; job_title: string; phone: string; password?: string }

export function TechnicianManagementPage({ companyId }: { companyId: string }) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Technician | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<Technician | null>(null)
  const queryClient = useQueryClient()
  const technicians = useQuery({
    queryKey: ['company-accounts', companyId],
    queryFn: async () => {
      const { data, error } = await supabase!.functions.invoke('manage-company-access', { body: { action: 'list_company_accounts', company_id: companyId } })
      if (error) throw error
      return (data.accounts as Technician[]).filter((account) => account.role === 'technician')
    },
  })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['company-accounts', companyId] })
  const setStatus = useMutation({
    mutationFn: async (technician: Technician) => {
      const { error } = await supabase!.functions.invoke('manage-company-access', { body: { action: 'set_member_status', company_id: companyId, user_id: technician.user_id, status: technician.active ? 'inactive' : 'active' } })
      if (error) throw error
    },
    onSuccess: refresh,
  })

  return <section className="page">
    <header className="page-heading"><div><h1>Técnicos</h1><p>Cadastre e gerencie os profissionais com acesso às visitas e checklists.</p></div><Button onClick={() => setCreating(true)}><Plus size={18} /> Novo técnico</Button></header>
    <Notice kind="info">Cada técnico recebe login e senha próprios. O acesso nasce confirmado, sem precisar validar e-mail.</Notice>
    {technicians.isLoading ? <LoadingState /> : technicians.error ? <Notice kind="error">Não foi possível carregar os técnicos. Atualize a página e tente novamente.</Notice> : !technicians.data?.length ? <EmptyState title="Nenhum técnico cadastrado">Cadastre o primeiro técnico para distribuir atendimentos.</EmptyState> : <section className="data-list">{technicians.data.map((technician) => <div className="data-row static-row" key={technician.user_id}><span><strong>{technician.full_name || 'Técnico sem nome'}</strong><small>{technician.job_title || 'Função não informada'} · {technician.email || 'E-mail não disponível'}</small></span><span className={`tag ${technician.active ? 'status-confirmed' : 'status-cancelled'}`}>{technician.active ? 'Ativo' : 'Inativo'}</span><Button className="button-secondary" onClick={() => setEditing(technician)}>Editar</Button><Button className="button-secondary" onClick={() => setPasswordTarget(technician)}>Senha</Button><Button className="button-secondary" disabled={setStatus.isPending} onClick={() => setStatus.mutate(technician)}>{technician.active ? 'Desativar' : 'Ativar'}</Button></div>)}</section>}
    {creating && <TechnicianFormModal companyId={companyId} onClose={() => setCreating(false)} onSuccess={() => { refresh(); setCreating(false) }} />}
    {editing && <TechnicianFormModal companyId={companyId} technician={editing} onClose={() => setEditing(null)} onSuccess={() => { refresh(); setEditing(null) }} />}
    {passwordTarget && <PasswordModal companyId={companyId} technician={passwordTarget} onClose={() => setPasswordTarget(null)} />}
  </section>
}

function TechnicianFormModal({ companyId, technician, onClose, onSuccess }: { companyId: string; technician?: Technician; onClose: () => void; onSuccess: () => void }) {
  const { register, handleSubmit, reset } = useForm<TechnicianForm>({ defaultValues: technician ? { full_name: technician.full_name || '', email: technician.email || '', job_title: technician.job_title || '', phone: technician.phone || '' } : { full_name: '', email: '', job_title: '', phone: '', password: '' } })
  const mutation = useMutation({
    mutationFn: async (values: TechnicianForm) => {
      const body = technician
        ? { action: 'update_technician', company_id: companyId, user_id: technician.user_id, ...values }
        : { action: 'create_technician', company_id: companyId, ...values }
      const { error } = await supabase!.functions.invoke('manage-company-access', { body })
      if (error) throw error
    },
    onSuccess,
  })
  useEffect(() => { if (technician) reset({ full_name: technician.full_name || '', email: technician.email || '', job_title: technician.job_title || '', phone: technician.phone || '' }) }, [technician, reset])
  return <Modal title={technician ? 'Editar técnico' : 'Cadastrar técnico'} onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((values) => mutation.mutate(values))}><label>Nome completo<input {...register('full_name', { required: true })} required /></label><label>Função / cargo<input {...register('job_title')} placeholder="Ex.: Técnico de Segurança" /></label><label>E-mail de login<input type="email" autoComplete="email" {...register('email', { required: true })} required /></label><label>Telefone<input type="tel" {...register('phone')} /></label>{!technician && <label className="full">Senha inicial<input type="password" minLength={8} autoComplete="new-password" {...register('password', { required: true, minLength: 8 })} required /></label>}{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : technician ? 'Salvar alterações' : 'Cadastrar técnico'}</Button></footer></form></Modal>
}

function PasswordModal({ companyId, technician, onClose }: { companyId: string; technician: Technician; onClose: () => void }) {
  const { register, handleSubmit } = useForm<{ password: string }>()
  const mutation = useMutation({
    mutationFn: async ({ password }: { password: string }) => {
      const { error } = await supabase!.functions.invoke('manage-company-access', { body: { action: 'reset_password', company_id: companyId, user_id: technician.user_id, password } })
      if (error) throw error
    },
    onSuccess: onClose,
  })
  return <Modal title={`Nova senha: ${technician.full_name || technician.email || 'técnico'}`} onClose={onClose}><form className="form-grid" onSubmit={handleSubmit((values) => mutation.mutate(values))}><label className="full">Nova senha<input type="password" minLength={8} autoComplete="new-password" {...register('password', { required: true, minLength: 8 })} required /></label><Notice kind="info">A senha é aplicada imediatamente, sem confirmação por e-mail.</Notice>{mutation.error && <Notice kind="error">{mutation.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={onClose}>Cancelar</Button><Button disabled={mutation.isPending}>{mutation.isPending ? 'Salvando…' : 'Salvar nova senha'}</Button></footer></form></Modal>
}
