/* global process */

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || ''
const appUrl = process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || 'https://habit-tracker-black-theta.vercel.app'

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
