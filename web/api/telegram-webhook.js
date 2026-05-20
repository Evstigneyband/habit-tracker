/* global process */
import { createClient } from '@supabase/supabase-js'

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || ''
const appUrl = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || 'https://habit-tracker-black-theta.vercel.app'
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' })
  }

  if (!telegramBotToken) {
    return response.status(500).json({ error: 'Telegram bot is not configured' })
  }

  if (webhookSecret && request.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) {
    return response.status(401).json({ error: 'Unauthorized' })
  }

  const update = request.body || {}
  const message = update.message || update.edited_message
  const chatId = message?.chat?.id
  const telegramUserId = message?.from?.id || chatId
  const text = String(message?.text || '').trim()

  if (!chatId || !text.startsWith('/start')) {
    return response.status(200).json({ ok: true })
  }

  const payload = text.split(/\s+/)[1] || ''
  const inviteToken = normalizeInvitePayload(payload)

  if (!inviteToken) {
    await sendTelegramMessage({
      chatId,
      text: 'Привет! Нажми кнопку ниже, чтобы открыть Твой челлендж.',
      replyMarkup: {
        inline_keyboard: [[makeOpenAppButton(appUrl)]],
      },
    })
    return response.status(200).json({ ok: true })
  }

  const savedInvite = await savePendingInvite({
    telegramId: telegramUserId,
    chatId,
    token: inviteToken,
  })

  if (!savedInvite) {
    await sendTelegramMessage({
      chatId,
      text: 'Это приглашение уже обработано или больше не активно. Открой приложение, чтобы продолжить.',
      replyMarkup: {
        inline_keyboard: [[makeOpenAppButton(appUrl)]],
      },
    })
    return response.status(200).json({ ok: true })
  }

  const inviteUrl = new URL(appUrl)
  inviteUrl.searchParams.set('invite', inviteToken)

  await sendTelegramMessage({
    chatId,
    text: 'Тебя пригласили в совместный челлендж. Открой мини-приложение, чтобы присоединиться.',
    replyMarkup: {
      inline_keyboard: [[makeOpenAppButton(inviteUrl.toString(), 'Открыть приглашение')]],
    },
  })

  return response.status(200).json({ ok: true })
}

async function savePendingInvite({ telegramId, chatId, token }) {
  if (!supabaseUrl || !supabaseServiceRoleKey || !telegramId || !token) return false

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const { data: invite, error: inviteError } = await supabase
    .from('challenge_invites')
    .select('id, status, expires_at')
    .eq('token', token)
    .eq('status', 'active')
    .maybeSingle()

  if (inviteError || !invite) return false
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return false

  const { data: handledInvite } = await supabase
    .from('telegram_pending_invites')
    .select('status')
    .eq('telegram_id', telegramId)
    .eq('invite_token', token)
    .in('status', ['accepted', 'declined'])
    .maybeSingle()

  if (handledInvite) return false

  const { error } = await supabase
    .from('telegram_pending_invites')
    .upsert(
      {
        telegram_id: telegramId,
        chat_id: chatId,
        invite_token: token,
        status: 'pending',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id' },
    )

  if (error) {
    console.warn('Could not save pending Telegram invite:', error)
    return false
  }

  return true
}

function normalizeInvitePayload(value) {
  if (!value) return ''
  const trimmed = String(value).trim()
  if (trimmed.startsWith('invite_')) return trimmed.slice('invite_'.length)
  return /^[a-f0-9]{20,}$/i.test(trimmed) ? trimmed : ''
}

function makeOpenAppButton(url, text = 'Открыть челлендж') {
  return {
    text,
    web_app: { url },
  }
}

async function sendTelegramMessage({ chatId, text, replyMarkup }) {
  const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
    }),
  })

  const payload = await telegramResponse.json().catch(() => ({}))
  if (!telegramResponse.ok) {
    throw new Error(payload.description || 'Telegram sendMessage failed')
  }
}
