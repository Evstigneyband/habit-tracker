import { requireSupabase } from '../lib/supabaseClient'

export async function getCurrentSession() {
  const supabase = requireSupabase()
  const { data, error } = await supabase.auth.getSession()

  if (error) throw error
  return data.session
}

export async function signInWithEmail(email, password) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error
  return data
}

export async function signUpWithEmail(email, password) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
    },
  })

  if (error) throw error
  return data
}

export async function signInWithTelegram(initData) {
  const supabase = requireSupabase()
  const response = await fetch('/api/telegram-auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initData }),
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error || 'Telegram auth failed')
  }

  const { error } = await supabase.auth.setSession({
    access_token: payload.session.access_token,
    refresh_token: payload.session.refresh_token,
  })

  if (error) throw error
  return payload
}

export async function signOut() {
  const supabase = requireSupabase()
  const { error } = await supabase.auth.signOut()

  if (error) throw error
}
