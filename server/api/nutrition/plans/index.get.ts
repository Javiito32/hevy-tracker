import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { getActivePlan, loadVersionFull, serializeVersion } from '../../../utils/diet-service'

/**
 * Single read for the nutrition page: the active plan, the version currently in
 * force, and the open draft if there is one.
 *
 * `editing` tells the page which of the two to render — the draft always wins,
 * so reopening the page resumes unpublished work instead of hiding it.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  const plan = await getActivePlan(userId)
  if (!plan) return { plan: null, active: null, draft: null, editing: null, weight_kg: null }

  const [versions, latestWeight] = await Promise.all([
    prisma.dietVersion.findMany({
      where: { diet_plan_id: plan.id, status: { in: ['active', 'draft'] } },
      select: { id: true, status: true }
    }),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, weight: { not: null } },
      orderBy: { date: 'desc' },
      select: { weight: true }
    })
  ])

  const activeId = versions.find(v => v.status === 'active')?.id
  const draftId = versions.find(v => v.status === 'draft')?.id
  const weightKg = latestWeight?.weight ?? null

  const [activeVersion, draftVersion] = await Promise.all([
    activeId ? loadVersionFull(activeId) : Promise.resolve(null),
    draftId ? loadVersionFull(draftId) : Promise.resolve(null)
  ])

  return {
    plan,
    weight_kg: weightKg,
    active: activeVersion ? serializeVersion(activeVersion, { weightKg }) : null,
    draft: draftVersion ? serializeVersion(draftVersion, { weightKg }) : null,
    editing: draftVersion ? 'draft' : activeVersion ? 'active' : null
  }
})
