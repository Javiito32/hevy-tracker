import { prisma } from './prisma'
import { computeVersionTotals, macroSplit, proteinPerKg, type VersionTotals } from './nutrition-calculator'

/**
 * Everything that mutates a diet goes through this file.
 *
 * Two invariants live here and nowhere else, because splitting them across the
 * endpoints is how they would drift apart:
 *
 * 1. **Only a draft is mutable.** A published version is frozen forever, which
 *    is what makes "what was I eating in March" answerable at all.
 * 2. **Totals are recomputed on every write.** They are denormalised onto
 *    DietVersion for the history list and the chart, so a write path that
 *    forgot to recalc would leave the history quietly showing stale figures.
 */

/** Day-keyed dates are anchored at UTC noon so a timezone shift can't move them. */
export const dayAnchor = (date: Date | string = new Date()): Date => {
  const iso = typeof date === 'string' ? date : date.toISOString()
  return new Date(`${iso.slice(0, 10)}T12:00:00.000Z`)
}

export const toDateKey = (date: Date | null | undefined): string | null =>
  date ? date.toISOString().slice(0, 10) : null

const MEAL_INCLUDE = {
  meals: {
    orderBy: { order_index: 'asc' as const },
    include: { items: { orderBy: { order_index: 'asc' as const } } }
  }
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export const getActivePlan = async (userId: string) =>
  prisma.dietPlan.findFirst({
    where: { user_id: userId, status: 'active' },
    orderBy: { created_at: 'desc' }
  })

/** 404 for unknown ids and for someone else's, never 403 — as requireOwnedConversation does. */
export const requireOwnedPlan = async (userId: string, planId: string) => {
  const plan = await prisma.dietPlan.findFirst({ where: { id: planId, user_id: userId } })
  if (!plan) throw createError({ statusCode: 404, statusMessage: 'Dieta no encontrada' })
  return plan
}

// ── Versions ──────────────────────────────────────────────────────────────────

export const loadVersionFull = async (versionId: string) =>
  prisma.dietVersion.findUnique({ where: { id: versionId }, include: MEAL_INCLUDE })

/** Resolves a version id to its owner, 404ing across users. */
export const requireOwnedVersion = async (userId: string, versionId: string) => {
  const version = await prisma.dietVersion.findFirst({
    where: { id: versionId, diet_plan: { user_id: userId } },
    include: { diet_plan: true }
  })
  if (!version) throw createError({ statusCode: 404, statusMessage: 'Versión de dieta no encontrada' })
  return version
}

/**
 * Guards every mutation. A published version must never change: the whole
 * history feature rests on that, so this is a hard 409 rather than a silent
 * no-op or an implicit fork.
 */
export const assertDraft = (version: { status: string }) => {
  if (version.status !== 'draft') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Esta versión ya está publicada y no puede modificarse. Crea un borrador para editar la dieta.'
    })
  }
}

/**
 * Returns the plan's open draft, creating one if there isn't any.
 *
 * A plan with an active version gets a deep copy of it — meals, items and, most
 * importantly, each item's nutrients_snapshot, so the draft starts from exactly
 * what was published rather than from whatever the catalogue says today.
 */
