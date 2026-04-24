import { prisma } from './prisma'

function getWeekStartKey(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

function computeWeeklyWeights(
  metrics: Array<{ date: Date | string; weight: any }>,
  maxWeeks = 5
): Array<{ weekStart: string; avg: number; count: number }> {
  const byWeek = new Map<string, number[]>()
  for (const m of metrics) {
    if (m.weight == null) continue
    const key = getWeekStartKey(new Date(m.date))
    if (!byWeek.has(key)) byWeek.set(key, [])
    byWeek.get(key)!.push(Number(m.weight))
  }
  return Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-maxWeeks)
    .map(([weekStart, weights]) => ({
      weekStart,
      avg: weights.reduce((s, w) => s + w, 0) / weights.length,
      count: weights.length
    }))
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (s === 0) return `${m}m`
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters} m`
}

export const formatWorkoutFull = (w: any): string => {
  const exSummary: any[] = w.exercises_summary ? JSON.parse(w.exercises_summary) : []
  const dateStr = new Date(w.date).toLocaleDateString('es-ES')
  const exercisesText = exSummary.map((ex: any) => {
    const isCardio = ex.type === 'cardio' || ex.type === 'duration'
    const setsText = (ex.sets_details || []).map((s: any, i: number) => {
      const rpe = s.rpe ? ` RPE ${s.rpe}` : ''
      if (isCardio || (s.duration_seconds && !s.weight && !s.reps)) {
        const dist = s.distance_meters ? ` ${fmtDistance(s.distance_meters)}` : ''
        const dur = s.duration_seconds ? ` ${fmtDuration(s.duration_seconds)}` : ''
        return `      Set ${i + 1}:${dist}${dur}${rpe}`
      }
      return `      Set ${i + 1}: ${s.weight ?? '-'}kg × ${s.reps ?? '-'} reps${rpe}`
    }).join('\n')
    let exMeta: string
    if (isCardio) {
      const dist = ex.total_distance_meters ? ` Dist: ${fmtDistance(ex.total_distance_meters)},` : ''
      const dur = ex.total_duration_seconds ? ` Tiempo: ${fmtDuration(ex.total_duration_seconds)}` : ''
      exMeta = `${dist}${dur}`
    } else {
      exMeta = ` Vol: ${ex.total_volume ?? 0}kg${ex.estimated_1rm ? `, 1RM est: ${parseFloat(ex.estimated_1rm).toFixed(1)}kg` : ''}`
    }
    return `    • ${ex.name} (${ex.sets} sets,${exMeta})\n${setsText}`
  }).join('\n')
  return `  [${dateStr}] ${w.name} | Vol: ${w.total_volume || 0}kg | RPE: ${w.rpe_avg || 'N/A'}${w.notes ? ` | Notas: ${w.notes}` : ''}\n${exercisesText}`
}

const getWorkoutsInWindow = async (userId: string, centerDate: Date, windowDays = 7) => {
  const from = new Date(centerDate)
  from.setDate(from.getDate() - Math.floor(windowDays / 2))
  const to = new Date(centerDate)
  to.setDate(to.getDate() + Math.ceil(windowDays / 2))
  return prisma.workout.findMany({
    where: { user_id: userId, date: { gte: from, lte: to } },
    orderBy: { date: 'asc' },
    select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
  })
}

interface MetricSnapshot {
  label: string
  metric: any | null
}

function hasMeasurements(m: any): boolean {
  return !!(m?.body_fat_percentage != null || m?.waist != null || m?.biceps != null ||
    m?.chest != null || m?.thighs != null || m?.hips != null || m?.neck != null || m?.calves != null)
}

function formatSnapshot(s: MetricSnapshot): string | null {
  const m = s.metric
  if (!m || !hasMeasurements(m)) return null
  const dateStr = new Date(m.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
  const parts: string[] = []
  if (m.body_fat_percentage != null) parts.push(`${m.body_fat_percentage}% grasa`)
  if (m.waist != null) parts.push(`cintura ${m.waist}cm`)
  if (m.biceps != null) parts.push(`bíceps ${parseFloat(m.biceps).toFixed(1)}cm`)
  if (m.chest != null) parts.push(`pecho ${m.chest}cm`)
  if (m.thighs != null) parts.push(`muslos ${parseFloat(m.thighs).toFixed(1)}cm`)
  if (m.hips != null) parts.push(`caderas ${m.hips}cm`)
  if (m.neck != null) parts.push(`cuello ${m.neck}cm`)
  if (m.calves != null) parts.push(`gemelos ${parseFloat(m.calves).toFixed(1)}cm`)
  if (!parts.length) return null
  return `  ${s.label} (${dateStr}): ${parts.join(', ')}`
}

export const buildUserProfileBlock = (
  user: any,
  latestMetric: any,
  weeklyWeights?: Array<{ weekStart: string; avg: number; count: number }>,
  measurementSnapshots?: MetricSnapshot[]
): string => {
  const lines: string[] = []
  if (user?.name && user.name !== 'User') lines.push(`- Nombre: ${user.name}`)
  if (user?.sex) lines.push(`- Sexo: ${{ male: 'Masculino', female: 'Femenino' }[user.sex as string] ?? user.sex}`)
  if (user?.birth_date) {
    const age = Math.floor((Date.now() - new Date(user.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    lines.push(`- Edad: ${age} años`)
  }
  if (user?.height) lines.push(`- Altura: ${user.height} cm`)
  if (weeklyWeights && weeklyWeights.length > 0) {
    const weightLines = weeklyWeights.map(w => {
      const label = new Date(w.weekStart + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
      const note = w.count > 1 ? ` (×${w.count})` : ''
      return `  ${label}: ${w.avg.toFixed(1)} kg${note}`
    }).join('\n')
    lines.push(`- Peso (medias semanales, últimas ${weeklyWeights.length}):\n${weightLines}`)
  } else if (latestMetric?.weight) {
    lines.push(`- Peso actual: ${latestMetric.weight} kg (${new Date(latestMetric.date).toLocaleDateString('es-ES')})`)
  }
  if (measurementSnapshots?.length) {
    const snapshotLines = measurementSnapshots.map(formatSnapshot).filter(Boolean) as string[]
    if (snapshotLines.length) lines.push(`- Medidas corporales:\n${snapshotLines.join('\n')}`)
  } else if (latestMetric?.body_fat_percentage) {
    lines.push(`- % Grasa corporal: ${latestMetric.body_fat_percentage}%`)
  }
  return lines.length ? lines.join('\n') : '- Sin datos de perfil registrados.'
}

export async function buildUserProfileAsync(userId: string): Promise<string> {
  const now = new Date()
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }
  const tenWeeksAgo = daysAgo(70)

  const [user, recentWeights, currentMetric, metric1m, metric3m] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.bodyMetric.findMany({
      where: { user_id: userId, date: { gte: tenWeeksAgo } },
      orderBy: { date: 'asc' },
      select: { weight: true, date: true }
    }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId }, orderBy: { date: 'desc' } }),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, date: { gte: daysAgo(42), lte: daysAgo(21) } },
      orderBy: { date: 'desc' }
    }),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, date: { gte: daysAgo(105), lte: daysAgo(70) } },
      orderBy: { date: 'desc' }
    })
  ])

  const weeklyWeights = computeWeeklyWeights(recentWeights)
  return buildUserProfileBlock(user, currentMetric, weeklyWeights, [
    { label: 'Actual', metric: currentMetric },
    { label: 'Hace ~1 mes', metric: metric1m },
    { label: 'Hace ~3 meses', metric: metric3m }
  ])
}

const DAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export const buildSystemPrompt = async (userId: string): Promise<string> => {
  const now = new Date()
  const twoMonthsAgo = new Date(now); twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)
  const threeMonthsAgo = new Date(now); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const tenWeeksAgo = new Date(now); tenWeeksAgo.setDate(tenWeeksAgo.getDate() - 70)

  const dAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }

  const [user, activeMesocycle, currentMetric, recentBodyMetrics, recentWorkouts, workouts2mAgo, workouts3mAgo, metric1m, metric3m] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.mesocycle.findFirst({
      where: { user_id: userId, status: 'active' },
      include: {
        evaluations: { orderBy: { week_number: 'desc' }, take: 3, select: { week_number: true, summary: true, volume_trend: true } },
        diary_notes: { orderBy: { date: 'desc' }, take: 5 }
      }
    }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId }, orderBy: { date: 'desc' } }),
    prisma.bodyMetric.findMany({
      where: { user_id: userId, date: { gte: tenWeeksAgo } },
      orderBy: { date: 'asc' },
      select: { weight: true, date: true }
    }),
    prisma.workout.findMany({
      where: { user_id: userId },
      take: 5, orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true }
    }),
    getWorkoutsInWindow(userId, twoMonthsAgo),
    getWorkoutsInWindow(userId, threeMonthsAgo),
    prisma.bodyMetric.findFirst({ where: { user_id: userId, date: { gte: dAgo(42), lte: dAgo(21) } }, orderBy: { date: 'desc' } }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId, date: { gte: dAgo(105), lte: dAgo(70) } }, orderBy: { date: 'desc' } })
  ])

  const weeklyWeights = computeWeeklyWeights(recentBodyMetrics)
  const profileBlock = buildUserProfileBlock(user, currentMetric, weeklyWeights, [
    { label: 'Actual', metric: currentMetric },
    { label: 'Hace ~1 mes', metric: metric1m },
    { label: 'Hace ~3 meses', metric: metric3m }
  ])

  const mesoBlock = activeMesocycle
    ? (() => {
        const weekNumber = Math.max(1, Math.ceil((now.getTime() - new Date(activeMesocycle.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000)))
        const evalSummary = activeMesocycle.evaluations.length
          ? activeMesocycle.evaluations.map(e => `  Semana ${e.week_number}: ${e.summary ?? 'Sin resumen'} (volumen: ${e.volume_trend ?? 'N/A'})`).join('\n')
          : '  Sin evaluaciones previas.'
        const notesSummary = activeMesocycle.diary_notes.length
          ? activeMesocycle.diary_notes.map(n => `  [${new Date(n.date).toLocaleDateString('es-ES')}] ${n.content}`).join('\n')
          : '  Sin notas de diario.'
        return `- Nombre: ${activeMesocycle.name}
