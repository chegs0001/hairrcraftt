import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import type { Staff } from './types'

interface AuthState {
  loading: boolean
  session: Session | null
  staff: Staff | null
  isManager: boolean   // manager or admin
  isAdmin: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [staff, setStaff] = useState<Staff | null>(null)

  const loadStaff = async (s: Session | null) => {
    if (!s) return setStaff(null)
    const { data } = await supabase.from('staff').select('*').eq('auth_user_id', s.user.id).maybeSingle()
    // Deactivated staff are signed out on their next request.
    if (data?.status === 'inactive') {
      await supabase.auth.signOut()
      setSession(null)
      return setStaff(null)
    }
    setStaff(data as Staff | null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadStaff(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      void loadStaff(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const value: AuthState = {
    loading,
    session,
    staff,
    isManager: staff?.role === 'manager' && staff.status === 'active',
    isAdmin: !!staff?.is_admin && staff.status === 'active',
    signIn: async () => {
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
    refresh: () => loadStaff(session),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
