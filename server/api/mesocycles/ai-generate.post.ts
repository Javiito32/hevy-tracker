import OpenAI from 'openai'
import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { buildUserProfileAsync, formatWorkoutFull } from '../../utils/ai-context'

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

  const [profileBlock, recentWorkouts, previousMesocycles] = await Promise.all([
    buildUserProfileAsync(userId),
    prisma.workout.findMany({
      where: { user_id: userId },
      take: 5,
      orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
    }),
    prisma.mesocycle.findMany({
      where: { user_id: userId, status: { in: ['completed', 'paused'] } },
      orderBy: { start_date: 'desc' },
      take: 2,
      select: { name: true, goal: true, split_description: true, target_volume_weekly: true }
    })
  ])

  const recentText = recentWorkouts.length
    ? recentWorkouts.map(formatWorkoutFull).join('\n\n')
    : 'Sin entrenamientos recientes.'

  const prevMesoText = previousMesocycles.length
    ? previousMesocycles.map(m => `- ${m.name}: ${m.goal ?? 'Sin objetivo'} | Split: ${m.split_description ?? 'N/A'} | ${m.target_volume_weekly ?? '?'} sesiones/semana`).join('\n')
    : 'Sin mesociclos anteriores.'

  const prompt = `El deportista quiere crear un nuevo mesociclo con estas especificaciones:
- Objetivo: ${goal}
- Días disponibles por semana: ${days_per_week}
- Duración: ${duration_weeks} semanas
${equipment ? `- Equipamiento / restricciones: ${equipment}` : ''}

Genera un plan completo. Responde ÚNICAMENTE con un objeto JSON válido con esta estructura exacta:
{
  "name": "Nombre descriptivo del mesociclo",
  "goal": "Objetivo detallado y realista adaptado al perfil",
  "split_description": "Descripción completa del split día por día con grupos musculares y ejercicios principales sugeridos",
  "target_volume_weekly": <entero con número de sesiones por semana>,
  "notes": "Recomendaciones clave, progresión de carga sugerida y cualquier consideración relevante"
}`

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia y powerbuilding. Diseña planes de entrenamiento personalizados basados en evidencia científica. Responde siempre en español.\n\n### PERFIL DEL DEPORTISTA\n${profileBlock}\n\n### ÚLTIMOS ENTRENAMIENTOS\n${recentText}\n\n### MESOCICLOS ANTERIORES\n${prevMesoText}`
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
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
    await prisma.aiMessage.create({ data: { conversation_id: convo.id, role: 'assistant', content, tokens_used: tokensUsed } })
  }

  return { success: true, plan }
})
