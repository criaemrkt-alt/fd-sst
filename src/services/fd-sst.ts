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
  const payload = { ...input, cnpj: input.cnpj?.replace(/\D/g, '') || null, cnae_code: input.cnae_code?.replace(/\D/g, '') || null }
  const { data, error } = input.id
    ? await client().from('clients').update(payload).eq('id', input.id).select().single()
    : await client().from('clients').insert(payload).select().single()
  if (error) throw error
  return data as Client
}

export async function listAppointments(companyId: string, technicianId?: string) {
  let query = client().from('appointments').select('*, clients(id, name, phone, whatsapp, address_line), appointment_technicians!inner(technician_id)').eq('company_id', companyId).order('starts_at')
  if (technicianId) query = query.eq('appointment_technicians.technician_id', technicianId)
  const { data, error } = await query
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
  })
}

export async function updateTechnicianAppointmentStatus(appointment: Appointment, status: Appointment['status']) {
  return invokeTechnicianWork<{ ok: true }>({ action: 'update_status', appointment_id: appointment.id, status })
}
