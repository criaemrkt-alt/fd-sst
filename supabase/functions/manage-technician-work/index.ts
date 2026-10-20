import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type Action = 'create_client' | 'create_appointment' | 'update_status' | 'save_service' | 'save_function_activity' | 'save_evidence' | 'save_signature' | 'save_travel' | 'save_accident' | 'save_training' | 'save_heat_assessment'
type RequestBody = Record<string, unknown> & { action?: Action; company_id?: string; appointment_id?: string; client_id?: string; status?: 'in_progress' | 'completed' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const message = (text: string, status: number) => new Response(text, { status, headers: corsHeaders })
const string = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const nullable = (value: unknown) => string(value) || null
const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

/** Every field mutation is authorized against an active technician membership; visit records additionally require assignment. */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return message('Method not allowed', 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization) return message('Unauthorized', 401)
  const body = await request.json().catch(() => ({})) as RequestBody
  if (!body.action) return message('Invalid request', 400)
  const url = Deno.env.get('SUPABASE_URL')!, publishableKey = Deno.env.get('SUPABASE_ANON_KEY')!, serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const actor = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } })
  const token = authorization.replace(/^Bearer\s+/i, '')
  const { data: { user }, error: userError } = await actor.auth.getUser(token)
  if (userError || !user) return message('Unauthorized', 401)
  const { data: profile } = await actor.from('profiles').select('active').eq('id', user.id).maybeSingle()
  if (!profile?.active) return message('Forbidden', 403)
  const admin = createClient(url, serviceRole)
  const hasActiveMembership = async (companyId?: string) => {
    if (!companyId) return false
    const { data } = await actor.from('company_memberships').select('role, companies!inner(status)').eq('company_id', companyId).eq('user_id', user.id).eq('role', 'technician').eq('active', true).eq('companies.status', 'active').maybeSingle()
    return Boolean(data)
  }
  const assignedAppointment = async (appointmentId?: string) => {
    if (!appointmentId) return null
    const { data: link } = await admin.from('appointment_technicians').select('company_id').eq('appointment_id', appointmentId).eq('technician_id', user.id).maybeSingle()
    if (!link || !(await hasActiveMembership(link.company_id))) return null
    const { data } = await admin.from('appointments').select('id, company_id, client_id, status').eq('id', appointmentId).eq('company_id', link.company_id).maybeSingle()
    return data
  }
  const clientInCompany = async (clientId?: string, companyId?: string) => {
    if (!clientId || !companyId || !(await hasActiveMembership(companyId))) return null
    const { data } = await admin.from('clients').select('id').eq('id', clientId).eq('company_id', companyId).eq('active', true).maybeSingle()
    return data
  }
  if (body.action === 'create_client') {
    const companyId = string(body.company_id)
    if (!companyId || !(await hasActiveMembership(companyId))) return message('Forbidden', 403)
    if (!string(body.name)) return message('Informe o nome do cliente.', 400)
    const { data, error } = await admin.from('clients').insert({ company_id: companyId, name: string(body.name), legal_name: nullable(body.legal_name), cnpj: nullable(body.cnpj)?.replace(/\D/g, '') || null, phone: nullable(body.phone), whatsapp: nullable(body.whatsapp), email: nullable(body.email), address_line: nullable(body.address_line), city: nullable(body.city), state: nullable(body.state)?.toUpperCase() || null, cnae_input: nullable(body.cnae_input)?.replace(/\D/g, '') || null, business_activity: nullable(body.business_activity), created_by: user.id }).select().single()
    return error ? message(error.message, 400) : json({ client: data })
  }
  if (body.action === 'create_appointment') {
    const companyId = string(body.company_id), clientId = string(body.client_id), startsAt = new Date(string(body.starts_at)), endsAt = body.ends_at ? new Date(string(body.ends_at)) : null
    if (!companyId || !(await hasActiveMembership(companyId))) return message('Forbidden', 403)
    if (!clientId || !string(body.service_type) || Number.isNaN(startsAt.getTime()) || (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt))) return message('Informe cliente, serviço e horários válidos.', 400)
    if (!(await clientInCompany(clientId, companyId))) return message('Cliente não encontrado ou inativo.', 404)
    const { data: appointment, error } = await admin.from('appointments').insert({ company_id: companyId, client_id: clientId, service_type: string(body.service_type), starts_at: startsAt.toISOString(), ends_at: endsAt?.toISOString() || null, location_text: nullable(body.location_text), description: nullable(body.description), status: 'scheduled', created_by: user.id }).select().single()
    if (error || !appointment) return message(error?.message || 'Não foi possível criar o atendimento.', 400)
    const { error: linkError } = await admin.from('appointment_technicians').insert({ appointment_id: appointment.id, company_id: companyId, technician_id: user.id, assigned_by: user.id })
    if (linkError) { await admin.from('appointments').delete().eq('id', appointment.id); return message(linkError.message, 500) }
    await admin.from('appointment_status_history').insert({ company_id: companyId, appointment_id: appointment.id, from_status: null, to_status: 'scheduled', changed_by: user.id, note: 'Atendimento criado pelo técnico.' })
    return json({ appointment })
  }
  if (body.action === 'update_status') {
    const appointment = await assignedAppointment(string(body.appointment_id)), next = body.status
    if (!appointment) return message('Atendimento não disponível.', 404)
    const allowed = next === 'in_progress' ? ['scheduled', 'pending_confirmation', 'confirmed'].includes(appointment.status) : next === 'completed' && appointment.status === 'in_progress'
    if (!allowed) return message('Esta alteração de status não é permitida.', 409)
    const now = new Date().toISOString(), update = next === 'in_progress' ? { status: next, started_at: now } : { status: next, completed_at: now }
    const { error } = await admin.from('appointments').update(update).eq('id', appointment.id)
    if (error) return message(error.message, 500)
    await admin.from('appointment_status_history').insert({ company_id: appointment.company_id, appointment_id: appointment.id, from_status: appointment.status, to_status: next, changed_by: user.id })
    return json({ ok: true })
  }
  if (body.action === 'save_service' || body.action === 'save_function_activity' || body.action === 'save_evidence' || body.action === 'save_signature') {
    const appointment = await assignedAppointment(string(body.appointment_id))
    if (!appointment) return message('Atendimento não disponível.', 404)
    if (body.action === 'save_service') {
      if (!string(body.service_name)) return message('Informe o serviço realizado.', 400)
      const { data, error } = await admin.from('service_records').insert({ company_id: appointment.company_id, client_id: appointment.client_id, appointment_id: appointment.id, service_name: string(body.service_name), notes: nullable(body.notes), created_by: user.id }).select('id').single()
      return error ? message(error.message, 400) : json({ ok: true, id: data.id })
    }
    if (body.action === 'save_function_activity') {
      if (!string(body.role_name) || !string(body.description)) return message('Informe a função e a atividade.', 400)
      const { data, error } = await admin.from('function_activities').insert({ company_id: appointment.company_id, client_id: appointment.client_id, appointment_id: appointment.id, role_name: string(body.role_name), worker_name: nullable(body.worker_name), sector: nullable(body.sector), description: string(body.description), notes: nullable(body.notes), created_by: user.id }).select('id').single()
      return error ? message(error.message, 400) : json({ ok: true, id: data.id })
    }
    if (body.action === 'save_evidence') {
      const path = string(body.storage_path), kind = ['image', 'video', 'document'].includes(string(body.media_kind)) ? string(body.media_kind) : 'document', risk = ['low', 'medium', 'high'].includes(string(body.risk_level)) ? string(body.risk_level) : null
      if (!path.startsWith(`${appointment.company_id}/${appointment.id}/`) || !string(body.file_name)) return message('Arquivo de evidência inválido.', 400)
      const { data, error } = await admin.from('evidence').insert({ company_id: appointment.company_id, appointment_id: appointment.id, storage_bucket: 'fd-sst-evidence', storage_path: path, file_name: string(body.file_name), content_type: nullable(body.content_type), byte_size: numberOrNull(body.byte_size), media_kind: kind, risk_level: risk, observation: nullable(body.observation), recommendation: nullable(body.recommendation), created_by: user.id }).select('id').single()
      return error ? message(error.message, 400) : json({ ok: true, id: data.id })
    }
    const path = string(body.storage_path)
    if (!string(body.signer_name) || !path.startsWith(`${appointment.company_id}/${appointment.id}/`)) return message('Informe responsável e assinatura.', 400)
    const { error } = await admin.from('appointment_signatures').upsert({ company_id: appointment.company_id, appointment_id: appointment.id, signer_name: string(body.signer_name), signer_job_title: nullable(body.signer_job_title), storage_bucket: 'fd-sst-evidence', storage_path: path, signed_at: new Date().toISOString(), captured_by: user.id }, { onConflict: 'appointment_id' })
    return error ? message(error.message, 400) : json({ ok: true })
  }
  if (body.action === 'save_travel') {
    const appointment = body.appointment_id ? await assignedAppointment(string(body.appointment_id)) : null, companyId = appointment?.company_id || string(body.company_id), distance = numberOrNull(body.distance_km)
    if (!companyId || !(await hasActiveMembership(companyId))) return message('Empresa não disponível.', 404)
    if (distance !== null && distance < 0) return message('Quilometragem inválida.', 400)
    const { data, error } = await admin.from('travel_logs').insert({ company_id: companyId, appointment_id: appointment?.id || null, technician_id: user.id, departed_at: nullable(body.departed_at), arrived_at: nullable(body.arrived_at), ended_at: nullable(body.ended_at), distance_km: distance, distance_source: ['manual', 'estimated', 'geolocation'].includes(string(body.distance_source)) ? string(body.distance_source) : 'manual', notes: nullable(body.notes) }).select('id').single()
    return error ? message(error.message, 400) : json({ ok: true, id: data.id })
  }
  if (body.action === 'save_accident' || body.action === 'save_training' || body.action === 'save_heat_assessment') {
    const companyId = string(body.company_id), clientId = string(body.client_id)
    if (!(await clientInCompany(clientId, companyId))) return message('Cliente não disponível.', 404)
    if (body.action === 'save_accident') {
      if (!string(body.description) || !string(body.occurred_at)) return message('Informe data e descrição do acidente.', 400)
      const { data, error } = await admin.from('accident_investigations').insert({ company_id: companyId, client_id: clientId, occurred_at: new Date(string(body.occurred_at)).toISOString(), location_text: nullable(body.location_text), worker_name: nullable(body.worker_name), worker_role: nullable(body.worker_role), occurrence_type: nullable(body.occurrence_type), description: string(body.description), circumstances: nullable(body.circumstances), possible_causes: nullable(body.possible_causes), immediate_measures: nullable(body.immediate_measures), recommendations: nullable(body.recommendations), created_by: user.id }).select('id').single()
      return error ? message(error.message, 400) : json({ ok: true, id: data.id })
    }
    if (body.action === 'save_training') {
      if (!string(body.name) || !string(body.starts_at)) return message('Informe treinamento e data.', 400)
      const { data, error } = await admin.from('trainings').insert({ company_id: companyId, client_id: clientId, name: string(body.name), starts_at: new Date(string(body.starts_at)).toISOString(), location_text: nullable(body.location_text), workload_minutes: numberOrNull(body.workload_minutes), instructor_name: nullable(body.instructor_name), syllabus: nullable(body.syllabus), notes: nullable(body.notes), created_by: user.id }).select('id').single()
      return error ? message(error.message, 400) : json({ ok: true, id: data.id })
    }
    const tbn = numberOrNull(body.tbn), tg = numberOrNull(body.tg), tbs = numberOrNull(body.tbs), solar = body.solar_exposure === true
    if (tbn === null || tg === null || (solar && tbs === null)) return message('Informe as temperaturas necessárias para o cálculo.', 400)
    const ibutg = solar ? 0.7 * tbn + 0.2 * tg + 0.1 * (tbs as number) : 0.7 * tbn + 0.3 * tg
    const { data, error } = await admin.from('heat_assessments').insert({ company_id: companyId, client_id: clientId, appointment_id: nullable(body.appointment_id), tbn, tg, tbs, solar_exposure: solar, activity_description: nullable(body.activity_description), formula_version: solar ? 'NHO-06: 0.7 tbn + 0.2 tg + 0.1 tbs' : 'NHO-06: 0.7 tbn + 0.3 tg', calculated_ibutg: Number(ibutg.toFixed(2)), validation_status: 'pending_technical_validation', notes: nullable(body.notes), measured_at: body.measured_at ? new Date(string(body.measured_at)).toISOString() : new Date().toISOString(), created_by: user.id }).select('id').single()
    return error ? message(error.message, 400) : json({ ok: true, id: data.id })
  }
  return message('Unsupported action', 400)
})
