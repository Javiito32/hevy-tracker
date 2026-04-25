import OpenAI from 'openai'
import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { buildUserProfileAsync, formatWorkoutFull, buildLastCompletedMesocycleSummary } from '../../utils/ai-context'
import { AI_MODEL } from '../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  if (!config.openaiApiKey || config.openaiApiKey.includes('your_openai_api_key')) {
    throw createError({ statusCode: 503, statusMessage: 'OpenAI API Key no configurada' })
  }

  const body = await readBody(event)
  const { name, goal, split_description, target_volume_weekly, duration_weeks, notes } = body

  const [profileBlock, recentWorkouts, lastMesocycleSummary] = await Promise.all([
    buildUserProfileAsync(userId),
    prisma.workout.findMany({
      where: { user_id: userId },
      take: 5,
      orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
    }),
    // Last completed mesocycle as baseline — lets the model judge the new plan
    // relative to what the athlete actually trained before, not in a vacuum
    buildLastCompletedMesocycleSummary(userId)
  ])

  const recentText = recentWorkouts.length
    ? recentWorkouts.map(formatWorkoutFull).join('\n\n')
    : 'Sin entrenamientos recientes.'

  // Baseline block: last completed mesocycle for comparison
  const baselineBlock = lastMesocycleSummary
    ? `\n\n### MESOCICLO ANTERIOR (línea base del deportista)\n${lastMesocycleSummary}`
    : ''

  const prompt = `El deportista ha diseñado el siguiente mesociclo y quiere feedback:

**Nombre:** ${name || 'Sin nombre'}
**Objetivo:** ${goal || 'No especificado'}
**Duración:** ${duration_weeks ? duration_weeks + ' semanas' : 'No especificada'}
**Sesiones por semana:** ${target_volume_weekly ?? 'No especificado'}
**Split/Rutina:**
${split_description || 'No especificado'}
${notes ? `**Notas:** ${notes}` : ''}

Analiza este plan con rigor y proporciona feedback constructivo en Markdown. Estructura tu respuesta con estas secciones:

## Evaluación general
## Volumen y frecuencia
## Idoneidad del split
## Riesgos o puntos de atención
## Recomendaciones concretas`

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia y powerbuilding. Da feedback honesto, directo y basado en datos científicos. Sé conciso. Responde en español.\n\n### PERFIL DEL DEPORTISTA\n${profileBlock}${baselineBlock}\n\n### ÚLTIMOS 5 ENTRENAMIENTOS\n${recentText}`
      },
      { role: 'user', content: prompt }
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
