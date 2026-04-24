import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mesocycleId = getRouterParam(event, 'id')!

  const mesocycle = await prisma.mesocycle.findFirst({ where: { id: mesocycleId, user_id: userId } })
  if (!mesocycle) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  return prisma.mesocycleNote.findMany({
    where: { mesocycle_id: mesocycleId },
    orderBy: { date: 'desc' }
  })
})
