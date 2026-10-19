import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type InviteRequest = { company_id?: string; email?: string; full_name?: string; role?: 'admin' | 'technician' }

/** Creates an Auth invitation and the tenant membership. The service key stays only in the function runtime. */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  const authorization = request.headers.get('Authorization')
  if (!authorization) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  const body = await request.json().catch(() => ({})) as InviteRequest
  if (!body.company_id || !body.email || !body.role || !['admin', 'technician'].includes(body.role)) return new Response('Invalid invitation data', { status: 400, headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const actor = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: userError } = await actor.auth.getUser()
  if (userError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  const { data: profile } = await actor.from('profiles').select('global_role, active').eq('id', user.id).maybeSingle()
  const isMaster = profile?.active && profile.global_role === 'master'
  const { data: membership } = await actor.from('company_memberships').select('role, active').eq('company_id', body.company_id).eq('user_id', user.id).maybeSingle()
  const isCompanyAdmin = membership?.active && membership.role === 'admin'
  if (!isMaster && !isCompanyAdmin) return new Response('Forbidden', { status: 403, headers: corsHeaders })
  if (!isMaster && body.role !== 'technician') return new Response('Only Master can invite an administrator', { status: 403, headers: corsHeaders })

  const admin = createClient(url, serviceRole)
  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(body.email, { data: { full_name: body.full_name ?? body.email } })
  if (inviteError || !invitation.user) return new Response(inviteError?.message ?? 'Unable to invite user', { status: 400, headers: corsHeaders })
  const { error: membershipError } = await admin.from('company_memberships').upsert({ company_id: body.company_id, user_id: invitation.user.id, role: body.role, active: true }, { onConflict: 'company_id,user_id' })
  if (membershipError) return new Response(membershipError.message, { status: 500, headers: corsHeaders })
  return new Response(JSON.stringify({ ok: true, user_id: invitation.user.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
