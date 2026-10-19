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
  configured: boolean
  refreshIdentity: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(hasSupabaseConfiguration)

  const refreshIdentity = async () => {
    if (!supabase) return
    const { data: { session: nextSession } } = await supabase.auth.getSession()
    setSession(nextSession)
    if (!nextSession?.user) {
      setProfile(null)
      setMemberships([])
      setLoading(false)
      return
    }
    const [profileResponse, membershipsResponse] = await Promise.all([
      supabase.from('profiles').select('id, full_name, global_role, active').eq('id', nextSession.user.id).single(),
      supabase.from('company_memberships').select('id, company_id, user_id, role, active, job_title, companies(id, name)').eq('user_id', nextSession.user.id).eq('active', true),
    ])
    setProfile(profileResponse.data as Profile | null)
    const normalizedMemberships = (membershipsResponse.data ?? []).map((membership: any) => ({
      ...membership,
      companies: Array.isArray(membership.companies) ? membership.companies[0] ?? null : membership.companies,
    }))
    setMemberships(normalizedMemberships as Membership[])
    setLoading(false)
  }

  useEffect(() => {
    if (!supabase) return
    void refreshIdentity()
    const { data: listener } = supabase.auth.onAuthStateChange(() => void refreshIdentity())
    return () => listener.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthState>(() => ({
    session, user: session?.user ?? null, profile, memberships, loading,
    configured: hasSupabaseConfiguration, refreshIdentity,
  }), [session, profile, memberships, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
