import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID required' })

  const mesocycle = await prisma.mesocycle.findFirst({ where: { id, user_id: userId } })
  if (!mesocycle) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  return prisma.mesocycleEvaluation.findMany({
    where: { mesocycle_id: id },
    orderBy: { week_number: 'desc' }
  })
})
