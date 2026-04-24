import { prisma } from '../../../utils/prisma'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const sessionUser = await requireAdmin(event)
  const targetId = getRouterParam(event, 'id')!
  const { is_active } = await readBody(event)

  if (is_active === false && targetId === sessionUser.id) {
    throw createError({ statusCode: 400, message: 'No puedes desactivar tu propia cuenta.' })
  }

  return prisma.user.update({
    where: { id: targetId },
    data: { ...(is_active !== undefined && { is_active }) },
    select: { id: true, is_active: true }
  })
})
