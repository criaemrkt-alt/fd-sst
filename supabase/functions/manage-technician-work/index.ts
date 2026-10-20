import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type RequestBody = {
  action?: 'create_client' | 'create_appointment' | 'update_status'
  company_id?: string
  client_id?: string
  appointment_id?: string
  name?: string
  phone?: string
  whatsapp?: string
  address_line?: string
  city?: string
  state?: string
  service_type?: string
  starts_at?: string
  ends_at?: string
  location_text?: string
  description?: string
  status?: 'in_progress' | 'completed'
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const message = (text: string, status: number) => new Response(text, { status, headers: corsHeaders })
const textOrNull = (value?: string) => value?.trim() || null

/**
 * Field-work actions that must always be restricted to the current technician.
 * The service key never reaches the browser; every request first verifies the
 * user's JWT and active technician membership in the requested company.
 */
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
  const token = authorization.replace(/^Bearer\s+/i, '')
  const { data: { user }, error: userError } = await actor.auth.getUser(token)
  if (userError || !user) return message('Unauthorized', 401)

  const { data: profile } = await actor.from('profiles').select('active').eq('id', user.id).maybeSingle()
  if (!profile?.active) return message('Forbidden', 403)
  const admin = createClient(url, serviceRole)

  const hasActiveTechnicianMembership = async (companyId?: string) => {
    if (!companyId) return false
    const { data } = await actor.from('company_memberships')
      .select('role, companies!inner(status)')
      .eq('company_id', companyId)
      .eq('user_id', user.id)
      .eq('role', 'technician')
      .eq('active', true)
      .eq('companies.status', 'active')
      .maybeSingle()
    return Boolean(data)
  }

  if (body.action === 'create_client') {
    if (!body.company_id || !(await hasActiveTechnicianMembership(body.company_id))) return message('Forbidden', 403)
    if (!textOrNull(body.name)) return message('Informe o nome do cliente.', 400)
    const { data: client, error } = await admin.from('clients').insert({
      company_id: body.company_id,
      name: textOrNull(body.name),
      phone: textOrNull(body.phone),
      whatsapp: textOrNull(body.whatsapp),
      address_line: textOrNull(body.address_line),
      city: textOrNull(body.city),
      state: textOrNull(body.state)?.toUpperCase() || null,
      created_by: user.id,
    }).select().single()
    if (error) return message(error.message, 400)
    return json({ client })
  }

  if (body.action === 'create_appointment') {
    if (!body.company_id || !(await hasActiveTechnicianMembership(body.company_id))) return message('Forbidden', 403)
    if (!body.client_id || !textOrNull(body.service_type) || !body.starts_at) return message('Informe cliente, serviço e data de início.', 400)
    const startsAt = new Date(body.starts_at)
    const endsAt = body.ends_at ? new Date(body.ends_at) : null
    if (Number.isNaN(startsAt.getTime()) || (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt))) return message('Informe horários válidos.', 400)
    const { data: client } = await admin.from('clients').select('id').eq('id', body.client_id).eq('company_id', body.company_id).eq('active', true).maybeSingle()
    if (!client) return message('Cliente não encontrado ou inativo.', 404)
    const { data: appointment, error } = await admin.from('appointments').insert({
      company_id: body.company_id,
      client_id: body.client_id,
      service_type: textOrNull(body.service_type),
      starts_at: startsAt.toISOString(),
      ends_at: endsAt?.toISOString() || null,
      location_text: textOrNull(body.location_text),
      description: textOrNull(body.description),
      status: 'scheduled',
      created_by: user.id,
    }).select().single()
    if (error || !appointment) return message(error?.message || 'Não foi possível criar o atendimento.', 400)
    const { error: linkError } = await admin.from('appointment_technicians').insert({ appointment_id: appointment.id, company_id: body.company_id, technician_id: user.id, assigned_by: user.id })
    if (linkError) {
      await admin.from('appointments').delete().eq('id', appointment.id)
      return message(linkError.message, 500)
    }
    await admin.from('appointment_status_history').insert({ company_id: body.company_id, appointment_id: appointment.id, from_status: null, to_status: 'scheduled', changed_by: user.id, note: 'Atendimento criado pelo técnico.' })
    return json({ appointment })
  }

  if (body.action === 'update_status') {
    if (!body.appointment_id || !body.status) return message('Atendimento e status são obrigatórios.', 400)
    const { data: link } = await admin.from('appointment_technicians').select('company_id').eq('appointment_id', body.appointment_id).eq('technician_id', user.id).maybeSingle()
    if (!link || !(await hasActiveTechnicianMembership(link.company_id))) return message('Atendimento não disponível.', 404)
    const { data: appointment } = await admin.from('appointments').select('id, status').eq('id', body.appointment_id).eq('company_id', link.company_id).maybeSingle()
    if (!appointment) return message('Atendimento não encontrado.', 404)
    const allowed = body.status === 'in_progress'
      ? ['scheduled', 'pending_confirmation', 'confirmed'].includes(appointment.status)
      : appointment.status === 'in_progress'
    if (!allowed) return message('Esta alteração de status não é permitida.', 409)
    const now = new Date().toISOString()
    const update = body.status === 'in_progress' ? { status: body.status, started_at: now } : { status: body.status, completed_at: now }
    const { error } = await admin.from('appointments').update(update).eq('id', appointment.id)
    if (error) return message(error.message, 500)
    const { error: historyError } = await admin.from('appointment_status_history').insert({ company_id: link.company_id, appointment_id: appointment.id, from_status: appointment.status, to_status: body.status, changed_by: user.id })
    if (historyError) return message(historyError.message, 500)
    return json({ ok: true })
  }

  return message('Unsupported action', 400)
})