export const ensureDraft = async (userId: string, planId: string) => {
  await requireOwnedPlan(userId, planId)

  const existing = await prisma.dietVersion.findFirst({
    where: { diet_plan_id: planId, status: 'draft' }
  })
  if (existing) return existing

  const [active, last] = await Promise.all([
    prisma.dietVersion.findFirst({
      where: { diet_plan_id: planId, status: 'active' },
      include: MEAL_INCLUDE
    }),
    prisma.dietVersion.findFirst({
      where: { diet_plan_id: planId },
      orderBy: { version_number: 'desc' },
      select: { version_number: true }
    })
  ])

  const draft = await prisma.dietVersion.create({
    data: {
      diet_plan_id: planId,
      version_number: (last?.version_number ?? 0) + 1,
      status: 'draft',
      target_kcal: active?.target_kcal ?? null,
      target_protein_g: active?.target_protein_g ?? null,
      target_carbs_g: active?.target_carbs_g ?? null,
      target_fat_g: active?.target_fat_g ?? null
    }
  })

  for (const meal of active?.meals ?? []) {
    await prisma.dietMeal.create({
      data: {
        diet_version_id: draft.id,
        name: meal.name,
        order_index: meal.order_index,
        time_of_day: meal.time_of_day,
        day_type: meal.day_type,
        items: {
          create: meal.items.map(item => ({
            food_id: item.food_id,
            food_name: item.food_name,
            quantity_g: item.quantity_g,
            order_index: item.order_index,
            // Copied verbatim: re-reading the Food here would let a catalogue
            // correction leak into what was published.
            nutrients_snapshot: item.nutrients_snapshot
          }))
        }
      }
    })
  }

  await recalcVersionTotals(draft.id)
  return (await prisma.dietVersion.findUnique({ where: { id: draft.id } }))!
}

/**
 * Recomputes and persists a version's totals. Called at the end of every write
 * path — meal and item creates, updates and deletes, and the draft clone.
 */
export const recalcVersionTotals = async (versionId: string) => {
  const version = await prisma.dietVersion.findUnique({
    where: { id: versionId },
    include: MEAL_INCLUDE
  })
  if (!version) return null

  const totals = computeVersionTotals(version.meals)

  return prisma.dietVersion.update({
    where: { id: versionId },
    data: {
      // The hot columns hold the everyday figures; a plan with no
      // training/rest split reports the same numbers in all three buckets.
      total_kcal: totals.all.kcal ?? 0,
      total_protein_g: totals.all.protein_g ?? 0,
      total_carbs_g: totals.all.carbs_g ?? 0,
      total_fat_g: totals.all.fat_g ?? 0,
      totals_json: JSON.stringify(totals)
    }
  })
}

/**
 * Publishes a draft: it becomes the active version from today, and the version
 * it replaces is closed off at today.
 *
 * Ranges are half-open [start_date, end_date), so a version published and then
 * replaced on the same day covers no days at all — exactly right, since it was
 * never followed for a full day — and `resolveVersion` for today unambiguously
 * returns the new one.
 */
export const publishDraft = async (
  userId: string,
  versionId: string,
  options: { change_note?: string | null; targets?: Record<string, number | null> } = {}
) => {
  const version = await requireOwnedVersion(userId, versionId)
  assertDraft(version)

  const today = dayAnchor()
  const targets = options.targets ?? {}

  return prisma.$transaction(async tx => {
    await tx.dietVersion.updateMany({
      where: { diet_plan_id: version.diet_plan_id, status: 'active' },
      data: { status: 'superseded', end_date: today }
    })

    return tx.dietVersion.update({
      where: { id: versionId },
      data: {
        status: 'active',
        start_date: today,
        end_date: null,
        change_note: options.change_note?.trim() || null,
        ...(targets.target_kcal !== undefined && { target_kcal: targets.target_kcal }),
        ...(targets.target_protein_g !== undefined && { target_protein_g: targets.target_protein_g }),
        ...(targets.target_carbs_g !== undefined && { target_carbs_g: targets.target_carbs_g }),
        ...(targets.target_fat_g !== undefined && { target_fat_g: targets.target_fat_g })
      }
    })
  })
}

export const discardDraft = async (userId: string, versionId: string) => {
  const version = await requireOwnedVersion(userId, versionId)
  assertDraft(version)
  await prisma.dietVersion.delete({ where: { id: versionId } })
  return { success: true }
}

/**
 * Finds a version by id, or the one in force on a given date, or the active one.
 * The date branch is what lets the AI answer "what was I eating back then".
 */
