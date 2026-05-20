/* global Buffer, process */
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const telegramAuthSecret = process.env.TELEGRAM_AUTH_SECRET || supabaseServiceRoleKey
const technicalEmailDomain = 'telegram.habit-tracker.app'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !telegramBotToken || !telegramAuthSecret) {
    return response.status(500).json({
      code: 'telegram_config_missing',
      error: 'Telegram-вход ещё не настроен на сервере. Проверь переменные Vercel.',
    })
  }

  try {
    const { initData } = request.body || {}

    if (!initData || typeof initData !== 'string') {
      return response.status(400).json({
        code: 'telegram_data_missing',
        error: 'Telegram не передал данные входа. Закрой мини-приложение и открой его снова.',
      })
    }

    const telegramUser = verifyTelegramInitData(initData, telegramBotToken)
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
    const email = `telegram-${telegramUser.id}@${technicalEmailDomain}`
    const password = makeTelegramPassword(telegramUser.id, telegramAuthSecret)
    const displayName = getTelegramDisplayName(telegramUser)

    let profile = await findTelegramProfile(serviceClient, telegramUser.id)
    let signInEmail = email

    if (!profile) {
      const { data: createdUserData, error: createUserError } = await serviceClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          auth_provider: 'telegram',
          telegram_id: telegramUser.id,
          telegram_username: telegramUser.username || null,
          display_name: displayName,
        },
      })

      if (createUserError && !isAlreadyRegisteredError(createUserError)) {
        throw new TelegramAuthError(
          'supabase_user_create_failed',
          'Не получилось создать Telegram-профиль. Попробуй открыть мини-приложение ещё раз.',
          createUserError,
        )
      }

      const userId = createdUserData?.user?.id
      if (userId) {
        profile = await upsertTelegramProfile(serviceClient, {
          userId,
          email,
          telegramUser,
          displayName,
        })
      } else {
        profile = await findTelegramProfile(serviceClient, telegramUser.id)
      }
    } else {
      signInEmail = profile.email || email
      await upsertTelegramProfile(serviceClient, {
        userId: profile.id,
        email: signInEmail,
        telegramUser,
        displayName,
      })
    }

    if (!profile) {
      throw new TelegramAuthError(
        'supabase_profile_missing',
        'Не получилось подготовить Telegram-профиль. Открой мини-приложение ещё раз.',
      )
    }

    const pendingInviteToken = await findPendingInviteToken(serviceClient, telegramUser.id)

    const { data: sessionData, error: signInError } = await anonClient.auth.signInWithPassword({
      email: signInEmail,
      password,
    })

    if (signInError) {
      throw new TelegramAuthError(
        'supabase_session_failed',
        'Не получилось открыть Telegram-сессию. Закрой мини-приложение и открой его снова.',
        signInError,
      )
    }

    return response.status(200).json({
      session: sessionData.session,
      profile: {
        id: profile?.id || sessionData.user.id,
        displayName,
        telegramId: telegramUser.id,
        telegramUsername: telegramUser.username || null,
        photoUrl: telegramUser.photo_url || null,
        pendingInviteToken,
      },
    })
  } catch (error) {
    console.error('Telegram auth error:', error)
    const payload = toTelegramAuthResponse(error)
    return response.status(payload.status).json({
      code: payload.code,
      error: payload.error,
    })
  }
}

async function findPendingInviteToken(supabase, telegramId) {
  const { data, error } = await supabase
    .from('telegram_pending_invites')
    .select('invite_token, status, expires_at')
    .eq('telegram_id', telegramId)
    .eq('status', 'pending')
    .maybeSingle()

  if (error) {
    if (String(error.message || '').includes('telegram_pending_invites')) return ''
    console.warn('Could not load pending Telegram invite:', error)
    return ''
  }

  if (!data?.invite_token) return ''
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return ''

  const { data: invite, error: inviteError } = await supabase
    .from('challenge_invites')
    .select('id, expires_at')
    .eq('token', data.invite_token)
    .eq('status', 'active')
    .maybeSingle()

  if (inviteError || !invite) return ''
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return ''

  return data.invite_token
}

