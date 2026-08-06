import { prisma } from './prisma'

/**
 * Context builders for the chat endpoint (text-formatted, Spanish).
 * Structured JSON payloads for the stateless endpoints live in ai-payload.ts.
 */

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

/**
 * Lightweight workout line — only date, name, total volume and RPE.
 */
const formatWorkoutSummary = (w: any): string => {
  const dateStr = new Date(w.date).toLocaleDateString('es-ES')
  const parts: string[] = []
  if (w.total_volume) parts.push(`Vol: ${Math.round(Number(w.total_volume)).toLocaleString('es-ES')}kg`)
  if (w.rpe_avg) parts.push(`RPE: ${w.rpe_avg}`)
  if (w.notes) parts.push(`Notas: ${w.notes}`)
  return `  [${dateStr}] ${w.name}${parts.length ? ' | ' + parts.join(' | ') : ''}`
}

interface MetricSnapshot {
  label: string
  metric: any | null
}

function hasMeasurements(m: any): boolean {
  return !!(m?.body_fat_percentage != null || m?.waist != null || m?.left_bicep != null ||
    m?.right_bicep != null || m?.chest != null || m?.left_thigh != null || m?.right_thigh != null ||
    m?.hips != null || m?.neck != null || m?.left_calf != null || m?.right_calf != null)
}

function avg2(a: any, b: any): string | null {
  const va = a != null ? parseFloat(a) : null
  const vb = b != null ? parseFloat(b) : null
  if (va == null && vb == null) return null
  const result = va != null && vb != null ? (va + vb) / 2 : (va ?? vb)!
  return result.toFixed(1)
}

function formatSnapshot(s: MetricSnapshot): string | null {
  const m = s.metric
  if (!m || !hasMeasurements(m)) return null
  const dateStr = new Date(m.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })
  const parts: string[] = []
  if (m.body_fat_percentage != null) parts.push(`${parseFloat(m.body_fat_percentage).toFixed(1)}% grasa`)
  if (m.lean_mass != null) parts.push(`masa magra ${parseFloat(m.lean_mass).toFixed(1)}kg`)
  if (m.waist != null) parts.push(`cintura ${parseFloat(m.waist).toFixed(1)}cm`)
  if (m.abdomen != null) parts.push(`abdomen ${parseFloat(m.abdomen).toFixed(1)}cm`)
  const biceps = avg2(m.left_bicep, m.right_bicep)
  if (biceps) parts.push(`bíceps ${biceps}cm`)
  if (m.chest != null) parts.push(`pecho ${parseFloat(m.chest).toFixed(1)}cm`)
  const thighs = avg2(m.left_thigh, m.right_thigh)
  if (thighs) parts.push(`muslos ${thighs}cm`)
  if (m.hips != null) parts.push(`caderas ${parseFloat(m.hips).toFixed(1)}cm`)
  if (m.neck != null) parts.push(`cuello ${parseFloat(m.neck).toFixed(1)}cm`)
  const calves = avg2(m.left_calf, m.right_calf)
  if (calves) parts.push(`gemelos ${calves}cm`)
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

/**
 * Lean system prompt for the chat endpoint. Carries only the minimum context
 * (profile + active mesocycle + last 3 workout summaries). Historical data is
 * fetched on-demand by the model via tool calls — see server/utils/ai-tools.ts.
 */
export const buildLeanSystemPrompt = async (userId: string): Promise<string> => {
  const now = new Date()
  const dAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }
  const tenWeeksAgo = dAgo(70)

  const [user, activeMesocycle, currentMetric, recentBodyMetrics, recentWorkouts, metric1m, metric3m, activeNotes] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.mesocycle.findFirst({
      where: { user_id: userId, status: 'active' },
      include: {
        evaluations: { orderBy: { week_number: 'desc' }, take: 2, select: { week_number: true, summary: true, volume_trend: true } },
        diary_notes: { orderBy: { date: 'desc' }, take: 3 }
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
      take: 3, orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, notes: true }
    }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId, date: { gte: dAgo(42), lte: dAgo(21) } }, orderBy: { date: 'desc' } }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId, date: { gte: dAgo(105), lte: dAgo(70) } }, orderBy: { date: 'desc' } }),
    prisma.aiNote.findMany({ where: { user_id: userId, is_active: true }, orderBy: { created_at: 'asc' } })
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
- ID: ${activeMesocycle.id}
- Semana actual: ${weekNumber}
- Objetivo: ${activeMesocycle.goal || 'No especificado'}
- Split: ${activeMesocycle.split_description || 'No especificado'}
- Objetivo entrenos/semana: ${activeMesocycle.target_volume_weekly ?? 'No especificado'}
Últimas evaluaciones:
${evalSummary}
Diario reciente:
${notesSummary}`
      })()
    : '- No hay ningún mesociclo activo.'

  const recentText = recentWorkouts.length
    ? recentWorkouts.map(formatWorkoutSummary).join('\n')
    : '- No hay entrenamientos recientes registrados.'

  const notesBlock = activeNotes.length > 0
    ? activeNotes.map(n => `- [${n.id}] ${n.content}`).join('\n')
    : '- Sin notas guardadas.'

  const todayStr = `${DAY_NAMES_ES[now.getDay()]}, ${now.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`
  const daysLeftInWeek = 6 - now.getDay()

  return `Eres "HevyTracker AI", un entrenador personal experto en hipertrofia y powerbuilding integrado en una app que sincroniza datos de Hevy.
Analiza los entrenamientos del usuario, compara con sus objetivos y da feedback constructivo basado en evidencia científica.

HOY: ${todayStr}${daysLeftInWeek > 0 ? ` (quedan ${daysLeftInWeek} días de semana)` : ' (último día de la semana)'}

### PERFIL DEL DEPORTISTA
${profileBlock}

### MESOCICLO ACTIVO
${mesoBlock}

### ÚLTIMOS 3 ENTRENAMIENTOS (resumen)
${recentText}

### NOTAS RECORDADAS
${notesBlock}

---

### CÓMO RESPONDER
Tienes acceso a herramientas para consultar más datos bajo demanda. Úsalas solo cuando realmente las necesites:
- Preguntas que se responden con el contexto anterior → responde directamente sin invocar herramientas.
- Comparaciones históricas, semanas concretas, progresión de ejercicios, métricas corporales pasadas, mesociclos anteriores → invoca la herramienta apropiada.
- Para series detalladas de un entreno concreto usa get_workout_detail, no get_workouts_in_range con detail=full.
- Encadena varias herramientas si la pregunta lo requiere, pero evita llamadas redundantes.
- Si una herramienta devuelve un error o datos vacíos, dilo claramente en lugar de inventar cifras.
- Usa \`save_user_note\` cuando el usuario mencione preferencias, contexto temporal (viajes, eventos, estrés), objetivos concretos, restricciones nuevas o contexto nutricional que no esté ya en su perfil. Hazlo en el mismo turno en que el usuario lo menciona.
- Usa \`deactivate_user_note\` con el ID entre corchetes cuando el usuario confirme que la situación se resolvió, la fecha de la nota ya pasó, o el usuario la contradiga directamente. Si hay duda, no la desactives.

### REGLAS DE ESTILO
1. Sé directo y conciso. Markdown con negritas para valores clave y listas para recomendaciones.
2. Justifica sugerencias con datos concretos (RPE, volumen, 1RM, tendencia).
3. Ten en cuenta notas del diario para contextualizar fatiga, sueño o nutrición.
4. No repitas el contexto que ya tienes. Ve directo a la respuesta.`
}
