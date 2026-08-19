import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import {
  buildAthleteProfile, buildHistoricalReference, buildWorkoutData, type WorkoutAnalysisPayload
} from '../../../utils/ai-payload'
import { renderWorkoutAnalysis } from '../../../utils/ai-serialize'
import { runAiTask, aiKeysFromConfig } from '../../../utils/ai-service'
import { WORKOUT_ANALYSIS_PROMPT } from '../../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../../utils/ai-config'
import { localDayKey } from '../../../utils/dates'
import { matchWorkoutToPlan } from '../../../utils/plan-service'

/**
 * Analyses one session.
 *
 * Two things about it are dated to **the session**, not to now:
 *
 *  - the athlete profile (`asOf`), so re-analysing a workout from March cites
 *    the body the athlete had in March. It used to load the current profile,
 *    which produced sentences like "con tu peso actual de 84 kg" about a
 *    session trained eight kilos ago, and read notes written months afterwards
 *    as context for it;
 *  - the mesocycle, which is the block the workout belongs to rather than
 *    whichever block happens to be active today. An old session judged against
 *    today's goal is judged against a goal that did not exist yet.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'Workout ID is required' })

  const workout = await prisma.workout.findFirst({ where: { id, user_id: userId } })
  if (!workout) throw createError({ statusCode: 404, statusMessage: 'Workout not found' })

  const [athlete, mesocycle, historicalReference, prescribed] = await Promise.all([
    buildAthleteProfile(userId, { asOf: workout.date }),
    workout.mesocycle_id
      ? prisma.mesocycle.findFirst({ where: { id: workout.mesocycle_id, user_id: userId } })
      // A session logged outside any block still benefits from knowing what the
      // athlete was working towards at the time.
      : prisma.mesocycle.findFirst({
          where: {
            user_id: userId,
            start_date: { lte: workout.date },
            OR: [{ end_date: null }, { end_date: { gte: workout.date } }]
          },
          orderBy: { start_date: 'desc' }
        }),
    // Candidates chosen by the exercises this session contains, then limited —
    // not the last five workouts filtered afterwards. See ai-payload.ts.
    buildHistoricalReference(userId, workout),
    workout.mesocycle_id
      ? matchWorkoutToPlan(userId, workout.mesocycle_id, workout.id)
      : Promise.resolve(null)
  ])

  // A session logged outside any block can still match the plan that was in
  // force that day — same lookup used for the mesocycle heading above.
  const prescribedOrDated = prescribed ?? (
    mesocycle && !workout.mesocycle_id
      ? await matchWorkoutToPlan(userId, mesocycle.id, workout.id)
      : null
  )

  const payload: WorkoutAnalysisPayload = {
    task: 'workout_analysis',
    today: localDayKey(new Date()),
    athlete,
    workout: buildWorkoutData(workout),
    ...(historicalReference.length && { historical_reference: historicalReference }),
    ...(mesocycle && {
      active_mesocycle: {
        name: mesocycle.name,
        ...(mesocycle.goal && { goal: mesocycle.goal }),
        ...(mesocycle.split_description && { split: mesocycle.split_description })
      }
    }),
    ...(prescribedOrDated && { prescribed: prescribedOrDated })
  }

  const { content, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    task: 'analyze',
    systemPrompt: WORKOUT_ANALYSIS_PROMPT,
    payload: renderWorkoutAnalysis(payload),
    maxOutputTokens: MAX_OUTPUT_TOKENS.analysis
  })

  const analysis = content || 'No se pudo generar el análisis.'
  await prisma.workout.update({ where: { id }, data: { ai_analysis: analysis, ai_model: model } })

  return { success: true, analysis, model }
})
