/* global process */
import { createClient } from '@supabase/supabase-js'
import { getUnlockableAwards } from '../src/lib/awards.js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return response.status(500).json({ error: 'Сервер ещё не настроен для сохранения прогресса.' })
  }

  try {
    const user = await getRequestUser(request)
    const payload = request.body || {}
    const supabase = createServiceClient()
    const goalId = String(payload.goalId || '')
    const challengeId = String(payload.challengeId || '')

    if (!goalId || !challengeId || !payload.entryDate) {
      return response.status(400).json({ error: 'Не хватает данных для сохранения.' })
    }

    const { data: goal, error: goalError } = await supabase
      .from('goals')
      .select('id, challenge_id, goal_type, target_hours')
      .eq('id', goalId)
      .eq('challenge_id', challengeId)
      .single()

    if (goalError || !goal) {
      return response.status(404).json({ error: 'Цель не найдена.' })
    }

    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('id, start_date, end_date, duration_days, status')
      .eq('id', challengeId)
      .single()

    if (challengeError || !challenge || challenge.status === 'deleted') {
      return response.status(404).json({ error: 'Челлендж не найден.' })
    }

    const entryDate = String(payload.entryDate)
    const endDate = challenge.end_date || addDays(challenge.start_date, Number(challenge.duration_days || 1) - 1)
    if (challenge.status === 'completed' || entryDate < challenge.start_date || entryDate > endDate) {
      return response.status(409).json({ error: 'Челлендж уже завершён. Прогресс больше не изменяется.' })
    }

    const isTimeGoal = goal.goal_type === 'time'
    const targetHours = isTimeGoal ? Number(goal.target_hours || 0) : null
    const actualHours = isTimeGoal ? Number(payload.actualHours || 0) : 0
    const completed = isTimeGoal ? actualHours >= targetHours : Boolean(payload.isChecked)

    const row = {
      challenge_id: challengeId,
      goal_id: goalId,
      user_id: user.id,
      entry_date: entryDate,
      day_number: Number(payload.dayNumber || 1),
      goal_type: goal.goal_type,
      is_checked: !isTimeGoal && Boolean(payload.isChecked),
      target_hours: targetHours,
      actual_hours: actualHours,
      is_completed: completed,
      completion_percent: completed ? 100 : 0,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('daily_entries')
      .upsert(row, { onConflict: 'goal_id,user_id,entry_date' })
      .select('*')
      .single()

    if (error) throw error

    const awardResult = await syncAccountAwards(supabase, {
      userId: user.id,
      challengeId,
      entryDate: payload.entryDate,
      changedEntry: data,
    })

    return response.status(200).json({
      data: {
        ...data,
        new_awards: awardResult.newAwards,
        award_rows: awardResult.awardRows,
        award_events: awardResult.awardEvents,
      },
    })
  } catch (error) {
    console.error('Save entry API error:', error)
    return response.status(500).json({ error: formatServerError(error) })
  }
}

async function syncAccountAwards(supabase, { userId, challengeId, entryDate, changedEntry }) {
  try {
    const newEvents = await recordAwardEvents(supabase, { userId, challengeId, entryDate, changedEntry })
    const { data: awardEvents, error: eventsError } = await supabase
      .from('user_award_events')
      .select('*')
      .eq('user_id', userId)
      .order('event_date', { ascending: true })

    if (eventsError) throw eventsError

    const { data: awardRows, error: awardsError } = await supabase
      .from('user_awards')
      .select('*')
      .eq('user_id', userId)

    if (awardsError) throw awardsError

    const unlockableAwards = getUnlockableAwards(awardEvents || [], awardRows || [])
    if (unlockableAwards.length === 0) {
      return { newAwards: [], awardRows: awardRows || [], awardEvents: awardEvents || [] }
    }

    const sourceEvent = newEvents[0] || awardEvents?.[awardEvents.length - 1] || null
    const unlockRows = unlockableAwards.map((award) => ({
      user_id: userId,
      award_id: award.id,
      source_challenge_id: sourceEvent?.challenge_id || challengeId || null,
      source_event_id: sourceEvent?.id || null,
      metadata: {
        title: award.title,
        description: award.description,
        metric: award.metric,
        threshold: award.threshold,
      },
    }))

    const { data: insertedAwards, error: insertError } = await supabase
      .from('user_awards')
      .upsert(unlockRows, { onConflict: 'user_id,award_id', ignoreDuplicates: true })
      .select('*')

    if (insertError) throw insertError

    const insertedIds = new Set((insertedAwards || []).map((award) => award.award_id))
    const newAwards = unlockableAwards.filter((award) => insertedIds.has(award.id))

    return {
      newAwards,
      awardRows: [...(awardRows || []), ...(insertedAwards || [])],
      awardEvents: awardEvents || [],
    }
  } catch (error) {
    console.warn('Could not sync account awards:', error)
    return { newAwards: [], awardRows: [], awardEvents: [] }
  }
}

