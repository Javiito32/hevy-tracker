import OpenAI from 'openai'
import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildUserProfileAsync } from '../../../utils/ai-context'
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

  const fourWeeksAgo = new Date(workout.date)
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 35)
  const fourWeeksAgoEnd = new Date(workout.date)
  fourWeeksAgoEnd.setDate(fourWeeksAgoEnd.getDate() - 21)

  const exerciseNames = exercises.map((e: any) => e.name)

  const [profileBlock, activeMesocycle, historicalWorkouts] = await Promise.all([
    buildUserProfileAsync(userId),
    prisma.mesocycle.findFirst({ where: { user_id: userId, status: 'active' } }),
    prisma.workout.findMany({
      where: { user_id: userId, date: { gte: fourWeeksAgo, lte: fourWeeksAgoEnd } },
      orderBy: { date: 'desc' },
      take: 5,
      select: { name: true, date: true, exercises_summary: true }
    })
  ])

  const fmtDur = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60); return h > 0 ? `${h}h ${m}m` : sec === 0 ? `${m}m` : `${m}:${String(sec).padStart(2, '0')}` }
  const fmtDist = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m} m`

  const exercisesText = exercises.map((ex: any) => {
    const isCardio = ex.type === 'cardio' || ex.type === 'duration'
    const setsDetail = (ex.sets_details || []).map((s: any, i: number) => {
      if (isCardio || (s.duration_seconds && !s.weight && !s.reps)) {
        const dist = s.distance_meters ? ` ${fmtDist(s.distance_meters)}` : ''
        const dur = s.duration_seconds ? ` ${fmtDur(s.duration_seconds)}` : ''
        return `  Set ${i + 1}:${dist}${dur}${s.rpe ? ` @ RPE ${s.rpe}` : ''}`
      }
      return `  Set ${i + 1}: ${s.weight ?? '-'}kg × ${s.reps ?? '-'} reps${s.rpe ? ` @ RPE ${s.rpe}` : ''}`
    }).join('\n')
    if (isCardio) {
      const dist = ex.total_distance_meters ? ` Dist: ${fmtDist(ex.total_distance_meters)},` : ''
      const dur = ex.total_duration_seconds ? ` Tiempo: ${fmtDur(ex.total_duration_seconds)}` : ''
      return `**${ex.name}** (${ex.sets} sets,${dist}${dur})\n${setsDetail}`
    }
    return `**${ex.name}** (${ex.sets} sets, Vol: ${ex.total_volume ?? 0}kg, 1RM est: ${ex.estimated_1rm ? parseFloat(ex.estimated_1rm).toFixed(1) + 'kg' : 'N/A'})\n${setsDetail}`
  }).join('\n\n')

  let historicalText = ''
  if (historicalWorkouts.length && exerciseNames.length) {
    const matchingExercises: string[] = []
    for (const hw of historicalWorkouts) {
      const hwExercises: any[] = hw.exercises_summary ? JSON.parse(hw.exercises_summary) : []
      const relevant = hwExercises.filter((e: any) => exerciseNames.includes(e.name))
      if (relevant.length) {
        const dateStr = new Date(hw.date).toLocaleDateString('es-ES')
        relevant.forEach((ex: any) => {
          const isCardioEx = ex.type === 'cardio' || ex.type === 'duration'
          const setsText = (ex.sets_details || []).map((s: any, i: number) => {
            if (isCardioEx || (s.duration_seconds && !s.weight && !s.reps)) {
              const dist = s.distance_meters ? ` ${fmtDist(s.distance_meters)}` : ''
              const dur = s.duration_seconds ? ` ${fmtDur(s.duration_seconds)}` : ''
              return `    Set ${i + 1}:${dist}${dur}${s.rpe ? ` RPE ${s.rpe}` : ''}`
            }
            return `    Set ${i + 1}: ${s.weight ?? '-'}kg × ${s.reps ?? '-'} reps${s.rpe ? ` RPE ${s.rpe}` : ''}`
          }).join('\n')
          const exSummary = isCardioEx
            ? `${ex.total_distance_meters ? ` Dist: ${fmtDist(ex.total_distance_meters)},` : ''}${ex.total_duration_seconds ? ` Tiempo: ${fmtDur(ex.total_duration_seconds)}` : ''}`
            : `Vol ${ex.total_volume ?? 0}kg, 1RM est ${ex.estimated_1rm ? parseFloat(ex.estimated_1rm).toFixed(1) + 'kg' : 'N/A'}`
          matchingExercises.push(`  [${dateStr}] ${ex.name}:${exSummary}\n${setsText}`)
        })
      }
    }
    if (matchingExercises.length) {
      historicalText = `\n\n## Referencia histórica (3-5 semanas atrás, mismos ejercicios):\n${matchingExercises.join('\n\n')}`
    }
  }

  const now = new Date()
  const todayStr = `${['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][now.getDay()]}, ${now.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`

  const prompt = `Analiza este entrenamiento y dame feedback concreto y conciso. Hoy es ${todayStr}.

## Entrenamiento: ${workout.name}
- Fecha: ${new Date(workout.date).toLocaleDateString('es-ES')}
- Duración: ${workout.duration ? Math.floor(workout.duration / 60) + ' min' : 'N/A'}
- Volumen total: ${(workout.total_volume ?? 0).toLocaleString()} kg
- RPE promedio: ${workout.rpe_avg ?? 'N/A'}
${workout.notes ? `- Notas del deportista: ${workout.notes}` : ''}

## Ejercicios:
${exercisesText || 'Sin detalle de ejercicios.'}
${historicalText}
${activeMesocycle ? `\n## Mesociclo activo: ${activeMesocycle.name}
- Objetivo: ${activeMesocycle.goal ?? 'No especificado'}
- Split: ${activeMesocycle.split_description ?? 'No especificado'}` : ''}

Proporciona:
1. **Evaluación general** (calidad, intensidad, volumen en 2-3 frases)
2. **Puntos fuertes**
3. **Áreas de mejora** (con datos concretos)
4. **Recomendaciones** para la siguiente sesión similar`

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia. Analiza entrenamientos con rigor científico. Sé conciso y directo. Responde en español con formato Markdown.\n\n### PERFIL DEL DEPORTISTA\n${profileBlock}`
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_completion_tokens: 700
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
