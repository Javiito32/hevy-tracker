import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const query = getQuery(event)
  const limit = query.limit ? parseInt(query.limit as string) : undefined

  const metrics = await prisma.bodyMetric.findMany({
    where: { user_id: userId },
    orderBy: { date: 'asc' },
    take: limit,
    select: {
      id: true, date: true,
      weight: true, lean_mass: true, body_fat_percentage: true,
      neck: true, shoulder: true, chest: true,
      left_bicep: true, right_bicep: true,
      left_bicep_relaxed: true, right_bicep_relaxed: true,
      left_forearm: true, right_forearm: true,
      abdomen: true, waist: true, hips: true,
      left_thigh: true, right_thigh: true,
      left_calf: true, right_calf: true,
      hrv: true, resting_hr: true,
    }
  })

  return metrics.map(m => ({ ...m, date: m.date.toISOString().slice(0, 10) }))
})
