import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Public confirmation endpoint. Receives only a random opaque token; all matching and mutation happen server-side. */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  const token = (await request.json().catch(() => ({}))).token
  if (typeof token !== 'string' || token.length < 32) return new Response('Invalid token', { status: 400, headers: corsHeaders })
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!serviceRole) return new Response('Function is not configured', { status: 503, headers: corsHeaders })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceRole)
  const hash = await sha256(token)
  const now = new Date().toISOString()
  const { data: confirmation, error } = await admin.from('appointment_confirmation_tokens').select('id, appointment_id, used_at, expires_at').eq('token_hash', hash).maybeSingle()
  if (error || !confirmation || confirmation.used_at || confirmation.expires_at < now) return new Response('Token unavailable', { status: 404, headers: corsHeaders })
  const { data: appointment, error: appointmentError } = await admin.from('appointments').update({ status: 'confirmed', client_confirmed_at: now }).eq('id', confirmation.appointment_id).in('status', ['scheduled', 'pending_confirmation']).select('id, company_id').maybeSingle()
  if (appointmentError || !appointment) return new Response('Appointment unavailable', { status: 409, headers: corsHeaders })
  const { error: useError } = await admin.from('appointment_confirmation_tokens').update({ used_at: now }).eq('id', confirmation.id).is('used_at', null)
  if (useError) return new Response(useError.message, { status: 500, headers: corsHeaders })
  await admin.from('appointment_status_history').insert({ company_id: appointment.company_id, appointment_id: appointment.id, to_status: 'confirmed', note: 'Confirmed by secure public link' })
  const { data: technicians } = await admin.from('appointment_technicians').select('technician_id').eq('appointment_id', appointment.id)
  if (technicians?.length) await admin.from('notifications').insert(technicians.map(({ technician_id }) => ({ company_id: appointment.company_id, recipient_id: technician_id, title: 'Visita confirmada', body: 'O cliente confirmou o atendimento agendado.', entity_type: 'appointment', entity_id: appointment.id })))
  return new Response(JSON.stringify({ confirmed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
})
