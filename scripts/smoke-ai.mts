/**
 * Exercises the AI layer end to end WITHOUT calling a model: serializers,
 * context builders, temporal windows, tool results, tool ownership, tool
 * selection, memory writes, the plan validator, and the chat/plan runners
 * driven by a scripted fake provider.
 *
 *   DATABASE_URL="file:/abs/path/prisma/dev.db" npx tsx scripts/smoke-ai.mts
 *
 * Everything runs against the real code paths and the real database with a
 * throwaway user, and cleans up after itself. The only thing replaced is the
 * provider — which is exactly the piece that costs money and is nondeterministic.
 */
import { PrismaClient } from '@prisma/client'

// h3's `createError` is a Nitro auto-import; outside the server runtime it has
// to exist before any module that throws through it is loaded.
;(globalThis as any).createError = (input: any) => {
  const error: any = new Error(input?.statusMessage ?? input?.message ?? 'error')
  Object.assign(error, input)
  return error
}

const { buildAthleteProfile, buildHistoricalReference, buildNutritionSnapshot, buildWorkoutData } =
  await import('../server/utils/ai-payload')
const {
  formatSet, renderWorkoutAnalysis, serializeAthlete, serializeNutrition, serializeWorkout, table
} = await import('../server/utils/ai-serialize')
const { buildLeanSystemPrompt } = await import('../server/utils/ai-context')
const { executeTool, matchToolDomains, selectChatTools, AI_TOOLS } = await import('../server/utils/ai-tools')
const { validateGeneratedMesocycle } = await import('../server/utils/ai-plan-validator')
const { runChatTurn } = await import('../server/utils/ai-chat')
const { generateMesocyclePlan } = await import('../server/utils/ai-plan-generator')
const { rowCost } = await import('../server/utils/ai-usage')
const { savePlan } = await import('../server/utils/plan-service')
const { buildWorkoutMetrics } = await import('../server/utils/workout-metrics')
const { writeWorkoutExercises } = await import('../server/utils/exercise-store')
const { refreshTemplateAliases } = await import('../server/utils/exercise-aliases')

type ChatMessage = import('../server/utils/ai-provider').ChatMessage
type GenerateOptions = import('../server/utils/ai-provider').GenerateOptions
type GenerateResult = import('../server/utils/ai-provider').GenerateResult
type StreamEvent = import('../server/utils/ai-provider').StreamEvent

