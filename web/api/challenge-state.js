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
    return response.status(500).json({ error: 'Сервер ещё не настроен для совместных челленджей.' })
  }

  try {
    const user = await getRequestUser(request)
    const challengeId = String(request.body?.challengeId || '')
    if (!challengeId) return response.status(400).json({ error: 'Не указан челлендж.' })

    const supabase = createServiceClient()
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('id, user_id, status')
      .eq('id', challengeId)
      .single()

    if (challengeError || !challenge || challenge.status === 'deleted') {
      return response.status(404).json({ error: 'Челлендж не найден.' })
    }

    const { data: membership } = await supabase
      .from('challenge_members')
      .select('user_id')
      .eq('challenge_id', challengeId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()

    if (challenge.user_id !== user.id && !membership) {
      return response.status(403).json({ error: 'Нет доступа к этому челленджу.' })
    }

    const [goalsResult, entriesResult, membersResult] = await Promise.all([
      supabase
        .from('goals')
        .select('*')
        .eq('challenge_id', challengeId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('daily_entries')
        .select('*')
        .eq('challenge_id', challengeId)
        .order('entry_date', { ascending: true }),
      supabase
        .from('challenge_members')
        .select('user_id, role, joined_at, profiles (id, email, display_name, auth_provider, telegram_username)')
        .eq('challenge_id', challengeId)
        .eq('status', 'active')
        .order('joined_at', { ascending: true }),
    ])

    if (goalsResult.error) throw goalsResult.error
    if (entriesResult.error) throw entriesResult.error
    if (membersResult.error) throw membersResult.error

    return response.status(200).json({
      data: {
        goals: goalsResult.data || [],
        entries: entriesResult.data || [],
        members: membersResult.data || [],
      },
    })
  } catch (error) {
    console.error('Challenge state API error:', error)
    return response.status(500).json({ error: String(error?.message || error || 'Не удалось загрузить челлендж.') })
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
