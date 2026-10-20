import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { supabase } from '../lib/supabase'
import { Button, EmptyState, LoadingState, Modal, Notice } from './ui'

type Account = { user_id: string; full_name: string; email: string | null; role: string; active: boolean }

export function MasterAccessPage() {
  const [companyId, setCompanyId] = useState('')
  const [target, setTarget] = useState<Account | null>(null)
  const { register, handleSubmit, reset } = useForm<{ password: string }>()
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
  const resetPassword = useMutation({ mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
    const { error } = await supabase!.functions.invoke('manage-company-access', { body: { action: 'reset_password', company_id: companyId, user_id: userId, password } })
    if (error) throw error
  }, onSuccess: () => {
    setTarget(null)
    reset()
    void queryClient.invalidateQueries({ queryKey: ['company-accounts', companyId] })
  } })

  return <section className="page">
    <header className="page-heading"><div><h1>Acessos das empresas</h1><p>Consulte os usuários e redefina senhas sem confirmação por e-mail.</p></div></header>
    <section className="card"><label className="form-grid"><span className="full">Empresa<select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setTarget(null) }}><option value="">Selecione uma empresa</option>{(companies.data ?? []).map((company) => <option key={company.id} value={company.id}>{company.name}{company.status === 'inactive' ? ' (inativa)' : ''}</option>)}</select></span></label></section>
    {companyId && (accounts.isLoading ? <LoadingState /> : accounts.error ? <Notice kind="error">Não foi possível carregar os acessos desta empresa.</Notice> : !accounts.data?.length ? <EmptyState title="Nenhum acesso cadastrado">Cadastre um administrador pela tela Empresas.</EmptyState> : <section className="data-list">{accounts.data.map((account) => <div className="data-row static-row" key={account.user_id}><span><strong>{account.full_name || 'Usuário sem nome'}</strong><small>{account.email || 'E-mail não disponível'} · {account.role === 'admin' ? 'Administrador' : 'Técnico'}</small></span><span className={`tag ${account.active ? 'status-confirmed' : 'status-cancelled'}`}>{account.active ? 'Ativo' : 'Inativo'}</span><Button className="button-secondary" onClick={() => setTarget(account)}>Alterar senha</Button></div>)}</section>)}
    {target && <Modal title={`Nova senha: ${target.full_name || target.email || 'usuário'}`} onClose={() => { setTarget(null); reset() }}><form className="form-grid" onSubmit={handleSubmit((values) => resetPassword.mutate({ userId: target.user_id, password: values.password }))}><label className="full">Nova senha<input type="password" minLength={8} autoComplete="new-password" {...register('password', { required: true, minLength: 8 })} required /></label><Notice kind="info">A senha é gravada com segurança e o usuário poderá entrar imediatamente.</Notice>{resetPassword.error && <Notice kind="error">{resetPassword.error.message}</Notice>}<footer className="form-actions"><Button type="button" className="button-secondary" onClick={() => { setTarget(null); reset() }}>Cancelar</Button><Button disabled={resetPassword.isPending}>{resetPassword.isPending ? 'Salvando…' : 'Salvar nova senha'}</Button></footer></form></Modal>}
  </section>
}
