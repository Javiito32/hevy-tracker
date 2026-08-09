import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'

/**
 * Progress and result of a plan-generation job. Polled by the new-mesocycle
 * form while one runs.
 *
 * 404s on another user's job rather than 403 — an id you don't own shouldn't be
 * confirmed as existing, the same rule the sync and conversation endpoints follow.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const jobId = getRouterParam(event, 'jobId')

  const job = await prisma.maintenanceJob.findFirst({
    where: { id: jobId, user_id: userId, kind: 'ai_generate_plan' }
  })
  if (!job) throw createError({ statusCode: 404, message: 'Generación no encontrada' })

  let result: Record<string, unknown> | null = null
  if (job.result_json) {
    try { result = JSON.parse(job.result_json) } catch { result = null }
  }

  return {
    id: job.id,
    status: job.status,
    message: job.message,
    error: job.error,
    plan: (result?.plan as any) ?? null,
    warning: (result?.warning as string) ?? null,
    finished: job.status === 'done' || job.status === 'error'
  }
})
