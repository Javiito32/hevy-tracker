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

  const [profileBlock, thisWeekWorkouts, prevEvaluations, weekNotes, ...prevWeeksWorkouts] = await Promise.all([
    buildUserProfileAsync(userId),
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
    ...prevWindows.map(w =>
      prisma.workout.findMany({
        where: { user_id: userId, mesocycle_id: id, date: { gte: w.start, lt: w.end } },
        orderBy: { date: 'asc' },
        select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
      })
    )
  ])

  const thisVol = thisWeekWorkouts.reduce((s, w) => s + (w.total_volume ?? 0), 0)
  const prevVol = prevWeeksWorkouts[prevWeeksWorkouts.length - 1]?.reduce((s: number, w: any) => s + (w.total_volume ?? 0), 0) ?? 0
  const volumeTrend = prevVol === 0 ? 'N/A' : thisVol > prevVol * 1.05 ? 'increasing' : thisVol < prevVol * 0.95 ? 'decreasing' : 'stable'

  const formatWorkouts = (ws: any[]) =>
    ws.length ? ws.map(formatWorkoutFull).join('\n\n') : '  (Sin entrenamientos)'

  const prevWeeksBlock = prevWindows.map((w, i) => {
    const ww = prevWeeksWorkouts[i] ?? []
    const vol = (ww as any[]).reduce((s: number, x: any) => s + (x.total_volume ?? 0), 0)
    return `SEMANA ${w.weekNum} (${w.start.toLocaleDateString('es-ES')} – ${w.end.toLocaleDateString('es-ES')}) — Vol: ${Math.round(vol).toLocaleString()}kg:\n${formatWorkouts(ww as any[])}`
  }).join('\n\n')

  const notesBlock = weekNotes.length
    ? weekNotes.map((n: any) => `  [${new Date(n.date).toLocaleDateString('es-ES')}] ${n.content}`).join('\n')
    : '  Sin notas del deportista esta semana.'

  const prevEvalsBlock = prevEvaluations.length
    ? prevEvaluations.map(e => `  Semana ${e.week_number}: ${e.summary ?? 'Sin resumen'} (volumen: ${e.volume_trend ?? 'N/A'})`).join('\n')
    : '  Primera evaluación del mesociclo.'

  const todayStr = `${['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][now.getDay()]}, ${now.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`
  const daysLeftInWeek = weekEnd.getTime() > now.getTime()
    ? Math.ceil((weekEnd.getTime() - now.getTime()) / msPerDay)
    : 0
  const weekInProgress = daysLeftInWeek > 0

  const targetMet = mesocycle.target_volume_weekly
    ? weekInProgress
      ? `${thisWeekWorkouts.length}/${mesocycle.target_volume_weekly} — semana en curso (hoy ${todayStr}, quedan ~${daysLeftInWeek} días)`
      : `${thisWeekWorkouts.length}/${mesocycle.target_volume_weekly} (${thisWeekWorkouts.length >= mesocycle.target_volume_weekly ? '✓ objetivo cumplido' : 'objetivo no alcanzado'})`
    : `${thisWeekWorkouts.length} entrenamientos`

  const prompt = `Evalúa la semana ${weekNumber} del mesociclo "${mesocycle.name}". Sé conciso.

OBJETIVO: ${mesocycle.goal ?? 'No especificado'}
SPLIT: ${mesocycle.split_description ?? 'No especificado'}
ENTRENAMIENTOS: ${targetMet}
VOLUMEN: ${Math.round(thisVol).toLocaleString()}kg esta semana vs ${Math.round(prevVol).toLocaleString()}kg semana anterior (${volumeTrend})

${prevWeeksBlock ? `SEMANAS ANTERIORES (referencia de progresión):\n${prevWeeksBlock}\n\n` : ''}SEMANA ACTUAL — SEMANA ${weekNumber} (${weekStart.toLocaleDateString('es-ES')} – ${weekEnd.toLocaleDateString('es-ES')}):
${formatWorkouts(thisWeekWorkouts)}

NOTAS DEL DEPORTISTA (últimas semanas):
${notesBlock}

EVALUACIONES PREVIAS:
${prevEvalsBlock}

Responde con estas secciones (breve, sin repetir datos que ya tienes):

## Resumen
(2 frases sobre el rendimiento)

## Volumen e intensidad
(Comparativa con semana anterior)

## Puntos fuertes

## Áreas de atención

## Recomendaciones próxima semana`

  const openai = new OpenAI({ apiKey: config.openaiApiKey })
  const completion = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      {
        role: 'system',
        content: `Eres un entrenador personal experto en hipertrofia. Evalúa semanas de entrenamiento con rigor científico. Sé conciso. Responde en español con formato Markdown.\n\n### PERFIL\n${profileBlock}`
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    max_completion_tokens: 700
  })

  const tokensUsed = completion.usage?.total_tokens ?? null
  const aiAnalysis = completion.choices[0]?.message?.content ?? ''
  const summaryMatch = aiAnalysis.match(/## Resumen\n+([\s\S]*?)(?=\n##|$)/)
  const summary = summaryMatch?.[1]?.trim().split('\n')[0] ?? ''
  const recsMatch = aiAnalysis.match(/## Recomendaciones[\s\S]*?\n+([\s\S]*?)(?=\n##|$)/)
  const recommendations = recsMatch?.[1]?.trim() ?? ''

  // Track token usage
  if (tokensUsed) {
    const convo = await prisma.aiConversation.create({ data: { context_type: 'evaluate', user_id: userId } })
    await prisma.aiMessage.create({ data: { conversation_id: convo.id, role: 'assistant', content: aiAnalysis, tokens_used: tokensUsed } })
  }

  return prisma.mesocycleEvaluation.create({
    data: {
      mesocycle_id: id,
      week_number: weekNumber,
      evaluation_date: now,
      summary,
      volume_trend: volumeTrend,
      progress_score: null,
      ai_analysis: aiAnalysis,
      recommendations
    }
  })
})
