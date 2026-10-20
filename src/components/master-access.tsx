import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { Button, EmptyState, LoadingState, Modal, Notice } from './ui'

type Account = { user_id: string; full_name: string; email: string | null; role: string; active: boolean }

export function MasterAccessPage() {
  const [companyId, setCompanyId] = useState('')
  const [target, setTarget] = useState<Account | null>(null)
  const { register, handleSubmit, reset } = useForm<{ full_name: string; email: string; password: string }>()
  const queryClient = useQueryClient()
  const companies = useQuery({ queryKey: ['master-companies'], queryFn: async () => {
    const { data, error } = await supabase!.from('companies').select('id, name, status').order('name')
    if (error) throw error
    return data ?? []
  } })
  const accounts = useQuery({ queryKey: ['company-accounts', companyId], enabled: Boolean(companyId), queryFn: async () => {
    const { data, error } = await supabase!.functions.invoke('manage-company-access', { body: { action: 'list_company_accounts', company_id: companyId } })
    if (error) throw error
    return data.accounts as Account[]
  } })
  const updateAccount = useMutation({ mutationFn: async ({ userId, fullName, email, password }: { userId: string; fullName: string; email: string; password: string }) => {
    const { error } = await supabase!.functions.invoke('manage-company-access', { body: { action: 'update_company_account', company_id: companyId, user_id: userId, full_name: fullName, email, password: password || undefined } })
    if (error) throw error
  }, onSuccess: () => {
    setTarget(null)
    reset()
    void queryClient.invalidateQueries({ queryKey: ['company-accounts', companyId] })
  } })

  return <section className="page">
    <header className="page-heading"><div><h1>Acessos das empresas</h1><p>Consulte os usuários e redefina senhas sem confirmação por e-mail.</p></div></header>
    <section className="card"><label className="form-grid"><span className="full">Empresa<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setTarget(null) }}><option value="">Selecione uma empresa</option>{(companies.data ?? []).map((company) => <option key={company.id} value={company.id}>{company.name}{company.status === 'inactive' ? ' (inativa)' : ''}</option>)}</select></span></label></section>
    {companyId && (accounts.isLoading ? <LoadingState /> : accounts.error ? <Notice kind="error">Não foi possível carregar os acessos desta empresa.</Notice> : !accounts.data?.length ? <EmptyState title="Nenhum acesso cadastrado">Cadastre um administrador pela tela Empresas.</EmptyState> : <section className="data-list">{accounts.data.map((account) => <div className="data-row static-row" key={account.user_id}><span><strong>{account.full_name || 'Usuário sem nome'}</strong><small>{account.email || 'E-mail não disponível'} · {account.role === 'admin' ? 'Administrador' : 'Técnico'}</small></span><span className={`tag ${account.active ? 'status-confirmed' : 'status-cancelled'}`}>{account.active ? 'Ativo' : 'Inativo'}</span><Button className="button-secondary" onClick={() => { setTarget(account); reset({ full_name: account.full_name || '', email: account.email || '', password: '' }) }}>Editar acesso</Button></div>)}</section>)}
    {target && <Modal title={`Editar acesso: ${target.full_name || target.email || 'usuário'}`} onClose={() => { setTarget(null); reset() }}><form className="form-grid" onSubmit={handleSubmit((values) => updateAccount.mutate({ userId: target.user_id, fullName: values.full_name, email: values.email, password: values.password }))}><label className="full">Nome<input autoComplete="name" {...register('full_name')} /></label><label className="full">E-mail de login<input type="email" autoComplete="email" {...register('email', { required: true })} required /></label><label className="full">Nova senha (opcional)<input type="password" minLength={8} autoComplete="new-password" {...register('password', { minLength: 8 })} placeholder="Deixe em branco para manter a atual" /></label><Notice kind="info">O Master pode alterar o login e definir uma nova senha. A senha anterior nunca é exibida.</Notice>{updateAccount.error && <Notice kind="error">{updateAccount.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={() => { setTarget(null); reset() }}>Cancelar</Button><Button disabled={updateAccount.isPending}>{updateAccount.isPending ? 'Salvando…' : 'Salvar acesso'}</Button></footer></form></Modal>}
  </section>
}
