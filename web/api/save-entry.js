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
    return response.status(500).json({ error: 'Сервер ещё не настроен для сохранения прогресса.' })
  }

  try {
    const user = await getRequestUser(request)
    const payload = request.body || {}
    const supabase = createServiceClient()
    const goalId = String(payload.goalId || '')
    const challengeId = String(payload.challengeId || '')

    if (!goalId || !challengeId || !payload.entryDate) {
      return response.status(400).json({ error: 'Не хватает данных для сохранения.' })
    }

    const { data: goal, error: goalError } = await supabase
      .from('goals')
      .select('id, challenge_id, goal_type, target_hours')
      .eq('id', goalId)
      .eq('challenge_id', challengeId)
      .single()

    if (goalError || !goal) {
      return response.status(404).json({ error: 'Цель не найдена.' })
    }

    const isTimeGoal = goal.goal_type === 'time'
    const targetHours = isTimeGoal ? Number(goal.target_hours || 0) : null
    const actualHours = isTimeGoal ? Number(payload.actualHours || 0) : 0
    const completed = isTimeGoal ? actualHours >= targetHours : Boolean(payload.isChecked)

    const row = {
      challenge_id: challengeId,
      goal_id: goalId,
      user_id: user.id,
      entry_date: payload.entryDate,
      day_number: Number(payload.dayNumber || 1),
      goal_type: goal.goal_type,
      is_checked: !isTimeGoal && Boolean(payload.isChecked),
      target_hours: targetHours,
      actual_hours: actualHours,
      is_completed: completed,
      completion_percent: completed ? 100 : 0,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('daily_entries')
      .upsert(row, { onConflict: 'goal_id,user_id,entry_date' })
      .select('*')
      .single()

    if (error) throw error

    return response.status(200).json({ data })
  } catch (error) {
    console.error('Save entry API error:', error)
    return response.status(500).json({ error: formatServerError(error) })
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

function formatServerError(error) {
  const message = String(error?.message || error || '')
  if (message.includes('duplicate key')) return 'Запись за этот день уже существует.'
  if (message.includes('permission denied')) return 'Серверу не хватает прав для сохранения.'
  return message || 'Не получилось сохранить прогресс.'
}
