import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildAthleteProfile, buildWorkoutData, type WorkoutAnalysisPayload } from '../../../utils/ai-payload'
import { runAiTask, aiKeysFromConfig } from '../../../utils/ai-service'
import { WORKOUT_ANALYSIS_PROMPT } from '../../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'Workout ID is required' })

  const workout = await prisma.workout.findFirst({ where: { id, user_id: userId } })
  if (!workout) throw createError({ statusCode: 404, statusMessage: 'Workout not found' })

  const exercises: any[] = workout.exercises_summary ? JSON.parse(workout.exercises_summary) : []
  const exerciseNames = exercises.map((e: any) => e.name)

  const fourWeeksAgo = new Date(workout.date)
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 35)
  const fourWeeksAgoEnd = new Date(workout.date)
  fourWeeksAgoEnd.setDate(fourWeeksAgoEnd.getDate() - 21)

  const [athlete, activeMesocycle, historicalWorkouts] = await Promise.all([
    buildAthleteProfile(userId),
    prisma.mesocycle.findFirst({ where: { user_id: userId, status: 'active' } }),
    prisma.workout.findMany({
      where: { user_id: userId, date: { gte: fourWeeksAgo, lte: fourWeeksAgoEnd } },
      orderBy: { date: 'desc' },
      take: 5,
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
    })
  ])

  // Build historical reference filtered to exercises that appear in the current workout
  const historicalReference = historicalWorkouts.reduce<ReturnType<typeof buildWorkoutData>[]>((acc, hw) => {
    const exs: any[] = hw.exercises_summary ? JSON.parse(hw.exercises_summary) : []
    const relevant = exs.filter((e: any) => exerciseNames.includes(e.name))
    if (relevant.length) {
      acc.push(buildWorkoutData({ ...hw, exercises_summary: JSON.stringify(relevant) }))
    }
    return acc
  }, [])

  const payload: WorkoutAnalysisPayload = {
    task: 'workout_analysis',
    today: new Date().toISOString().substring(0, 10),
    athlete,
    workout: buildWorkoutData(workout),
    ...(historicalReference.length && { historical_reference: historicalReference }),
    ...(activeMesocycle && {
      active_mesocycle: {
        name: activeMesocycle.name,
        ...(activeMesocycle.goal && { goal: activeMesocycle.goal }),
        ...(activeMesocycle.split_description && { split: activeMesocycle.split_description })
      }
    })
  }

  const { content, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    contextType: 'analyze',
    systemPrompt: WORKOUT_ANALYSIS_PROMPT,
    payload,
    maxOutputTokens: MAX_OUTPUT_TOKENS.analysis
  })

  const analysis = content || 'No se pudo generar el análisis.'
  await prisma.workout.update({ where: { id }, data: { ai_analysis: analysis, ai_model: model } })

  return { success: true, analysis, model }
})
