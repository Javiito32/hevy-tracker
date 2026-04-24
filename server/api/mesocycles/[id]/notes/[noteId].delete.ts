import { prisma } from '../../../../utils/prisma'
import { getSessionUser } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const noteId = getRouterParam(event, 'noteId')!
  const mesocycleId = getRouterParam(event, 'id')!

  // Verify ownership via mesocycle
  const note = await prisma.mesocycleNote.findFirst({
    where: { id: noteId, mesocycle: { id: mesocycleId, user_id: userId } }
  })
  if (!note) throw createError({ statusCode: 404, statusMessage: 'Note not found' })

  await prisma.mesocycleNote.delete({ where: { id: noteId } })
  return { success: true }
})
