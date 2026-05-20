import { requireSupabase } from '../lib/supabaseClient'

export async function getUserChallenges(userId) {
  const supabase = requireSupabase()
  const { data: ownChallenges, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })

  if (error) throw error

  const { data: memberRows, error: memberError } = await supabase
    .from('challenge_members')
    .select('challenge_id, role, challenges (*)')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (memberError) {
    console.warn('Could not load shared challenges:', memberError)
    return ownChallenges || []
  }

  const sharedChallenges = (memberRows || [])
    .map((row) => row.challenges)
    .filter(Boolean)
    .filter((challenge) => challenge.status !== 'deleted')

  const byId = new Map()
  ;[...(ownChallenges || []), ...sharedChallenges].forEach((challenge) => {
    byId.set(challenge.id, challenge)
  })

  return Array.from(byId.values()).sort((left, right) => {
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })
}

export async function getUserProfile(userId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, auth_provider, telegram_username, last_active_challenge_id')
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

  await ensureChallengeOwnerMember({ challengeId: data.id, userId })

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

async function ensureChallengeOwnerMember({ challengeId, userId }) {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('challenge_members')
    .upsert(
      {
        challenge_id: challengeId,
        user_id: userId,
        role: 'owner',
        status: 'active',
      },
      { onConflict: 'challenge_id,user_id', ignoreDuplicates: true },
    )

  if (error) throw error
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

export async function touchUserLastSeen(userId) {
  const supabase = requireSupabase()
  const { error } = await supabase
    .from('profiles')
    .update({
      last_seen_at: new Date().toISOString(),
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

export async function getChallengeMembers(challengeId) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('challenge_members')
    .select('user_id, role, joined_at, profiles (id, email, display_name, auth_provider, telegram_username)')
    .eq('challenge_id', challengeId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true })

  if (error) {
    console.warn('Could not load challenge members:', error)
    return []
  }
  return data || []
}

export async function createChallengeInvite({ challengeId, userId, challengeTitle }) {
  const supabase = requireSupabase()
  const token = crypto.randomUUID().replaceAll('-', '')
  const { data, error } = await supabase
    .from('challenge_invites')
    .insert({
      challenge_id: challengeId,
      created_by: userId,
      token,
      challenge_title: challengeTitle,
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function getChallengeInvite(token) {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('challenge_invites')
    .select('id, challenge_id, challenge_title, created_by, expires_at, status')
    .eq('token', token)
    .eq('status', 'active')
    .single()

  if (error) throw error
  return data
}

export async function joinChallengeInvite({ token, userId }) {
  const apiJoinedChallenge = await joinChallengeInviteViaApi(token)
  if (apiJoinedChallenge) return apiJoinedChallenge

  const supabase = requireSupabase()
  const invite = await getChallengeInvite(token)

  const { error: memberError } = await supabase
    .from('challenge_members')
    .upsert(
      {
        challenge_id: invite.challenge_id,
        user_id: userId,
        role: 'member',
        status: 'active',
      },
      { onConflict: 'challenge_id,user_id', ignoreDuplicates: true },
    )

  if (memberError) throw memberError

  const { data, error } = await supabase
    .from('challenges')
    .select('*')
    .eq('id', invite.challenge_id)
    .single()

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
  const apiSavedEntry = await saveDailyEntryViaApi({
    challengeId,
    goalId: goal.id,
    userId,
    entryDate,
    dayNumber,
    isChecked,
    actualHours,
  })
  if (apiSavedEntry) return apiSavedEntry

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
      { onConflict: 'goal_id,user_id,entry_date' },
    )
    .select('*')
    .single()

  if (error?.code === '42P10') {
    const { data: fallbackData, error: fallbackError } = await supabase
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

    if (fallbackError) throw fallbackError
    return fallbackData
  }

  if (error) throw error
  return data
}

async function joinChallengeInviteViaApi(token) {
  try {
    return await callAuthedApi('/api/join-invite', { token })
  } catch (error) {
    console.warn('Server invite join failed, trying client fallback:', error)
    return null
  }
}

async function saveDailyEntryViaApi(payload) {
  try {
    return await callAuthedApi('/api/save-entry', payload)
  } catch (error) {
    console.warn('Server entry save failed, trying client fallback:', error)
    return null
  }
}

async function callAuthedApi(path, payload) {
  const supabase = requireSupabase()
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error('Нет активной сессии')

  const response = await fetch(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body.error || 'Server request failed')
  }

  return body.data
}
