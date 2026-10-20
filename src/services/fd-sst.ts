import { supabase } from '../lib/supabase'
import type { Appointment, Client } from '../types/domain'

function client() {
  if (!supabase) throw new Error('O Supabase ainda não foi configurado.')
  return supabase
}

export async function listClients(companyId: string, search = '') {
  let query = client().from('clients').select('*').eq('company_id', companyId).order('name')
  if (search) query = query.ilike('name', `%${search}%`)
  const { data, error } = await query
  if (error) throw error
  return data as Client[]
}

export async function saveClient(input: Partial<Client> & Pick<Client, 'company_id' | 'name'>) {
  const payload = { ...input, cnpj: input.cnpj?.replace(/\D/g, '') || null, cnae_input: input.cnae_input?.replace(/\D/g, '') || null }
  const { data, error } = input.id
    ? await client().from('clients').update(payload).eq('id', input.id).select().single()
    : await client().from('clients').insert(payload).select().single()
  if (error) throw error
  return data as Client
}

export async function listAppointments(companyId: string, technicianId?: string) {
  const db = client()
  // Load assignments separately. This avoids a fragile embedded PostgREST
  // relation from turning an agenda into a full query failure on mobile.
  if (technicianId) {
    const { data: assignments, error: assignmentError } = await db
      .from('appointment_technicians')
      .select('appointment_id')
      .eq('company_id', companyId)
      .eq('technician_id', technicianId)
    if (assignmentError) throw assignmentError
    const appointmentIds = (assignments ?? []).map((item) => item.appointment_id)
    if (!appointmentIds.length) return [] as Appointment[]
    const { data, error } = await db
      .from('appointments')
      .select('*, clients(id, name, phone, whatsapp, address_line, cnae_code, cnae_input, business_activity, cnae_description_snapshot, risk_grade)')
      .eq('company_id', companyId)
      .in('id', appointmentIds)
      .order('starts_at')
    if (error) throw error
    return data as Appointment[]
  }
  const { data, error } = await db
    .from('appointments')
    .select('*, clients(id, name, phone, whatsapp, address_line, cnae_code, cnae_input, business_activity, cnae_description_snapshot, risk_grade)')
    .eq('company_id', companyId)
    .order('starts_at')
  if (error) throw error
  return data as Appointment[]
}

export async function updateAppointmentStatus(appointment: Appointment, status: Appointment['status']) {
  const db = client()
  const timestamp = new Date().toISOString()
  const update: Record<string, unknown> = { status }
  if (status === 'in_progress') update.started_at = timestamp
  if (status === 'completed') update.completed_at = timestamp
  const { error } = await db.from('appointments').update(update).eq('id', appointment.id)
  if (error) throw error
  const { error: historyError } = await db.from('appointment_status_history').insert({
    company_id: appointment.company_id, appointment_id: appointment.id, from_status: appointment.status, to_status: status,
  })
  if (historyError) throw historyError
}

export async function createAppointment(input: {
  company_id: string; client_id: string; service_type: string; starts_at: string; ends_at?: string; location_text?: string; description?: string; technician_ids: string[]
}) {
  const db = client()
  const { technician_ids, ...appointmentInput } = input
  const { data, error } = await db.from('appointments').insert(appointmentInput).select().single()
  if (error) throw error
  if (technician_ids.length) {
    const { error: linkError } = await db.from('appointment_technicians').insert(technician_ids.map((technician_id) => ({
      appointment_id: data.id, company_id: input.company_id, technician_id,
    })))
    if (linkError) throw linkError
  }
  return data as Appointment
}

type TechnicianAppointmentInput = {
  company_id: string
  client_id: string
  service_type: string
  starts_at: string
  ends_at?: string
  location_text?: string
  description?: string
}

async function invokeTechnicianWork<T>(body: Record<string, unknown>) {
  const { data, error } = await client().functions.invoke('manage-technician-work', { body })
  if (error) throw new Error(error.message || 'Não foi possível concluir esta ação.')
  return data as T
}

/** Creates an appointment already assigned to the signed-in technician. */
export async function createTechnicianAppointment(input: TechnicianAppointmentInput) {
  return invokeTechnicianWork<{ appointment: Appointment }>({ action: 'create_appointment', ...input })
}

export async function createTechnicianClient(input: Pick<Client, 'company_id' | 'name'> & Partial<Client>) {
  return invokeTechnicianWork<{ client: Client }>({
    action: 'create_client',
    company_id: input.company_id,
    name: input.name,
    phone: input.phone,
    whatsapp: input.whatsapp,
    address_line: input.address_line,
    city: input.city,
    state: input.state,
    legal_name: input.legal_name,
    cnpj: input.cnpj,
    email: input.email,
    cnae_input: input.cnae_input,
    business_activity: input.business_activity,
  })
}