const prisma = new PrismaClient()
let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${detail}`); failures++ }
}

/** A provider that answers from a script and records what it was asked. */
class FakeProvider {
  readonly model = 'fake/model-1'
  calls: Array<{ messages: ChatMessage[]; options: GenerateOptions }> = []
  constructor(private script: Array<Partial<GenerateResult>>) {}

  async generate(messages: ChatMessage[], options: GenerateOptions = {}): Promise<GenerateResult> {
    this.calls.push({ messages: structuredClone(messages), options })
    const next = this.script.shift() ?? { text: 'sin guion' }
    return {
      text: next.text ?? null,
      toolCalls: next.toolCalls ?? [],
      usage: next.usage ?? {
        inputTokens: 100, outputTokens: 20, totalTokens: 120,
        cachedInputTokens: 40, reasoningTokens: 5
      },
      latencyMs: 12
    }
  }

  async *generateStream(messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
    const result = await this.generate(messages, options)
    if (result.text) yield { type: 'text', delta: result.text }
    if (result.toolCalls.length) yield { type: 'toolCalls', toolCalls: result.toolCalls }
    yield { type: 'usage', usage: result.usage, latencyMs: result.latencyMs }
  }

  /** The system prompt of the last call — what the model actually knew. */
  get lastSystemPrompt(): string {
    const last = this.calls[this.calls.length - 1]
    return last?.messages.find(m => m.role === 'system')?.content ?? ''
  }

  get lastToolNames(): string[] {
    return (this.calls[this.calls.length - 1]?.options.tools ?? []).map(t => t.name)
  }
}

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d }

/** A workout row with real metrics, from a minimal Hevy-shaped payload. */
async function createWorkout(userId: string, opts: {
  name: string
  date: Date
  mesocycleId?: string
  exercises: Array<{ title: string; templateId: string | null; sets: Array<{ weight: number; reps: number; rpe?: number; type?: string }> }>
}) {
  const raw = {
    id: `w-${Math.random().toString(36).slice(2)}`,
    title: opts.name,
    start_time: opts.date.toISOString(),
    end_time: new Date(opts.date.getTime() + 3600_000).toISOString(),
    exercises: opts.exercises.map((e, i) => ({
      index: i,
      title: e.title,
      exercise_template_id: e.templateId,
      sets: e.sets.map((s, j) => ({
        index: j, type: s.type ?? 'normal', weight_kg: s.weight, reps: s.reps, rpe: s.rpe ?? null
      }))
    }))
  }
  const m = buildWorkoutMetrics(raw as any)
  const workout = await prisma.workout.create({
    data: {
      user_id: userId,
      hevy_id: raw.id,
      name: opts.name,
      date: opts.date,
      ...(opts.mesocycleId && { mesocycle_id: opts.mesocycleId }),
      total_volume: m.totalVolume,
      total_tonnage: m.totalTonnage,
      rpe_avg: m.rpeAvg,
      exercises_summary: JSON.stringify(m.summary),
      raw_data: JSON.stringify(raw)
    }
  })
  await writeWorkoutExercises(workout.id, userId, opts.date, m.summary)
  return workout
}

async function main() {
  const stamp = Date.now()
  const user = await prisma.user.create({
    data: {
      name: 'SmokeAI', email: `smokeai-${stamp}@test.local`, password_hash: 'x',
      sex: 'male', height: 178, birth_date: new Date('1994-05-01'),
      injuries_notes: 'Hombro derecho: evitar press militar con barra.'
    }
  })
  const other = await prisma.user.create({
    data: { name: 'SmokeAIOther', email: `smokeai-other-${stamp}@test.local`, password_hash: 'x' }
  })

  try {
    await prisma.exerciseTemplate.createMany({
      data: [
        { id: 'AI_BENCH', title: 'Bench Press (Barbell)', type: 'weight_reps', primary_muscle_group: 'chest', secondary_muscle_groups: JSON.stringify(['triceps']), equipment_category: 'barbell' },
        { id: 'AI_ROW', title: 'Barbell Row', type: 'weight_reps', primary_muscle_group: 'upper_back', secondary_muscle_groups: JSON.stringify(['biceps']), equipment_category: 'barbell' }
      ]
    })

    // ── Serializers ──────────────────────────────────────────────────────────
    console.log('\n── Serializadores ──')

    check('una serie normal no lleva marca', formatSet({ set: 1, weight_kg: 100, reps: 8, rpe: 8 }) === '100×8@8',
      formatSet({ set: 1, weight_kg: 100, reps: 8, rpe: 8 }))
    check('el calentamiento se marca con c', formatSet({ set: 1, type: 'warmup', weight_kg: 60, reps: 10 }) === '60×10c')
    check('dropset y fallo se distinguen',
      formatSet({ set: 1, type: 'dropset', weight_kg: 50, reps: 8 }) === '50×8d' &&
      formatSet({ set: 1, type: 'failure', weight_kg: 50, reps: 8 }) === '50×8f')

    const emptyColumn = table(['a', 'b', 'c'], [['1', null, '3'], ['4', null, '6']])
    check('la tabla descarta columnas sin datos', !emptyColumn.includes('b') && emptyColumn.includes('a | c'), emptyColumn)

    const athleteText = serializeAthlete({
      name: 'Test', sex: 'male', age_years: 31, height_cm: 178,
      weight_history: [{ week: '2026-08-03', avg_kg: 82.4, samples: 3 }],
      injuries_limitations: 'Hombro derecho tocado',
      active_notes: ['Viaja en julio']
    })
    check('el perfil serializado nombra las lesiones como restricción',
      athleteText.includes('LESIONES') && athleteText.includes('Hombro derecho tocado'), athleteText)
    check('el perfil no imprime ceros por datos ausentes', !/\b0 cm\b/.test(athleteText))

    // ── Temporal context ─────────────────────────────────────────────────────
    console.log('\n── Contexto temporal ──')

    await prisma.bodyMetric.createMany({
      data: [
        { user_id: user.id, date: daysAgo(200), weight: 74, waist: 80 },
        { user_id: user.id, date: daysAgo(2), weight: 84, waist: 88 }
      ]
    })
    await prisma.aiNote.create({ data: { user_id: user.id, content: 'Nota escrita esta semana sobre el viaje.' } })

    const profileNow = await buildAthleteProfile(user.id)
    const profilePast = await buildAthleteProfile(user.id, { asOf: daysAgo(150) })

    check('el perfil actual usa el peso reciente',
      profileNow.weight_history.some(w => w.avg_kg === 84), JSON.stringify(profileNow.weight_history))
    check('el perfil histórico NO usa datos posteriores a su fecha',
      !profilePast.weight_history.some(w => w.avg_kg === 84) &&
      !(profilePast.body_measurements?.current?.waist_cm === 88),
      JSON.stringify(profilePast))
    check('el perfil histórico NO trae notas escritas después',
      (profilePast.active_notes ?? []).length === 0, JSON.stringify(profilePast.active_notes))
    check('las lesiones viajan por defecto en cualquier tarea',
      !!profileNow.injuries_limitations && !!profilePast.injuries_limitations)
    check('la edad se calcula a la fecha de referencia',
      (profilePast.age_years ?? 0) <= (profileNow.age_years ?? 0), `${profilePast.age_years} vs ${profileNow.age_years}`)

    // ── Historical reference ─────────────────────────────────────────────────
    console.log('\n── Referencia histórica del análisis ──')

    // Same movement, logged in Spanish (as Hevy logs it) with the English
    // catalogue's template id — the case name matching always failed.
    const oldSession = await createWorkout(user.id, {
      name: 'Empuje', date: daysAgo(75),
      exercises: [{ title: 'Press de banca (Barra)', templateId: 'AI_BENCH', sets: [{ weight: 90, reps: 8, rpe: 8 }] }]
    })
    // Noise between the two: sessions with nothing in common must not crowd the
    // comparable one out of the list.
    for (const n of [40, 35, 30, 25, 20]) {
      await createWorkout(user.id, {
        name: 'Tirón', date: daysAgo(n),
        exercises: [{ title: 'Remo con barra', templateId: 'AI_ROW', sets: [{ weight: 70, reps: 10, rpe: 8 }] }]
      })
    }
    const target = await createWorkout(user.id, {
      name: 'Empuje', date: daysAgo(1),
      exercises: [{ title: 'Press de banca (Barra)', templateId: 'AI_BENCH', sets: [{ weight: 60, reps: 10, type: 'warmup' }, { weight: 100, reps: 8, rpe: 9 }] }]
    })
    // A session AFTER the analysed one: never a candidate.
    await createWorkout(user.id, {
      name: 'Empuje', date: new Date(),
      exercises: [{ title: 'Press de banca (Barra)', templateId: 'AI_BENCH', sets: [{ weight: 105, reps: 8, rpe: 9 }] }]
    })

    const reference = await buildHistoricalReference(user.id, target as any)
    check('encuentra la sesión comparable fuera de la ventana 21-35 días',
      reference.some(w => w.date === oldSession.date.toISOString().substring(0, 10)),
      JSON.stringify(reference.map(w => w.date)))
    check('no cuela sesiones sin ejercicios en común',
      reference.every(w => (w.exercises ?? []).every(e => e.name.toLowerCase().includes('banca'))),
      JSON.stringify(reference.map(w => w.exercises?.map(e => e.name))))
    check('no usa sesiones posteriores a la analizada',
      reference.every(w => w.date < target.date.toISOString().substring(0, 10)))
    check('van de la más antigua a la más reciente',
      reference.every((w, i) => i === 0 || w.date >= reference[i - 1].date))

    const analysisDoc = renderWorkoutAnalysis({
      task: 'workout_analysis',
      today: new Date().toISOString().substring(0, 10),
      athlete: await buildAthleteProfile(user.id, { asOf: target.date }),
      workout: buildWorkoutData(target),
      historical_reference: reference
    })
    check('el documento de análisis lleva las lesiones', analysisDoc.includes('LESIONES'))
    check('el documento marca el calentamiento sin contarlo como trabajo', analysisDoc.includes('60×10c'))
    check('el documento es texto compacto, no JSON', !analysisDoc.includes('"sets_detail"') && analysisDoc.includes('## ENTRENAMIENTO'))

    // ── Tool results ─────────────────────────────────────────────────────────
    console.log('\n── Resultados de herramientas ──')

    await refreshTemplateAliases(user.id)

    const workoutsResult = await executeTool('get_workouts_in_range', user.id, {
      start_date: daysAgo(90).toISOString().substring(0, 10),
      end_date: new Date().toISOString().substring(0, 10)
    })
    check('get_workouts_in_range devuelve texto', typeof workoutsResult === 'string')
    check('no filtra campos internos',
      !workoutsResult.includes('user_id') && !workoutsResult.includes('raw_data') && !workoutsResult.includes('null'),
      workoutsResult.slice(0, 200))
    check('trae la tabla de ejercicios', workoutsResult.includes('ejercicio | series'))

    const detail = await executeTool('get_workout_detail', user.id, { workout_id: target.id })
    check('get_workout_detail trae las series', detail.includes('100×8@9'), detail)

    const progression = await executeTool('get_exercise_progression', user.id, { exercise_name: 'Press de banca (Barra)', weeks_back: 52 })
    check('la progresión encuentra el ejercicio por nombre exacto', progression.includes('PROGRESIÓN'), progression.slice(0, 120))

    const bodyText = await executeTool('get_body_metrics_range', user.id, {
      start_date: daysAgo(365).toISOString().substring(0, 10),
      end_date: new Date().toISOString().substring(0, 10)
    })
    check('las métricas corporales omiten columnas vacías',
      bodyText.includes('peso_kg') && !bodyText.includes('HRV'), bodyText.slice(0, 200))

    // ── Ownership ────────────────────────────────────────────────────────────
    console.log('\n── Propiedad de los recursos ──')

    const otherWorkout = await createWorkout(other.id, {
      name: 'Sesión ajena', date: daysAgo(3),
      exercises: [{ title: 'Sentadilla secreta', templateId: null, sets: [{ weight: 200, reps: 5 }] }]
    })
    const stolen = await executeTool('get_workout_detail', user.id, { workout_id: otherWorkout.id })
    check('un workout_id de otro usuario no devuelve nada',
      !stolen.includes('Sentadilla secreta') && stolen.toLowerCase().includes('no encontrado'), stolen)

    const otherMeso = await prisma.mesocycle.create({
      data: { user_id: other.id, name: 'Bloque ajeno', start_date: daysAgo(10), status: 'active' }
    })
    const stolenEvals = await executeTool('get_mesocycle_evaluations', user.id, { mesocycle_id: otherMeso.id })
    check('un mesocycle_id de otro usuario no devuelve su bloque',
      !stolenEvals.includes('Bloque ajeno'), stolenEvals)

    const stolenPlan = await executeTool('get_active_plan', user.id, { mesocycle_id: otherMeso.id })
    check('get_active_plan no cruza de usuario', !stolenPlan.includes('Bloque ajeno'), stolenPlan)

    const otherNote = await prisma.aiNote.create({ data: { user_id: other.id, content: 'Nota ajena' } })
    const stolenDeactivate = await executeTool('deactivate_user_note', user.id, { note_id: otherNote.id })
    const stillActive = await prisma.aiNote.findUnique({ where: { id: otherNote.id } })
    check('no se puede desactivar la nota de otro usuario',
      stolenDeactivate.startsWith('ERROR') && stillActive?.is_active === true, stolenDeactivate)

    // ── Memory ───────────────────────────────────────────────────────────────
    console.log('\n── Memoria / notas ──')

    const noteText = 'Viaja a Londres del 20 al 30 de mayo y no tendrá gimnasio.'
    const saved = await executeTool('save_user_note', user.id, { content: noteText })
    check('guarda una nota nueva', saved.startsWith('Nota guardada'), saved)
    const dup = await executeTool('save_user_note', user.id, { content: 'Viaja a Londres del 20 al 30 de mayo, sin gimnasio disponible.' })
    check('no duplica una nota equivalente', dup.includes('Ya existe una nota equivalente'), dup)
    const notesCount = await prisma.aiNote.count({ where: { user_id: user.id, is_active: true, content: { contains: 'Londres' } } })
    check('y no crea una segunda fila', notesCount === 1, String(notesCount))
    const tooShort = await executeTool('save_user_note', user.id, { content: 'ok' })
    check('rechaza una nota vacía o trivial', tooShort.startsWith('ERROR'), tooShort)

    // ── Tool selection ───────────────────────────────────────────────────────
    console.log('\n── Selección de herramientas ──')

    const nutritionTools = selectChatTools('¿Cuántas calorías tiene mi desayuno?').map(t => t.name)
    check('una pregunta solo de dieta no arrastra las de entreno',
      nutritionTools.includes('get_diet') && !nutritionTools.includes('get_workouts_in_range'), nutritionTools.join(','))
    check('las de memoria viajan siempre', nutritionTools.includes('save_user_note'))
    const openTools = selectChatTools('¿Cómo voy?').map(t => t.name)
    check('una pregunta ambigua conserva todas', openTools.length === AI_TOOLS.length, String(openTools.length))
    const mixedTools = selectChatTools('¿Mi dieta encaja con el volumen de entrenamiento?').map(t => t.name)
    check('una pregunta de dos dominios conserva todas', mixedTools.length === AI_TOOLS.length)
    check('detecta el dominio de plan', matchToolDomains('¿qué me toca mañana según el plan?').includes('plan'))

    // ── Plan validator ───────────────────────────────────────────────────────
    console.log('\n── Validación del plan generado ──')

    const allowed = new Set(['AI_BENCH', 'AI_ROW'])
    const known = new Set(['AI_BENCH', 'AI_ROW'])
    const validOptions = { durationWeeks: 4, daysPerWeek: 2, allowedTemplateIds: allowed, knownTemplateIds: known }

    const goodPlan = validateGeneratedMesocycle({
      name: 'Bloque', goal: 'Hipertrofia', notes: null,
      weeks: [
        { week_number: 1, target_rir: 3, volume_multiplier: 1 },
        { week_number: 2, target_rir: 2, volume_multiplier: 1 },
        { week_number: 3, target_rir: 1, volume_multiplier: 1 },
        { week_number: 4, is_deload: true, target_rir: 4, volume_multiplier: 0.5 }
      ],
      sessions: [
        { name: 'Empuje', day_of_week: 1, exercises: [{ exercise_template_id: 'AI_BENCH', name: 'Bench Press (Barbell)', target_sets: 4, rep_min: 6, rep_max: 8, target_rir: 2 }] },
        { name: 'Tirón', day_of_week: 4, exercises: [{ exercise_template_id: 'AI_ROW', name: 'Barbell Row', target_sets: 4, rep_min: 8, rep_max: 10, target_rir: 2 }] }
      ]
    }, validOptions)
    check('un plan correcto pasa sin avisos', goodPlan.warnings.length === 0 && goodPlan.repairs.length === 0,
      JSON.stringify([goodPlan.warnings, goodPlan.repairs]))

    const repaired = validateGeneratedMesocycle({
      name: 'Bloque',
      weeks: [{ week_number: 1, volume_multiplier: 4 }],
      sessions: [{
        name: 'Empuje', day_of_week: 9,
        exercises: [
          { exercise_template_id: 'INVENTADO', name: 'Press inventado', target_sets: 0, rep_min: 12, rep_max: 6, target_rir: 12 },
          { name: 'Ejercicio sin id', target_sets: 99 }
        ]
      }]
    }, validOptions)
    const bench = repaired.sessions[0].exercises[0]
    check('descarta un id que no salió de la herramienta',
      !bench.exercise_template_id && repaired.warnings.some(w => w.includes('no salió de la búsqueda')),
      JSON.stringify(repaired.warnings))
    check('corrige el rango de repeticiones invertido', bench.rep_min === 6 && bench.rep_max === 12)
    check('sube las series a un mínimo utilizable', (bench.target_sets ?? 0) >= 1)
    check('acota el RIR', (bench.target_rir ?? 0) <= 6)
    check('acota el multiplicador de volumen', (repaired.weeks[0].volume_multiplier ?? 0) <= 1.5)
    check('completa las semanas que faltan', repaired.weeks.length === 4)
    check('avisa de que faltan sesiones para los días pedidos',
      repaired.warnings.some(w => w.includes('sesiones por semana')), JSON.stringify(repaired.warnings))
    check('avisa de que la última semana no es descarga',
      repaired.warnings.some(w => w.includes('descarga')), JSON.stringify(repaired.warnings))
    check('el día de la semana fuera de rango se acota', repaired.sessions[0].day_of_week === 7)

    const rejects = (raw: any) => {
      try { validateGeneratedMesocycle(raw, validOptions); return false } catch { return true }
    }
    check('rechaza un plan sin sesiones', rejects({ sessions: [] }))
    check('rechaza una sesión sin ejercicios', rejects({ sessions: [{ name: 'X', exercises: [] }] }))
    check('rechaza un ejercicio sin nombre', rejects({ sessions: [{ name: 'X', exercises: [{ target_sets: 3 }] }] }))
    check('rechaza una respuesta que no es un objeto', rejects('no soy un plan'))

    // ── Cost accounting ──────────────────────────────────────────────────────
    console.log('\n── Contabilidad de coste ──')

    const prices = new Map([['fake/model-1', {
      id: 'p1', model: 'fake/model-1', input_per_1m: 3, output_per_1m: 15,
      cached_input_per_1m: 0.3, currency: 'USD', created_at: new Date(), updated_at: new Date()
    } as any]])
    const fullPrice = rowCost({ model: 'fake/model-1', inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000, cachedInputTokens: 0 }, prices)
    const cachedPrice = rowCost({ model: 'fake/model-1', inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000, cachedInputTokens: 1_000_000 }, prices)
    check('el input cacheado se cobra a su tarifa', fullPrice === 3 && cachedPrice === 0.3, `${fullPrice} / ${cachedPrice}`)
    const noCachePrice = rowCost({ model: 'fake/model-1', inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000, cachedInputTokens: null }, prices)
    check('sin dato de caché se cobra todo como entrada normal', noCachePrice === 3, String(noCachePrice))
    check('un modelo sin precio no se estima',
      rowCost({ model: 'otro/modelo', inputTokens: 100, outputTokens: 100, totalTokens: 200 }, prices) === null)

    // ── Chat, with a scripted provider ───────────────────────────────────────
    console.log('\n── Chat (proveedor simulado) ──')

    const meso = await prisma.mesocycle.create({
      data: {
        user_id: user.id, name: 'Bloque hipertrofia', goal: 'Ganar tamaño',
        start_date: daysAgo(14), status: 'active', target_sessions_weekly: 2
      }
    })
    await savePlan(meso.id, user.id, [
      { name: 'Empuje', day_of_week: 1, exercises: [{ exercise_template_id: 'AI_BENCH', name: 'Bench Press (Barbell)', target_sets: 4, rep_min: 6, rep_max: 8, target_rir: 2 }] },
      { name: 'Tirón', day_of_week: 4, exercises: [{ exercise_template_id: 'AI_ROW', name: 'Barbell Row', target_sets: 4, rep_min: 8, rep_max: 10, target_rir: 2 }] }
    ], [{ week_number: 1, target_rir: 3, volume_multiplier: 1 }, { week_number: 2, target_rir: 2, volume_multiplier: 1 }])

    // 1. Simple turn: no tools.
    const simple = new FakeProvider([{ text: 'Vas bien.' }])
    const turn1 = await runChatTurn({
      userId: user.id, conversationId: null, message: 'Hola, ¿qué tal?', keys: {}, provider: simple as any
    })
    check('turno simple responde sin herramientas', turn1.reply === 'Vas bien.' && turn1.toolsInvoked.length === 0)
    check('el prompt de sistema lleva las lesiones del deportista',
      simple.lastSystemPrompt.includes('LESIONES'), simple.lastSystemPrompt.slice(0, 200))
    check('el prompt empieza por las reglas (prefijo cacheable)',
      simple.lastSystemPrompt.startsWith('Eres "HevyTracker AI"'))
    check('las reglas van antes que los datos del atleta',
      simple.lastSystemPrompt.indexOf('SEGURIDAD') < simple.lastSystemPrompt.indexOf('CONTEXTO DEL DEPORTISTA'))
    check('pide caché de prefijo', simple.calls[0].options.cachePrefix === true)
    check('el chat razona en bajo', simple.calls[0].options.reasoningEffort === 'low')
    check('registra métricas de la llamada', turn1.metrics.latencyMs > 0 && turn1.metrics.toolRounds === 0)

    const storedMessage = await prisma.aiMessage.findFirst({
      where: { conversation_id: turn1.conversationId, role: 'assistant' },
      orderBy: { created_at: 'desc' }
    })
    check('persiste el desglose de tokens y la latencia',
      storedMessage?.input_tokens === 100 && storedMessage?.cached_input_tokens === 40 &&
      storedMessage?.reasoning_tokens === 5 && (storedMessage?.latency_ms ?? 0) > 0,
      JSON.stringify(storedMessage))

    // 2. One tool.
    const oneTool = new FakeProvider([
      { toolCalls: [{ id: 'c1', name: 'get_next_planned_session', arguments: {} }] },
      { text: 'Te toca Empuje.' }
    ])
    const turn2 = await runChatTurn({
      userId: user.id, conversationId: null, message: '¿Qué sesión me toca hoy según el plan?', keys: {}, provider: oneTool as any
    })
    check('usa la herramienta de plan', turn2.toolsInvoked.includes('get_next_planned_session'))
    const toolMessage = oneTool.calls[1].messages.find(m => m.role === 'tool')
    check('el resultado de la herramienta llega como texto, sin JSON',
      !!toolMessage && toolMessage.content.includes('SIGUIENTE SESIÓN') && !toolMessage.content.startsWith('{'),
      toolMessage?.content.slice(0, 120))
    check('la pregunta de plan recorta las herramientas ofrecidas',
      oneTool.lastToolNames.includes('get_active_plan') && !oneTool.lastToolNames.includes('get_diet'),
      oneTool.lastToolNames.join(','))
    check('el plan responde con la carga sugerida',
      (toolMessage?.content ?? '').includes('carga sugerida_kg'))

    // 3. Several tools in one turn.
    const multiTool = new FakeProvider([
      {
        toolCalls: [
          { id: 'c1', name: 'get_training_alerts', arguments: {} },
          { id: 'c2', name: 'get_volume_by_muscle_group', arguments: { weeks_back: 4 } }
        ]
      },
      { toolCalls: [{ id: 'c3', name: 'get_personal_records', arguments: {} }] },
      { text: 'Resumen final.' }
    ])
    const turn3 = await runChatTurn({
      userId: user.id, conversationId: null, message: '¿Cómo voy de volumen, récords y alertas?', keys: {}, provider: multiTool as any
    })
    check('encadena varias herramientas', turn3.toolsInvoked.length === 3 && turn3.metrics.toolRounds === 2,
      JSON.stringify(turn3.toolsInvoked))
    check('suma el uso de todas las llamadas', turn3.usage.totalTokens === 360, String(turn3.usage.totalTokens))
    check('suma también los tokens cacheados', turn3.usage.cachedInputTokens === 120, String(turn3.usage.cachedInputTokens))

    // 4. Nutrition turn.
    const dietPlan = await prisma.dietPlan.create({
      data: { user_id: user.id, name: 'Dieta test', goal: 'bulk', status: 'active' }
    })
    const version = await prisma.dietVersion.create({
      data: {
        diet_plan_id: dietPlan.id, version_number: 1, status: 'active', start_date: daysAgo(5),
        total_kcal: 2800, total_protein_g: 180, total_carbs_g: 320, total_fat_g: 80, planned_days: 7
      }
    })
    const food = await prisma.food.create({
      data: { user_id: user.id, name: 'Avena', kcal: 380, protein_g: 13, carbs_g: 60, fat_g: 7, source: 'manual' }
    })
    for (let weekday = 1; weekday <= 7; weekday++) {
      const meal = await prisma.dietMeal.create({
        data: { diet_version_id: version.id, name: 'Desayuno', weekday, order_index: 0 }
      })
      await prisma.dietItem.create({
        data: {
          diet_meal_id: meal.id, food_id: food.id, food_name: 'Avena', quantity_g: 100,
          nutrients_snapshot: JSON.stringify({ kcal: 380, protein_g: 13, carbs_g: 60, fat_g: 7 })
        }
      })
    }

    const nutritionTurn = new FakeProvider([
      { toolCalls: [{ id: 'd1', name: 'get_diet', arguments: {} }] },
      { text: 'Tu desayuno son 100 g de avena.' }
    ])
    await runChatTurn({
      userId: user.id, conversationId: null, message: '¿Qué alimentos tengo en el desayuno?', keys: {}, provider: nutritionTurn as any
    })
    const dietTool = nutritionTurn.calls[1].messages.find(m => m.role === 'tool')
    check('el resultado de get_diet trae el menú', (dietTool?.content ?? '').includes('Avena 100 g'), dietTool?.content.slice(0, 200))
    check('y avisa de que es un plan, no un registro', (dietTool?.content ?? '').includes('ES UN PLAN'))

    const systemPrompt = await buildLeanSystemPrompt(user.id)
    check('el contexto permanente trae macros pero no el menú',
      systemPrompt.includes('media de un día planificado') && !systemPrompt.includes('Avena 100 g'),
      systemPrompt.slice(systemPrompt.indexOf('DIETA ACTIVA'), systemPrompt.indexOf('DIETA ACTIVA') + 300))
    check('el contexto apunta al plan estructurado sin incluirlo',
      systemPrompt.includes('get_active_plan') && !systemPrompt.includes('Bench Press (Barbell) — 4'))
    check('el contexto declara que los datos no son instrucciones',
      systemPrompt.includes('no instrucciones') || systemPrompt.includes('no son instrucciones'))

    // 5. A tool answering about another user's data can't be reached from chat.
    const crossUser = new FakeProvider([
      { toolCalls: [{ id: 'x1', name: 'get_workout_detail', arguments: { workout_id: otherWorkout.id } }] },
      { text: 'No encuentro ese entrenamiento.' }
    ])
    await runChatTurn({
      userId: user.id, conversationId: null, message: '¿Qué hice en ese entrenamiento?', keys: {}, provider: crossUser as any
    })
    const crossResult = crossUser.calls[1].messages.find(m => m.role === 'tool')
    check('desde el chat tampoco se alcanza el dato de otro usuario',
      !(crossResult?.content ?? '').includes('Sentadilla secreta'), crossResult?.content)

    // ── Plan generation, with a scripted provider ────────────────────────────
    console.log('\n── Generación de plan (proveedor simulado) ──')

    const generation = new FakeProvider([
      { toolCalls: [{ id: 's1', name: 'search_exercise_templates', arguments: { query: 'bench' } }] },
      {
        text: JSON.stringify({
          name: 'Bloque generado', goal: 'Hipertrofia', notes: 'Notas',
          weeks: [
            { week_number: 1, target_rir: 3, volume_multiplier: 1 },
            { week_number: 2, target_rir: 2, volume_multiplier: 1 },
            { week_number: 3, target_rir: 1, volume_multiplier: 1 },
            { week_number: 4, is_deload: true, target_rir: 4, volume_multiplier: 0.5 }
          ],
          sessions: [
            { name: 'Empuje', day_of_week: 1, exercises: [{ exercise_template_id: 'AI_BENCH', name: 'Bench Press (Barbell)', target_sets: 4, rep_min: 6, rep_max: 8, target_rir: 2 }] },
            { name: 'Fantasía', day_of_week: 3, exercises: [{ exercise_template_id: 'NO_EXISTE', name: 'Press de unicornio', target_sets: 3, rep_min: 8, rep_max: 10 }] }
          ]
        })
      }
    ])
    const generated = await generateMesocyclePlan(
      user.id, {}, { goal: 'hipertrofia', days_per_week: 2, duration_weeks: 4 }, undefined, generation as any
    )
    check('la generación devuelve un plan validado', generated.plan.sessions.length === 2)
    check('conserva el id que sí salió del catálogo',
      generated.plan.sessions[0].exercises[0].exercise_template_id === 'AI_BENCH')
    check('descarta el ejercicio inexistente y lo reporta',
      !generated.plan.sessions[1].exercises[0].exercise_template_id &&
      (generated.warning ?? '').includes('descartado'), generated.warning)
    check('avisa de que ese ejercicio no se podrá enviar a Hevy',
      (generated.warning ?? '').includes('Hevy'), generated.warning)
    const generationDoc = generation.calls[0].messages.find(m => m.role === 'user')?.content ?? ''
    check('el documento de generación es texto con secciones',
      generationDoc.includes('## PETICIÓN') && generationDoc.includes('## PERFIL') && !generationDoc.startsWith('{'),
      generationDoc.slice(0, 120))
    check('la generación traslada las lesiones al modelo', generationDoc.includes('LESIONES'))
    check('la generación razona en alto en todas sus rondas',
      generation.calls.every(c => c.options.reasoningEffort === 'high'),
      generation.calls.map(c => c.options.reasoningEffort).join(','))
    // Every round before the forced-answer one is capped below the task budget,
    // and the cap still has to fit a whole mesocycle: any of them may be the
    // round that answers.
    const roundBudget = generation.calls[0].options.maxOutputTokens ?? 0
    check('las rondas intermedias van con presupuesto recortado pero suficiente',
      roundBudget < 48000 && roundBudget >= 16000, String(roundBudget))
    check('la ronda intermedia no fuerza JSON', generation.calls[0].options.jsonMode !== true)

    // The plan that came out must be storable as-is.
    const saveResult = await savePlan(meso.id, user.id, generated.plan.sessions, generated.plan.weeks)
    check('el plan validado se guarda sin errores', saveResult.sessions === 2 && saveResult.exercises === 2,
      JSON.stringify(saveResult))
  } finally {
    // Cascade order: everything hanging off the two users, then the users.
    for (const id of [user.id, other.id]) {
      const conversations = await prisma.aiConversation.findMany({ where: { user_id: id }, select: { id: true } })
      await prisma.aiMessage.deleteMany({ where: { conversation_id: { in: conversations.map(c => c.id) } } })
      await prisma.aiConversation.deleteMany({ where: { user_id: id } })
      await prisma.aiNote.deleteMany({ where: { user_id: id } })
      await prisma.trainingAlert.deleteMany({ where: { user_id: id } })
      await prisma.personalRecord.deleteMany({ where: { user_id: id } })
      await prisma.exerciseSet.deleteMany({ where: { workout_exercise: { user_id: id } } })
      await prisma.workoutExercise.deleteMany({ where: { user_id: id } })
      await prisma.workout.deleteMany({ where: { user_id: id } })
      await prisma.mesocycle.deleteMany({ where: { user_id: id } })
      const plans = await prisma.dietPlan.findMany({ where: { user_id: id }, select: { id: true } })
      const versions = await prisma.dietVersion.findMany({ where: { diet_plan_id: { in: plans.map(p => p.id) } }, select: { id: true } })
      const meals = await prisma.dietMeal.findMany({ where: { diet_version_id: { in: versions.map(v => v.id) } }, select: { id: true } })
      await prisma.dietItem.deleteMany({ where: { diet_meal_id: { in: meals.map(m => m.id) } } })
      await prisma.dietMeal.deleteMany({ where: { id: { in: meals.map(m => m.id) } } })
      await prisma.dietVersion.deleteMany({ where: { id: { in: versions.map(v => v.id) } } })
      await prisma.dietPlan.deleteMany({ where: { user_id: id } })
      await prisma.food.deleteMany({ where: { user_id: id } })
      await prisma.bodyMetric.deleteMany({ where: { user_id: id } })
      await prisma.exerciseTemplateAlias.deleteMany({ where: { user_id: id } })
      await prisma.user.delete({ where: { id } })
    }
    await prisma.exerciseTemplate.deleteMany({ where: { id: { in: ['AI_BENCH', 'AI_ROW'] } } })
  }

  console.log(failures === 0 ? '\n✅ Todo correcto' : `\n❌ ${failures} comprobaciones fallidas`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
