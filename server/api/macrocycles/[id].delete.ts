import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!

  await prisma.mesocycle.updateMany({ where: { macrocycle_id: id, user_id: userId }, data: { macrocycle_id: null } })
  await prisma.macrocycle.deleteMany({ where: { id, user_id: userId } })
  return { success: true }
})
