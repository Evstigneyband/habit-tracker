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

export async function getUserProfile(userId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, last_active_challenge_id')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data
}

export async function createChallenge({ userId, title, durationDays, startDate, simpleGoals = [], timeGoals = [] }) {
  const supabase = requireSupabase()
  const endDate = addDays(startDate, durationDays - 1)
  const totalGoals = simpleGoals.length + timeGoals.length

  const { data, error } = await supabase
    .from('challenges')
    .insert({
      user_id: userId,
      title,
      duration_days: durationDays,
      start_date: startDate,
      end_date: endDate,
      total_goals: totalGoals,
    })
    .select('*')
    .single()

  if (error) throw error

  const goalRows = [
    ...simpleGoals.map((goal, index) => ({
      challenge_id: data.id,
      user_id: userId,
      goal_type: 'simple',
      title: goal.title,
      sort_order: index,
      weight: 1,
    })),
    ...timeGoals.map((goal, index) => ({
      challenge_id: data.id,
      user_id: userId,
      goal_type: 'time',
      title: goal.title,
      target_hours: goal.targetHours,
      sort_order: simpleGoals.length + index,
      weight: 1,
    })),
  ]

  if (goalRows.length > 0) {
    const { error: goalsError } = await supabase.from('goals').insert(goalRows)

    if (goalsError) throw goalsError
  }

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

export async function deleteChallenge({ userId, challengeId }) {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('challenges')
    .update({
      status: 'deleted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', challengeId)
    .eq('user_id', userId)

  if (error) throw error
}

export async function restartChallenge({
  userId,
  challengeId,
  title,
  durationDays,
  startDate,
  simpleGoals = [],
  timeGoals = [],
}) {
  const supabase = requireSupabase()
  const endDate = addDays(startDate, durationDays - 1)
  const totalGoals = simpleGoals.length + timeGoals.length
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('challenges')
    .update({
      title,
      duration_days: durationDays,
      start_date: startDate,
      end_date: endDate,
      status: 'active',
      total_goals: totalGoals,
      updated_at: now,
      completed_at: null,
    })
    .eq('id', challengeId)
    .eq('user_id', userId)
    .select('*')
    .single()

  if (error) throw error

  const { error: archiveError } = await supabase
    .from('goals')
    .update({
      is_active: false,
      archived_at: now,
      updated_at: now,
    })
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)

  if (archiveError) throw archiveError

  const { error: entriesError } = await supabase
    .from('daily_entries')
    .delete()
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)

  if (entriesError) throw entriesError

  const goalRows = [
    ...simpleGoals.map((goal, index) => ({
      challenge_id: challengeId,
      user_id: userId,
      goal_type: 'simple',
      title: goal.title,
      sort_order: index,
      weight: 1,
    })),
    ...timeGoals.map((goal, index) => ({
      challenge_id: challengeId,
      user_id: userId,
      goal_type: 'time',
      title: goal.title,
      target_hours: goal.targetHours,
      sort_order: simpleGoals.length + index,
      weight: 1,
    })),
  ]

  if (goalRows.length > 0) {
    const { error: goalsError } = await supabase.from('goals').insert(goalRows)

    if (goalsError) throw goalsError
  }

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

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatLocalDate(date)
}

function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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

export async function getChallengeEntries(challengeId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('entry_date', { ascending: true })

  if (error) throw error
  return data
}

export async function saveDailyEntry({
  challengeId,
  goal,
  userId,
  entryDate,
  dayNumber,
  isChecked = false,
  actualHours = 0,
}) {
  const supabase = requireSupabase()
  const isTimeGoal = goal.goal_type === 'time'
  const targetHours = isTimeGoal ? Number(goal.target_hours || goal.target || 0) : null
  const completed = isTimeGoal ? Number(actualHours) >= targetHours : Boolean(isChecked)

  const { data, error } = await supabase
    .from('daily_entries')
    .upsert(
      {
        challenge_id: challengeId,
        goal_id: goal.id,
        user_id: userId,
        entry_date: entryDate,
        day_number: dayNumber,
        goal_type: goal.goal_type,
        is_checked: !isTimeGoal && Boolean(isChecked),
        target_hours: targetHours,
        actual_hours: isTimeGoal ? Number(actualHours) : 0,
        is_completed: completed,
        completion_percent: completed ? 100 : 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'goal_id,entry_date' },
    )
    .select('*')
    .single()

  if (error) throw error
  return data
}
