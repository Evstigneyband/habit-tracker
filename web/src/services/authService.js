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
  })

  if (error) throw error
  return data
}

export async function signOut() {
  const supabase = requireSupabase()
  const { error } = await supabase.auth.signOut()

  if (error) throw error
}
