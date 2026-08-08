import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

/**
 * Active training alerts, most severe first.
 *
 * Dismissed alerts are excluded but not deleted: the detector keeps their
 * evidence current so reopening one shows today's numbers rather than the ones
 * that were dismissed weeks ago.
 */
const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 }

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const includeResolved = getQuery(event).includeResolved === 'true'

  const alerts = await prisma.trainingAlert.findMany({
    where: {
      user_id: userId,
      status: includeResolved ? { in: ['active', 'resolved'] } : 'active'
    },
    orderBy: { detected_at: 'desc' }
  })

  return alerts
    .map(a => ({
      id: a.id,
      type: a.type,
      subject_kind: a.subject_kind,
      subject: a.subject,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      evidence: a.payload_json ? safeParse(a.payload_json) : null,
      status: a.status,
      detected_at: a.detected_at,
      /** Days the alert has been standing — what makes "sigue estancado" concrete. */
      days_open: Math.max(0, Math.floor((Date.now() - a.detected_at.getTime()) / 86_400_000))
    }))
    .sort((a, b) =>
      (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
      new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
    )
})

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) } catch { return null }
}
