import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

/**
 * Every exercise the user has logged, with session count and 1RM.
 *
 * Reads the normalised table instead of parsing `exercises_summary` for the
 * whole history on each request, which is what the previous version did.
 *
 * Reports the BEST estimated 1RM as well as the latest: ranking by the last
 * session alone means one bad day makes a lift look weaker than it is.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  const [grouped, latestRows] = await Promise.all([
    prisma.workoutExercise.groupBy({
      by: ['name'],
      where: { user_id: userId },
      _count: { _all: true },
      _max: { date: true, best_e1rm: true },
      _sum: { working_sets: true, total_volume: true }
    }),
    // One row per exercise carrying its most recent e1RM. Fetched separately
    // because groupBy can't return "the value at the max date".
    prisma.workoutExercise.findMany({
      where: { user_id: userId, best_e1rm: { not: null } },
      select: { name: true, date: true, best_e1rm: true },
      orderBy: { date: 'desc' }
    })
  ])

  const latestByName = new Map<string, number>()
  for (const row of latestRows) {
    if (!latestByName.has(row.name) && row.best_e1rm != null) {
      latestByName.set(row.name, row.best_e1rm)
    }
  }

  return grouped
    .map(g => ({
      name: g.name,
      sessionCount: g._count._all,
      lastDate: (g._max.date ?? new Date(0)).toISOString(),
      lastEstimated1rm: latestByName.get(g.name) ?? null,
      bestEstimated1rm: g._max.best_e1rm ?? null,
      totalSets: g._sum.working_sets ?? 0,
      totalVolume: Math.round(g._sum.total_volume ?? 0)
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount)
})
