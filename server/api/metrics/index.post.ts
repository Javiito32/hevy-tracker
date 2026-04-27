import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)

  const { date, ...fields } = body
  if (!date) throw createError({ statusCode: 400, statusMessage: 'date is required' })

  const startOfDay = new Date(`${date}T00:00:00.000Z`)
  const endOfDay = new Date(`${date}T23:59:59.999Z`)

  const payload: Record<string, any> = {}
  const allowed = [
    'weight', 'lean_mass', 'body_fat_percentage',
    'neck', 'shoulder', 'chest',
    'left_bicep', 'right_bicep', 'left_bicep_relaxed', 'right_bicep_relaxed',
    'left_forearm', 'right_forearm',
    'abdomen', 'waist', 'hips',
    'left_thigh', 'right_thigh',
    'left_calf', 'right_calf',
    'hrv', 'resting_hr',
  ]
  for (const key of allowed) {
    if (fields[key] !== undefined && fields[key] !== '') {
      payload[key] = fields[key] === null ? null : Number(fields[key])
    }
  }

  const existing = await prisma.bodyMetric.findFirst({
    where: { user_id: userId, date: { gte: startOfDay, lte: endOfDay } }
  })

  if (existing) {
    const updated = await prisma.bodyMetric.update({
      where: { id: existing.id },
      data: payload
    })
    return { ...updated, date: updated.date.toISOString().slice(0, 10) }
  }

  const created = await prisma.bodyMetric.create({
    data: { user_id: userId, date: new Date(`${date}T12:00:00.000Z`), source: 'manual', ...payload }
  })
  return { ...created, date: created.date.toISOString().slice(0, 10) }
})
