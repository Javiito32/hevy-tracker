import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!

  const macro = await prisma.macrocycle.findFirst({
    where: { id, user_id: userId },
    include: {
      mesocycles: {
        orderBy: { start_date: 'asc' },
        include: {
          _count: { select: { workouts: true } },
          diary_notes: { orderBy: { date: 'desc' }, take: 3 }
        }
      }
    }
  })

  if (!macro) throw createError({ statusCode: 404, message: 'Macrociclo no encontrado' })
  return macro
})
