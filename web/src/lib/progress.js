export function calculateDayProgress(goals) {
  const total = goals.length
  const completed = goals.filter((goal) => goal.isCompleted).length
  const percent = total ? Math.round((completed / total) * 100) : 0

  return { completed, total, percent }
}

export function isGoalCompleted(goal) {
  if (goal.goalType === 'time') return Number(goal.actualHours || 0) >= Number(goal.targetHours || 0)
  return Boolean(goal.isChecked)
}
