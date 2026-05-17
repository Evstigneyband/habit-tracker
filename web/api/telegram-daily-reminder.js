/* global process */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const cronSecret = process.env.CRON_SECRET
const appUrl = getAppUrl()
const reminderType = 'daily_open_challenge'
const targetHour = Number(process.env.TELEGRAM_REMINDER_HOUR || 12)

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const url = new URL(request.url, 'https://habit-tracker.local')
  const isManualTest = ['1', 'true', 'yes'].includes(String(url.searchParams.get('test') || '').toLowerCase())
  const isAuthorized = !cronSecret || request.headers.authorization === `Bearer ${cronSecret}`

  if (cronSecret && !isAuthorized) {
    return response.status(401).json({ error: 'Unauthorized' })
  }

  if (isManualTest && !cronSecret) {
    return response.status(401).json({ error: 'Manual test requires CRON_SECRET' })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey || !telegramBotToken) {
    return response.status(500).json({ error: 'Telegram reminder is not configured' })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  try {
    const profiles = await getTelegramProfiles(supabase)
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
        console.error('Telegram reminder user error:', profile.id, error)
        result.errors += 1
      }
    }

    return response.status(200).json(result)
  } catch (error) {
    console.error('Telegram reminder error:', error)
    return response.status(500).json({ error: 'Telegram reminder failed' })
  }
}

async function getTelegramProfiles(supabase) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, telegram_id, timezone, last_seen_at, last_active_challenge_id')
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
  if (!force && profile.last_seen_at && getDateInTimezone(new Date(profile.last_seen_at), timezone) === today) return null

  const challenge = await getReminderChallenge(supabase, profile)
  if (!challenge) return null

  const dayNumber = getChallengeDay(today, challenge.start_date)
  if (dayNumber < 1 || dayNumber > Number(challenge.duration_days || 0)) return null
  if (!force && dayNumber <= 1) return null

  const wasSent = await wasReminderSent(supabase, profile.id, today)
  if (wasSent) return null

  return {
    userId: profile.id,
    telegramId: profile.telegram_id,
    challengeId: challenge.id,
    challengeTitle: challenge.title,
    dayNumber,
    reminderDate: today,
    name: getFirstName(profile.display_name),
  }
}

async function getReminderChallenge(supabase, profile) {
  if (profile.last_active_challenge_id) {
    const { data, error } = await supabase
      .from('challenges')
      .select('id, title, start_date, duration_days, status')
      .eq('id', profile.last_active_challenge_id)
      .eq('user_id', profile.id)
      .eq('status', 'active')
      .maybeSingle()

    if (error) throw error
    if (data) return data
  }

  const { data, error } = await supabase
    .from('challenges')
    .select('id, title, start_date, duration_days, status')
    .eq('user_id', profile.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

async function wasReminderSent(supabase, userId, reminderDate) {
  const { data, error } = await supabase
    .from('telegram_reminders')
    .select('id')
    .eq('user_id', userId)
    .eq('reminder_type', reminderType)
    .eq('reminder_date', reminderDate)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
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
  const greeting = reminder.name ? `Привет, ${reminder.name}!` : 'Привет!'
  const text = [
    `${greeting} Сегодня день ${reminder.dayNumber} челленджа «${reminder.challengeTitle}».`,
    '',
    'Большой результат складывается из маленьких действий. Даже один шаг сегодня уже двигает тебя вперёд.',
    '',
    'Зайди и отметь свой прогресс.',
  ].join('\n')

  const body = {
    chat_id: reminder.telegramId,
    text,
  }

  if (appUrl) {
    body.reply_markup = {
      inline_keyboard: [[{ text: 'Открыть челлендж', web_app: { url: appUrl } }]],
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
