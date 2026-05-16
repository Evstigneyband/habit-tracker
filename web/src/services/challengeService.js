import { requireSupabase } from '../lib/supabaseClient'

export async function getUserChallenges(userId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function createChallenge({ userId, title, durationDays, startDate }) {
  const supabase = requireSupabase()
  const endDate = addDays(startDate, durationDays - 1)

  const { data, error } = await supabase
    .from('challenges')
    .insert({
      user_id: userId,
      title,
      duration_days: durationDays,
      start_date: startDate,
      end_date: endDate,
      total_goals: 0,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function setLastActiveChallenge(userId, challengeId) {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('profiles')
    .update({
      last_active_challenge_id: challengeId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)

  if (error) throw error
}

export async function getChallengeGoals(challengeId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) throw error
  return data
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function getTodayEntries(challengeId, entryDate) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('entry_date', entryDate)

  if (error) throw error
  return data
}
