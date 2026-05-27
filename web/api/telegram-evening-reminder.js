/* global process */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const cronSecret = process.env.CRON_SECRET
const appUrl = getAppUrl()
const reminderType = 'evening_remaining_goals'
const targetHour = Number(process.env.TELEGRAM_EVENING_REMINDER_HOUR || 20)

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const url = new URL(request.url, 'https://habit-tracker.local')
  const isManualTest = ['1', 'true', 'yes'].includes(String(url.searchParams.get('test') || '').toLowerCase())
  const isReport = ['1', 'true', 'yes'].includes(String(url.searchParams.get('report') || '').toLowerCase())
  const isAuthorized = !cronSecret || request.headers.authorization === `Bearer ${cronSecret}`

  if (cronSecret && !isAuthorized) {
    return response.status(401).json({ error: 'Unauthorized' })
  }

  if ((isManualTest || isReport) && !cronSecret) {
    return response.status(401).json({ error: 'Manual access requires CRON_SECRET' })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey || !telegramBotToken) {
    return response.status(500).json({ error: 'Telegram evening reminder is not configured' })
  }

  const supabase = createServiceClient()

  try {
    const profiles = await getTelegramProfiles(supabase)

    if (isReport) {
      const report = await buildReminderReport(supabase, profiles)
      return response.status(200).json(report)
    }

    const result = {
      checked: profiles.length,
      sent: 0,
      skipped: 0,
      errors: 0,
      test: isManualTest,
    }

    for (const profile of profiles) {
      try {
        const reminder = await buildReminder(supabase, profile, { force: isManualTest })

        if (!reminder) {
          result.skipped += 1
          continue
        }

        await sendTelegramReminder(reminder)
        await markReminderSent(supabase, reminder)
        result.sent += 1
      } catch (error) {
        console.error('Telegram evening reminder user error:', profile.id, error)
        result.errors += 1
      }
    }

    return response.status(200).json(result)
  } catch (error) {
    console.error('Telegram evening reminder error:', error)
    return response.status(500).json({ error: 'Telegram evening reminder failed' })
  }
}

async function buildReminderReport(supabase, profiles) {
  const now = new Date()
  const rows = []

  for (const profile of profiles) {
    const timezone = profile.timezone || 'Europe/Podgorica'
    const today = getDateInTimezone(now, timezone)
    const currentHour = getHourInTimezone(now, timezone)
    const challenge = await getReminderChallenge(supabase, profile)
    const progress = challenge ? await getTodayProgress(supabase, { challenge, profile, today }) : null
    const sentToday = await getReminderRecord(supabase, profile.id, today)
    const scheduledReason = getSkipReason({
      currentHour: targetHour,
      challenge,
      progress,
      sentToday,
    })

    rows.push({
      name: profile.display_name || profile.telegram_username || 'Без имени',
      username: profile.telegram_username || '',
      userId: maskId(profile.id),
      telegramId: maskId(profile.telegram_id),
      timezone,
      localDate: today,
      localHour: currentHour,
      challenge: challenge
        ? {
            title: challenge.title,
            startDate: challenge.start_date,
            durationDays: Number(challenge.duration_days || 0),
            dayNumber: progress?.dayNumber || null,
          }
        : null,
      goalsTotal: progress?.totalGoals || 0,
      goalsCompleted: progress?.completedGoals || 0,
      goalsRemaining: progress?.remainingGoals || 0,
      reminderSentToday: Boolean(sentToday),
      reminderSentAt: sentToday?.created_at || null,
      wouldSendAtScheduledHour: !scheduledReason,
      scheduledReason: scheduledReason || 'Подходит под отправку',
      reason:
        getSkipReason({
          currentHour,
          challenge,
          progress,
          sentToday,
        }) || 'Подходит под отправку',
    })
  }

  return {
    nowUtc: now.toISOString(),
    targetHour,
    profileCount: profiles.length,
    profiles: rows,
  }
}

async function getTelegramProfiles(supabase) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, telegram_id, telegram_username, timezone, last_active_challenge_id')
    .eq('auth_provider', 'telegram')
    .not('telegram_id', 'is', null)

  if (error) throw error
  return data || []
}

