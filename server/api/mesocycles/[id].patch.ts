import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event)
  const { status, name, goal, split_description, end_date, notes, macrocycle_id, target_volume_weekly } = body

  // Verify ownership before any mutation
  const owned = await prisma.mesocycle.findFirst({
    where: { id, user_id: userId },
    select: { id: true, status: true, final_summary: true }
  })
  if (!owned) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  if (status === 'active') {
    await prisma.mesocycle.updateMany({ where: { user_id: userId, status: 'active', id: { not: id } }, data: { status: 'paused' } })
  }

  const updated = await prisma.mesocycle.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(name !== undefined && { name }),
      ...(goal !== undefined && { goal }),
      ...(split_description !== undefined && { split_description }),
      ...(end_date !== undefined && { end_date: end_date ? new Date(end_date) : null }),
      ...(notes !== undefined && { notes }),
      ...(macrocycle_id !== undefined && { macrocycle_id: macrocycle_id || null }),
      ...(target_volume_weekly !== undefined && { target_volume_weekly: target_volume_weekly ? Number(target_volume_weekly) : null })
    }
  })

  if (status === 'completed' && owned.status !== 'completed' && !owned.final_summary) {
    $fetch(`/api/mesocycles/${id}/final-summary`, { method: 'POST' }).catch(() => {})
  }

  return updated
})
