import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// A chave publishable é própria para aplicações cliente e fica exposta no
// bundle web. As variáveis permitem sobrescrever estes valores em outros
// ambientes; os valores padrão tornam o GitHub Pages publicável sem uma etapa
// manual de configuração de variáveis no repositório.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://cperyeyppyhpzyjafqtp.supabase.co'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_nbisAHKwrduF8RF3UjU06Q_FIblD_qg'

export const supabase: SupabaseClient | null = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null

export const hasSupabaseConfiguration = Boolean(supabase)
