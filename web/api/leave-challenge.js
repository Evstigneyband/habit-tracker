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
    return response.status(500).json({ error: 'Сервер ещё не настроен для выхода из челленджа.' })
  }

  try {
    const user = await getRequestUser(request)
    const challengeId = String(request.body?.challengeId || '').trim()
    if (!challengeId) return response.status(400).json({ error: 'Челлендж не найден.' })

    const supabase = createServiceClient()
    const { error } = await supabase
      .from('challenge_members')
      .update({
        status: 'left',
        updated_at: new Date().toISOString(),
      })
      .eq('challenge_id', challengeId)
      .eq('user_id', user.id)
      .neq('role', 'owner')

    if (error) throw error

    return response.status(200).json({ data: { left: true } })
  } catch (error) {
    console.error('Leave challenge API error:', error)
    return response.status(500).json({ error: String(error?.message || error || 'Не удалось покинуть челлендж.') })
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
