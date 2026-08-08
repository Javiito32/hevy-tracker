import { prisma } from './prisma'
import { MUSCLE_LABELS, parseSecondaryMuscles } from './muscle-groups'

/**
 * Catalogue search, used by the plan generator.
 *
 * The generator must return REAL `exercise_template_id`s or the plan can never
 * be pushed to Hevy. The catalogue is ~400 entries, far too many to inline in a
 * prompt, and letting the model invent ids produces plausible-looking rows that
 * fail on push. So it searches instead — the same pattern the chat already uses
 * for workout data.
 */

const MAX_RESULTS = 25

export interface TemplateHit {
  id: string
  title: string
  primary_muscle_group: string
  primary_label: string
  secondary_muscle_groups: string[]
  equipment_category: string | null
  /** Sessions the athlete has logged of it — a familiar lift beats a novel one. */
  familiarity: number
}

export async function searchExerciseTemplates(
  userId: string,
  args: { query?: string; muscle_group?: string; equipment?: string; limit?: number }
): Promise<{ count: number; results: TemplateHit[]; note?: string }> {
  const limit = Math.min(MAX_RESULTS, Math.max(1, Number(args.limit) || 12))

  const where: any = {
    // Global catalogue plus this user's custom exercises — never another user's.
    OR: [{ user_id: null }, { user_id: userId }]
  }
  if (args.query) where.title = { contains: args.query }
  if (args.muscle_group) where.primary_muscle_group = args.muscle_group
  if (args.equipment) where.equipment_category = args.equipment

  const templates = await prisma.exerciseTemplate.findMany({
    where,
    take: limit * 3,
    select: {
      id: true, title: true, primary_muscle_group: true,
      secondary_muscle_groups: true, equipment_category: true
    }
  })

  if (templates.length === 0) {
    const total = await prisma.exerciseTemplate.count()
    return {
      count: 0,
      results: [],
      note: total === 0
        ? 'El catálogo de ejercicios está vacío. Un administrador debe sincronizarlo desde el panel antes de poder proponer ejercicios enlazados.'
        : 'Ningún ejercicio coincide. Prueba con un término más corto o filtra solo por muscle_group.'
    }
  }

  // Rank by how often the athlete has actually done each one: a plan built from
  // movements they already perform is one they can execute on day one.
  const counts = await prisma.workoutExercise.groupBy({
    by: ['exercise_template_id'],
    where: { user_id: userId, exercise_template_id: { in: templates.map(t => t.id) } },
    _count: { _all: true }
  })
  const familiarity = new Map(counts.map(c => [c.exercise_template_id, c._count._all]))

  const results = templates
    .map(t => ({
      id: t.id,
      title: t.title,
      primary_muscle_group: t.primary_muscle_group,
      primary_label: MUSCLE_LABELS[t.primary_muscle_group] ?? t.primary_muscle_group,
      secondary_muscle_groups: parseSecondaryMuscles(t.secondary_muscle_groups),
      equipment_category: t.equipment_category,
      familiarity: familiarity.get(t.id) ?? 0
    }))
    .sort((a, b) => b.familiarity - a.familiarity || a.title.localeCompare(b.title))
    .slice(0, limit)

  return { count: results.length, results }
}

export const SEARCH_TEMPLATES_TOOL = {
  name: 'search_exercise_templates',
  description: `Busca ejercicios reales en el catálogo de Hevy del usuario. DEBES usar esta herramienta para obtener los "exercise_template_id" de cada ejercicio que propongas: son obligatorios para que el plan pueda enviarse a Hevy, y un id inventado hace que el plan falle al enviarlo.

Filtra por texto ("query"), por grupo muscular ("muscle_group": chest, lats, upper_back, traps, lower_back, shoulders, biceps, triceps, forearms, abdominals, quadriceps, hamstrings, glutes, calves, abductors, adductors) o por equipamiento ("equipment": barbell, dumbbell, machine, cable, kettlebell, plate, resistance_band, suspension, none, other).

"familiarity" indica cuántas veces lo ha entrenado el usuario: en igualdad de condiciones prefiere ejercicios que ya conoce.`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Texto a buscar en el nombre (ej. "press banca", "curl")' },
      muscle_group: { type: 'string', description: 'Filtrar por grupo muscular primario' },
      equipment: { type: 'string', description: 'Filtrar por categoría de equipamiento' },
      limit: { type: 'number', description: 'Máximo de resultados (1-25, default 12)' }
    }
  }
}