export async function updateTechnicianAppointmentStatus(appointment: Appointment, status: Appointment['status']) {
  return invokeTechnicianWork<{ ok: true }>({ action: 'update_status', appointment_id: appointment.id, status })
}

export async function saveTechnicianFieldRecord(action: string, input: Record<string, unknown>) {
  return invokeTechnicianWork<{ ok: true; id?: string }>({ action, ...input })
}

export async function uploadTechnicianEvidence(input: { companyId: string; appointmentId: string; file: File; observation?: string; locationText?: string; recommendation?: string; additionalNotes?: string; checklistAnswerId?: string; riskLevel?: 'low' | 'medium' | 'high' }) {
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100)
  const path = `${input.companyId}/${input.appointmentId}/${crypto.randomUUID()}-${safeName}`
  const storage = client().storage.from('fd-sst-evidence')
  const { error: uploadError } = await storage.upload(path, input.file, { contentType: input.file.type || undefined, upsert: false })
  if (uploadError) throw uploadError
  try {
    await saveTechnicianFieldRecord('save_evidence', {
      appointment_id: input.appointmentId,
      storage_path: path,
      file_name: input.file.name,
      content_type: input.file.type || null,
      byte_size: input.file.size,
      media_kind: input.file.type.startsWith('video/') ? 'video' : input.file.type.startsWith('image/') ? 'image' : 'document',
      observation: input.observation,
      location_text: input.locationText,
      recommendation: input.recommendation,
      additional_notes: input.additionalNotes,
      checklist_answer_id: input.checklistAnswerId,
      risk_level: input.riskLevel,
    })
  } catch (error) {
    await storage.remove([path])
    throw error
  }
}

export async function uploadTechnicianSignature(input: { companyId: string; appointmentId: string; blob: Blob; signerName: string; signerJobTitle?: string }) {
  const path = `${input.companyId}/${input.appointmentId}/signature-${crypto.randomUUID()}.png`
  const { error: uploadError } = await client().storage.from('fd-sst-evidence').upload(path, input.blob, { contentType: 'image/png', upsert: false })
  if (uploadError) throw uploadError
  try {
    await saveTechnicianFieldRecord('save_signature', { appointment_id: input.appointmentId, storage_path: path, signer_name: input.signerName, signer_job_title: input.signerJobTitle })
  } catch (error) {
    await client().storage.from('fd-sst-evidence').remove([path])
    throw error
  }
}

export async function listAttendanceContent(appointmentId: string) {
  const db = client()
  const [services, activities, notes, evidence, signature, checklists] = await Promise.all([
    db.from('service_records').select('*').eq('appointment_id', appointmentId).order('performed_at'),
    db.from('function_activities').select('*').eq('appointment_id', appointmentId).order('created_at'),
    db.from('appointment_notes').select('*').eq('appointment_id', appointmentId).order('created_at'),
    db.from('evidence').select('*').eq('appointment_id', appointmentId).order('created_at'),
    db.from('appointment_signatures').select('*').eq('appointment_id', appointmentId).maybeSingle(),
    db.from('appointment_checklists').select('*, checklist_template_versions(id, checklist_templates(id, name, service_type, cnae_profile_id, source_label), checklist_items(*))').eq('appointment_id', appointmentId).order('started_at'),
  ])
  for (const result of [services, activities, notes, evidence, signature, checklists]) if (result.error) throw result.error
  const checklistIds = (checklists.data ?? []).map((item: any) => item.id)
  const answers = checklistIds.length ? await db.from('checklist_answers').select('*').in('appointment_checklist_id', checklistIds) : { data: [], error: null }
  if (answers.error) throw answers.error
  return { services: services.data ?? [], activities: activities.data ?? [], notes: notes.data ?? [], evidence: evidence.data ?? [], signature: signature.data, checklists: checklists.data ?? [], answers: answers.data ?? [] }
}

export async function listChecklistTemplates(companyId: string) {
  const { data, error } = await client().from('checklist_templates').select('*, checklist_template_versions(id, version_number, checklist_items(*))').eq('company_id', companyId).eq('active', true).is('archived_at', null).order('name')
  if (error) throw error
  return data ?? []
}

export async function listCompanyServices(companyId: string) {
  const { data, error } = await client().from('company_services').select('*').eq('company_id', companyId).eq('active', true).order('sort_order').order('name')
  if (error) throw error
  return data ?? []
}

export async function getPrivateObjectUrl(path?: string | null) {
  if (!path) return null
  const { data, error } = await client().storage.from('fd-sst-evidence').createSignedUrl(path, 60 * 15)
  if (error) throw error
  return data.signedUrl
}