async function recordAwardEvents(supabase, { userId, challengeId, entryDate, changedEntry }) {
  const newEvents = []
  const { data: challenge, error: challengeError } = await supabase
    .from('challenges')
    .select('id, user_id, title, start_date, duration_days, total_goals, status')
    .eq('id', challengeId)
    .single()

  if (challengeError || !challenge || challenge.status === 'deleted') return newEvents

  const { data: goals, error: goalsError } = await supabase
    .from('goals')
    .select('id')
    .eq('challenge_id', challengeId)
    .eq('is_active', true)

  if (goalsError) throw goalsError

  const totalGoals = (goals || []).length || Number(challenge.total_goals || 0)
  if (totalGoals <= 0) return newEvents

  const { data: todayEntries, error: todayEntriesError } = await supabase
    .from('daily_entries')
    .select('id, is_completed')
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .eq('entry_date', entryDate)

  if (todayEntriesError) throw todayEntriesError

  const completedToday = (todayEntries || []).filter((entry) => entry.is_completed).length
  if (completedToday >= totalGoals) {
    const event = await upsertAwardEvent(supabase, {
      userId,
      eventType: 'day_completed_100',
      eventDate: entryDate,
      challengeId,
      goalId: changedEntry.goal_id,
      value: 100,
      metadata: {
        day_number: changedEntry.day_number,
        challenge_title: challenge.title,
      },
    })
    if (event) newEvents.push(event)
  }

  const userPercentByDay = await getChallengePercentByDay(supabase, { challenge, userId, totalGoals })
  if (isChallengeFullyCompleted(userPercentByDay, challenge.duration_days)) {
    const event = await upsertAwardEvent(supabase, {
      userId,
      eventType: 'challenge_completed',
      eventDate: entryDate,
      challengeId,
      value: 100,
      metadata: {
        challenge_title: challenge.title,
      },
    })
    if (event) newEvents.push(event)
  }

  const battleWinEvent = await maybeRecordBattleWin(supabase, {
    userId,
    challenge,
    totalGoals,
    entryDate,
    userPercentByDay,
  })
  if (battleWinEvent) newEvents.push(battleWinEvent)

  return newEvents
}

async function maybeRecordBattleWin(supabase, { userId, challenge, totalGoals, entryDate, userPercentByDay }) {
  const { data: members, error } = await supabase
    .from('challenge_members')
    .select('user_id')
    .eq('challenge_id', challenge.id)
    .eq('status', 'active')

  if (error || (members || []).length < 2) return null

  const currentOverall = getOverallFromPercentByDay(userPercentByDay, challenge.duration_days)
  if (currentOverall < 100) return null

  const opponentIds = (members || []).map((member) => member.user_id).filter((memberId) => memberId !== userId)
  if (opponentIds.length === 0) return null

  const opponentScores = await Promise.all(
    opponentIds.map(async (opponentId) => {
      const percentByDay = await getChallengePercentByDay(supabase, {
        challenge,
        userId: opponentId,
        totalGoals,
      })
      return getOverallFromPercentByDay(percentByDay, challenge.duration_days)
    }),
  )

  if (opponentScores.some((score) => currentOverall <= score)) return null

  return upsertAwardEvent(supabase, {
    userId,
    eventType: 'friend_battle_win',
    eventDate: entryDate,
    challengeId: challenge.id,
    value: currentOverall,
    metadata: {
      challenge_title: challenge.title,
      opponent_best_percent: Math.max(...opponentScores),
    },
  })
}

async function getChallengePercentByDay(supabase, { challenge, userId, totalGoals }) {
  const { data, error } = await supabase
    .from('daily_entries')
    .select('day_number, is_completed')
    .eq('challenge_id', challenge.id)
    .eq('user_id', userId)

  if (error) throw error

  return (data || []).reduce((acc, entry) => {
    const day = Number(entry.day_number || 0)
    if (!day) return acc
    const completed = (acc.get(day)?.completed || 0) + (entry.is_completed ? 1 : 0)
    acc.set(day, {
      completed,
      percent: totalGoals ? Math.round((completed / totalGoals) * 100) : 0,
    })
    return acc
  }, new Map())
}

function isChallengeFullyCompleted(percentByDay, durationDays) {
  const duration = Number(durationDays || 0)
  if (duration <= 0) return false
  for (let day = 1; day <= duration; day += 1) {
    if ((percentByDay.get(day)?.percent || 0) < 100) return false
  }
  return true
}

function getOverallFromPercentByDay(percentByDay, durationDays) {
  const duration = Number(durationDays || 0)
  if (duration <= 0) return 0
  let total = 0
  for (let day = 1; day <= duration; day += 1) {
    total += percentByDay.get(day)?.percent || 0
  }
  return Math.round(total / duration)
}

async function upsertAwardEvent(supabase, { userId, eventType, eventDate, challengeId, goalId = null, value, metadata }) {
  let existingQuery = supabase
    .from('user_award_events')
    .select('*')
    .eq('user_id', userId)
    .eq('event_type', eventType)

  if (eventType === 'day_completed_100') {
    existingQuery = existingQuery.eq('event_date', eventDate)
  } else {
    existingQuery = existingQuery.eq('challenge_id', challengeId)
  }

  const { data: existingEvent, error: existingError } = await existingQuery.maybeSingle()
  if (existingError) throw existingError
  if (existingEvent) return null

  const row = {
    user_id: userId,
    event_type: eventType,
    event_date: eventDate,
    challenge_id: challengeId || null,
    goal_id: goalId || null,
    value,
    metadata,
  }

  const { data, error } = await supabase
    .from('user_award_events')
    .insert(row)
    .select('*')
    .single()

  if (error) {
    if (String(error.message || '').includes('duplicate key')) return null
    throw error
  }
  return data || null
}

async function getRequestUser(request) {
  const authHeader = request.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
  if (!token) throw new Error('Не получилось определить пользователя.')

  const { data, error } = await createServiceClient().auth.getUser(token)
  if (error || !data.user) throw error || new Error('Не получилось определить пользователя.')
  return data.user
}

function createServiceClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
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

function formatServerError(error) {
  const message = String(error?.message || error || '')
  if (message.includes('duplicate key')) return 'Запись за этот день уже существует.'
  if (message.includes('permission denied')) return 'Серверу не хватает прав для сохранения.'
  return message || 'Не получилось сохранить прогресс.'
}
