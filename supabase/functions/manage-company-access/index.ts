import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type RequestBody = {
  action?: 'list_company_accounts' | 'create_admin' | 'create_technician' | 'update_technician' | 'reset_password' | 'set_company_status' | 'set_member_status'
  company_id?: string
  user_id?: string
  full_name?: string
  email?: string
  password?: string
  status?: 'active' | 'inactive'
  job_title?: string
  phone?: string
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const message = (text: string, status: number) => new Response(text, { status, headers: corsHeaders })

/** Sensitive account operations stay server-side. */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return message('Method not allowed', 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return message('Unauthorized', 401)
  const body = await request.json().catch(() => ({})) as RequestBody
  if (!body.action) return message('Invalid request', 400)

  const url = Deno.env.get('SUPABASE_URL')!
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const actor = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: userError } = await actor.auth.getUser()
  if (userError || !user) return message('Unauthorized', 401)

  const { data: profile } = await actor.from('profiles').select('global_role, active').eq('id', user.id).maybeSingle()
  if (!profile?.active) return message('Forbidden', 403)
  const isMaster = profile.global_role === 'master'
  const admin = createClient(url, serviceRole)

  const canManageCompany = async (companyId?: string) => {
    if (!companyId) return false
    if (isMaster) return true
    const { data: membership } = await actor
      .from('company_memberships')
      .select('role, companies!inner(status)')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .eq('active', true)
      .eq('role', 'admin')
      .eq('companies.status', 'active')
      .maybeSingle()
    return Boolean(membership)
  }

  const getMembership = async (companyId?: string, userId?: string) => {
    if (!companyId || !userId) return null
    const { data } = await admin
      .from('company_memberships')
      .select('user_id, role, active')
      .eq('company_id', companyId)
      .eq('user_id', userId)
      .maybeSingle()
    return data
  }

  if (body.action === 'list_company_accounts') {
    if (!body.company_id || !(await canManageCompany(body.company_id))) return message('Forbidden', 403)
    const { data: memberships, error } = await admin
      .from('company_memberships')
      .select('user_id, role, active, job_title, phone')
      .eq('company_id', body.company_id)
      .order('created_at')
    if (error) return message(error.message, 500)
    const userIds = (memberships ?? []).map((item) => item.user_id)
    const { data: profiles, error: profilesError } = userIds.length
      ? await admin.from('profiles').select('id, full_name').in('id', userIds)
      : { data: [], error: null }
    if (profilesError) return message(profilesError.message, 500)
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (authError) return message(authError.message, 500)
    const names = new Map((profiles ?? []).map((item) => [item.id, item.full_name]))
    const emails = new Map(authData.users.map((item) => [item.id, item.email]))
    return json({ accounts: (memberships ?? []).map((item: any) => ({
      ...item,
      full_name: names.get(item.user_id) ?? null,
      email: emails.get(item.user_id) ?? null,
    })) })
  }

  if (body.action === 'create_admin') {
    if (!isMaster) return message('Forbidden', 403)
    if (!body.company_id || !body.email || !body.password || body.password.length < 8) return message('Informe empresa, e-mail e uma senha com ao menos 8 caracteres.', 400)
    const { data: company } = await admin.from('companies').select('id').eq('id', body.company_id).maybeSingle()
    if (!company) return message('Empresa não encontrada', 404)
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: body.email.trim().toLowerCase(),
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name?.trim() || body.email.trim() },
    })
    if (createError || !created.user) return message(createError?.message ?? 'Não foi possível criar o acesso', 400)
    const { error: membershipError } = await admin.from('company_memberships').upsert({
      company_id: body.company_id,
      user_id: created.user.id,
      role: 'admin',
      active: true,
    }, { onConflict: 'company_id,user_id' })
    if (membershipError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return message(membershipError.message, 500)
    }
    return json({ ok: true, user_id: created.user.id })
  }

  if (body.action === 'create_technician') {
    if (!body.company_id || !(await canManageCompany(body.company_id))) return message('Forbidden', 403)
    if (!body.email || !body.password || body.password.length < 8) return message('Informe e-mail e uma senha com ao menos 8 caracteres.', 400)
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: body.email.trim().toLowerCase(),
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name?.trim() || body.email.trim() },
    })
    if (createError || !created.user) return message(createError?.message ?? 'Não foi possível criar o técnico', 400)
    const { error: membershipError } = await admin.from('company_memberships').insert({
      company_id: body.company_id,
      user_id: created.user.id,
      role: 'technician',
      active: true,
      job_title: body.job_title?.trim() || null,
      phone: body.phone?.trim() || null,
    })
    if (membershipError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return message(membershipError.message, 500)
    }
    return json({ ok: true, user_id: created.user.id })
  }

  if (body.action === 'update_technician') {
    if (!body.company_id || !body.user_id || !(await canManageCompany(body.company_id))) return message('Forbidden', 403)
    const membership = await getMembership(body.company_id, body.user_id)
    if (!membership || (!isMaster && membership.role !== 'technician')) return message('Técnico não encontrado', 404)
    if (!body.email?.trim()) return message('Informe um e-mail válido.', 400)
    const { error: authError } = await admin.auth.admin.updateUserById(body.user_id, { email: body.email.trim().toLowerCase(), email_confirm: true })
    if (authError) return message(authError.message, 400)
    const { error: profileError } = await admin.from('profiles').update({ full_name: body.full_name?.trim() || null }).eq('id', body.user_id)
    if (profileError) return message(profileError.message, 500)
    const { error: membershipError } = await admin.from('company_memberships').update({
      job_title: body.job_title?.trim() || null,
      phone: body.phone?.trim() || null,
    }).eq('company_id', body.company_id).eq('user_id', body.user_id)
    if (membershipError) return message(membershipError.message, 500)
    return json({ ok: true })
  }

  if (body.action === 'reset_password' || body.action === 'set_member_status') {
    if (!body.company_id || !body.user_id || !(await canManageCompany(body.company_id))) return message('Forbidden', 403)
    const membership = await getMembership(body.company_id, body.user_id)
    if (!membership || (!isMaster && membership.role !== 'technician')) return message('Usuário não pertence a esta empresa', 404)
    if (body.action === 'reset_password') {
      if (!body.password || body.password.length < 8) return message('Informe uma senha com ao menos 8 caracteres.', 400)
      const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password })
      if (error) return message(error.message, 400)
      return json({ ok: true })
    }
    if (!body.status) return message('Status é obrigatório', 400)
    const { error } = await admin.from('company_memberships').update({ active: body.status === 'active' }).eq('company_id', body.company_id).eq('user_id', body.user_id)
    if (error) return message(error.message, 500)
    return json({ ok: true })
  }

  if (body.action === 'set_company_status') {
    if (!isMaster) return message('Forbidden', 403)
    if (!body.company_id || !body.status) return message('Empresa e status são obrigatórios', 400)
    const { error } = await admin.from('companies').update({ status: body.status }).eq('id', body.company_id)
    if (error) return message(error.message, 500)
    return json({ ok: true })
  }

  return message('Unsupported action', 400)
})
