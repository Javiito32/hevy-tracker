import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const { name, goal, start_date, end_date, notes } = await readBody(event)

  if (!name || !start_date) throw createError({ statusCode: 400, message: 'name y start_date son obligatorios' })

  return prisma.macrocycle.create({
    data: { user_id: userId, name, goal: goal || null, start_date: new Date(start_date), end_date: end_date ? new Date(end_date) : null, notes: notes || null }
  })
})
