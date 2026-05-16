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