export const resolveVersion = async (
  userId: string,
  options: { version_id?: string | null; date?: string | null } = {}
) => {
  if (options.version_id) {
    await requireOwnedVersion(userId, options.version_id)
    return loadVersionFull(options.version_id)
  }

  const plan = await getActivePlan(userId)
  if (!plan) return null

  if (options.date) {
    const at = dayAnchor(options.date)
    return prisma.dietVersion.findFirst({
      where: {
        diet_plan_id: plan.id,
        status: { in: ['active', 'superseded'] },
        start_date: { lte: at },
        OR: [{ end_date: null }, { end_date: { gt: at } }]
      },
      orderBy: { start_date: 'desc' },
      include: MEAL_INCLUDE
    })
  }

  return prisma.dietVersion.findFirst({
    where: { diet_plan_id: plan.id, status: 'active' },
    include: MEAL_INCLUDE
  })
}

// ── Child ownership ───────────────────────────────────────────────────────────

/**
 * Meals and items carry no user_id of their own, so ownership is reached through
 * the parent chain — the same obligation MesocycleEvaluation and AiMessage have.
 */
export const requireDraftMeal = async (userId: string, mealId: string) => {
  const meal = await prisma.dietMeal.findFirst({
    where: { id: mealId, diet_version: { diet_plan: { user_id: userId } } },
    include: { diet_version: true }
  })
  if (!meal) throw createError({ statusCode: 404, statusMessage: 'Comida no encontrada' })
  assertDraft(meal.diet_version)
  return meal
}

export const requireDraftItem = async (userId: string, itemId: string) => {
  const item = await prisma.dietItem.findFirst({
    where: { id: itemId, diet_meal: { diet_version: { diet_plan: { user_id: userId } } } },
    include: { diet_meal: { include: { diet_version: true } } }
  })
  if (!item) throw createError({ statusCode: 404, statusMessage: 'Alimento de la dieta no encontrado' })
  assertDraft(item.diet_meal.diet_version)
  return item
}

// ── Serialisation ─────────────────────────────────────────────────────────────

export const parseTotals = (totalsJson: string | null): VersionTotals | null => {
  if (!totalsJson) return null
  try {
    const parsed = JSON.parse(totalsJson)
    // Rows written before coverage existed have no `coverage` key; treating it
    // as absent is right — `isComplete` then reports "complete", which is the
    // same thing those totals already claimed.
    return parsed?.all ? parsed : null
  } catch {
    return null
  }
}

/** Shapes a version (with meals included) for API responses and AI payloads. */
export const serializeVersion = (version: any, options: { weightKg?: number | null } = {}) => {
  const totals = parseTotals(version.totals_json) ?? computeVersionTotals(version.meals ?? [])
  const hasDaySplit = (version.meals ?? []).some((m: any) => (m.day_type || 'all') !== 'all')

  return {
    id: version.id,
    diet_plan_id: version.diet_plan_id,
    version_number: version.version_number,
    status: version.status,
    start_date: toDateKey(version.start_date),
    end_date: toDateKey(version.end_date),
    change_note: version.change_note,
    targets: {
      kcal: version.target_kcal,
      protein_g: version.target_protein_g,
      carbs_g: version.target_carbs_g,
      fat_g: version.target_fat_g
    },
    totals,
    has_day_split: hasDaySplit,
    macro_split: macroSplit(totals.all),
    protein_g_per_kg: proteinPerKg(totals.all, options.weightKg ?? null),
    meals: (version.meals ?? []).map((meal: any) => ({
      id: meal.id,
      name: meal.name,
      order_index: meal.order_index,
      time_of_day: meal.time_of_day,
      day_type: meal.day_type,
      items: (meal.items ?? []).map((item: any) => ({
        id: item.id,
        food_id: item.food_id,
        food_name: item.food_name,
        quantity_g: item.quantity_g,
        order_index: item.order_index,
        nutrients_snapshot: item.nutrients_snapshot
      }))
    }))
  }
}
