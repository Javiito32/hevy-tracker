import { prisma } from './prisma'
import {
  computeVersionTotals,
  macroSplit,
  proteinPerKg,
  isWeekday,
  WEEKDAYS,
  WEEKDAY_LABELS_ES,
  MICRO_KEYS,
  type VersionTotals,
  type Weekday
} from './nutrition-calculator'

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

/**
 * The single ordering source for every read path. Meals sort by weekday first,
 * then by their position within that day — `order_index` is scoped to a day, not
 * to the version — so a consumer can group by weekday without re-sorting.
 */
const MEAL_INCLUDE = {
  meals: {
    orderBy: [{ weekday: 'asc' as const }, { order_index: 'asc' as const }],
    include: { items: { orderBy: { order_index: 'asc' as const } } }
  },
  day_targets: { orderBy: { weekday: 'asc' as const } }
}

/**
 * Validates a weekday off a request body, or 400s.
 *
 * Deliberately NOT a silent fallback to Monday, which is what the `day_type` it
 * replaced did with an unrecognised value. That was harmless when every meal
 * meant 'all'; here it would drop the meal on Monday while the user watches the
 * Thursday tab not change, with no error anywhere. A 400 makes that visible.
 */
export const parseWeekday = (raw: unknown): Weekday => {
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (!isWeekday(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'El día de la semana debe ser un número del 1 (lunes) al 7 (domingo)'
    })
  }
  return value
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
 *
 * The copy spans all seven weekdays and the per-day target overrides, so editing
 * a published diet never quietly loses the days the user isn't looking at.
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

  if (active?.day_targets?.length) {
    await prisma.dietDayTarget.createMany({
      data: active.day_targets.map(t => ({
        diet_version_id: draft.id,
        weekday: t.weekday,
        target_kcal: t.target_kcal,
        target_protein_g: t.target_protein_g,
        target_carbs_g: t.target_carbs_g,
        target_fat_g: t.target_fat_g
      }))
    })
  }

  for (const meal of active?.meals ?? []) {
    await prisma.dietMeal.create({
      data: {
        diet_version_id: draft.id,
        name: meal.name,
        weekday: meal.weekday,
        order_index: meal.order_index,
        time_of_day: meal.time_of_day,
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
      // The hot columns hold the MEAN of a planned day, not a weekly sum: they
      // are read straight against target_* (which is daily) and plotted as one
      // point per version in the history chart. `planned_days` travels with them
      // so no reader ever shows the mean without saying what it averages.
      total_kcal: totals.average.kcal ?? 0,
      total_protein_g: totals.average.protein_g ?? 0,
      total_carbs_g: totals.average.carbs_g ?? 0,
      total_fat_g: totals.average.fat_g ?? 0,
      planned_days: totals.planned_days.length,
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

// ── Weekday operations ────────────────────────────────────────────────────────

/**
 * Makes the target weekdays an exact copy of the source one.
 *
 * **Replaces, never merges.** The button this serves says "make Tuesday look
 * like Monday"; merging would leave two Desayunos to delete by hand, with no
 * undo. Being destructive is the reason CopyDayModal names every day it is about
 * to overwrite and counts the meals each one loses before the click.
 *
 * Snapshots are copied verbatim as strings — re-reading Food here would reprice
 * a published-then-drafted day against today's catalogue, the same trap
 * ensureDraft avoids.
 */
export const copyWeekday = async (versionId: string, from: Weekday, to: Weekday[]) => {
  const targets = to.filter(d => d !== from)
  if (targets.length === 0) return { copied: 0 }

  return prisma.$transaction(
    async tx => {
      const source = await tx.dietMeal.findMany({
        where: { diet_version_id: versionId, weekday: from },
        orderBy: { order_index: 'asc' },
        include: { items: { orderBy: { order_index: 'asc' } } }
      })

      // Items go with their meals through onDelete: Cascade.
      await tx.dietMeal.deleteMany({
        where: { diet_version_id: versionId, weekday: { in: targets } }
      })

      for (const weekday of targets) {
        for (const meal of source) {
          await tx.dietMeal.create({
            data: {
              diet_version_id: versionId,
              name: meal.name,
              weekday,
              order_index: meal.order_index,
              time_of_day: meal.time_of_day,
              items: {
                create: meal.items.map(item => ({
                  food_id: item.food_id,
                  food_name: item.food_name,
                  quantity_g: item.quantity_g,
                  order_index: item.order_index,
                  nutrients_snapshot: item.nutrients_snapshot
                }))
              }
            }
          })
        }
      }

      return { copied: targets.length }
    },
    // Six target days of a five-meal, six-food plan is ~216 inserts, past the
    // 5 s default on a cold SQLite file.
    { timeout: 15000 }
  )
}

/**
 * The targets in force on one weekday: the override where there is one, the
 * version's own target otherwise. Resolved here so no client repeats the
 * fallback and gets it subtly different.
 */
export const effectiveTarget = (
  version: { target_kcal?: number | null; target_protein_g?: number | null; target_carbs_g?: number | null; target_fat_g?: number | null; day_targets?: any[] },
  weekday: Weekday
) => {
  const override = (version.day_targets ?? []).find((t: any) => t.weekday === weekday)
  return {
    kcal: override?.target_kcal ?? version.target_kcal ?? null,
    protein_g: override?.target_protein_g ?? version.target_protein_g ?? null,
    carbs_g: override?.target_carbs_g ?? version.target_carbs_g ?? null,
    fat_g: override?.target_fat_g ?? version.target_fat_g ?? null,
    /** True when at least one macro on this day departs from the base target. */
    overridden: !!override
  }
}

/**
 * Writes (or clears) the per-day target override for one or more weekdays.
 *
 * A row whose four values are all null is deleted rather than stored: "no
 * override" and "an override that overrides nothing" must not be two states, or
 * the UI would have to render a difference the user can't see.
 */
export const saveDayTargets = async (
  versionId: string,
  weekdays: Weekday[],
  values: {
    target_kcal?: number | null
    target_protein_g?: number | null
    target_carbs_g?: number | null
    target_fat_g?: number | null
  }
) => {
  const empty =
    values.target_kcal == null &&
    values.target_protein_g == null &&
    values.target_carbs_g == null &&
    values.target_fat_g == null

  for (const weekday of weekdays) {
    if (empty) {
      await prisma.dietDayTarget.deleteMany({ where: { diet_version_id: versionId, weekday } })
      continue
    }
    await prisma.dietDayTarget.upsert({
      where: { diet_version_id_weekday: { diet_version_id: versionId, weekday } },
      create: { diet_version_id: versionId, weekday, ...values },
      update: values
    })
  }
}

// ── Serialisation ─────────────────────────────────────────────────────────────

export const parseTotals = (totalsJson: string | null): VersionTotals | null => {
  if (!totalsJson) return null
  try {
    const parsed = JSON.parse(totalsJson)
    // Totals in the pre-weekday shape ({"all","training","rest"}) return null on
    // purpose. serializeVersion then recomputes from the meals, which before the
    // fan-out job means "everything on Monday" — the truthful reading of an
    // unmigrated row, and self-healing the moment the job runs. Synthesising
    // seven identical days from `all` instead would disguise an unmigrated
    // database and make the job look optional.
    return parsed?.days ? parsed : null
  } catch {
    return null
  }
}

/** A meal as the API and the AI serializers both see it. */
const serializeMeal = (meal: any) => ({
  id: meal.id,
  name: meal.name,
  weekday: meal.weekday,
  order_index: meal.order_index,
  time_of_day: meal.time_of_day,
  items: (meal.items ?? []).map((item: any) => ({
    id: item.id,
    food_id: item.food_id,
    food_name: item.food_name,
    quantity_g: item.quantity_g,
    order_index: item.order_index,
    nutrients_snapshot: item.nutrients_snapshot
  }))
})

/**
 * What makes two weekdays "the same day": the meals in order, each with its
 * name, time and foods in grams. Rounded to the gram because a plan is not
 * prescribed to a tenth, and a 0.1 g difference splitting a group would show the
 * user two identical-looking days side by side.
 */
const daySignature = (meals: any[]): string =>
  JSON.stringify(
    meals.map(m => [
      m.name,
      m.time_of_day ?? '',
      (m.items ?? []).map((i: any) => [i.food_name, Math.round(i.quantity_g)])
    ])
  )

/**
 * Collapses identical weekdays into groups, in weekday order.
 *
 * One definition of "identical" shared by the history card and both AI payloads:
 * a real diet has two or three distinct patterns, so this is also the entire
 * token strategy for sending a seven-day plan to a model.
 */
export const buildDayGroups = (meals: any[]) => {
  const byDay = new Map<Weekday, any[]>(WEEKDAYS.map(d => [d, []]))
  for (const meal of meals ?? []) {
    if (isWeekday(meal.weekday)) byDay.get(meal.weekday)!.push(meal)
  }

  const groups: Array<{ weekdays: Weekday[]; signature: string; meals: any[] }> = []
  for (const weekday of WEEKDAYS) {
    const dayMeals = byDay.get(weekday)!
    // A day with no food is not "the same as" another empty day in any useful
    // sense — grouping them would produce a "Sáb · Dom" heading over nothing.
    if (dayMeals.every(m => (m.items ?? []).length === 0)) continue

    const signature = daySignature(dayMeals)
    const existing = groups.find(g => g.signature === signature)
    if (existing) existing.weekdays.push(weekday)
    else groups.push({ weekdays: [weekday], signature, meals: dayMeals.map(serializeMeal) })
  }

  return groups.map(({ weekdays, meals }) => ({ weekdays, meals }))
}

/**
 * Shapes a version (with meals included) for API responses and AI payloads.
 *
 * `meals` stays FLAT, each carrying its weekday, and the page filters. Grouping
 * server-side would churn MealEditor, AddFoodModal and DietVersionCard for
 * nothing — they all still want the meal object they already handle. What the
 * server does add is `days`, so no client has to repeat the target fallback or
 * the 4/4/9 arithmetic per weekday.
 */
export const serializeVersion = (version: any, options: { weightKg?: number | null } = {}) => {
  const totals = parseTotals(version.totals_json) ?? computeVersionTotals(version.meals ?? [])
  const weightKg = options.weightKg ?? null

  return {
    id: version.id,
    diet_plan_id: version.diet_plan_id,
    version_number: version.version_number,
    status: version.status,
    start_date: toDateKey(version.start_date),
    end_date: toDateKey(version.end_date),
    change_note: version.change_note,
    /** The base target. Days that depart from it carry their own in `days`. */
    targets: {
      kcal: version.target_kcal,
      protein_g: version.target_protein_g,
      carbs_g: version.target_carbs_g,
      fat_g: version.target_fat_g
    },
    totals,
    planned_days: totals.planned_days,
    macro_split: macroSplit(totals.average),
    protein_g_per_kg: proteinPerKg(totals.average, weightKg),
    days: WEEKDAYS.map(weekday => {
      const day = totals.days[String(weekday)]
      return {
        weekday,
        planned: (day?.items ?? 0) > 0,
        meals_count: day?.meals ?? 0,
        items_count: day?.items ?? 0,
        totals: day?.nutrients ?? null,
        coverage: day?.coverage ?? {},
        macro_split: day ? macroSplit(day.nutrients) : null,
        protein_g_per_kg: day ? proteinPerKg(day.nutrients, weightKg) : null,
        target: effectiveTarget(version, weekday)
      }
    }),
    day_groups: buildDayGroups(version.meals ?? []),
    meals: (version.meals ?? []).map(serializeMeal)
  }
}

// ── AI serialisation ──────────────────────────────────────────────────────────

const weekdayName = (weekday: Weekday) => WEEKDAY_LABELS_ES[weekday].toLowerCase()

const macrosOf = (n: any) =>
  n ? { kcal: n.kcal, protein_g: n.protein_g, carbs_g: n.carbs_g, fat_g: n.fat_g } : null

export interface DietAiOptions {
  weightKg?: number | null
  /**
   * 'full' sends every distinct day's meals — for `get_diet`, which the model
   * called on purpose. 'representative' sends the macro line of every day but
   * the meals of only the most common one, for the snapshot that rides in every
   * context payload.
   */
  detail: 'full' | 'representative'
}

/**
 * The one place a diet is shaped for a model.
 *
 * `get_diet` and `buildNutritionSnapshot` were near-identical copies before the
 * weekday split, and both would now need the same non-trivial day collapsing.
 * Two copies would drift exactly where it costs most: the model would see one
 * set of figures in its permanent context and another from its own tool call,
 * with no way to tell which is right.
 *
 * **Identical days are collapsed into groups** — that is the whole token
 * strategy for a seven-day plan. A real diet has two or three distinct patterns
 * (weekdays vs weekend, training vs rest), so the payload lands near what a
 * single-day plan used to cost.
 */
export const serializeDietForAi = (version: any, options: DietAiOptions) => {
  const s = serializeVersion(version, { weightKg: options.weightKg ?? null })

  // Only micros with data are emitted. An omitted one means the food data is
  // incomplete, not that the plan provides zero — sending 0 would invite the
  // model to diagnose a deficiency that isn't in evidence. Micros backed by only
  // some of the foods travel with an explicit "lower bound" warning, which the
  // weekly mean makes more necessary, not less: averaging understates twice.
  const micronutrients: Record<string, number> = {}
  const micronutrientsPartial: Record<string, string> = {}
  for (const key of MICRO_KEYS) {
    const value = (s.totals.average as any)[key]
    if (value == null) continue
    micronutrients[key] = value
    const entry = s.totals.average_coverage?.[key]
    if (entry && entry.known < entry.total) {
      micronutrientsPartial[key] = `mínimo: solo ${entry.known} de ${entry.total} alimentos tienen este dato`
    }
  }

  const groups = s.day_groups
  // The group covering most days is the one worth spelling out when the payload
  // has to stay small. Ties go to the earlier weekday, which `day_groups`
  // ordering already gives us.
  const representative = groups.reduce(
    (best, g) => (best && best.weekdays.length >= g.weekdays.length ? best : g),
    groups[0]
  )

  const mealsOf = (group: { meals: any[] }) =>
    group.meals
      .filter(m => (m.items ?? []).length > 0)
      .map(meal => ({
        name: meal.name,
        ...(meal.time_of_day && { time_of_day: meal.time_of_day }),
        foods: meal.items.map((item: any) => ({ name: item.food_name, quantity_g: item.quantity_g }))
      }))

  const dayTargets = s.days
    .filter(d => d.target.overridden)
    .map(d => ({
      weekday: weekdayName(d.weekday),
      kcal: d.target.kcal,
      protein_g: d.target.protein_g,
      carbs_g: d.target.carbs_g,
      fat_g: d.target.fat_g
    }))

  return {
    is_plan_not_log: true,
    version_id: s.id,
    version_number: s.version_number,
    status: s.status,
    ...(s.start_date && { from: s.start_date }),
    ...(s.end_date && { to: s.end_date }),
    ...(Object.values(s.targets).some(v => v != null) && { targets: s.targets }),
    ...(dayTargets.length > 0 && { targets_by_weekday: dayTargets }),

    /** Mean of a PLANNED day. Not a weekly total, and not a mean over seven. */
    daily_totals: { ...macrosOf(s.totals.average), ...micronutrients },
    planned_days_per_week: s.planned_days.length,
    planned_weekdays: s.planned_days.map(weekdayName),
    ...(Object.keys(micronutrientsPartial).length > 0 && { micronutrients_partial: micronutrientsPartial }),
    ...(s.macro_split.protein_pct != null && {
      macro_split_pct: {
        protein: s.macro_split.protein_pct,
        carbs: s.macro_split.carbs_pct,
        fat: s.macro_split.fat_pct
      }
    }),
    ...(s.protein_g_per_kg != null && { protein_g_per_kg: s.protein_g_per_kg }),

    /** One line per distinct day pattern, always complete. */
    days: groups.map(g => ({
      weekdays: g.weekdays.map(weekdayName),
      ...macrosOf(s.days.find(d => d.weekday === g.weekdays[0])?.totals)
    })),

    ...(options.detail === 'full'
      ? {
          meals_by_day: groups.map(g => ({
            weekdays: g.weekdays.map(weekdayName),
            meals: mealsOf(g)
          }))
        }
      : {
          // Always present, even for a diet with no food at all: a consumer that
          // has to check whether `meals` exists ends up guessing what its
          // absence means.
          meals: representative ? mealsOf(representative) : [],
          ...(representative && { meals_apply_to: representative.weekdays.map(weekdayName) }),
          // Stated rather than implied: without this the model answers about
          // Saturday using Monday's foods, which is the whole risk of sending a
          // representative day instead of all of them.
          meals_other_days_omitted: groups.length > 1,
          ...(groups.length > 1 && {
            note: 'Solo se detallan las comidas del patrón de día más frecuente. Usa get_diet para ver las de un día concreto.'
          })
        })
  }
}
