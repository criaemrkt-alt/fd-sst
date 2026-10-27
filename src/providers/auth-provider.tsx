import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { hasSupabaseConfiguration, supabase } from '../lib/supabase'
import type { Membership, Profile } from '../types/domain'

type AuthState = {
  session: Session | null
  user: User | null
  profile: Profile | null
  memberships: Membership[]
  loading: boolean
  identityError: string | null
  configured: boolean
  refreshIdentity: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)
const offlineIdentityKey = 'fd-sst-offline-identity-v1'
type OfflineIdentity = { user: User; profile: Profile; memberships: Membership[]; expires: number }

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(hasSupabaseConfiguration)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [offlineUser, setOfflineUser] = useState<User | null>(null)

  const refreshIdentity = async (providedSession?: Session | null) => {
    if (!supabase) return
    if (!navigator.onLine) {
      try {
        const cached = JSON.parse(localStorage.getItem(offlineIdentityKey) || 'null') as OfflineIdentity | null
        if (cached && cached.expires > Date.now() && (!providedSession?.user || providedSession.user.id === cached.user.id)) {
          // Local-only workspace: this grants no server permissions. Every sync
          // revalidates the real Supabase session and the database enforces RLS.
          setOfflineUser(cached.user); setProfile(cached.profile); setMemberships(cached.memberships)
          setIdentityError(null); setLoading(false); return
        }
      } catch { /* Invalid cache is never used for access. */ }
    }
    setOfflineUser(null)
    const nextSession = providedSession === undefined
      ? (await supabase.auth.getSession()).data.session
      : providedSession
    setSession(nextSession)
    if (!nextSession?.user) {
      setProfile(null)
      setMemberships([])
      setIdentityError(null)
      setLoading(false)
      return
    }
    const [profileResponse, membershipsResponse] = await Promise.all([
      supabase.from('profiles').select('id, full_name, global_role, active').eq('id', nextSession.user.id).single(),
      supabase.from('company_memberships').select('id, company_id, user_id, role, active, job_title, companies!inner(id, name, status)').eq('user_id', nextSession.user.id).eq('active', true).eq('companies.status', 'active'),
    ])
    if (profileResponse.error || membershipsResponse.error) {
      setProfile(null)
      setMemberships([])
      setIdentityError('Não foi possível validar seu acesso agora. Atualize a página e tente novamente.')
      setLoading(false)
      return
    }
    setProfile(profileResponse.data as Profile | null)
    const normalizedMemberships = (membershipsResponse.data ?? []).map((membership: any) => ({
      ...membership,
      companies: Array.isArray(membership.companies) ? membership.companies[0] ?? null : membership.companies,
    }))
    setMemberships(normalizedMemberships as Membership[])
    const techMemberships = normalizedMemberships.filter((item) => item.role === 'technician') as Membership[]
    if (profileResponse.data?.active && !profileResponse.data.global_role && techMemberships.length) {
      try { localStorage.setItem(offlineIdentityKey, JSON.stringify({ user: { id: nextSession.user.id, email: nextSession.user.email }, profile: profileResponse.data, memberships: techMemberships, expires: Date.now() + 7 * 86400000 })) } catch { /* Online access still works when local storage is disabled. */ }
    } else localStorage.removeItem(offlineIdentityKey)
    setIdentityError(null)
    setLoading(false)
  }

  useEffect(() => {
    if (!supabase) return
    void refreshIdentity()
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Evita consultar o Auth enquanto o próprio evento de autenticação ainda está em execução.
      window.setTimeout(() => void refreshIdentity(nextSession), 0)
    })
    const reconnect = () => void refreshIdentity()
    window.addEventListener('online', reconnect)
    return () => { listener.subscription.unsubscribe(); window.removeEventListener('online', reconnect) }
  }, [])

  const signOut = async () => {
    if (!supabase) return
    localStorage.removeItem(offlineIdentityKey)
    setOfflineUser(null)
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    if (error) throw error
  }

  const value = useMemo<AuthState>(() => ({
    session, user: offlineUser ?? session?.user ?? null, profile, memberships, loading, identityError,
    configured: hasSupabaseConfiguration, refreshIdentity, signOut,
  }), [session, offlineUser, profile, memberships, loading, identityError])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
