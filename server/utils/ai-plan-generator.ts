import { prisma } from './prisma'
import {
  buildAthleteProfile,
  buildWorkoutData,
  extractCompoundLiftsData,
  buildNutritionSnapshot,
  type CompoundLift,
  type NutritionSnapshot,
  type Workout
} from './ai-payload'
import {
  renderTaskDocument, serializeAthlete, serializeCompoundLifts, serializeMuscleVolume,
  serializeNutrition, serializeWorkouts, table
} from './ai-serialize'
import { runAiTask, parseAiJson } from './ai-service'
import type { AiKeys, AiProvider } from './ai-provider'
import { MESOCYCLE_GENERATE_PROMPT } from './ai-prompts'
import { MAX_OUTPUT_TOKENS } from './ai-config'
import { SEARCH_TEMPLATES_TOOL, searchExerciseTemplates } from './exercise-search'
import { buildMuscleVolumeReport } from './muscle-volume'
import { validateGeneratedMesocycle, type ValidatedPlan } from './ai-plan-validator'

/**
 * Mesocycle generation, extracted from the endpoint so it can run as a
 * background job.
 *
 * It is the app's longest single AI task by a wide margin: several rounds of
 * catalogue lookups, each a separately billed model call that reasons before it
 * answers, followed by a final turn emitting the whole block as JSON. Minutes,
 * not seconds — past any reverse proxy's read timeout, which is what turned a
 * working generation into a 504 with nothing to show for the tokens spent.
 *
 * The output is the one place in the app where a model's answer becomes rows in
 * the athlete's plan, so it is the one place with a dedicated validator between
 * the two — see ai-plan-validator.ts.
 */

export interface PlanRequest {
  goal: string
  days_per_week: number
  duration_weeks: number
  equipment?: string
}

export interface PlanResult {
  plan: ValidatedPlan
  /** Present when the plan departs from the request or lost an exercise id. */
  warning?: string
  model: string
  tokens_used: number
}

export async function generateMesocyclePlan(
  userId: string,
  keys: AiKeys,
  request: PlanRequest,
  progress?: (message: string) => Promise<void>,
  provider?: AiProvider
): Promise<PlanResult> {
  await progress?.('Reuniendo tu historial de entrenamiento…')

  const [athlete, recentWorkoutRows, previousMesocycles, nutrition] = await Promise.all([
    // Injuries are the reason this task exists in its current shape: a block
    // designed around a shoulder that can't press is a different block.
    buildAthleteProfile(userId, { includeInjuries: true }),
    prisma.workout.findMany({
      where: { user_id: userId },
      take: 5,
      orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true, duration: true }
    }),
    prisma.mesocycle.findMany({
      where: { user_id: userId, status: { in: ['completed', 'paused'] } },
      orderBy: { start_date: 'desc' },
      take: 2,
      select: { name: true, goal: true, split_description: true, target_sessions_weekly: true }
    }),
    buildNutritionSnapshot(userId)
  ])

  const recentWorkouts: Workout[] = recentWorkoutRows.map(w => buildWorkoutData(w, true))
  const compoundLifts: CompoundLift[] = extractCompoundLiftsData(recentWorkoutRows)

  // The athlete's actual set distribution, so the new block corrects what the
  // last one under- or over-trained instead of restating a generic template.
  const muscleVolume = await buildMuscleVolumeReport(userId, 8)

  const document = buildGenerationDocument({
    request,
    athlete: serializeAthlete(athlete),
    recentWorkouts,
    compoundLifts,
    previousMesocycles,
    nutrition,
    muscleVolume: muscleVolume.averages
  })

  await progress?.('Diseñando el bloque y buscando ejercicios en el catálogo…')

  // Every id the catalogue search actually handed over. The validator accepts
  // no other: an id the model produced from memory looks exactly like a real
  // one and fails only at push time, in the athlete's Hevy account.
  const offeredIds = new Set<string>()

  const { content, model, tokensUsed } = await runAiTask({
    keys,
    userId,
    task: 'mesocycle_generate',
    systemPrompt: MESOCYCLE_GENERATE_PROMPT,
    payload: document,
    maxOutputTokens: MAX_OUTPUT_TOKENS.planGeneration,
    jsonMode: true,
    ...(provider && { provider }),
    // The catalogue is ~400 entries — too many for the prompt, and a made-up id
    // yields a plan that looks fine and fails on push. So it looks them up.
    tools: [SEARCH_TEMPLATES_TOOL],
    toolImpls: {
      search_exercise_templates: async (args) => {
        const result = await searchExerciseTemplates(userId, args)
        for (const hit of result.results) offeredIds.add(hit.id)
        return result
      }
    },
    maxToolIterations: 6,
    onToolRound: async (round) => {
      await progress?.(`Buscando ejercicios en el catálogo (ronda ${round})…`)
    }
  })

  await progress?.('Comprobando el plan…')

  const raw = parseAiJson<any>(content, 'generar el plan')

  // Only ids that are still in the catalogue survive; `savePlan` would drop the
  // rest anyway, but silently and much later.
  const knownTemplateIds = offeredIds.size
    ? new Set((await prisma.exerciseTemplate.findMany({
        where: { id: { in: [...offeredIds] } },
        select: { id: true }
      })).map(t => t.id))
    : new Set<string>()

  const plan = validateGeneratedMesocycle(raw, {
    durationWeeks: request.duration_weeks,
    daysPerWeek: request.days_per_week,
    allowedTemplateIds: offeredIds,
    knownTemplateIds
  })

  // Exercises with no id still train fine; they just can't be pushed to Hevy.
  const unlinked = plan.sessions.flatMap(s => s.exercises.filter(e => !e.exercise_template_id).map(e => e.name))
  const notices = [
    ...plan.warnings,
    ...(unlinked.length
      ? [`${unlinked.length} ejercicio(s) sin identificar en el catálogo (${unlinked.slice(0, 4).join(', ')}): el plan es válido, pero no se podrá enviar a Hevy hasta resolverlos.`]
      : []),
    ...plan.repairs
  ]

  return {
    plan,
    model,
    tokens_used: tokensUsed,
    ...(notices.length && { warning: notices.join(' ') })
  }
}

