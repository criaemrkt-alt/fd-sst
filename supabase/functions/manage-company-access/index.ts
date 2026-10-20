import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type RequestBody = {
  action?: 'list_company_accounts' | 'create_admin' | 'reset_password' | 'set_company_status'
  company_id?: string
  user_id?: string
  full_name?: string
  email?: string
  password?: string
  status?: 'active' | 'inactive'
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

/** Master-only company account administration. Service credentials never leave this function. */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const authorization = request.headers.get('Authorization')
  if (!authorization) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  const body = await request.json().catch(() => ({})) as RequestBody
  if (!body.action) return new Response('Invalid request', { status: 400, headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const actor = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: userError } = await actor.auth.getUser()
  if (userError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

  const { data: profile } = await actor.from('profiles').select('global_role, active').eq('id', user.id).maybeSingle()
  if (!profile?.active || profile.global_role !== 'master') return new Response('Forbidden', { status: 403, headers: corsHeaders })

  const admin = createClient(url, serviceRole)

  if (body.action === 'list_company_accounts') {
    if (!body.company_id) return new Response('Company is required', { status: 400, headers: corsHeaders })
    const { data: memberships, error } = await admin
      .from('company_memberships')
      .select('user_id, role, active, job_title, profiles(full_name)')
      .eq('company_id', body.company_id)
      .order('created_at')
    if (error) return new Response(error.message, { status: 500, headers: corsHeaders })
    const { data: authData, error: authError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (authError) return new Response(authError.message, { status: 500, headers: corsHeaders })
    const emails = new Map(authData.users.map((item) => [item.id, item.email]))
    return json({ accounts: (memberships ?? []).map((item: any) => ({
      ...item,
      full_name: Array.isArray(item.profiles) ? item.profiles[0]?.full_name : item.profiles?.full_name,
      email: emails.get(item.user_id) ?? null,
    })) })
  }

  if (body.action === 'create_admin') {
    if (!body.company_id || !body.email || !body.password || body.password.length < 8) return new Response('Informe empresa, e-mail e uma senha com ao menos 8 caracteres.', { status: 400, headers: corsHeaders })
    const { data: company } = await admin.from('companies').select('id').eq('id', body.company_id).maybeSingle()
    if (!company) return new Response('Empresa não encontrada', { status: 404, headers: corsHeaders })
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: body.email.trim().toLowerCase(),
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name?.trim() || body.email.trim() },
    })
    if (createError || !created.user) return new Response(createError?.message ?? 'Não foi possível criar o acesso', { status: 400, headers: corsHeaders })
    const { error: membershipError } = await admin.from('company_memberships').upsert({
      company_id: body.company_id,
      user_id: created.user.id,
      role: 'admin',
      active: true,
    }, { onConflict: 'company_id,user_id' })
    if (membershipError) {
      await admin.auth.admin.deleteUser(created.user.id)
      return new Response(membershipError.message, { status: 500, headers: corsHeaders })
    }
    return json({ ok: true, user_id: created.user.id })
  }

  if (body.action === 'reset_password') {
    if (!body.company_id || !body.user_id || !body.password || body.password.length < 8) return new Response('Informe empresa, usuário e uma senha com ao menos 8 caracteres.', { status: 400, headers: corsHeaders })
    const { data: membership } = await admin.from('company_memberships').select('user_id').eq('company_id', body.company_id).eq('user_id', body.user_id).maybeSingle()
    if (!membership) return new Response('Usuário não pertence a esta empresa', { status: 404, headers: corsHeaders })
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password })
    if (error) return new Response(error.message, { status: 400, headers: corsHeaders })
    return json({ ok: true })
  }

  if (body.action === 'set_company_status') {
    if (!body.company_id || !body.status) return new Response('Empresa e status são obrigatórios', { status: 400, headers: corsHeaders })
    const { error } = await admin.from('companies').update({ status: body.status }).eq('id', body.company_id)
    if (error) return new Response(error.message, { status: 500, headers: corsHeaders })
    return json({ ok: true })
  }

  return new Response('Unsupported action', { status: 400, headers: corsHeaders })
})
