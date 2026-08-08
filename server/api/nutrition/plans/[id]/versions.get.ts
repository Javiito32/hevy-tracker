import { prisma } from '../../../../utils/prisma'
import { getSessionUser } from '../../../../utils/session'
import { requireOwnedPlan, toDateKey } from '../../../../utils/diet-service'

/**
 * Version history for the timeline and the history page. Reads the denormalised
 * total columns only — no meals, no JSON parsing — which is what they exist for.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const planId = getRouterParam(event, 'id')!

  const plan = await requireOwnedPlan(userId, planId)

  const versions = await prisma.dietVersion.findMany({
    where: { diet_plan_id: planId },
    orderBy: { version_number: 'desc' },
    select: {
      id: true,
      version_number: true,
      status: true,
      start_date: true,
      end_date: true,
      change_note: true,
      total_kcal: true,
      total_protein_g: true,
      total_carbs_g: true,
      total_fat_g: true,
      target_kcal: true,
      created_at: true,
      _count: { select: { meals: true } }
    }
  })

  return {
    plan,
    count: versions.length,
    versions: versions.map(v => ({
      ...v,
      start_date: toDateKey(v.start_date),
      end_date: toDateKey(v.end_date),
      meals_count: v._count.meals,
      _count: undefined
    }))
  }
})
