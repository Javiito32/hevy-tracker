import OpenAI from 'openai'
import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { buildAthleteProfile, buildWorkoutData, extractCompoundLiftsData, type MesocycleGeneratePayload } from '../../utils/ai-payload'
import { AI_MODEL } from '../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  if (!config.openaiApiKey || config.openaiApiKey.includes('your_openai_api_key')) {
    throw createError({ statusCode: 503, statusMessage: 'OpenAI API Key no configurada' })
  }

  const body = await readBody(event)
  const { goal, days_per_week, duration_weeks, equipment } = body

  if (!goal || !days_per_week || !duration_weeks) {
    throw createError({ statusCode: 400, statusMessage: 'Faltan campos requeridos: goal, days_per_week, duration_weeks' })
  }

  const [athlete, recentWorkouts, previousMesocycles] = await Promise.all([
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
      select: { name: true, goal: true, split_description: true, target_volume_weekly: true }
    })
  ])

  const payload: MesocycleGeneratePayload = {
    task: 'mesocycle_generate',
    today: new Date().toISOString().substring(0, 10),
    athlete,
    recent_workouts: recentWorkouts.map(w => buildWorkoutData(w, true)),
    compound_lifts: extractCompoundLiftsData(recentWorkouts),
    previous_mesocycles: previousMesocycles.map(m => ({
      name: m.name,
      ...(m.goal && { goal: m.goal }),
      ...(m.split_description && { split: m.split_description }),
      ...(m.target_volume_weekly != null && { sessions_per_week: m.target_volume_weekly })
    })),
    request: {
      goal,
      days_per_week,
      duration_weeks,
      ...(equipment && { equipment })
    }
  }

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia y powerbuilding. Diseña planes de entrenamiento personalizados basados en evidencia científica. Responde siempre en español.

Recibirás un JSON con el perfil del deportista y los parámetros del mesociclo a diseñar. Si el campo "athlete.injuries_limitations" está presente, respeta estrictamente esas restricciones y no incluyas ejercicios contraindicados.

Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "name": "Nombre descriptivo del mesociclo",
  "goal": "Objetivo detallado y realista adaptado al perfil",
  "split_description": "Descripción completa del split día por día con grupos musculares y ejercicios principales sugeridos",
  "target_volume_weekly": <entero con número de sesiones por semana>,
  "notes": "Recomendaciones clave, progresión de carga sugerida y cualquier consideración relevante"
}`
      },
      { role: 'user', content: JSON.stringify(payload, null, 2) }
    ],
    max_completion_tokens: 1200,
    response_format: { type: 'json_object' }
  })

  const tokensUsed = completion.usage?.total_tokens ?? null
  const content = completion.choices[0]?.message?.content ?? '{}'

  let plan: any
  try {
    plan = JSON.parse(content)
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Error al procesar la respuesta de la IA' })
  }

  if (tokensUsed) {
    const convo = await prisma.aiConversation.create({ data: { context_type: 'mesocycle_generate', user_id: userId } })
    await prisma.aiMessage.create({ data: { conversation_id: convo.id, role: 'assistant', content, tokens_used: tokensUsed, model_used: AI_MODEL } })
  }

  return { success: true, plan }
})
