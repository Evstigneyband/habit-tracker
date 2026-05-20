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

    await supabase
      .from('challenge_members')
      .upsert(
        {
          challenge_id: challengeId,
          user_id: challenge.user_id,
          role: 'owner',
          status: 'active',
        },
        { onConflict: 'challenge_id,user_id' },
      )

    const [goalsResult, entriesResult, members] = await Promise.all([
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
      loadMembersWithProfiles(supabase, challengeId),
    ])

    if (goalsResult.error) throw goalsResult.error
    if (entriesResult.error) throw entriesResult.error

    return response.status(200).json({
      data: {
        goals: goalsResult.data || [],
        entries: entriesResult.data || [],
        members,
      },
    })
  } catch (error) {
    console.error('Challenge state API error:', error)
    return response.status(500).json({ error: String(error?.message || error || 'Не удалось загрузить челлендж.') })
  }
}

async function loadMembersWithProfiles(supabase, challengeId) {
  const membersResult = await supabase
    .from('challenge_members')
    .select('user_id, role, joined_at')
    .eq('challenge_id', challengeId)
    .eq('status', 'active')
    .order('joined_at', { ascending: true })

  if (membersResult.error) throw membersResult.error

  const members = membersResult.data || []
  const userIds = members.map((member) => member.user_id).filter(Boolean)
  if (userIds.length === 0) return []

  const profilesResult = await loadProfiles(supabase, userIds)
  const profilesById = new Map((profilesResult || []).map((profile) => [profile.id, profile]))

  return members.map((member) => ({
    ...member,
    profiles: profilesById.get(member.user_id) || null,
  }))
}

async function loadProfiles(supabase, userIds) {
  const withPhoto = await supabase
    .from('profiles')
    .select('id, email, display_name, auth_provider, telegram_username, photo_url')
    .in('id', userIds)

  if (!withPhoto.error) return withPhoto.data || []
  if (!String(withPhoto.error.message || '').includes('photo_url')) throw withPhoto.error

  const fallback = await supabase
    .from('profiles')
    .select('id, email, display_name, auth_provider, telegram_username')
    .in('id', userIds)

  if (fallback.error) throw fallback.error
  return fallback.data || []
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
