import OpenAI from 'openai'
import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildAthleteProfile, buildWorkoutData, type FinalSummaryPayload } from '../../../utils/ai-payload'
import { AI_MODEL } from '../../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID required' })

  const mesocycle = await prisma.mesocycle.findFirst({ where: { id, user_id: userId } })
  if (!mesocycle) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  if (!config.openaiApiKey || config.openaiApiKey.includes('your_openai_api_key')) {
    throw createError({ statusCode: 503, statusMessage: 'OpenAI API Key no configurada' })
  }

  const [athlete, allWorkouts, allEvaluations, allNotes] = await Promise.all([
    buildAthleteProfile(userId),
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
    })
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
    }))
  }

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia. Genera análisis finales de bloques de entrenamiento con rigor científico. Sé conciso y constructivo. Responde en español con formato Markdown.

Recibirás un JSON con los datos del mesociclo completado. Genera un análisis final con estas secciones:

## Conclusiones del mesociclo
(Evaluación global: ¿Se cumplieron los objetivos? 3-4 frases)

## Progresión conseguida
(Comparativa inicio vs final: volumen, cargas, RPE)

## Logros destacados

## Puntos de mejora para el siguiente bloque

## Recomendaciones para el próximo mesociclo
(Ajustes de volumen, intensidad, split o ejercicios)`
      },
      { role: 'user', content: JSON.stringify(payload, null, 2) }
    ],
    max_completion_tokens: 1400
  })

  const tokensUsed = completion.usage?.total_tokens ?? null
  const finalSummary = completion.choices[0]?.message?.content ?? ''

  if (tokensUsed) {
    const convo = await prisma.aiConversation.create({ data: { context_type: 'final_summary', user_id: userId } })
    await prisma.aiMessage.create({ data: { conversation_id: convo.id, role: 'assistant', content: finalSummary, tokens_used: tokensUsed, model_used: AI_MODEL } })
  }

  await prisma.mesocycle.update({ where: { id }, data: { final_summary: finalSummary, final_summary_model: AI_MODEL } })

  return { success: true, final_summary: finalSummary, model: AI_MODEL }
})
