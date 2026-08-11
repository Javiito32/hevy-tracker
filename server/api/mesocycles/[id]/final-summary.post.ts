import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildAthleteProfile, buildWorkoutData, buildNutritionSnapshot, buildNutritionHistory, type FinalSummaryPayload } from '../../../utils/ai-payload'
import { renderFinalSummary } from '../../../utils/ai-serialize'
import { runAiTask, aiKeysFromConfig } from '../../../utils/ai-service'
import { FINAL_SUMMARY_PROMPT } from '../../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID required' })

  const mesocycle = await prisma.mesocycle.findFirst({ where: { id, user_id: userId } })
  if (!mesocycle) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  // A completed block is summarised as of its end date: the diet and the body
  // that belong in the story are the ones the block was trained with.
  const asOf = mesocycle.end_date && mesocycle.end_date < new Date() ? mesocycle.end_date : new Date()

  const [athlete, allWorkouts, allEvaluations, allNotes, nutrition, nutritionHistory] = await Promise.all([
    buildAthleteProfile(userId, { asOf }),
    prisma.workout.findMany({
      where: { user_id: userId, mesocycle_id: id },
      orderBy: { date: 'asc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true, duration: true }
    }),
    prisma.mesocycleEvaluation.findMany({
      where: { mesocycle_id: id },
      orderBy: { week_number: 'asc' },
      select: { week_number: true, summary: true, volume_trend: true, recommendations: true }
    }),
    prisma.mesocycleNote.findMany({
      where: { mesocycle_id: id },
      orderBy: { date: 'asc' }
    }),
    buildNutritionSnapshot(userId, { asOf }),
    buildNutritionHistory(userId)
  ])

  const totalVolume = allWorkouts.reduce((s, w) => s + Number(w.total_volume ?? 0), 0)
  const workoutsWithRpe = allWorkouts.filter(w => w.rpe_avg)
  const avgRpe = workoutsWithRpe.length
    ? workoutsWithRpe.reduce((s, w) => s + (w.rpe_avg ?? 0), 0) / workoutsWithRpe.length
    : 0

  const durationDays = mesocycle.end_date
    ? Math.round((new Date(mesocycle.end_date).getTime() - new Date(mesocycle.start_date).getTime()) / (24 * 60 * 60 * 1000))
    : Math.round((Date.now() - new Date(mesocycle.start_date).getTime()) / (24 * 60 * 60 * 1000))

  const firstWorkout = allWorkouts[0]
  const lastWorkout = allWorkouts[allWorkouts.length - 1]

  const payload: FinalSummaryPayload = {
    task: 'final_summary',
    today: new Date().toISOString().substring(0, 10),
    athlete,
    mesocycle: {
      name: mesocycle.name,
      ...(mesocycle.goal && { goal: mesocycle.goal }),
      ...(mesocycle.split_description && { split: mesocycle.split_description })
    },
    stats: {
      duration_days: durationDays,
      duration_weeks: Math.round(durationDays / 7),
      total_sessions: allWorkouts.length,
      total_volume_kg: Math.round(totalVolume),
      avg_rpe: parseFloat(avgRpe.toFixed(1))
    },
    ...(firstWorkout && { first_workout: buildWorkoutData(firstWorkout, true) }),
    ...(lastWorkout && lastWorkout !== firstWorkout && { last_workout: buildWorkoutData(lastWorkout, true) }),
    weekly_evaluations: allEvaluations.map(e => ({
      week: e.week_number,
      ...(e.summary && { summary: e.summary }),
      ...(e.volume_trend && { volume_trend: e.volume_trend }),
      ...(e.recommendations && { recommendations: e.recommendations })
    })),
    diary_notes: allNotes.map((n: any) => ({
      date: new Date(n.date).toISOString().substring(0, 10),
      content: n.content
    })),
    ...(nutrition && { nutrition }),
    ...(nutritionHistory.length > 0 && { nutrition_history: nutritionHistory })
  }

  const { content: finalSummary, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    task: 'final_summary',
    systemPrompt: FINAL_SUMMARY_PROMPT,
    payload: renderFinalSummary(payload),
    maxOutputTokens: MAX_OUTPUT_TOKENS.finalSummary
  })

  await prisma.mesocycle.update({ where: { id }, data: { final_summary: finalSummary, final_summary_model: model } })

  return { success: true, final_summary: finalSummary, model }
})
