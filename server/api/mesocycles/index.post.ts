import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)
  const { name, start_date, end_date, goal, split_description, target_volume_weekly, notes } = body

  if (!name || !start_date) throw createError({ statusCode: 400, statusMessage: 'Name and start_date are required' })

  await prisma.mesocycle.updateMany({ where: { user_id: userId, status: 'active' }, data: { status: 'paused' } })

  return prisma.mesocycle.create({
    data: {
      user_id: userId,
      name,
      start_date: new Date(start_date),
      end_date: end_date ? new Date(end_date) : null,
      goal: goal || null,
      split_description: split_description || null,
      target_volume_weekly: target_volume_weekly ? Number(target_volume_weekly) : null,
      notes: notes || null,
      status: 'active'
    }
  })
})
