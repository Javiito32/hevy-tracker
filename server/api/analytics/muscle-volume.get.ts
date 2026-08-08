import { getSessionUser } from '../../utils/session'
import { buildMuscleVolumeReport } from '../../utils/muscle-volume'
import { VOLUME_LANDMARKS, TRAINABLE_MUSCLE_GROUPS, MUSCLE_LABELS } from '../../utils/muscle-groups'

/**
 * Weekly working sets per muscle group, against the MEV/MAV/MRV bands.
 *
 * The landmark table ships with the response so the chart doesn't hardcode a
 * second copy of numbers that live in muscle-groups.ts.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  const weeks = Math.min(26, Math.max(1, Number(getQuery(event).weeks) || 8))
  const report = await buildMuscleVolumeReport(userId, weeks)

  return {
    ...report,
    weeks_requested: weeks,
    landmarks: TRAINABLE_MUSCLE_GROUPS.map(m => ({
      muscle: m,
      label: MUSCLE_LABELS[m] ?? m,
      ...VOLUME_LANDMARKS[m]
    }))
  }
})
