export type AppRole = 'master' | 'admin' | 'technician'
export type AppointmentStatus = 'scheduled' | 'pending_confirmation' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'

export interface Profile {
  id: string
  full_name: string | null
  global_role: AppRole | null
  active: boolean
}

export interface Membership {
  id: string
  company_id: string
  user_id: string
  role: Exclude<AppRole, 'master'>
  active: boolean
  job_title: string | null
  companies?: { id: string; name: string } | null
}

export interface Client {
  id: string
  company_id: string
  name: string
  legal_name: string | null
  cnpj: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  address_line: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  cnae_code: string | null
  cnae_input?: string | null
  business_activity: string | null
  risk_grade: number | null
  cnae_description_snapshot: string | null
  active: boolean
}

export interface Appointment {
  id: string
  company_id: string
  client_id: string
  service_type: string
  description: string | null
  location_text: string | null
  starts_at: string
  ends_at: string | null
  status: AppointmentStatus
  client_confirmed_at: string | null
  started_at: string | null
  completed_at: string | null
  clients?: Pick<Client, 'id' | 'name' | 'phone' | 'whatsapp' | 'address_line'> | null
  appointment_technicians?: Array<{ technician_id: string; profiles?: { full_name: string | null } | null }>
}