function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')

  if (!hash) {
    throw new TelegramAuthError(
      'telegram_hash_missing',
      'Telegram не передал подпись входа. Закрой мини-приложение и открой его снова.',
      null,
      400,
    )
  }

  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  const hashBuffer = Buffer.from(hash, 'hex')
  const calculatedBuffer = Buffer.from(calculatedHash, 'hex')

  if (hashBuffer.length !== calculatedBuffer.length || !crypto.timingSafeEqual(hashBuffer, calculatedBuffer)) {
    throw new TelegramAuthError(
      'telegram_hash_invalid',
      'Не удалось проверить данные Telegram. Проверь токен бота в Vercel и открой мини-приложение снова.',
      null,
      401,
    )
  }

  const authDate = Number(params.get('auth_date') || 0)
  const maxAgeSeconds = 60 * 60 * 24

  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new TelegramAuthError(
      'telegram_data_expired',
      'Сессия Telegram устарела. Закрой мини-приложение и открой его снова.',
      null,
      401,
    )
  }

  let user
  try {
    user = JSON.parse(params.get('user') || '{}')
  } catch (error) {
    throw new TelegramAuthError(
      'telegram_user_invalid',
      'Telegram передал некорректные данные пользователя. Открой мини-приложение снова.',
      error,
      400,
    )
  }

  if (!user.id) {
    throw new TelegramAuthError(
      'telegram_user_missing',
      'Telegram не передал пользователя. Закрой мини-приложение и открой его снова.',
      null,
      400,
    )
  }
  return user
}

function makeTelegramPassword(telegramId, secret) {
  return crypto.createHmac('sha256', secret).update(`telegram:${telegramId}`).digest('hex')
}

async function findTelegramProfile(supabase, telegramId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (error) {
    throw makeSupabaseTelegramError(
      'supabase_profile_lookup_failed',
      'Не получилось найти Telegram-профиль.',
      error,
    )
  }
  return data
}

async function upsertTelegramProfile(supabase, { userId, email, telegramUser, displayName }) {
  const payload = {
    id: userId,
    email,
    display_name: displayName,
    auth_provider: 'telegram',
    telegram_id: telegramUser.id,
    telegram_username: telegramUser.username || null,
    photo_url: telegramUser.photo_url || null,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload)
    .select('id, email, display_name')
    .single()

  if (error && String(error.message || '').includes('photo_url')) {
    const fallbackPayload = { ...payload }
    delete fallbackPayload.photo_url
    const fallbackResult = await supabase
      .from('profiles')
      .upsert(fallbackPayload)
      .select('id, email, display_name')
      .single()

    if (!fallbackResult.error) return fallbackResult.data
  }

  if (error) {
    throw makeSupabaseTelegramError(
      'supabase_profile_save_failed',
      'Не получилось сохранить Telegram-профиль.',
      error,
    )
  }
  return data
}

function getTelegramDisplayName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `Telegram ${user.id}`
}

function isAlreadyRegisteredError(error) {
  return String(error?.message || '').toLowerCase().includes('already')
}

function makeSupabaseTelegramError(code, prefix, error) {
  const causeMessage = String(error?.message || '')
  const causeDetails = [error?.code, error?.details, error?.hint].filter(Boolean).join(' ')
  const cause = `${causeMessage} ${causeDetails}`.toLowerCase()

  if (cause.includes('telegram_id') || cause.includes('auth_provider') || cause.includes('telegram_username')) {
    return new TelegramAuthError(
      code,
      `${prefix} В Supabase не применена Telegram-миграция. Выполни SQL с колонками telegram_id, telegram_username и auth_provider.`,
      error,
    )
  }

  if (cause.includes('permission denied') || error?.code === '42501') {
    return new TelegramAuthError(
      code,
      `${prefix} У серверной функции нет прав к таблице profiles. Проверь, что SUPABASE_SERVICE_ROLE_KEY в Vercel — именно service_role secret, и сделай Redeploy.`,
      error,
    )
  }

  if (cause.includes('relation') || cause.includes('does not exist') || cause.includes('schema cache')) {
    return new TelegramAuthError(
      code,
      `${prefix} Supabase не видит нужную таблицу или новые поля. Проверь SQL-миграцию и обнови schema cache, затем сделай Redeploy.`,
      error,
    )
  }

  return new TelegramAuthError(
    code,
    `${prefix} Supabase ответил: ${causeMessage || 'неизвестная ошибка'}`,
    error,
  )
}

class TelegramAuthError extends Error {
  constructor(code, message, cause = null, status = 500) {
    super(message)
    this.name = 'TelegramAuthError'
    this.code = code
    this.status = status
    this.cause = cause
  }
}

function toTelegramAuthResponse(error) {
  if (error instanceof TelegramAuthError) {
    return {
      status: error.status || 500,
      code: error.code,
      error: error.message,
    }
  }

  return {
    status: 500,
    code: 'telegram_auth_failed',
    error: 'Не получилось войти через Telegram. Закрой мини-приложение и открой его снова.',
  }
}
