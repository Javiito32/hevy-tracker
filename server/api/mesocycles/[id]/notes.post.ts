import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mesocycleId = getRouterParam(event, 'id')!
  const body = await readBody(event)
  const { content, date, tags } = body

  if (!content?.trim()) throw createError({ statusCode: 400, message: 'El contenido es obligatorio' })

  const mesocycle = await prisma.mesocycle.findFirst({ where: { id: mesocycleId, user_id: userId } })
  if (!mesocycle) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  return prisma.mesocycleNote.create({
    data: {
      mesocycle_id: mesocycleId,
      content: content.trim(),
      date: date ? new Date(date) : new Date(),
      tags: tags ? JSON.stringify(tags) : null
    }
  })
})
