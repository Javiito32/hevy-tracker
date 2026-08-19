import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { buildAthleteProfile, buildWorkoutData, buildLastMesocycleSummaryData, buildNutritionSnapshot, type MesocycleFeedbackPayload } from '../../utils/ai-payload'
import { renderMesocycleFeedback } from '../../utils/ai-serialize'
import { runAiTask, aiKeysFromConfig } from '../../utils/ai-service'
import { MESOCYCLE_FEEDBACK_PROMPT } from '../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../utils/ai-config'
import { localDayKey } from '../../utils/dates'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  const body = await readBody(event)
  const { name, goal, split_description, target_sessions_weekly, duration_weeks, notes, sessions, weeks } = body

  const [athlete, recentWorkouts, baselineMesocycle, nutrition] = await Promise.all([
    buildAthleteProfile(userId),
    prisma.workout.findMany({
      where: { user_id: userId },
      take: 5,
      orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, notes: true, exercises_summary: true }
    }),
    buildLastMesocycleSummaryData(userId),
    buildNutritionSnapshot(userId)
  ])

  const structuredSessions = Array.isArray(sessions)
    ? sessions
        .filter((s: any) => s && typeof s.name === 'string' && Array.isArray(s.exercises))
        .map((s: any) => ({
          name: String(s.name),
          day_of_week: Number.isFinite(s.day_of_week) ? Number(s.day_of_week) : null,
          exercises: s.exercises
            .filter((e: any) => e && e.name)
            .map((e: any) => ({
              name: String(e.name),
              ...(e.target_sets != null && { target_sets: Number(e.target_sets) }),
              ...(e.rep_min != null && { rep_min: Number(e.rep_min) }),
              ...(e.rep_max != null && { rep_max: Number(e.rep_max) }),
              ...(e.target_rir != null && { target_rir: Number(e.target_rir) })
            }))
        }))
    : []

  const structuredWeeks = Array.isArray(weeks)
    ? weeks
        .filter((w: any) => w && Number.isFinite(w.week_number))
        .map((w: any) => ({
          week_number: Number(w.week_number),
          ...(w.is_deload && { is_deload: true }),
          ...(w.target_rir != null && { target_rir: Number(w.target_rir) }),
          ...(w.volume_multiplier != null && { volume_multiplier: Number(w.volume_multiplier) })
        }))
    : []

  const payload: MesocycleFeedbackPayload = {
    task: 'mesocycle_feedback',
    today: localDayKey(new Date()),
    athlete,
    recent_workouts: recentWorkouts.map(w => buildWorkoutData(w, true)),
    plan: {
      ...(name && { name }),
      ...(goal && { goal }),
      ...(duration_weeks && { duration_weeks }),
      ...(target_sessions_weekly != null && { sessions_per_week: target_sessions_weekly }),
      ...(split_description && { split_description }),
      ...(notes && { notes }),
      ...(structuredSessions.length && { sessions: structuredSessions }),
      ...(structuredWeeks.length && { weeks: structuredWeeks })
    },
    ...(baselineMesocycle && { baseline_mesocycle: baselineMesocycle }),
    ...(nutrition && { nutrition })
  }

  const { content, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    task: 'mesocycle_feedback',
    systemPrompt: MESOCYCLE_FEEDBACK_PROMPT,
    payload: renderMesocycleFeedback(payload),
    maxOutputTokens: MAX_OUTPUT_TOKENS.analysis
  })

  return { success: true, feedback: content || 'No se pudo generar el análisis.', model }
})
