import OpenAI from 'openai'
import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildUserProfileAsync, formatWorkoutFull } from '../../../utils/ai-context'

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

  const [profileBlock, allWorkouts, allEvaluations, allNotes] = await Promise.all([
    buildUserProfileAsync(userId),
    prisma.workout.findMany({
      where: { user_id: userId, mesocycle_id: id },
      orderBy: { date: 'asc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
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

  const totalVolume = allWorkouts.reduce((s, w) => s + (w.total_volume ?? 0), 0)
  const avgRpe = allWorkouts.filter(w => w.rpe_avg).reduce((s, w) => s + (w.rpe_avg ?? 0), 0) /
    (allWorkouts.filter(w => w.rpe_avg).length || 1)

  const durationDays = mesocycle.end_date
    ? Math.round((new Date(mesocycle.end_date).getTime() - new Date(mesocycle.start_date).getTime()) / (24 * 60 * 60 * 1000))
    : Math.round((Date.now() - new Date(mesocycle.start_date).getTime()) / (24 * 60 * 60 * 1000))

  const evalsBlock = allEvaluations.length
    ? allEvaluations.map(e => `  Semana ${e.week_number}: ${e.summary ?? 'Sin resumen'} | Volumen: ${e.volume_trend ?? 'N/A'}`).join('\n')
    : '  Sin evaluaciones semanales registradas.'

  const notesBlock = allNotes.length
    ? allNotes.map(n => `  [${new Date(n.date).toLocaleDateString('es-ES')}] ${n.content}`).join('\n')
    : '  Sin notas del diario.'

  const firstWorkout = allWorkouts[0]
  const lastWorkout = allWorkouts[allWorkouts.length - 1]

  const prompt = `Genera el resumen final del mesociclo "${mesocycle.name}" que acaba de completarse.

DATOS GENERALES:
- Duración: ${durationDays} días (${Math.round(durationDays / 7)} semanas)
- Objetivo: ${mesocycle.goal ?? 'No especificado'}
- Split: ${mesocycle.split_description ?? 'No especificado'}
- Total entrenamientos: ${allWorkouts.length}
- Volumen total acumulado: ${Math.round(totalVolume).toLocaleString()}kg
- RPE promedio global: ${avgRpe.toFixed(1)}

PRIMER ENTRENAMIENTO:
${firstWorkout ? formatWorkoutFull(firstWorkout) : '  (Sin datos)'}

ÚLTIMO ENTRENAMIENTO:
${lastWorkout && lastWorkout !== firstWorkout ? formatWorkoutFull(lastWorkout) : '  (Sin datos)'}

RESUMEN DE EVALUACIONES SEMANALES:
${evalsBlock}

DIARIO DEL DEPORTISTA:
${notesBlock}

Genera un análisis final con estas secciones:

## Conclusiones del mesociclo
(Evaluación global: ¿Se cumplieron los objetivos? 3-4 frases)

## Progresión conseguida
(Comparativa inicio vs final: volumen, cargas, RPE)

## Logros destacados

## Puntos de mejora para el siguiente bloque

## Recomendaciones para el próximo mesociclo
(Ajustes de volumen, intensidad, split o ejercicios)`

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia. Genera análisis finales de bloques de entrenamiento con rigor científico. Sé conciso y constructivo. Responde en español con formato Markdown.\n\n### PERFIL\n${profileBlock}`
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_completion_tokens: 900
  })

  const tokensUsed = completion.usage?.total_tokens ?? null
  const finalSummary = completion.choices[0]?.message?.content ?? ''

  if (tokensUsed) {
    const convo = await prisma.aiConversation.create({ data: { context_type: 'final_summary', user_id: userId } })
    await prisma.aiMessage.create({ data: { conversation_id: convo.id, role: 'assistant', content: finalSummary, tokens_used: tokensUsed } })
  }

  await prisma.mesocycle.update({ where: { id }, data: { final_summary: finalSummary } })

  return { success: true, final_summary: finalSummary }
})
