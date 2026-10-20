import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type Action = 'create_client' | 'create_appointment' | 'start_appointment' | 'finalize_appointment' | 'save_service' | 'save_function_activity' | 'save_note' | 'attach_checklist' | 'save_checklist_answer' | 'save_evidence' | 'update_evidence' | 'delete_content' | 'save_signature' | 'save_travel' | 'save_accident' | 'save_training' | 'save_heat_assessment'
type Body = Record<string, unknown> & { action?: Action; appointment_id?: string; company_id?: string; client_id?: string }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const fail = (text: string, status = 400) => new Response(text, { status, headers: corsHeaders })
const str = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const nullable = (value: unknown) => str(value) || null
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const validRisk = (value: unknown) => ['low', 'medium', 'high'].includes(str(value)) ? str(value) : null

/**
 * The browser never receives a privileged key. Every mutation first proves the
 * caller is an active technician assigned to the attendance. This keeps drafts
 * private until the atomic finalization action publishes them to the ADM role.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return fail('Method not allowed', 405)
  const authorization = request.headers.get('Authorization')
  if (!authorization) return fail('Unauthorized', 401)
  const body = await request.json().catch(() => ({})) as Body
  if (!body.action) return fail('Invalid request')
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const actor = createClient(url, anon, { global: { headers: { Authorization: authorization } } })
  const token = authorization.replace(/^Bearer\s+/i, '')
  const { data: { user }, error: userError } = await actor.auth.getUser(token)
  if (userError || !user) return fail('Unauthorized', 401)
  const { data: profile } = await actor.from('profiles').select('active').eq('id', user.id).maybeSingle()
  if (!profile?.active) return fail('Forbidden', 403)
  const admin = createClient(url, service)
  const activeTech = async (companyId?: string) => {
    if (!companyId) return false
    const { data } = await actor.from('company_memberships').select('role, companies!inner(status)').eq('company_id', companyId).eq('user_id', user.id).eq('role', 'technician').eq('active', true).eq('companies.status', 'active').maybeSingle()
    return Boolean(data)
  }
  const appointmentFor = async (id?: string) => {
    if (!id) return null
    const { data: link } = await admin.from('appointment_technicians').select('company_id').eq('appointment_id', id).eq('technician_id', user.id).maybeSingle()
    if (!link || !(await activeTech(link.company_id))) return null
    const { data } = await admin.from('appointments').select('id, company_id, client_id, status, started_at, completed_at').eq('id', id).eq('company_id', link.company_id).maybeSingle()
    return data
  }
  const draft = async (id?: string) => {
    const appointment = await appointmentFor(id)
    return appointment?.status === 'in_progress' ? appointment : null
  }
  const clientInCompany = async (clientId?: string, companyId?: string) => {
    if (!clientId || !companyId || !(await activeTech(companyId))) return null
    const { data } = await admin.from('clients').select('id').eq('id', clientId).eq('company_id', companyId).eq('active', true).maybeSingle()
    return data
  }
  const audit = async (companyId: string, entity: string, id: string | null, action: string, metadata: Record<string, unknown> = {}) => {
    await admin.from('audit_logs').insert({ company_id: companyId, actor_id: user.id, action, entity_type: entity, entity_id: id, metadata })
  }

  if (body.action === 'create_client') {
    const companyId = str(body.company_id)
    if (!companyId || !(await activeTech(companyId))) return fail('Forbidden', 403)
    if (!str(body.name)) return fail('Informe o nome do cliente.')
    const { data, error } = await admin.from('clients').insert({ company_id: companyId, name: str(body.name), legal_name: nullable(body.legal_name), cnpj: nullable(body.cnpj)?.replace(/\D/g, '') || null, phone: nullable(body.phone), whatsapp: nullable(body.whatsapp), email: nullable(body.email), address_line: nullable(body.address_line), city: nullable(body.city), state: nullable(body.state)?.toUpperCase() || null, cnae_input: nullable(body.cnae_input)?.replace(/\D/g, '') || null, business_activity: nullable(body.business_activity), created_by: user.id }).select().single()
    if (error) return fail(error.message)
    await audit(companyId, 'client', data.id, 'technician_created_client')
    return json({ client: data })
  }

  if (body.action === 'create_appointment') {
    const companyId = str(body.company_id), clientId = str(body.client_id), starts = new Date(str(body.starts_at)), ends = body.ends_at ? new Date(str(body.ends_at)) : null
    if (!companyId || !(await activeTech(companyId))) return fail('Forbidden', 403)
    if (!clientId || !str(body.service_type) || Number.isNaN(starts.getTime()) || (ends && (Number.isNaN(ends.getTime()) || ends <= starts))) return fail('Informe cliente, serviço e horários válidos.')
    if (!(await clientInCompany(clientId, companyId))) return fail('Cliente não encontrado ou inativo.', 404)
    const { data: appointment, error } = await admin.from('appointments').insert({ company_id: companyId, client_id: clientId, service_type: str(body.service_type), starts_at: starts.toISOString(), ends_at: ends?.toISOString() || null, location_text: nullable(body.location_text), description: nullable(body.description), status: 'scheduled', created_by: user.id }).select().single()
    if (error || !appointment) return fail(error?.message || 'Não foi possível criar o atendimento.')
    const { error: linkError } = await admin.from('appointment_technicians').insert({ appointment_id: appointment.id, company_id: companyId, technician_id: user.id, assigned_by: user.id })
    if (linkError) { await admin.from('appointments').delete().eq('id', appointment.id); return fail(linkError.message, 500) }
    await admin.from('appointment_status_history').insert({ company_id: companyId, appointment_id: appointment.id, to_status: 'scheduled', changed_by: user.id, note: 'Atendimento criado pelo técnico.' })
    await audit(companyId, 'appointment', appointment.id, 'technician_created_appointment')
    return json({ appointment })
  }

  if (body.action === 'start_appointment') {
    const appointment = await appointmentFor(str(body.appointment_id))
    if (!appointment) return fail('Atendimento não disponível.', 404)
    if (appointment.status === 'in_progress') return json({ ok: true, already_started: true })
    if (!['scheduled', 'pending_confirmation', 'confirmed'].includes(appointment.status)) return fail('Este atendimento não pode ser iniciado.', 409)
    const now = new Date().toISOString()
    const { error } = await admin.from('appointments').update({ status: 'in_progress', started_at: now }).eq('id', appointment.id).eq('status', appointment.status)
    if (error) return fail(error.message, 500)
    await admin.from('appointment_status_history').insert({ company_id: appointment.company_id, appointment_id: appointment.id, from_status: appointment.status, to_status: 'in_progress', changed_by: user.id })
    await audit(appointment.company_id, 'appointment', appointment.id, 'attendance_started')
    return json({ ok: true })
  }

  if (body.action === 'save_service' || body.action === 'save_function_activity' || body.action === 'save_note' || body.action === 'save_evidence' || body.action === 'update_evidence' || body.action === 'save_signature' || body.action === 'attach_checklist' || body.action === 'save_checklist_answer' || body.action === 'delete_content') {
    const appointment = await draft(str(body.appointment_id))
    if (!appointment) return fail('Inicie o atendimento para registrar informações ou ele já foi finalizado.', 409)
    if (body.action === 'save_service') {
      if (!str(body.service_name)) return fail('Informe o serviço realizado.')
      const payload = { service_name: str(body.service_name), notes: nullable(body.notes), service_catalog_id: nullable(body.service_catalog_id), updated_at: new Date().toISOString(), updated_by: user.id }
      const id = str(body.id)
      const result = id ? await admin.from('service_records').update(payload).eq('id', id).eq('appointment_id', appointment.id).select('id').single() : await admin.from('service_records').insert({ ...payload, company_id: appointment.company_id, client_id: appointment.client_id, appointment_id: appointment.id, created_by: user.id }).select('id').single()
      if (result.error) return fail(result.error.message)
      await audit(appointment.company_id, 'service_record', result.data.id, id ? 'attendance_service_updated' : 'attendance_service_added')
      return json({ ok: true, id: result.data.id })
    }
    if (body.action === 'save_function_activity') {
      if (!str(body.role_name) || !str(body.description)) return fail('Informe a função e a atividade.')
      const payload = { role_name: str(body.role_name), worker_name: nullable(body.worker_name), sector: nullable(body.sector), description: str(body.description), notes: nullable(body.notes), updated_at: new Date().toISOString(), updated_by: user.id }
      const id = str(body.id)
      const result = id ? await admin.from('function_activities').update(payload).eq('id', id).eq('appointment_id', appointment.id).select('id').single() : await admin.from('function_activities').insert({ ...payload, company_id: appointment.company_id, client_id: appointment.client_id, appointment_id: appointment.id, created_by: user.id }).select('id').single()
      if (result.error) return fail(result.error.message)
      await audit(appointment.company_id, 'function_activity', result.data.id, id ? 'attendance_activity_updated' : 'attendance_activity_added')
      return json({ ok: true, id: result.data.id })
    }
    if (body.action === 'save_note') {
      if (!str(body.body)) return fail('Escreva uma observação.')
      const payload = { note_kind: ['general', 'issue', 'guidance', 'recommendation', 'pending'].includes(str(body.note_kind)) ? str(body.note_kind) : 'general', body: str(body.body), updated_at: new Date().toISOString(), updated_by: user.id }
      const id = str(body.id)
      const result = id ? await admin.from('appointment_notes').update(payload).eq('id', id).eq('appointment_id', appointment.id).select('id').single() : await admin.from('appointment_notes').insert({ ...payload, company_id: appointment.company_id, appointment_id: appointment.id, created_by: user.id }).select('id').single()
      if (result.error) return fail(result.error.message)
      return json({ ok: true, id: result.data.id })
    }
    if (body.action === 'attach_checklist') {
      const versionId = str(body.template_version_id)
      if (!versionId) return fail('Selecione um modelo de checklist.')
      const { data: version } = await admin.from('checklist_template_versions').select('id, company_id').eq('id', versionId).eq('company_id', appointment.company_id).maybeSingle()
      if (!version) return fail('Modelo não disponível.', 404)
      const { data, error } = await admin.from('appointment_checklists').upsert({ company_id: appointment.company_id, appointment_id: appointment.id, template_version_id: versionId }, { onConflict: 'appointment_id,template_version_id', ignoreDuplicates: true }).select('id').maybeSingle()
      if (error) return fail(error.message)
      const checklistId = data?.id || (await admin.from('appointment_checklists').select('id').eq('appointment_id', appointment.id).eq('template_version_id', versionId).single()).data?.id
      return json({ ok: true, id: checklistId })
    }
    if (body.action === 'save_checklist_answer') {
      const checklistId = str(body.appointment_checklist_id), itemId = str(body.checklist_item_id)
      if (!checklistId || !itemId) return fail('Checklist e item são obrigatórios.')
      const { data: checklist } = await admin.from('appointment_checklists').select('id, appointment_id').eq('id', checklistId).eq('appointment_id', appointment.id).maybeSingle()
      if (!checklist) return fail('Checklist não disponível.', 404)
      const { error } = await admin.from('checklist_answers').upsert({ company_id: appointment.company_id, appointment_checklist_id: checklistId, checklist_item_id: itemId, answer: body.answer ?? {}, note: nullable(body.note), answered_at: new Date().toISOString(), answered_by: user.id }, { onConflict: 'appointment_checklist_id,checklist_item_id' })
      return error ? fail(error.message) : json({ ok: true })
    }
    if (body.action === 'save_evidence') {
      const path = str(body.storage_path)
      if (!path.startsWith(`${appointment.company_id}/${appointment.id}/`) || !str(body.file_name)) return fail('Arquivo de evidência inválido.')
      const media = ['image', 'video', 'document'].includes(str(body.media_kind)) ? str(body.media_kind) : 'document'
      const { data, error } = await admin.from('evidence').insert({ company_id: appointment.company_id, appointment_id: appointment.id, checklist_answer_id: nullable(body.checklist_answer_id), storage_bucket: 'fd-sst-evidence', storage_path: path, file_name: str(body.file_name), content_type: nullable(body.content_type), byte_size: finite(body.byte_size), media_kind: media, risk_level: validRisk(body.risk_level), observation: nullable(body.observation), recommendation: nullable(body.recommendation), additional_notes: nullable(body.additional_notes), created_by: user.id, updated_by: user.id }).select('id').single()
      if (error) return fail(error.message)
      await audit(appointment.company_id, 'evidence', data.id, 'attendance_evidence_added')
      return json({ ok: true, id: data.id })
    }
    if (body.action === 'update_evidence') {
      const id = str(body.id); if (!id) return fail('Evidência não informada.')
      const { data, error } = await admin.from('evidence').update({ risk_level: validRisk(body.risk_level), observation: nullable(body.observation), recommendation: nullable(body.recommendation), additional_notes: nullable(body.additional_notes), checklist_answer_id: nullable(body.checklist_answer_id), updated_at: new Date().toISOString(), updated_by: user.id }).eq('id', id).eq('appointment_id', appointment.id).select('id').single()
      return error ? fail(error.message) : json({ ok: true, id: data.id })
    }
    if (body.action === 'save_signature') {
      const path = str(body.storage_path)
      if (!str(body.signer_name) || !path.startsWith(`${appointment.company_id}/${appointment.id}/`)) return fail('Informe responsável e assinatura.')
      const { error } = await admin.from('appointment_signatures').upsert({ company_id: appointment.company_id, appointment_id: appointment.id, signer_name: str(body.signer_name), signer_job_title: nullable(body.signer_job_title), storage_bucket: 'fd-sst-evidence', storage_path: path, signed_at: new Date().toISOString(), captured_by: user.id }, { onConflict: 'appointment_id' })
      return error ? fail(error.message) : json({ ok: true })
    }
    const id = str(body.id), kind = str(body.kind)
    if (!id || !['service', 'activity', 'note', 'evidence'].includes(kind)) return fail('Registro inválido.')
    if (kind === 'service') await admin.from('service_records').delete().eq('id', id).eq('appointment_id', appointment.id)
    if (kind === 'activity') await admin.from('function_activities').delete().eq('id', id).eq('appointment_id', appointment.id)
    if (kind === 'note') await admin.from('appointment_notes').delete().eq('id', id).eq('appointment_id', appointment.id)
    if (kind === 'evidence') {
      const { data: evidence } = await admin.from('evidence').select('storage_bucket, storage_path').eq('id', id).eq('appointment_id', appointment.id).maybeSingle()
      if (evidence) await admin.storage.from(evidence.storage_bucket).remove([evidence.storage_path])
      await admin.from('evidence').delete().eq('id', id).eq('appointment_id', appointment.id)
    }
    await audit(appointment.company_id, kind, id, 'attendance_content_deleted')
    return json({ ok: true })
  }

  if (body.action === 'finalize_appointment') {
    const appointment = await appointmentFor(str(body.appointment_id))
    if (!appointment) return fail('Atendimento não disponível.', 404)
    if (appointment.status === 'completed') return json({ ok: true, already_finalized: true })
    if (appointment.status !== 'in_progress') return fail('Inicie o atendimento antes de finalizar.', 409)
    const { data: assignedChecklists, error: checklistError } = await admin.from('appointment_checklists').select('id, template_version_id').eq('appointment_id', appointment.id)
    if (checklistError) return fail(checklistError.message, 500)
    const missing: Array<{ prompt: string }> = []
    for (const checklist of assignedChecklists || []) {
      const { data: requiredItems, error: itemError } = await admin.from('checklist_items').select('id, prompt').eq('template_version_id', checklist.template_version_id).eq('required', true)
      if (itemError) return fail(itemError.message, 500)
      const { data: answers, error: answerError } = await admin.from('checklist_answers').select('checklist_item_id, answer').eq('appointment_checklist_id', checklist.id)
      if (answerError) return fail(answerError.message, 500)
      const answerMap = new Map((answers || []).map((answer) => [answer.checklist_item_id, answer.answer]))
      for (const item of requiredItems || []) {
        const answer = answerMap.get(item.id)
        if (!answer || typeof answer !== 'object' || Object.keys(answer).length === 0) missing.push({ prompt: item.prompt })
      }
    }
    // This is a valid draft-state response, not a transport failure: the UI uses
    // it to take the technician directly back to the missing checklist items.
    if (missing.length) return json({ ok: false, missing_required: missing.map((item: any) => item.prompt) })
    const now = new Date().toISOString()
    const { data: updated, error } = await admin.from('appointments').update({ status: 'completed', completed_at: now, finalized_by: user.id, finalization_note: nullable(body.finalization_note) }).eq('id', appointment.id).eq('status', 'in_progress').select('id').maybeSingle()
    if (error) return fail(error.message, 500)
    if (!updated) return json({ ok: true, already_finalized: true })
    await admin.from('appointment_status_history').insert({ company_id: appointment.company_id, appointment_id: appointment.id, from_status: 'in_progress', to_status: 'completed', changed_by: user.id, note: nullable(body.finalization_note) })
    const { data: admins } = await admin.from('company_memberships').select('user_id').eq('company_id', appointment.company_id).eq('role', 'admin').eq('active', true)
    if (admins?.length) await admin.from('notifications').insert(admins.map((member) => ({ company_id: appointment.company_id, recipient_id: member.user_id, title: 'Atendimento finalizado', body: 'Um atendimento técnico foi finalizado e está disponível para consulta.', entity_type: 'appointment', entity_id: appointment.id })))
    await audit(appointment.company_id, 'appointment', appointment.id, 'attendance_finalized')
    return json({ ok: true, finalized_at: now })
  }

  // Stand-alone tools remain available outside an attendance and keep the same
  // active-company/active-technician validation as the visit workflow.
  if (body.action === 'save_travel') {
    const linked = body.appointment_id ? await appointmentFor(str(body.appointment_id)) : null
    const companyId = linked?.company_id || str(body.company_id), distance = finite(body.distance_km)
    if (!companyId || !(await activeTech(companyId))) return fail('Empresa não disponível.', 404)
    if (distance !== null && distance < 0) return fail('Quilometragem inválida.')
    const { data, error } = await admin.from('travel_logs').insert({ company_id: companyId, appointment_id: linked?.id || null, technician_id: user.id, departed_at: nullable(body.departed_at), arrived_at: nullable(body.arrived_at), ended_at: nullable(body.ended_at), distance_km: distance, distance_source: ['manual', 'estimated', 'geolocation'].includes(str(body.distance_source)) ? str(body.distance_source) : 'manual', notes: nullable(body.notes) }).select('id').single()
    return error ? fail(error.message) : json({ ok: true, id: data.id })
  }
  if (body.action === 'save_accident' || body.action === 'save_training' || body.action === 'save_heat_assessment') {
    const companyId = str(body.company_id), clientId = str(body.client_id)
    if (!(await clientInCompany(clientId, companyId))) return fail('Cliente não disponível.', 404)
    if (body.action === 'save_accident') {
      if (!str(body.description) || !str(body.occurred_at)) return fail('Informe data e descrição do acidente.')
      const { data, error } = await admin.from('accident_investigations').insert({ company_id: companyId, client_id: clientId, occurred_at: new Date(str(body.occurred_at)).toISOString(), location_text: nullable(body.location_text), worker_name: nullable(body.worker_name), worker_role: nullable(body.worker_role), occurrence_type: nullable(body.occurrence_type), description: str(body.description), circumstances: nullable(body.circumstances), possible_causes: nullable(body.possible_causes), immediate_measures: nullable(body.immediate_measures), recommendations: nullable(body.recommendations), created_by: user.id }).select('id').single()
      return error ? fail(error.message) : json({ ok: true, id: data.id })
    }
    if (body.action === 'save_training') {
      if (!str(body.name) || !str(body.starts_at)) return fail('Informe treinamento e data.')
      const { data, error } = await admin.from('trainings').insert({ company_id: companyId, client_id: clientId, name: str(body.name), starts_at: new Date(str(body.starts_at)).toISOString(), location_text: nullable(body.location_text), workload_minutes: finite(body.workload_minutes), instructor_name: nullable(body.instructor_name), syllabus: nullable(body.syllabus), notes: nullable(body.notes), created_by: user.id }).select('id').single()
      return error ? fail(error.message) : json({ ok: true, id: data.id })
    }
    const tbn = finite(body.tbn), tg = finite(body.tg), tbs = finite(body.tbs), solar = body.solar_exposure === true
    if (tbn === null || tg === null || (solar && tbs === null)) return fail('Informe as temperaturas necessárias para o cálculo.')
    const ibutg = solar ? .7 * tbn + .2 * tg + .1 * (tbs as number) : .7 * tbn + .3 * tg
    const { data, error } = await admin.from('heat_assessments').insert({ company_id: companyId, client_id: clientId, tbn, tg, tbs, solar_exposure: solar, activity_description: nullable(body.activity_description), formula_version: solar ? 'NHO-06: 0.7 tbn + 0.2 tg + 0.1 tbs' : 'NHO-06: 0.7 tbn + 0.3 tg', calculated_ibutg: Number(ibutg.toFixed(2)), validation_status: 'pending_technical_validation', notes: nullable(body.notes), measured_at: body.measured_at ? new Date(str(body.measured_at)).toISOString() : new Date().toISOString(), created_by: user.id }).select('id').single()
    return error ? fail(error.message) : json({ ok: true, id: data.id })
  }
  return fail('Unsupported action')
})
