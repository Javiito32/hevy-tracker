import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildAthleteProfile, buildWorkoutData, buildNutritionSnapshot, type WeekEvaluationPayload } from '../../../utils/ai-payload'
import { runAiTask, aiKeysFromConfig } from '../../../utils/ai-service'
import { WEEK_EVALUATION_PROMPT } from '../../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID required' })

  const mesocycle = await prisma.mesocycle.findFirst({ where: { id, user_id: userId } })
  if (!mesocycle) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  const now = new Date()
  const msPerDay = 1000 * 60 * 60 * 24
  const daysSinceStart = Math.floor((now.getTime() - new Date(mesocycle.start_date).getTime()) / msPerDay)
  const weekNumber = Math.max(1, Math.floor(daysSinceStart / 7) + 1)

  const weekStart = new Date(new Date(mesocycle.start_date).getTime() + (weekNumber - 1) * 7 * msPerDay)
  const weekEnd = new Date(weekStart.getTime() + 7 * msPerDay)

  const prevWindows = Array.from({ length: 4 }, (_, i) => {
    const n = i + 1
    return {
      weekNum: weekNumber - n,
      start: new Date(weekStart.getTime() - n * 7 * msPerDay),
      end: new Date(weekStart.getTime() - (n - 1) * 7 * msPerDay)
    }
  }).filter(w => w.weekNum >= 1).reverse()

  const historyStart = prevWindows.length ? prevWindows[0].start : weekStart

  const [athlete, nutrition, thisWeekWorkouts, prevEvaluations, weekNotes, ...prevWeeksWorkouts] = await Promise.all([
    buildAthleteProfile(userId),
    buildNutritionSnapshot(userId),
    prisma.workout.findMany({
      where: { user_id: userId, mesocycle_id: id, date: { gte: weekStart, lt: weekEnd } },
      orderBy: { date: 'asc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
    }),
    prisma.mesocycleEvaluation.findMany({
      where: { mesocycle_id: id },
      orderBy: { week_number: 'desc' },
      take: 4,
      select: { week_number: true, summary: true, volume_trend: true }
    }),
    prisma.mesocycleNote.findMany({
      where: { mesocycle_id: id, date: { gte: historyStart, lt: weekEnd } },
      orderBy: { date: 'asc' }
    }),
    // Previous weeks: no exercises_summary — summary only to reduce token usage
    ...prevWindows.map(w =>
      prisma.workout.findMany({
        where: { user_id: userId, mesocycle_id: id, date: { gte: w.start, lt: w.end } },
        orderBy: { date: 'asc' },
        select: { name: true, date: true, total_volume: true, rpe_avg: true, notes: true }
      })
    )
  ])

  const thisVol = thisWeekWorkouts.reduce((s, w) => s + Number(w.total_volume ?? 0), 0)
  const prevVol = prevWeeksWorkouts[prevWeeksWorkouts.length - 1]?.reduce(
    (s: number, w: any) => s + Number(w.total_volume ?? 0), 0
  ) ?? 0
  const volumeTrend = prevVol === 0 ? 'N/A' : thisVol > prevVol * 1.05 ? 'increasing' : thisVol < prevVol * 0.95 ? 'decreasing' : 'stable'

  const daysLeftInWeek = weekEnd.getTime() > now.getTime()
    ? Math.ceil((weekEnd.getTime() - now.getTime()) / msPerDay)
    : 0
  const weekInProgress = daysLeftInWeek > 0

  const payload: WeekEvaluationPayload = {
    task: 'week_evaluation',
    today: now.toISOString().substring(0, 10),
    athlete,
    mesocycle: {
      name: mesocycle.name,
      ...(mesocycle.goal && { goal: mesocycle.goal }),
      ...(mesocycle.split_description && { split: mesocycle.split_description }),
      ...(mesocycle.target_sessions_weekly != null && { sessions_per_week: mesocycle.target_sessions_weekly })
    },
    current_week: {
      number: weekNumber,
      from: weekStart.toISOString().substring(0, 10),
      to: weekEnd.toISOString().substring(0, 10),
      in_progress: weekInProgress,
      ...(weekInProgress && { days_remaining: daysLeftInWeek }),
      workouts: thisWeekWorkouts.map(w => buildWorkoutData(w, true)),
      total_volume_kg: Math.round(thisVol),
      sessions_completed: thisWeekWorkouts.length,
      ...(mesocycle.target_sessions_weekly != null && { sessions_target: mesocycle.target_sessions_weekly }),
      volume_trend: volumeTrend,
      volume_vs_previous_kg: Math.round(thisVol - prevVol),
      athlete_notes: weekNotes.map((n: any) => ({
        date: new Date(n.date).toISOString().substring(0, 10),
        content: n.content
      }))
    },
    previous_weeks: prevWindows.map((w, i) => {
      const ww = prevWeeksWorkouts[i] ?? []
      const vol = (ww as any[]).reduce((s: number, x: any) => s + Number(x.total_volume ?? 0), 0)
      return {
        number: w.weekNum,
        from: w.start.toISOString().substring(0, 10),
        to: w.end.toISOString().substring(0, 10),
        workouts: (ww as any[]).map(x => buildWorkoutData(x, false)),
        total_volume_kg: Math.round(vol)
      }
    }),
    previous_evaluations: prevEvaluations.map(e => ({
      week: e.week_number,
      ...(e.summary && { summary: e.summary }),
      ...(e.volume_trend && { volume_trend: e.volume_trend })
    })),
    ...(nutrition && { nutrition })
  }

  const { content: aiAnalysis, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    contextType: 'evaluate',
    systemPrompt: WEEK_EVALUATION_PROMPT,
    payload,
    maxOutputTokens: MAX_OUTPUT_TOKENS.analysis
  })

  const summaryMatch = aiAnalysis.match(/## Resumen\n+([\s\S]*?)(?=\n##|$)/)
  const summary = summaryMatch?.[1]?.trim().split('\n')[0] ?? ''
  const recsMatch = aiAnalysis.match(/## Recomendaciones[\s\S]*?\n+([\s\S]*?)(?=\n##|$)/)
  const recommendations = recsMatch?.[1]?.trim() ?? ''

  return prisma.mesocycleEvaluation.create({
    data: {
      mesocycle_id: id,
      week_number: weekNumber,
      evaluation_date: now,
      summary,
      volume_trend: volumeTrend,
      progress_score: null,
      ai_analysis: aiAnalysis,
      ai_model: model,
      recommendations
    }
  })
})
