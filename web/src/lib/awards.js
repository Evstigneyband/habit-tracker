export const AWARD_DEFINITIONS = [
  {
    id: 'first-perfect-day',
    title: 'Первый идеальный день',
    description: 'Закрой первый день на 100%.',
    tone: 'gold',
    metric: 'fullDays',
    threshold: 1,
  },
  {
    id: 'perfect-streak-2',
    title: 'Два дня подряд',
    description: 'Два дня подряд на 100%.',
    tone: 'green',
    metric: 'maxStreak',
    threshold: 2,
  },
  {
    id: 'perfect-streak-3',
    title: 'Три дня подряд',
    description: 'Три дня подряд на 100%.',
    tone: 'blue',
    metric: 'maxStreak',
    threshold: 3,
  },
  {
    id: 'perfect-streak-5',
    title: 'Пять дней подряд',
    description: 'Пять дней подряд на 100%.',
    tone: 'violet',
    metric: 'maxStreak',
    threshold: 5,
  },
  {
    id: 'perfect-streak-7',
    title: 'Неделя подряд',
    description: 'Неделя подряд на 100%.',
    tone: 'gold',
    metric: 'maxStreak',
    threshold: 7,
  },
  {
    id: 'perfect-streak-10',
    title: 'Десять дней подряд',
    description: 'Десять дней подряд на 100%.',
    tone: 'flame',
    metric: 'maxStreak',
    threshold: 10,
  },
  {
    id: 'five-perfect-days',
    title: 'Пять идеальных дней',
    description: 'Пять идеальных дней на 100%.',
    tone: 'green',
    metric: 'fullDays',
    threshold: 5,
  },
  {
    id: 'challenge-completed-1',
    title: 'Один челлендж закрыт',
    description: 'Закрой один челлендж до конца.',
    tone: 'blue',
    metric: 'completedChallenges',
    threshold: 1,
  },
  {
    id: 'challenge-completed-5',
    title: 'Пять челленджей закрыто',
    description: 'Закрой пять челленджей до конца.',
    tone: 'violet',
    metric: 'completedChallenges',
    threshold: 5,
  },
  {
    id: 'challenge-completed-10',
    title: 'Десять челленджей закрыто',
    description: 'Закрой десять челленджей до конца.',
    tone: 'flame',
    metric: 'completedChallenges',
    threshold: 10,
  },
  {
    id: 'friend-battle-win',
    title: 'Победа в битве с другом',
    description: 'Победи в совместном челлендже.',
    tone: 'gold',
    metric: 'battleWins',
    threshold: 1,
  },
]

export function buildAwardStats(events = []) {
  const fullDayDates = uniqueSortedDates(
    events.filter((event) => event.event_type === 'day_completed_100').map((event) => event.event_date),
  )
  const completedChallenges = new Set(
    events
      .filter((event) => event.event_type === 'challenge_completed' && event.challenge_id)
      .map((event) => event.challenge_id),
  ).size
  const battleWins = new Set(
    events
      .filter((event) => event.event_type === 'friend_battle_win' && event.challenge_id)
      .map((event) => event.challenge_id),
  ).size

  return {
    fullDays: fullDayDates.length,
    maxStreak: getMaxDateStreak(fullDayDates),
    completedChallenges,
    battleWins,
  }
}

export function buildAwardsFromStats(stats = {}, awardRows = []) {
  const unlockedIds = new Set((awardRows || []).map((award) => award.award_id || award.id).filter(Boolean))

  return AWARD_DEFINITIONS.map((award) => {
    const value = Number(stats[award.metric] || 0)
    const isUnlocked = unlockedIds.has(award.id) || value >= award.threshold
    return {
      ...award,
      unlocked: isUnlocked,
      progress: isUnlocked ? 100 : Math.min(Math.round((value / award.threshold) * 100), 100),
    }
  })
}

export function getAwardDefinition(awardId) {
  return AWARD_DEFINITIONS.find((award) => award.id === awardId) || null
}

export function getUnlockableAwards(events = [], awardRows = []) {
  const stats = buildAwardStats(events)
  const unlockedIds = new Set((awardRows || []).map((award) => award.award_id || award.id).filter(Boolean))

  return AWARD_DEFINITIONS.filter((award) => {
    if (unlockedIds.has(award.id)) return false
    return Number(stats[award.metric] || 0) >= award.threshold
  })
}

function uniqueSortedDates(dates) {
  return [...new Set((dates || []).filter(Boolean))].sort()
}

function getMaxDateStreak(dates) {
  return (dates || []).reduce(
    (acc, date) => {
      const current = acc.previousDate && diffDays(acc.previousDate, date) === 1 ? acc.current + 1 : 1
      return {
        current,
        best: Math.max(acc.best, current),
        previousDate: date,
      }
    },
    { current: 0, best: 0, previousDate: '' },
  ).best
}

function diffDays(leftDate, rightDate) {
  const left = new Date(`${leftDate}T00:00:00`)
  const right = new Date(`${rightDate}T00:00:00`)
  return Math.round((right - left) / 86_400_000)
}