async function buildReminder(supabase, profile, { force = false } = {}) {
  const timezone = profile.timezone || 'Europe/Podgorica'
  const now = new Date()
  const today = getDateInTimezone(now, timezone)
  const currentHour = getHourInTimezone(now, timezone)

  if (!force && currentHour !== targetHour) return null

  const challenge = await getReminderChallenge(supabase, profile)
  if (!challenge) return null

  const progress = await getTodayProgress(supabase, { challenge, profile, today })
  if (!progress) return null
  if (!force && progress.remainingGoals <= 0) return null

  const wasSent = await wasReminderSent(supabase, profile.id, today)
  if (wasSent) return null

  return {
    userId: profile.id,
    telegramId: profile.telegram_id,
    challengeId: challenge.id,
    challengeTitle: challenge.title,
    dayNumber: progress.dayNumber,
    reminderDate: today,
    name: getFirstName(profile.display_name),
    remainingGoals: progress.remainingGoals,
  }
}

async function getReminderChallenge(supabase, profile) {
  if (profile.last_active_challenge_id) {
    const challenge = await getAccessibleActiveChallenge(supabase, {
      challengeId: profile.last_active_challenge_id,
      userId: profile.id,
    })

    if (challenge) return challenge
  }

  const ownChallenge = await getLatestOwnChallenge(supabase, profile.id)
  if (ownChallenge) return ownChallenge

  return getLatestMemberChallenge(supabase, profile.id)
}

async function getAccessibleActiveChallenge(supabase, { challengeId, userId }) {
  const { data: challenge, error } = await supabase
    .from('challenges')
    .select('id, user_id, title, start_date, duration_days, total_goals, status')
    .eq('id', challengeId)
    .eq('status', 'active')
    .maybeSingle()

  if (error) throw error
  if (!challenge) return null
  if (challenge.user_id === userId) return challenge

  const { data: membership, error: membershipError } = await supabase
    .from('challenge_members')
    .select('id')
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (membershipError) throw membershipError
  return membership ? challenge : null
}