/** The task document. Sections are named as the prompt refers to them. */
function buildGenerationDocument(input: {
  request: PlanRequest
  athlete: string
  recentWorkouts: Workout[]
  compoundLifts: CompoundLift[]
  previousMesocycles: Array<{ name: string; goal: string | null; split_description: string | null; target_sessions_weekly: number | null }>
  nutrition?: NutritionSnapshot
  muscleVolume: Array<{ muscle: string; label: string; avg_sets: number; verdict: string; landmarks?: { mev: number; mav: number; mrv: number } | null }>
}): string {
  const { request } = input
  return renderTaskDocument('generar mesociclo', new Date().toISOString().substring(0, 10), [
    ['PETICIÓN', [
      `objetivo: ${request.goal}`,
      `días por semana: ${request.days_per_week}`,
      `duración: ${request.duration_weeks} semanas`,
      request.equipment ? `equipamiento disponible: ${request.equipment}` : null
    ].filter(Boolean).join('\n')],
    ['PERFIL', input.athlete],
    ['FUERZA ACTUAL (1RM ESTIMADOS)', input.compoundLifts.length ? serializeCompoundLifts(input.compoundLifts) : null],
    ['ENTRENOS RECIENTES', input.recentWorkouts.length ? serializeWorkouts(input.recentWorkouts, { detail: 'sets' }) : null],
    ['MESOCICLOS ANTERIORES', input.previousMesocycles.length
      ? table(
          ['nombre', 'objetivo', 'sesiones/sem', 'split'],
          input.previousMesocycles.map(m => [m.name, m.goal, m.target_sessions_weekly, m.split_description])
        )
      : null],
    ['VOLUMEN POR GRUPO MUSCULAR', input.muscleVolume.length
      ? serializeMuscleVolume(input.muscleVolume.map(a => ({
          muscle: a.muscle,
          label: a.label,
          avg_weekly_sets: a.avg_sets,
          verdict: a.verdict,
          ...(a.landmarks && { mev: a.landmarks.mev, mav: a.landmarks.mav, mrv: a.landmarks.mrv })
        })))
      : null],
    ['DIETA', input.nutrition ? serializeNutrition(input.nutrition) : null]
  ])
}
