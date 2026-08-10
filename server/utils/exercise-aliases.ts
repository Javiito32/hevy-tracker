import { prisma } from './prisma'

/**
 * The exercise name as the athlete's own Hevy app shows it.
 *
 * Hevy's REST catalogue answers in English whatever language the app is set to,
 * while the workouts the same API returns carry the title as it was logged. So
 * a default exercise reaches this app under two names — "Bench Press (Barbell)"
 * from the catalogue, "Press de banca (Barra)" from the session — and anything
 * pairing a plan with what was performed *by name* matched nothing but custom
 * exercises, which the athlete named themselves, once, in their own language.
 *
 * There is no locale parameter to ask the catalogue for. The translation is
 * instead recovered from the athlete's history: every logged exercise carries
 * both `exercise_template_id` and the localised title, so performing a movement
 * once teaches its name permanently.
 *
 * Two consequences worth keeping:
 *
 * - Names are for reading. Matching goes through `exercise_template_id`, which
 *   is the same string in every language and survives a rename — see
 *   `getAdherence` and `suggestLoad`. The alias is what the athlete *sees*, not
 *   what the code compares.
 * - An exercise never performed has no alias, and there is nothing to invent
 *   one from. The catalogue title stands in, which is why `resolveTitle` falls
 *   back rather than returning null.
 */

/**
 * Case, accents and stray whitespace removed — the fallback used when there is
 * no template id on either side. It cannot bridge two languages (nothing keyed
 * on names can), but it does stop "Press Militar" and "press militar " from
 * reading as two exercises.
 */
export function normalizeExerciseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Relearns every alias for one athlete from their logged workouts.
 *
 * One grouped query over the whole history rather than a write per workout: the
 * same template appears in hundreds of sessions and they nearly all agree. The
 * most recently logged title wins, so renaming an exercise in Hevy propagates
 * on the next sync instead of being outvoted by years of the old name.
 *
 * Runs after every sync and at the end of the offline `rebuild_exercises` job,
 * which is what lets an existing database be corrected without touching Hevy.
 */
export async function refreshTemplateAliases(
  userId: string
): Promise<{ templates: number; written: number }> {
  const rows = await prisma.workoutExercise.groupBy({
    by: ['exercise_template_id', 'name'],
    where: { user_id: userId, exercise_template_id: { not: null } },
    _max: { date: true }
  })

  const latest = new Map<string, { title: string; at: number }>()
  for (const row of rows) {
    const id = row.exercise_template_id
    if (!id || !row.name.trim()) continue
    const at = row._max.date?.getTime() ?? 0
    const current = latest.get(id)
    if (!current || at > current.at) latest.set(id, { title: row.name, at })
  }

  // Only write what changed. The set is stable between syncs, and rewriting
  // every row would churn `updated_at` on a table read on every plan load.
  const existing = await prisma.exerciseTemplateAlias.findMany({
    where: { user_id: userId },
    select: { exercise_template_id: true, title: true }
  })
  const known = new Map(existing.map(a => [a.exercise_template_id, a.title]))

  let written = 0
  for (const [templateId, { title }] of latest) {
    if (known.get(templateId) === title) continue
    await prisma.exerciseTemplateAlias.upsert({
      where: {
        user_id_exercise_template_id: { user_id: userId, exercise_template_id: templateId }
      },
      update: { title },
      create: { user_id: userId, exercise_template_id: templateId, title }
    })
    written++
  }

  return { templates: latest.size, written }
}

/**
 * The athlete's names for the given templates, or for all of them when no ids
 * are passed. Absent from the map means "never logged it", not "same name".
 */
export async function loadTemplateTitles(
  userId: string,
  templateIds?: Array<string | null | undefined>
): Promise<Map<string, string>> {
  let filter: { in: string[] } | undefined
  if (templateIds) {
    const ids = [...new Set(templateIds.filter(Boolean))] as string[]
    if (ids.length === 0) return new Map()
    filter = { in: ids }
  }

  const rows = await prisma.exerciseTemplateAlias.findMany({
    where: { user_id: userId, ...(filter ? { exercise_template_id: filter } : {}) },
    select: { exercise_template_id: true, title: true }
  })
  return new Map(rows.map(r => [r.exercise_template_id, r.title]))
}

/** The athlete's name for a template, falling back to the catalogue's. */
export function resolveTitle(
  aliases: Map<string, string>,
  templateId: string | null | undefined,
  catalogueTitle: string
): string {
  return (templateId && aliases.get(templateId)) || catalogueTitle
}

/**
 * Template ids whose *localised* title matches a search term.
 *
 * The catalogue is searched in English; without this, a query the athlete would
 * actually type — "press banca" — matches nothing, which is what the plan
 * editor's picker and the generator's `search_exercise_templates` both did.
 */
export async function templateIdsMatchingAlias(
  userId: string,
  query: string
): Promise<string[]> {
  if (!query.trim()) return []
  const rows = await prisma.exerciseTemplateAlias.findMany({
    where: { user_id: userId, title: { contains: query } },
    select: { exercise_template_id: true }
  })
  return rows.map(r => r.exercise_template_id)
}