async function getLatestOwnChallenge(supabase, userId) {
  const { data, error } = await supabase
    .from('challenges')
    .select('id, user_id, title, start_date, duration_days, total_goals, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

async function getLatestMemberChallenge(supabase, userId) {
  const { data, error } = await supabase
    .from('challenge_members')
    .select('challenge_id, challenges (id, user_id, title, start_date, duration_days, total_goals, status, updated_at)')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (error) throw error

  return (data || [])
    .map((row) => row.challenges)
    .filter((challenge) => challenge?.status === 'active')
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())[0] || null
}

async function getTodayProgress(supabase, { challenge, profile, today }) {
  const dayNumber = getChallengeDay(today, challenge.start_date)
  if (dayNumber < 1 || dayNumber > Number(challenge.duration_days || 0)) return null

  const isWaitingForFriend = await isChallengeWaitingForFriend(supabase, challenge.id)
  if (isWaitingForFriend) return null

  const { data: goals, error: goalsError } = await supabase
    .from('goals')
    .select('id')
    .eq('challenge_id', challenge.id)
    .eq('is_active', true)

  if (goalsError) throw goalsError

  const goalIds = (goals || []).map((goal) => goal.id)
  const totalGoals = goalIds.length || Number(challenge.total_goals || 0)
  if (totalGoals <= 0) return null

  const { data: entries, error: entriesError } = await supabase
    .from('daily_entries')
    .select('goal_id, is_completed')
    .eq('challenge_id', challenge.id)
    .eq('user_id', profile.id)
    .eq('entry_date', today)

  if (entriesError) throw entriesError

  const completedGoalIds = new Set((entries || []).filter((entry) => entry.is_completed).map((entry) => entry.goal_id))
  const completedGoals = goalIds.filter((goalId) => completedGoalIds.has(goalId)).length
  const remainingGoals = Math.max(totalGoals - completedGoals, 0)

  return {
    dayNumber,
    totalGoals,
    completedGoals,
    remainingGoals,
  }
}

async function isChallengeWaitingForFriend(supabase, challengeId) {
  const [membersResult, invitesResult] = await Promise.all([
    supabase
      .from('challenge_members')
      .select('user_id')
      .eq('challenge_id', challengeId)
      .eq('status', 'active'),
    supabase
      .from('challenge_invites')
      .select('id')
      .eq('challenge_id', challengeId)
      .eq('status', 'active')
      .limit(1),
  ])

  if (membersResult.error) throw membersResult.error
  if (invitesResult.error) throw invitesResult.error

  return (membersResult.data || []).length < 2 && (invitesResult.data || []).length > 0
}

async function wasReminderSent(supabase, userId, reminderDate) {
  const data = await getReminderRecord(supabase, userId, reminderDate)
  return Boolean(data)
}

async function getReminderRecord(supabase, userId, reminderDate) {
  const { data, error } = await supabase
    .from('telegram_reminders')
    .select('id, created_at')
    .eq('user_id', userId)
    .eq('reminder_type', reminderType)
    .eq('reminder_date', reminderDate)
    .maybeSingle()

  if (error) throw error
  return data
}

async function markReminderSent(supabase, reminder) {
  const { error } = await supabase.from('telegram_reminders').insert({
    user_id: reminder.userId,
    challenge_id: reminder.challengeId,
    telegram_id: reminder.telegramId,
    reminder_type: reminderType,
    reminder_date: reminder.reminderDate,
  })

  if (error && error.code !== '23505') throw error
}

async function sendTelegramReminder(reminder) {
  const openingLine = reminder.name ? `${reminder.name}, день подходит к концу.` : 'День подходит к концу.'
  const text = [
    openingLine,
    `Осталось закрыть ${formatGoalCount(reminder.remainingGoals)} в челлендже «${reminder.challengeTitle}».`,
    '',
    'Зайди на пару минут и добери сегодняшний прогресс.',
  ].join('\n')

  const body = {
    chat_id: reminder.telegramId,
    text,
  }

  if (appUrl) {
    body.reply_markup = {
      inline_keyboard: [[{ text: 'Открыть приложение', web_app: { url: appUrl } }]],
    }
  }

  const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const payload = await telegramResponse.json().catch(() => ({}))
  if (!telegramResponse.ok) {
    throw new Error(payload.description || 'Telegram sendMessage failed')
  }
}

function getSkipReason({ currentHour, challenge, progress, sentToday }) {
  if (currentHour !== targetHour) return `Сейчас ${currentHour}:00, отправка только в ${targetHour}:00`
  if (!challenge) return 'Нет активного челленджа'
  if (!progress) return 'Сегодня вне дат челленджа, нет целей или челлендж ждёт друга'
  if (progress.remainingGoals <= 0) return 'Все цели на сегодня уже закрыты'
  if (sentToday) return 'Напоминание сегодня уже было отправлено'
  return ''
}

function getDateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day}`
}

function getHourInTimezone(date, timezone) {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(date)

  return Number(hour)
}

function getChallengeDay(today, startDate) {
  return daysBetween(startDate, today) + 1
}

function daysBetween(startDate, endDate) {
  const start = parseDateOnly(startDate)
  const end = parseDateOnly(endDate)
  return Math.floor((end - start) / 86400000)
}

function parseDateOnly(dateString) {
  const [year, month, day] = String(dateString).split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

function getFirstName(displayName) {
  return String(displayName || '').trim().split(/\s+/)[0] || ''
}

function formatGoalCount(count) {
  const value = Math.max(Number(count || 0), 0)
  const mod10 = value % 10
  const mod100 = value % 100

  if (mod10 === 1 && mod100 !== 11) return `${value} цель`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${value} цели`
  return `${value} целей`
}

function maskId(value) {
  const text = String(value || '')
  if (text.length <= 8) return text
  return `${text.slice(0, 4)}…${text.slice(-4)}`
}

function getAppUrl() {
  const rawUrl =
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    ''

  if (!rawUrl) return ''
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return rawUrl
  return `https://${rawUrl}`
}

function createServiceClient() {
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
