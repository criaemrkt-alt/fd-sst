import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

/** One-time initializer. Deploy with verify_jwt=true and set FD_SST_BOOTSTRAP_TOKEN as a function secret. */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  const authorization = request.headers.get('Authorization')
  if (!authorization) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  const supplied = (await request.json().catch(() => ({}))).bootstrap_token
  if (!supplied || supplied !== Deno.env.get('FD_SST_BOOTSTRAP_TOKEN')) return new Response('Forbidden', { status: 403, headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const actorClient = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: userError } = await actorClient.auth.getUser()
  if (userError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })
  const adminClient = createClient(url, serviceRole)
  const { count, error: countError } = await adminClient.from('profiles').select('id', { count: 'exact', head: true }).eq('global_role', 'master')
  if (countError) return new Response(countError.message, { status: 500, headers: corsHeaders })
  if ((count ?? 0) > 0) return new Response('Master already initialized', { status: 409, headers: corsHeaders })
  const { error } = await adminClient.from('profiles').upsert({ id: user.id, full_name: user.user_metadata.full_name ?? user.email, global_role: 'master', active: true })
  if (error) return new Response(error.message, { status: 500, headers: corsHeaders })
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
