import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  const workouts = await prisma.workout.findMany({
    where: { user_id: userId },
    orderBy: { date: 'desc' },
    select: { date: true, exercises_summary: true }
  })

  const exerciseMap = new Map<string, { lastDate: string; lastEstimated1rm: number | null; sessionCount: number }>()

  for (const w of workouts) {
    const exercises: any[] = w.exercises_summary ? JSON.parse(w.exercises_summary) : []
    for (const ex of exercises) {
      const name: string = ex.name
      if (!name) continue
      const existing = exerciseMap.get(name)
      if (!existing) {
        exerciseMap.set(name, {
          lastDate: w.date.toISOString(),
          lastEstimated1rm: ex.estimated_1rm ? parseFloat(ex.estimated_1rm) : null,
          sessionCount: 1
        })
      } else {
        existing.sessionCount++
      }
    }
  }

  return Array.from(exerciseMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.sessionCount - a.sessionCount)
})
