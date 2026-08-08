import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'

const DEFAULT_MEALS = ['Desayuno', 'Comida', 'Merienda', 'Cena']

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)
  const { name, goal, notes, target_kcal, target_protein_g, target_carbs_g, target_fat_g } = body

  if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: 'El nombre de la dieta es obligatorio' })

  // Only one active plan per user, same demotion idiom as Mesocycle.
  await prisma.dietPlan.updateMany({
    where: { user_id: userId, status: 'active' },
    data: { status: 'archived' }
  })

  const plan = await prisma.dietPlan.create({
    data: {
      user_id: userId,
      name: name.trim(),
      goal: goal || null,
      notes: notes || null,
      status: 'active',
      // A new plan starts as an unpublished draft, so nothing enters the history
      // until the user has actually filled it in and published it.
      versions: {
        create: {
          version_number: 1,
          status: 'draft',
          target_kcal: target_kcal ? Number(target_kcal) : null,
          target_protein_g: target_protein_g ? Number(target_protein_g) : null,
          target_carbs_g: target_carbs_g ? Number(target_carbs_g) : null,
          target_fat_g: target_fat_g ? Number(target_fat_g) : null,
          meals: {
            create: DEFAULT_MEALS.map((mealName, index) => ({ name: mealName, order_index: index }))
          }
        }
      }
    },
    include: { versions: true }
  })

  return plan
})
