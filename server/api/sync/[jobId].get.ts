import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

/**
 * Progress of a sync job. Polled by the navbar button while one runs.
 *
 * 404s on another user's job rather than 403 — an id you don't own shouldn't be
 * confirmed as existing, the same rule the conversation endpoints follow.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const jobId = getRouterParam(event, 'jobId')

  const job = await prisma.maintenanceJob.findFirst({
    where: { id: jobId, user_id: userId, kind: 'sync' }
  })
  if (!job) throw createError({ statusCode: 404, message: 'Sincronización no encontrada' })

  let result: Record<string, unknown> | null = null
  if (job.result_json) {
    try { result = JSON.parse(job.result_json) } catch { result = null }
  }

  return {
    id: job.id,
    status: job.status,
    message: job.message,
    current: job.progress_current,
    total: job.progress_total,
    error: job.error,
    result,
    finished: job.status === 'done' || job.status === 'error'
  }
})
