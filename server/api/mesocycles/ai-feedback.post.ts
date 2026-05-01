import OpenAI from 'openai'
import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { buildAthleteProfile, buildWorkoutData, buildLastMesocycleSummaryData, type MesocycleFeedbackPayload } from '../../utils/ai-payload'
import { AI_MODEL } from '../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  if (!config.openaiApiKey || config.openaiApiKey.includes('your_openai_api_key')) {
    throw createError({ statusCode: 503, statusMessage: 'OpenAI API Key no configurada' })
  }

  const body = await readBody(event)
  const { name, goal, split_description, target_volume_weekly, duration_weeks, notes } = body

  const [athlete, recentWorkouts, baselineMesocycle] = await Promise.all([
    buildAthleteProfile(userId),
    prisma.workout.findMany({
      where: { user_id: userId },
      take: 5,
      orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, notes: true }
    }),
    buildLastMesocycleSummaryData(userId)
  ])

  const payload: MesocycleFeedbackPayload = {
    task: 'mesocycle_feedback',
    today: new Date().toISOString().substring(0, 10),
    athlete,
    recent_workouts: recentWorkouts.map(w => buildWorkoutData(w, false)),
    plan: {
      ...(name && { name }),
      ...(goal && { goal }),
      ...(duration_weeks && { duration_weeks }),
      ...(target_volume_weekly != null && { sessions_per_week: target_volume_weekly }),
      ...(split_description && { split_description }),
      ...(notes && { notes })
    },
    ...(baselineMesocycle && { baseline_mesocycle: baselineMesocycle })
  }

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia y powerbuilding. Da feedback honesto, directo y basado en datos científicos. Sé conciso. Responde en español.

Recibirás un JSON con el plan de mesociclo propuesto y el contexto del deportista. Analiza el plan y proporciona feedback constructivo en Markdown con estas secciones:

## Evaluación general
## Volumen y frecuencia
## Idoneidad del split
## Riesgos o puntos de atención
## Recomendaciones concretas`
      },
      { role: 'user', content: JSON.stringify(payload, null, 2) }
    ],
    temperature: 0.6,
    max_completion_tokens: 800
  })

  const tokensUsed = completion.usage?.total_tokens ?? null
  const feedback = completion.choices[0]?.message?.content ?? 'No se pudo generar el análisis.'

  if (tokensUsed) {
    const convo = await prisma.aiConversation.create({ data: { context_type: 'mesocycle_feedback', user_id: userId } })
    await prisma.aiMessage.create({ data: { conversation_id: convo.id, role: 'assistant', content: feedback, tokens_used: tokensUsed, model_used: AI_MODEL } })
  }

  return { success: true, feedback, model: AI_MODEL }
})