- Semana actual: ${weekNumber}
- Objetivo: ${activeMesocycle.goal || 'No especificado'}
- Split: ${activeMesocycle.split_description || 'No especificado'}
- Objetivo entrenos/semana: ${activeMesocycle.target_volume_weekly ?? 'No especificado'}
Evaluaciones previas:
${evalSummary}
Diario del deportista (últimas notas):
${notesSummary}`
      })()
    : '- No hay ningún mesociclo activo.'

  const recentText = recentWorkouts.length
    ? recentWorkouts.map(formatWorkoutFull).join('\n\n')
    : '- No hay entrenamientos recientes registrados.'

  const twoLabel = twoMonthsAgo.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  const threeLabel = threeMonthsAgo.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  const hist2m = workouts2mAgo.length ? workouts2mAgo.map(formatWorkoutFull).join('\n\n') : '  (Sin datos en esa semana)'
  const hist3m = workouts3mAgo.length ? workouts3mAgo.map(formatWorkoutFull).join('\n\n') : '  (Sin datos en esa semana)'

  const todayStr = `${DAY_NAMES_ES[now.getDay()]}, ${now.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`
  const daysLeftInWeek = 6 - now.getDay() // 0=dom…6=sáb, días hasta el sábado inclusive

  return `Eres "HevyTracker AI", un entrenador personal experto en hipertrofia y powerbuilding integrado en una app que sincroniza datos de Hevy.
Analiza los entrenamientos del usuario, compara con sus objetivos y da feedback constructivo basado en evidencia científica.

HOY: ${todayStr}${daysLeftInWeek > 0 ? ` (quedan ${daysLeftInWeek} días de semana)` : ' (último día de la semana)'}

### PERFIL DEL DEPORTISTA
${profileBlock}

### MESOCICLO ACTIVO
${mesoBlock}

---

### ÚLTIMOS 5 ENTRENAMIENTOS (series completas)
${recentText}

---

### SEMANA DE HACE ~2 MESES (${twoLabel})
${hist2m}

---

### SEMANA DE HACE ~3 MESES (${threeLabel})
${hist3m}

---

### REGLAS:
1. Sé directo y conciso. Responde en Markdown con negritas para valores clave y listas para recomendaciones.
2. Cuando compares progreso usa los datos históricos como referencia concreta (pesos, reps, RPE).
3. Si sugieres cambios justifícalos con datos: RPE, volumen o tendencia de carga.
4. Ten en cuenta las notas del diario del deportista para contextualizar fatiga, sueño o nutrición.
5. No repitas el contexto que ya tienes. Ve directo a la respuesta o análisis.`
}
