import OpenAI from 'openai'
import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildAthleteProfile, buildWorkoutData, type WorkoutAnalysisPayload } from '../../../utils/ai-payload'
import { AI_MODEL } from '../../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'Workout ID is required' })

  const workout = await prisma.workout.findFirst({ where: { id, user_id: userId } })
  if (!workout) throw createError({ statusCode: 404, statusMessage: 'Workout not found' })

  if (!config.openaiApiKey || config.openaiApiKey.includes('your_openai_api_key')) {
    throw createError({ statusCode: 503, statusMessage: 'OpenAI API Key no configurada' })
  }

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

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia. Analiza entrenamientos con rigor científico. Sé conciso, constructivo y orientado a lo accionable. Responde en español con formato Markdown.

Recibirás un JSON con los datos del entrenamiento. Basa tu análisis únicamente en los datos proporcionados; no inventes progreso, objetivos ni métricas ausentes. Si falta contexto relevante, indícalo de forma breve y formula las conclusiones con cautela. Analiza el campo "workout" y proporciona:
1. **Evaluación general** (calidad, intensidad, volumen en 2-3 frases)
2. **Puntos fuertes**
3. **Áreas de mejora** (con datos concretos)
4. **Recomendaciones** para la siguiente sesión similar

Si hay datos en "historical_reference", compara con el historial. Ten en cuenta el mesociclo activo si está presente.

Antes de finalizar, verifica que cada afirmación esté respaldada por el JSON y que no falte ninguna sección solicitada.`
      },
      { role: 'user', content: JSON.stringify(payload, null, 2) }
    ],
    max_completion_tokens: 3000
  })

  const tokensUsed = completion.usage?.total_tokens ?? null
  const analysis = completion.choices[0]?.message?.content ?? 'No se pudo generar el análisis.'

  if (tokensUsed) {
    const convo = await prisma.aiConversation.create({ data: { context_type: 'analyze', user_id: userId } })
    await prisma.aiMessage.create({ data: { conversation_id: convo.id, role: 'assistant', content: analysis, tokens_used: tokensUsed, model_used: AI_MODEL } })
  }

  await prisma.workout.update({ where: { id }, data: { ai_analysis: analysis, ai_model: AI_MODEL } })

  return { success: true, analysis, model: AI_MODEL }
})
