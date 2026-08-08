import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { getCurrentRecords, RECORD_LABELS, type RecordType } from '../../utils/personal-records'

/**
 * Personal records: the current best per exercise, plus the most recent ones
 * for the dashboard feed.
 *
 * `?exercise=` narrows to one lift, which is how the progress page marks the
 * sessions that set a record.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const query = getQuery(event)
  const exercise = query.exercise as string | undefined

  const [current, recent] = await Promise.all([
    getCurrentRecords(userId, exercise),
    prisma.personalRecord.findMany({
      where: { user_id: userId, ...(exercise ? { exercise_name: exercise } : {}) },
      orderBy: { achieved_at: 'desc' },
      take: 20
    })
  ])

  const decorate = (r: { type: string; value: number; previous_value: number | null; at_weight: number | null }) => ({
    label: RECORD_LABELS[r.type as RecordType] ?? r.type,
    // Null rather than 0 on a first-ever record: "+0" would read as no progress
    // when in fact there was nothing to beat.
    improvement: r.previous_value != null
      ? Math.round((r.value - r.previous_value) * 100) / 100
      : null
  })

  return {
    current: current.map(r => ({ ...r, ...decorate(r) })),
    recent: recent.map(r => ({ ...r, ...decorate(r) }))
  }
})
