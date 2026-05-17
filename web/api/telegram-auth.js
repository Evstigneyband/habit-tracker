/* global Buffer, process */
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const telegramAuthSecret = process.env.TELEGRAM_AUTH_SECRET || supabaseServiceRoleKey

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !telegramBotToken || !telegramAuthSecret) {
    return response.status(500).json({ error: 'Telegram auth is not configured' })
  }

  try {
    const { initData } = request.body || {}

    if (!initData || typeof initData !== 'string') {
      return response.status(400).json({ error: 'Telegram auth data is missing' })
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
    const email = `telegram_${telegramUser.id}@telegram.local`
    const password = makeTelegramPassword(telegramUser.id, telegramAuthSecret)
    const displayName = getTelegramDisplayName(telegramUser)

    let profile = await findTelegramProfile(serviceClient, telegramUser.id)

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
        throw createUserError
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
      await upsertTelegramProfile(serviceClient, {
        userId: profile.id,
        email: profile.email || email,
        telegramUser,
        displayName,
      })
    }

    const { data: sessionData, error: signInError } = await anonClient.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) throw signInError

    return response.status(200).json({
      session: sessionData.session,
      profile: {
        id: profile?.id || sessionData.user.id,
        displayName,
        telegramId: telegramUser.id,
        telegramUsername: telegramUser.username || null,
      },
    })
  } catch (error) {
    console.error('Telegram auth error:', error)
    return response.status(401).json({ error: 'Telegram auth failed' })
  }
}

function verifyTelegramInitData(initData, botToken) {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')

  if (!hash) throw new Error('Missing Telegram hash')

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
    throw new Error('Invalid Telegram hash')
  }

  const authDate = Number(params.get('auth_date') || 0)
  const maxAgeSeconds = 60 * 60 * 24

  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    throw new Error('Telegram auth data is expired')
  }

  const user = JSON.parse(params.get('user') || '{}')

  if (!user.id) throw new Error('Telegram user is missing')
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

  if (error) throw error
  return data
}

async function upsertTelegramProfile(supabase, { userId, email, telegramUser, displayName }) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      email,
      display_name: displayName,
      auth_provider: 'telegram',
      telegram_id: telegramUser.id,
      telegram_username: telegramUser.username || null,
      updated_at: new Date().toISOString(),
    })
    .select('id, email, display_name')
    .single()

  if (error) throw error
  return data
}

function getTelegramDisplayName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || `Telegram ${user.id}`
}

function isAlreadyRegisteredError(error) {
  return String(error?.message || '').toLowerCase().includes('already')
}
