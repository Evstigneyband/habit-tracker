/* global process */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return response.status(500).json({ error: 'Сервер ещё не настроен для приглашений.' })
  }

  try {
    const user = await getRequestUser(request)
    const token = normalizeInviteToken(request.body?.token)
    if (!token) return response.status(400).json({ error: 'Приглашение не найдено.' })

    const supabase = createServiceClient()
    const { data: invite, error: inviteError } = await supabase
      .from('challenge_invites')
      .select('id, challenge_id, challenge_title, status, expires_at')
      .eq('token', token)
      .eq('status', 'active')
      .single()

    if (inviteError || !invite) {
      return response.status(404).json({ error: 'Приглашение не найдено или уже не активно.' })
    }

    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      return response.status(410).json({ error: 'Срок действия приглашения истёк.' })
    }

    const { error: memberError } = await supabase
      .from('challenge_members')
      .upsert(
        {
          challenge_id: invite.challenge_id,
          user_id: user.id,
          role: 'member',
          status: 'active',
        },
        { onConflict: 'challenge_id,user_id' },
      )

    if (memberError) throw memberError

    const { data: challengeBeforeStart, error: challengeBeforeStartError } = await supabase
      .from('challenges')
      .select('id, duration_days')
      .eq('id', invite.challenge_id)
      .single()

    if (challengeBeforeStartError) throw challengeBeforeStartError

    const startDate = getTodayDate()
    const endDate = addDays(startDate, Number(challengeBeforeStart.duration_days || 1) - 1)
    const { error: challengeStartError } = await supabase
      .from('challenges')
      .update({
        start_date: startDate,
        end_date: endDate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invite.challenge_id)

    if (challengeStartError) throw challengeStartError

    const { error: entriesResetError } = await supabase
      .from('daily_entries')
      .delete()
      .eq('challenge_id', invite.challenge_id)

    if (entriesResetError) throw entriesResetError

    const { error: inviteUpdateError } = await supabase
      .from('challenge_invites')
      .update({
        status: 'revoked',
      })
      .eq('id', invite.id)

    if (inviteUpdateError) console.warn('Could not close accepted invite:', inviteUpdateError)

    await clearPendingInviteForUser(supabase, user.id, token)

    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('*')
      .eq('id', invite.challenge_id)
      .single()

    if (challengeError) throw challengeError

    return response.status(200).json({ data: challenge })
  } catch (error) {
    console.error('Join invite API error:', error)
    return response.status(500).json({ error: formatServerError(error) })
  }
}

async function clearPendingInviteForUser(supabase, userId, token) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('telegram_id')
    .eq('id', userId)
    .maybeSingle()

  if (profileError || !profile?.telegram_id) return

  const { error } = await supabase
    .from('telegram_pending_invites')
    .update({
      status: 'accepted',
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_id', profile.telegram_id)
    .eq('invite_token', token)
    .eq('status', 'pending')

  if (error) console.warn('Could not clear accepted Telegram invite:', error)
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

function normalizeInviteToken(value) {
  if (!value) return ''
  const trimmed = String(value).trim()
  if (trimmed.startsWith('invite_')) return trimmed.slice('invite_'.length)
  return /^[a-f0-9]{20,}$/i.test(trimmed) ? trimmed : ''
}

function getTodayDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Podgorica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  return formatDate(date)
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatServerError(error) {
  const message = String(error?.message || error || '')
  if (message.includes('duplicate key')) return 'Ты уже присоединился к этому челленджу.'
  if (message.includes('permission denied')) return 'Серверу не хватает прав для присоединения.'
  return message || 'Не получилось присоединиться к челленджу.'
}
