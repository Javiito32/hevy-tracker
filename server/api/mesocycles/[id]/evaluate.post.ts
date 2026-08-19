import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildAthleteProfile, buildWorkoutData, buildNutritionSnapshot, type WeekEvaluationPayload } from '../../../utils/ai-payload'
import { renderWeekEvaluation } from '../../../utils/ai-serialize'
import { localDayKey, weekNumberFor } from '../../../utils/dates'
import { runAiTask, aiKeysFromConfig } from '../../../utils/ai-service'
import { WEEK_EVALUATION_PROMPT } from '../../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../../utils/ai-config'
import { getWeekAdherence } from '../../../utils/plan-service'
import { buildMuscleVolumeReport } from '../../../utils/muscle-volume'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID required' })

  const mesocycle = await prisma.mesocycle.findFirst({ where: { id, user_id: userId } })
  if (!mesocycle) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  const now = new Date()
  const msPerDay = 1000 * 60 * 60 * 24
  // Shared with the chat prompt and the adherence report, which each had their
  // own formula and disagreed on the boundary days.
  const weekNumber = weekNumberFor(mesocycle.start_date, now)

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

  // The week being judged, not today: evaluating week 2 of a finished block
  // must not quote the weight the athlete reached six weeks later. For a week
  // still in progress this is simply "now".
  const asOf = weekEnd < now ? weekEnd : now

  const weekWorkoutWhere = (start: Date, end: Date) => ({
    user_id: userId,
    date: { gte: start, lt: end },
    // Unlinked sessions in the window still happened this week. Another
    // block's rows stay out — they belong to a different story.
    OR: [{ mesocycle_id: id }, { mesocycle_id: null }]
  })

  const [athlete, nutrition, thisWeekWorkouts, prevEvaluations, weekNotes, weekAdherence, muscleVolume, alerts, ...prevWeeksWorkouts] = await Promise.all([
    buildAthleteProfile(userId, { asOf }),
    buildNutritionSnapshot(userId, { asOf }),
    prisma.workout.findMany({
      where: weekWorkoutWhere(weekStart, weekEnd),
      orderBy: { date: 'asc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
    }),
    // Newest four, then re-sorted ascending below: `previous_weeks` reads
    // oldest-first, and two adjacent lists running in opposite directions is how
    // a model ends up reporting a trend backwards.
    prisma.mesocycleEvaluation.findMany({
      where: { mesocycle_id: id },
      orderBy: { week_number: 'desc' },
      take: 4,
      select: { week_number: true, summary: true, volume_trend: true, recommendations: true }
    }),
    prisma.mesocycleNote.findMany({
      where: { mesocycle_id: id, date: { gte: historyStart, lt: weekEnd } },
      orderBy: { date: 'asc' }
    }),
    getWeekAdherence(userId, id, weekStart, weekEnd, weekNumber),
    buildMuscleVolumeReport(userId, 8),
    prisma.trainingAlert.findMany({
      where: { user_id: userId, status: 'active', detected_at: { lte: asOf } },
      orderBy: { detected_at: 'desc' },
      take: 12,
      select: { type: true, subject: true, title: true, severity: true }
    }),
    // Previous weeks: no exercises_summary — summary only to reduce token usage
    ...prevWindows.map(w =>
      prisma.workout.findMany({
        where: weekWorkoutWhere(w.start, w.end),
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
    today: localDayKey(now),
    athlete,
    mesocycle: {
      name: mesocycle.name,
      ...(mesocycle.goal && { goal: mesocycle.goal }),
      ...(mesocycle.split_description && { split: mesocycle.split_description }),
      ...(mesocycle.target_sessions_weekly != null && { sessions_per_week: mesocycle.target_sessions_weekly })
    },
    current_week: {
      number: weekNumber,
      from: localDayKey(weekStart),
      to: localDayKey(new Date(weekEnd.getTime() - 1)),
      in_progress: weekInProgress,
      ...(weekInProgress && { days_remaining: daysLeftInWeek }),
      workouts: thisWeekWorkouts.map(w => buildWorkoutData(w, true)),
      total_volume_kg: Math.round(thisVol),
      sessions_completed: thisWeekWorkouts.length,
      ...(mesocycle.target_sessions_weekly != null && { sessions_target: mesocycle.target_sessions_weekly }),
      volume_trend: volumeTrend,
      volume_vs_previous_kg: Math.round(thisVol - prevVol),
      // Only notes written inside the week being evaluated. The query reaches
      // four weeks back for context, and all of it used to land here — so a note
      // from a month ago read as evidence about this week.
      athlete_notes: weekNotes
        .filter((n: any) => new Date(n.date) >= weekStart)
        .map((n: any) => ({
          date: localDayKey(new Date(n.date)),
          content: n.content
        }))
    },
    previous_weeks: prevWindows.map((w, i) => {
      const ww = prevWeeksWorkouts[i] ?? []
      const vol = (ww as any[]).reduce((s: number, x: any) => s + Number(x.total_volume ?? 0), 0)
      return {
        number: w.weekNum,
        from: localDayKey(w.start),
        to: localDayKey(new Date(w.end.getTime() - 1)),
        workouts: (ww as any[]).map(x => buildWorkoutData(x, false)),
        total_volume_kg: Math.round(vol)
      }
    }),
    ...(() => {
      const earlier = weekNotes
        .filter((n: any) => new Date(n.date) < weekStart)
        .map((n: any) => ({
          date: localDayKey(new Date(n.date)),
          content: n.content
        }))
      return earlier.length ? { earlier_notes: earlier } : {}
    })(),
    previous_evaluations: [...prevEvaluations]
      .sort((a, b) => a.week_number - b.week_number)
      .map(e => ({
        week: e.week_number,
        ...(e.summary && { summary: e.summary }),
        ...(e.volume_trend && { volume_trend: e.volume_trend }),
        ...(e.recommendations && { recommendations: e.recommendations })
      })),
    ...(nutrition && { nutrition }),
    ...(weekAdherence.has_plan ? { week_adherence: { overall_pct: weekAdherence.overall_pct, rows: weekAdherence.rows } } : {}),
    ...(muscleVolume.averages.length ? {
      muscle_volume: muscleVolume.averages.map(a => ({
        muscle: a.muscle,
        label: a.label,
        avg_weekly_sets: a.avg_sets,
        verdict: a.verdict,
        ...(a.landmarks && { mev: a.landmarks.mev, mav: a.landmarks.mav, mrv: a.landmarks.mrv })
      }))
    } : {}),
    ...(alerts.length ? { alerts } : {})
  }

  const { content: aiAnalysis, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    task: 'evaluate',
    systemPrompt: WEEK_EVALUATION_PROMPT,
    payload: renderWeekEvaluation(payload),
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
