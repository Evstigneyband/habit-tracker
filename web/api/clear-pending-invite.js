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
    const supabase = createServiceClient()

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('telegram_id')
      .eq('id', user.id)
      .maybeSingle()

    if (profileError) throw profileError
    if (!profile?.telegram_id) return response.status(200).json({ data: { cleared: false } })

    let query = supabase
      .from('telegram_pending_invites')
      .update({
        status: 'declined',
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_id', profile.telegram_id)
      .eq('status', 'pending')

    if (token) query = query.eq('invite_token', token)

    const { error } = await query
    if (error) throw error

    return response.status(200).json({ data: { cleared: true } })
  } catch (error) {
    console.error('Clear pending invite API error:', error)
    return response.status(500).json({ error: String(error?.message || error || 'Не удалось убрать приглашение.') })
  }
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
