import { prisma } from '../../../utils/prisma'
import { requireAdmin } from '../../../utils/session'
import { JOB_LABELS, type JobKind } from '../../../utils/maintenance'

/**
 * Recent jobs, newest first — what the admin panel polls while something runs
 * and reads as a log once nothing does.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const jobs = await prisma.maintenanceJob.findMany({
    orderBy: { created_at: 'desc' },
    take: 25
  })

  const userIds = [...new Set(jobs.map(j => j.user_id).filter(Boolean))] as string[]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : []
  const nameById = new Map(users.map(u => [u.id, u.name]))

  return {
    jobs: jobs.map(j => ({
      id: j.id,
      kind: j.kind,
      label: JOB_LABELS[j.kind as JobKind] ?? j.kind,
      user_id: j.user_id,
      user_name: j.user_id ? nameById.get(j.user_id) ?? null : null,
      status: j.status,
      progress_current: j.progress_current,
      progress_total: j.progress_total,
      message: j.message,
      // Parsed here rather than in the component: the panel renders a summary
      // line, not raw JSON.
      result: j.result_json ? safeParse(j.result_json) : null,
      error: j.error,
      created_at: j.created_at,
      started_at: j.started_at,
      finished_at: j.finished_at
    })),
    running: jobs.some(j => j.status === 'running' || j.status === 'pending')
  }
})

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) } catch { return null }
}
