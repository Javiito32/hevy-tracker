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

const {
  buildAthleteProfile, buildCurrentStrength, buildFinalSummaryPayload, buildHistoricalReference,
  buildNutritionHistory, buildNutritionSnapshot, buildWorkoutData
} = await import('../server/utils/ai-payload')
const {
  formatSet, renderFinalSummary, renderMesocycleFeedback, renderWorkoutAnalysis, serializeAthlete, serializeNutrition,
  serializeWorkout, table
} = await import('../server/utils/ai-serialize')
const { buildLeanSystemPrompt, joinSystemPrompt } = await import('../server/utils/ai-context')
const { executeTool, matchToolDomains, selectChatTools, AI_TOOLS } = await import('../server/utils/ai-tools')
const { validateGeneratedMesocycle } = await import('../server/utils/ai-plan-validator')
const { runChatTurn } = await import('../server/utils/ai-chat')
const { generateMesocyclePlan } = await import('../server/utils/ai-plan-generator')
const { rowCost } = await import('../server/utils/ai-usage')
const { toOpenAiMessages, reassembleStreamedReasoning } = await import('../server/utils/ai-provider')
const { matchWorkoutToPlan, savePlan } = await import('../server/utils/plan-service')
const { getCurrentRecords, detectPersonalRecords } = await import('../server/utils/personal-records')
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
        cachedInputTokens: 40, cacheWriteTokens: 10, reasoningTokens: 5
      },
      latencyMs: 12,
      ...(next.reasoningDetails && { reasoningDetails: next.reasoningDetails })
    }
  }

  async *generateStream(messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
    const result = await this.generate(messages, options)
    if (result.text) yield { type: 'text', delta: result.text }
    // Reasoning is reassembled from fragments by the real adapter and emitted
    // whole; the fake emits it whole too, in the same position.
    if (result.reasoningDetails?.length) {
      yield { type: 'reasoningDetails', reasoningDetails: result.reasoningDetails }
    }
    if (result.toolCalls.length) yield { type: 'toolCalls', toolCalls: result.toolCalls }
    yield { type: 'usage', usage: result.usage, latencyMs: result.latencyMs }
  }

  /** The system message of the last call, both halves joined. */
  get lastSystemPrompt(): string {
    return systemTextOf(this.calls[this.calls.length - 1]?.messages ?? [])
  }

  /** Only the half that carries the cache breakpoint. */
  get lastStablePrompt(): string {
    const last = this.calls[this.calls.length - 1]
    return last?.messages.find(m => m.role === 'system')?.stableContent ?? ''
  }

  get lastToolNames(): string[] {
    return (this.calls[this.calls.length - 1]?.options.tools ?? []).map(t => t.name)
  }
}

const systemTextOf = (messages: ChatMessage[]): string => {
  const system = messages.find(m => m.role === 'system')
  if (!system) return ''
  return `${system.stableContent ?? ''}\n\n${system.content}`
}

const { localDayKey: localDayKeyOf } = await import('../server/utils/dates')

const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d }

/** The `g proteína/kg` figure out of a rendered diet, for comparing two of them. */
const proteinPerKgOf = (text: string): string | null =>
  text.match(/([\d.,]+) g prote/)?.[1] ?? null

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
    await detectPersonalRecords(user.id, target.id)
    const recordsEn = await getCurrentRecords(user.id, 'Bench Press (Barbell)')
    const recordsEs = await getCurrentRecords(user.id, 'Press de banca')
    check('los récords resuelven el nombre inglés del catálogo',
      recordsEn.some(r => r.exercise_template_id === 'AI_BENCH'),
      JSON.stringify(recordsEn.map(r => r.exercise_name)))
    check('y el nombre en español del historial',
      recordsEs.some(r => r.exercise_template_id === 'AI_BENCH'),
      JSON.stringify(recordsEs.map(r => r.exercise_name)))

    const workoutsResult = await executeTool('get_workouts_in_range', user.id, {
      start_date: daysAgo(90).toISOString().substring(0, 10),
      end_date: new Date().toISOString().substring(0, 10)
    })
    check('get_workouts_in_range devuelve texto', typeof workoutsResult === 'string')
    check('no filtra campos internos',
      !workoutsResult.includes('user_id') && !workoutsResult.includes('raw_data') && !workoutsResult.includes('null'),
      workoutsResult.slice(0, 200))
    check('trae la tabla de ejercicios', workoutsResult.includes('ejercicio | series'))
    check('get_workouts_in_range incluye el id de la sesión',
      workoutsResult.includes(`id ${target.id}`), workoutsResult.slice(0, 180))

    const detail = await executeTool('get_workout_detail', user.id, { workout_id: target.id })
    check('get_workout_detail trae las series', detail.includes('100×8@9'), detail)

    const progression = await executeTool('get_exercise_progression', user.id, { exercise_name: 'Press de banca (Barra)', weeks_back: 52 })
    check('la progresión encuentra el ejercicio por nombre exacto', progression.includes('PROGRESIÓN'), progression.slice(0, 120))
    const progressionEn = await executeTool('get_exercise_progression', user.id, { exercise_name: 'Bench Press (Barbell)', weeks_back: 52 })
    check('la progresión resuelve el nombre inglés del catálogo al mismo lift',
      progressionEn.includes('PROGRESIÓN') && !progressionEn.includes('varios ejercicios'),
      progressionEn.slice(0, 180))
    await createWorkout(user.id, {
      name: 'Empuje EN', date: daysAgo(2),
      exercises: [{ title: 'Bench Press (Barbell)', templateId: 'AI_BENCH', sets: [{ weight: 95, reps: 8, rpe: 8 }] }]
    })
    const listed = await executeTool('list_exercises', user.id, { weeks_back: 52 })
    const benchRows = listed.split('\n').filter(l => /banca|bench press/i.test(l))
    check('list_exercises agrupa el mismo template aunque el título cambie',
      benchRows.length === 1, listed)

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

    // Accents must not decide the domain: the same question written either way
    // has to land in the same place, or it silently falls through to "todas".
    check('los acentos no cambian el dominio detectado',
      JSON.stringify(matchToolDomains('¿cuánta proteína como?')) ===
      JSON.stringify(matchToolDomains('¿cuanta proteina como?')),
      JSON.stringify(matchToolDomains('¿cuánta proteína como?')))
    check('"proteína" acentuada se reconoce como dieta',
      matchToolDomains('¿cuánta proteína como?').includes('nutrition'))
    check('"récord" acentuado se reconoce como entreno',
      matchToolDomains('¿cuál es mi récord de banca?').includes('training'))

    // 'grasa' used to belong to `body`, so a purely nutritional question matched
    // two domains and got the whole catalogue — the opposite of the point.
    check('la grasa de una comida es dieta, no composición corporal',
      JSON.stringify(matchToolDomains('¿cuánta grasa tiene mi cena?')) === JSON.stringify(['nutrition']),
      JSON.stringify(matchToolDomains('¿cuánta grasa tiene mi cena?')))
    check('la grasa corporal sí es composición corporal',
      matchToolDomains('¿cómo va mi grasa corporal?').includes('body'))

    // A diet is judged against the weight trend, so the body tool travels with it.
    check('una pregunta de dieta arrastra la herramienta de peso corporal',
      nutritionTools.includes('get_body_metrics_range'), nutritionTools.join(','))
    const trainingTools = selectChatTools('¿cómo va mi press de banca?').map(t => t.name)
    check('una pregunta de entreno no arrastra las de dieta',
      trainingTools.includes('get_exercise_progression') && !trainingTools.includes('get_diet'),
      trainingTools.join(','))
    check('una pregunta de entreno arrastra las del plan',
      trainingTools.includes('get_active_plan'), trainingTools.join(','))

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
    // A weekday is an identifier, not a quantity: 9 clamped to 7 put the session
    // on a Sunday nobody chose, which `getNextSession` then prescribes as today.
    check('un día de la semana inválido se descarta, no se acota',
      repaired.sessions[0].day_of_week === null &&
      repaired.warnings.some(w => w.includes('sin día asignado')),
      `${repaired.sessions[0].day_of_week} · ${JSON.stringify(repaired.warnings)}`)

    // ── Week numbering: discarded, never clamped ────────────────────────────
    const weekOptions = { durationWeeks: 4, daysPerWeek: 1, allowedTemplateIds: allowed, knownTemplateIds: known }
    const oneSession = [{ name: 'Empuje', day_of_week: 1, exercises: [{ exercise_template_id: 'AI_BENCH', name: 'Bench Press (Barbell)', target_sets: 4, rep_min: 6, rep_max: 8 }] }]

    // week_number 0 must not become week 1 and overwrite the real one.
    const zeroWeek = validateGeneratedMesocycle({
      name: 'B', sessions: oneSession,
      weeks: [
        { week_number: 0, is_deload: true, volume_multiplier: 0.4, notes: 'semana cero inventada' },
        { week_number: 1, target_rir: 3, volume_multiplier: 1, notes: 'la de verdad' }
      ]
    }, weekOptions)
    check('week_number = 0 se descarta y no pisa la semana 1',
      zeroWeek.weeks[0].notes === 'la de verdad' && zeroWeek.weeks[0].is_deload === false,
      JSON.stringify(zeroWeek.weeks[0]))
    check('y el descarte se reporta como reparación',
      zeroWeek.repairs.some(r => r.includes('número inválido')), JSON.stringify(zeroWeek.repairs))

    // week_number beyond the block must not become the last week.
    const hugeWeek = validateGeneratedMesocycle({
      name: 'B', sessions: oneSession,
      weeks: [
        { week_number: 999, is_deload: false, volume_multiplier: 1.4, notes: 'semana fuera del bloque' },
        { week_number: 4, is_deload: true, volume_multiplier: 0.5, notes: 'descarga real' }
      ]
    }, weekOptions)
    check('week_number > duración se descarta y no pisa la última semana',
      hugeWeek.weeks[3].notes === 'descarga real' && hugeWeek.weeks[3].is_deload === true,
      JSON.stringify(hugeWeek.weeks[3]))

    // Non-integers name no position at all.
    const fractionalWeek = validateGeneratedMesocycle({
      name: 'B', sessions: oneSession,
      weeks: [{ week_number: 2.5, notes: 'ni una cosa ni otra' }, { week_number: 1, notes: 'primera' }]
    }, weekOptions)
    check('un week_number no entero se descarta',
      !fractionalWeek.weeks.some(w => w.notes === 'ni una cosa ni otra'),
      JSON.stringify(fractionalWeek.weeks.map(w => w.notes)))

    // Duplicates: deterministic, first wins, and counted as duplicates.
    const duplicateWeeks = validateGeneratedMesocycle({
      name: 'B', sessions: oneSession,
      weeks: [
        { week_number: 2, notes: 'la primera que llegó' },
        { week_number: 2, notes: 'la repetida' },
        { week_number: 2, notes: 'y otra más' }
      ]
    }, weekOptions)
    check('ante semanas repetidas gana la primera, de forma determinista',
      duplicateWeeks.weeks[1].notes === 'la primera que llegó', JSON.stringify(duplicateWeeks.weeks[1]))
    check('y se informa de cuántas se descartaron por repetidas',
      duplicateWeeks.repairs.some(r => r.includes('2 semana(s) repetidas')), JSON.stringify(duplicateWeeks.repairs))
    check('las semanas que faltan se rellenan neutras, sin inventar programación',
      duplicateWeeks.weeks.length === 4 &&
      duplicateWeeks.weeks[0].volume_multiplier === 1 && duplicateWeeks.weeks[0].target_rir === null,
      JSON.stringify(duplicateWeeks.weeks[0]))

    // Every repair reported must correspond to a change actually made.
    const reportedRepairs = validateGeneratedMesocycle({
      name: 'B',
      weeks: [{ week_number: 1 }, { week_number: 2 }, { week_number: 3 }, { week_number: 4, is_deload: true, volume_multiplier: 0.5 }],
      sessions: [{
        name: 'Empuje', day_of_week: 1,
        exercises: [{ exercise_template_id: 'AI_BENCH', name: 'Bench Press (Barbell)', target_sets: 3.7, rep_min: 6, rep_max: 8, rest_seconds: 5000 }]
      }]
    }, weekOptions)
    check('un target_sets fraccionario se redondea Y se reporta',
      reportedRepairs.sessions[0].exercises[0].target_sets === 4 &&
      reportedRepairs.repairs.some(r => r.includes('3.7 series')), JSON.stringify(reportedRepairs.repairs))
    check('un descanso fuera de rango se acota Y se reporta',
      reportedRepairs.sessions[0].exercises[0].rest_seconds === 900 &&
      reportedRepairs.repairs.some(r => r.includes('descanso')), JSON.stringify(reportedRepairs.repairs))

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

    // Cache WRITES: billed above plain input, and never double-counted against
    // the reads — both are subsets of the same `inputTokens`.
    const writePrices = new Map([['fake/model-1', {
      id: 'p2', model: 'fake/model-1', input_per_1m: 3, output_per_1m: 15,
      cached_input_per_1m: 0.3, cache_write_per_1m: 3.75, currency: 'USD', created_at: new Date(), updated_at: new Date()
    } as any]])
    const writeCost = rowCost({
      model: 'fake/model-1', inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000,
      cachedInputTokens: 0, cacheWriteTokens: 1_000_000
    }, writePrices)
    check('la escritura de caché se cobra a su propia tarifa', writeCost === 3.75, String(writeCost))

    const mixedCost = rowCost({
      model: 'fake/model-1', inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000,
      cachedInputTokens: 600_000, cacheWriteTokens: 200_000
    }, writePrices)
    // 200k fresh @3 + 600k read @0.3 + 200k write @3.75 — the three shares add
    // up to `inputTokens` exactly, which is the property being checked.
    const expectedMixed = 0.2 * 3 + 0.6 * 0.3 + 0.2 * 3.75
    check('lectura, escritura y entrada fresca se reparten sin solaparse',
      Math.abs((mixedCost ?? 0) - expectedMixed) < 1e-9, `${mixedCost} vs ${expectedMixed}`)

    const unconfiguredWrite = rowCost({
      model: 'fake/model-1', inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000,
      cachedInputTokens: 0, cacheWriteTokens: 1_000_000
    }, prices)
    check('sin tarifa de escritura configurada se cobra a entrada normal, sin inventar multiplicador',
      unconfiguredWrite === 3, String(unconfiguredWrite))

    const overReported = rowCost({
      model: 'fake/model-1', inputTokens: 1000, outputTokens: 0, totalTokens: 1000,
      cachedInputTokens: 900, cacheWriteTokens: 900
    }, writePrices)
    check('contadores incoherentes no facturan más tokens de los que hubo',
      (overReported ?? 0) > 0 && (overReported ?? 0) <= (1000 / 1_000_000) * 3.75,
      String(overReported))

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

    await prisma.workout.update({ where: { id: target.id }, data: { mesocycle_id: meso.id } })
    const vsPlan = await matchWorkoutToPlan(user.id, meso.id, target.id)
    check('empareja la sesión con el plan por template id, no por título',
      vsPlan?.session_name === 'Empuje' && (vsPlan?.exercises[0]?.actual_sets ?? 0) >= 1,
      JSON.stringify(vsPlan))
    const analysisWithPlan = renderWorkoutAnalysis({
      task: 'workout_analysis',
      today: localDayKeyOf(new Date()),
      athlete: await buildAthleteProfile(user.id, { asOf: target.date }),
      workout: buildWorkoutData(target),
      prescribed: vsPlan!
    })
    check('el documento de análisis incluye la sesión prescrita',
      analysisWithPlan.includes('## SESIÓN PRESCRITA') && analysisWithPlan.includes('series prescritas'),
      analysisWithPlan.slice(analysisWithPlan.indexOf('SESIÓN PRESCRITA'), analysisWithPlan.indexOf('SESIÓN PRESCRITA') + 200))

    // 1. Simple turn: no tools.
    const simple = new FakeProvider([{ text: 'Vas bien.' }])
    const turn1 = await runChatTurn({
      userId: user.id, conversationId: null, message: 'Hola, ¿qué tal?', keys: {}, provider: simple as any
    })
    check('turno simple responde sin herramientas', turn1.reply === 'Vas bien.' && turn1.toolsInvoked.length === 0)
    check('el prompt de sistema lleva las lesiones del deportista',
      simple.lastSystemPrompt.includes('LESIONES'), simple.lastSystemPrompt.slice(0, 200))
    check('pide caché de prefijo', simple.calls[0].options.cachePrefix === true)
    check('el chat razona en bajo', simple.calls[0].options.reasoningEffort === 'low')
    check('la conversación viaja como session_id para el enrutado pegajoso',
      simple.calls[0].options.sessionId === turn1.conversationId, String(simple.calls[0].options.sessionId))
    check('registra métricas de la llamada', turn1.metrics.latencyMs > 0 && turn1.metrics.toolRounds === 0)

    // ── Cache: the stable half really is stable ─────────────────────────────
    // The breakpoint sits at the end of `stableContent`. If any athlete datum
    // leaks into it, the cached prefix changes whenever the athlete does and is
    // written on every turn without ever being read.
    check('el prefijo estable va separado del contexto dinámico',
      simple.lastStablePrompt.length > 0 &&
      simple.calls[0].messages[0].content !== simple.lastStablePrompt,
      simple.lastStablePrompt.slice(0, 80))
    check('el prefijo estable empieza por las reglas',
      simple.lastStablePrompt.startsWith('Eres "HevyTracker AI"'))
    // The athlete's DATA, not the words the rules use to refer to it: the
    // grounding block legitimately names the "## LESIONES" section, which is a
    // rule and identical for everyone.
    check('el prefijo estable NO contiene datos del deportista',
      !simple.lastStablePrompt.includes('CONTEXTO DEL DEPORTISTA') &&
      !simple.lastStablePrompt.includes('Hombro derecho') &&
      !simple.lastStablePrompt.includes('SmokeAI') &&
      !simple.lastStablePrompt.includes('Bloque hipertrofia') &&
      !/\d+([.,]\d)? kg\b/.test(simple.lastStablePrompt),
      simple.lastStablePrompt.slice(-200))
    check('el contexto dinámico sí los contiene',
      simple.calls[0].messages[0].content.includes('CONTEXTO DEL DEPORTISTA'))

    const storedMessage = await prisma.aiMessage.findFirst({
      where: { conversation_id: turn1.conversationId, role: 'assistant' },
      orderBy: { created_at: 'desc' }
    })
    check('persiste el desglose de tokens y la latencia',
      storedMessage?.input_tokens === 100 && storedMessage?.cached_input_tokens === 40 &&
      storedMessage?.reasoning_tokens === 5 && (storedMessage?.latency_ms ?? 0) > 0,
      JSON.stringify(storedMessage))
    check('persiste también los tokens escritos en caché',
      storedMessage?.cache_write_tokens === 10, String(storedMessage?.cache_write_tokens))

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

    const promptHalves = await buildLeanSystemPrompt(user.id)
    const systemPrompt = joinSystemPrompt(promptHalves)
    check('el contexto permanente trae macros pero no el menú',
      systemPrompt.includes('media de un día planificado') && !systemPrompt.includes('Avena 100 g'),
      systemPrompt.slice(systemPrompt.indexOf('DIETA ACTIVA'), systemPrompt.indexOf('DIETA ACTIVA') + 300))
    check('el contexto apunta al plan estructurado sin incluirlo',
      systemPrompt.includes('get_active_plan') && !systemPrompt.includes('Bench Press (Barbell) — 4'))
    check('los últimos entrenos listan los ejercicios',
      systemPrompt.includes('Press de banca') && systemPrompt.includes('ÚLTIMOS ENTRENAMIENTOS'),
      systemPrompt.slice(systemPrompt.indexOf('ÚLTIMOS ENTRENAMIENTOS'), systemPrompt.indexOf('ÚLTIMOS ENTRENAMIENTOS') + 280))
    check('el último entreno trae las series de trabajo',
      systemPrompt.includes('105×8@9') || systemPrompt.includes('100×8@9'),
      systemPrompt.slice(systemPrompt.indexOf('ÚLTIMOS ENTRENAMIENTOS'), systemPrompt.indexOf('ÚLTIMOS ENTRENAMIENTOS') + 400))
    check('SEÑALES trae la semana y el volumen por músculo',
      systemPrompt.includes('ESTA SEMANA') && systemPrompt.includes('VOLUMEN ESTA SEMANA'),
      systemPrompt.slice(systemPrompt.indexOf('SEÑALES'), systemPrompt.indexOf('SEÑALES') + 400))
    check('el contexto lista otros mesociclos',
      systemPrompt.includes('OTROS MESOCICLOS'))
    check('el contexto apunta las alertas y la siguiente sesión',
      systemPrompt.includes('ALERTAS') && systemPrompt.includes('SIGUIENTE SESIÓN') && systemPrompt.includes('get_next_planned_session'),
      systemPrompt.slice(systemPrompt.indexOf('SEÑALES'), systemPrompt.indexOf('SEÑALES') + 280))

    const paused = await prisma.mesocycle.create({
      data: {
        user_id: user.id, name: 'Bloque de fuerza viejo', goal: 'Fuerza',
        start_date: daysAgo(120), end_date: daysAgo(90), status: 'paused'
      }
    })
    const focused = await buildLeanSystemPrompt(user.id, { focusMesocycleId: paused.id })
    check('un bloque pausado llega como EN DISCUSIÓN',
      focused.dynamic.includes('MESOCICLO EN DISCUSIÓN') && focused.dynamic.includes('Bloque de fuerza viejo'),
      focused.dynamic.slice(focused.dynamic.indexOf('MESOCICLO'), focused.dynamic.indexOf('MESOCICLO') + 400))
    check('y el activo se conserva',
      focused.dynamic.includes('MESOCICLO ACTIVO') && focused.dynamic.includes('Bloque hipertrofia'))
    check('el contexto declara que los datos no son instrucciones',
      systemPrompt.includes('no instrucciones') || systemPrompt.includes('no son instrucciones'))

    // Notes used to be printed twice: once as profile text and once with the
    // id `deactivate_user_note` needs. Exactly one representation, and it is
    // the one that carries the id.
    const londonMentions = systemPrompt.split('Londres').length - 1
    check('las notas guardadas no viajan duplicadas', londonMentions === 1, `${londonMentions} apariciones`)
    check('y la única que viaja lleva su id',
      /\[[0-9a-f-]{8,}\][^\n]*Londres/i.test(systemPrompt),
      systemPrompt.slice(systemPrompt.indexOf('NOTAS RECORDADAS')))

    // Changing the athlete must not move a byte of the cacheable prefix.
    await prisma.bodyMetric.create({ data: { user_id: user.id, date: new Date(), weight: 91.5 } })
    await prisma.aiNote.create({ data: { user_id: user.id, content: 'Nota nueva que cambia el contexto dinámico.' } })
    const promptAfter = await buildLeanSystemPrompt(user.id)
    check('el prefijo estable no cambia al cambiar peso o notas',
      promptAfter.stable === promptHalves.stable)
    check('y el contexto dinámico sí cambia',
      promptAfter.dynamic !== promptHalves.dynamic)

    // ── Reasoning preserved across tool calls ────────────────────────────────
    console.log('\n── Razonamiento entre llamadas a herramientas ──')

    const REASONING = [
      { type: 'reasoning.text', text: 'Necesito la sesión de hoy.', signature: 'sig-abc', format: 'anthropic-claude-v1', index: 0 }
    ]
    const reasoned = new FakeProvider([
      { toolCalls: [{ id: 'r1', name: 'get_next_planned_session', arguments: {} }], reasoningDetails: REASONING },
      { text: 'Te toca Empuje.' }
    ])
    await runChatTurn({
      userId: user.id, conversationId: null, message: '¿Qué sesión me toca según el plan?', keys: {}, provider: reasoned as any
    })
    const replayed = reasoned.calls[1].messages.find(m => m.role === 'assistant')
    check('el turno assistant se reenvía con su reasoning_details',
      JSON.stringify(replayed?.reasoningDetails) === JSON.stringify(REASONING),
      JSON.stringify(replayed?.reasoningDetails))
    check('la firma del bloque de razonamiento sobrevive intacta',
      replayed?.reasoningDetails?.[0]?.signature === 'sig-abc')
    check('el orden es reasoning → tool_call → tool_result',
      !!replayed?.reasoningDetails?.length && !!replayed?.toolCalls?.length &&
      reasoned.calls[1].messages.findIndex(m => m.role === 'assistant') <
      reasoned.calls[1].messages.findIndex(m => m.role === 'tool'))

    // A model that reasons about nothing must not gain an empty array: the
    // field has to be absent, not present-and-empty.
    const unreasoned = new FakeProvider([
      { toolCalls: [{ id: 'u1', name: 'get_next_planned_session', arguments: {} }] },
      { text: 'Listo.' }
    ])
    await runChatTurn({
      userId: user.id, conversationId: null, message: '¿Qué sesión me toca según el plan?', keys: {}, provider: unreasoned as any
    })
    const noReasoning = unreasoned.calls[1].messages.find(m => m.role === 'assistant')
    check('un modelo sin razonamiento no envía el campo',
      noReasoning !== undefined && !('reasoningDetails' in noReasoning),
      JSON.stringify(noReasoning))

    // The adapter's own serialisation: reasoning_details only appears when
    // there is reasoning, and never as an empty key.
    const withReasoning = toOpenAiMessages([
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'x', arguments: {} }], reasoningDetails: REASONING as any }
    ])
    const withoutReasoning = toOpenAiMessages([
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'x', arguments: {} }] }
    ])
    check('el cuerpo de la petición lleva reasoning_details cuando existe',
      JSON.stringify(withReasoning[0].reasoning_details) === JSON.stringify(REASONING))
    check('y no incluye la clave cuando no existe',
      !('reasoning_details' in withoutReasoning[0]), JSON.stringify(withoutReasoning[0]))

    // Streaming: same guarantee, from fragments.
    const streamedReasoning = new FakeProvider([
      { toolCalls: [{ id: 's1', name: 'get_next_planned_session', arguments: {} }], reasoningDetails: REASONING },
      { text: 'Respuesta final.' }
    ])
    const streamEvents: string[] = []
    await runChatTurn({
      userId: user.id, conversationId: null, message: '¿Qué sesión me toca según el plan?', keys: {},
      stream: true, provider: streamedReasoning as any,
      onEvent: async (e) => { streamEvents.push(e.type) }
    })
    const streamReplayed = streamedReasoning.calls[1].messages.find(m => m.role === 'assistant')
    check('en streaming el reasoning también se conserva',
      JSON.stringify(streamReplayed?.reasoningDetails) === JSON.stringify(REASONING),
      JSON.stringify(streamReplayed?.reasoningDetails))

    // The adapter's fragment reassembly, exercised directly.
    const merged = reassembleStreamedReasoning([
      [{ type: 'reasoning.text', text: 'Primero ', index: 0, format: 'anthropic-claude-v1' }],
      [{ type: 'reasoning.text', text: 'y después.', index: 0 }],
      [{ type: 'reasoning.text', signature: 'sig-z', index: 0 }]
    ])
    check('los fragmentos de razonamiento se recomponen en orden',
      merged.length === 1 && merged[0].text === 'Primero y después.' &&
      merged[0].signature === 'sig-z' && merged[0].format === 'anthropic-claude-v1',
      JSON.stringify(merged))

    // ── Streaming: text emitted before a tool call is not the answer ─────────
    console.log('\n── Streaming con texto previo a la herramienta ──')

    const preamble = new FakeProvider([
      { text: 'Déjame mirar tu plan…', toolCalls: [{ id: 'p1', name: 'get_next_planned_session', arguments: {} }] },
      { text: 'Te toca Empuje.' }
    ])
    const frames: Array<{ type: string; text?: string }> = []
    const streamedTurn = await runChatTurn({
      userId: user.id, conversationId: null, message: '¿Qué sesión me toca según el plan?', keys: {},
      stream: true, provider: preamble as any,
      onEvent: async (e) => { frames.push(e.type === 'delta' ? { type: e.type, text: e.text } : { type: e.type }) }
    })
    const resetAt = frames.findIndex(f => f.type === 'reset')
    check('el texto previo a la herramienta se emite y luego se descarta',
      resetAt > 0 && frames[resetAt - 1].text === 'Déjame mirar tu plan…', JSON.stringify(frames))
    check('el reset llega antes del aviso de herramienta',
      resetAt < frames.findIndex(f => f.type === 'tool'), JSON.stringify(frames.map(f => f.type)))
    check('lo que se persiste es solo la respuesta final',
      streamedTurn.reply === 'Te toca Empuje.', streamedTurn.reply)
    check('el modelo sí recibe el texto intermedio en la ronda siguiente',
      preamble.calls[1].messages.find(m => m.role === 'assistant')?.content === 'Déjame mirar tu plan…')
    const noResetTurn = streamEvents.filter(t => t === 'reset').length
    check('un turno sin texto previo no emite reset', noResetTurn === 0, String(noResetTurn))

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

    // ── Historical fidelity: nothing from after the reference date ───────────
    console.log('\n── Fidelidad temporal (dieta, notas, peso, plan) ──')

    // A finished block, and a diet + a body + a plan that all changed AFTER it.
    const oldBlockStart = daysAgo(120)
    const oldBlockEnd = daysAgo(90)
    const oldBlock = await prisma.mesocycle.create({
      data: {
        user_id: user.id, name: 'Bloque terminado', goal: 'Fuerza',
        start_date: oldBlockStart, end_date: oldBlockEnd, status: 'completed'
      }
    })
    await savePlan(oldBlock.id, user.id, [
      { name: 'Fuerza A', day_of_week: 2, exercises: [{ exercise_template_id: 'AI_BENCH', name: 'Bench Press (Barbell)', target_sets: 5, rep_min: 3, rep_max: 5 }] }
    ], [{ week_number: 1, target_rir: 2, volume_multiplier: 1 }])

    // Inside the block.
    const inBlockWorkout = await createWorkout(user.id, {
      name: 'Sesión dentro del bloque', date: daysAgo(100), mesocycleId: oldBlock.id,
      exercises: [{ title: 'Press de banca (Barra)', templateId: 'AI_BENCH', sets: [{ weight: 90, reps: 5, rpe: 8 }] }]
    })
    await prisma.mesocycleNote.create({
      data: { mesocycle_id: oldBlock.id, date: daysAgo(100), content: 'NOTA_DENTRO del bloque.' }
    })
    // Attached to the same block but dated after it ended — the hindsight case.
    await createWorkout(user.id, {
      name: 'Sesión posterior mal asignada', date: daysAgo(5), mesocycleId: oldBlock.id,
      exercises: [{ title: 'Press de banca (Barra)', templateId: 'AI_BENCH', sets: [{ weight: 120, reps: 5, rpe: 8 }] }]
    })
    await prisma.mesocycleNote.create({
      data: { mesocycle_id: oldBlock.id, date: daysAgo(3), content: 'NOTA_POSTERIOR escrita mucho después.' }
    })
    await prisma.mesocycleEvaluation.create({
      data: { mesocycle_id: oldBlock.id, week_number: 1, evaluation_date: daysAgo(95), summary: 'EVAL_DENTRO' }
    })
    await prisma.mesocycleEvaluation.create({
      data: { mesocycle_id: oldBlock.id, week_number: 2, evaluation_date: daysAgo(2), summary: 'EVAL_POSTERIOR' }
    })

    const summaryPayload = (await buildFinalSummaryPayload(user.id, oldBlock.id))!
    check('el resumen final NO incluye entrenos posteriores al bloque',
      summaryPayload.stats.total_sessions === 1 &&
      summaryPayload.first_workout?.name === 'Sesión dentro del bloque',
      JSON.stringify({ n: summaryPayload.stats.total_sessions, first: summaryPayload.first_workout?.name }))
    check('el resumen final NO incluye notas escritas después del bloque',
      summaryPayload.diary_notes.some(n => n.content.includes('NOTA_DENTRO')) &&
      !summaryPayload.diary_notes.some(n => n.content.includes('NOTA_POSTERIOR')),
      JSON.stringify(summaryPayload.diary_notes))
    check('el resumen final NO incluye evaluaciones posteriores al bloque',
      !summaryPayload.weekly_evaluations.some(e => e.summary === 'EVAL_POSTERIOR'),
      JSON.stringify(summaryPayload.weekly_evaluations.map(e => e.summary)))
    check('el resumen final NO cita el peso actual',
      !summaryPayload.athlete.weight_history.some(w => w.avg_kg === 91.5),
      JSON.stringify(summaryPayload.athlete.weight_history))
    check('el resumen final declara su fecha de corte',
      summaryPayload.as_of === localDayKeyOf(oldBlockEnd), `${summaryPayload.as_of}`)
    check('y el documento renderizado la nombra en el encabezado del perfil',
      renderFinalSummary(summaryPayload).includes(`## PERFIL (a fecha de ${summaryPayload.as_of})`),
      renderFinalSummary(summaryPayload).slice(0, 200))
    const summaryDoc = renderFinalSummary(summaryPayload)
    check('el resumen final lleva la progresión de cargas del bloque',
      summaryDoc.includes('## PROGRESIÓN DE CARGAS') && summaryDoc.includes('Press de banca'),
      summaryDoc.slice(summaryDoc.indexOf('PROGRESIÓN'), summaryDoc.indexOf('PROGRESIÓN') + 240))
    check('un mesociclo de otro usuario no produce payload',
      (await buildFinalSummaryPayload(user.id, otherMeso.id)) === null)

    // The diet published today must not appear in a history closed months ago.
    const historyNow = await buildNutritionHistory(user.id)
    const historyThen = await buildNutritionHistory(user.id, 12, oldBlockEnd)
    check('el historial de dieta actual ve la versión vigente',
      historyNow.some(h => h.version_number === 1), JSON.stringify(historyNow))
    check('el historial de dieta histórico NO ve versiones posteriores',
      historyThen.length === 0, JSON.stringify(historyThen))

    // A version that was still in force at the reference date renders as
    // "vigente" then, not with the end date it later got.
    const supersededVersion = await prisma.dietVersion.create({
      data: {
        diet_plan_id: dietPlan.id, version_number: 0, status: 'superseded',
        start_date: daysAgo(150), end_date: daysAgo(5),
        total_kcal: 2400, total_protein_g: 160, total_carbs_g: 260, total_fat_g: 70, planned_days: 7
      }
    })
    const historyOld = await buildNutritionHistory(user.id, 12, oldBlockEnd)
    check('una versión aún vigente en esa fecha no muestra su fecha de fin futura',
      historyOld.length === 1 && historyOld[0].to === undefined, JSON.stringify(historyOld))

    // Training weekdays must come from the block in force then, not the active one.
    const snapshotThen = await buildNutritionSnapshot(user.id, { asOf: daysAgo(100) })
    const snapshotNow = await buildNutritionSnapshot(user.id)
    check('los días de entrenamiento del snapshot histórico salen del bloque de entonces',
      JSON.stringify(snapshotThen?.training_weekdays) === JSON.stringify(['martes']),
      JSON.stringify(snapshotThen?.training_weekdays))
    check('y los del snapshot actual salen del bloque activo',
      JSON.stringify(snapshotNow?.training_weekdays) === JSON.stringify(['lunes', 'jueves']),
      JSON.stringify(snapshotNow?.training_weekdays))

    // Protein per kg of a past diet must divide by the body of that time.
    await prisma.bodyMetric.create({ data: { user_id: user.id, date: daysAgo(151), weight: 70 } })
    const dietThen = await executeTool('get_diet', user.id, { date: localDayKeyOf(daysAgo(140)) })
    const dietNow = await executeTool('get_diet', user.id, {})
    check('get_diet(date) calcula proteína/kg con el peso de entonces',
      dietThen.includes('peso de ') && dietThen.includes('70 kg') && !dietThen.includes('91.5 kg'),
      dietThen.split('\n').slice(0, 3).join(' | '))
    check('get_diet sin fecha usa el peso más reciente',
      dietNow.includes('91.5 kg'), dietNow.split('\n').slice(0, 3).join(' | '))
    check('y las dos cifras de proteína/kg difieren',
      proteinPerKgOf(dietThen) !== proteinPerKgOf(dietNow),
      `${proteinPerKgOf(dietThen)} vs ${proteinPerKgOf(dietNow)}`)

    await prisma.dietVersion.delete({ where: { id: supersededVersion.id } })

    // ── Nutrition analysis needs a menu it can act on ────────────────────────
    console.log('\n── Detalle del análisis de dieta ──')

    // Make Saturday differ from the rest, so a representative day is provably
    // not enough to answer "which food, on which day, by how many grams".
    const saturdayMeal = await prisma.dietMeal.findFirst({
      where: { diet_version_id: version.id, weekday: 6 }, select: { id: true }
    })
    const salmon = await prisma.food.create({
      data: { user_id: user.id, name: 'Salmón', kcal: 208, protein_g: 20, carbs_g: 0, fat_g: 13, source: 'manual' }
    })
    await prisma.dietItem.create({
      data: {
        diet_meal_id: saturdayMeal!.id, food_id: salmon.id, food_name: 'Salmón', quantity_g: 150,
        nutrients_snapshot: JSON.stringify({ kcal: 208, protein_g: 20, carbs_g: 0, fat_g: 13 })
      }
    })

    const analysisDiet = await buildNutritionSnapshot(user.id, { detail: 'full' })
    const analysisText = serializeNutrition(analysisDiet!)
    check('el análisis de dieta recibe el menú de TODOS los días distintos',
      analysisText.includes('Avena') && analysisText.includes('Salmón'), analysisText.slice(-400))
    check('y no declara el menú como omitido', !analysisText.includes('MENÚ NO INCLUIDO'))

    const macrosOnly = serializeNutrition((await buildNutritionSnapshot(user.id, { detail: 'macros' }))!)
    check('el contexto de las tareas de entreno sigue sin menú',
      !macrosOnly.includes('Salmón') && macrosOnly.includes('MENÚ NO INCLUIDO'), macrosOnly.slice(-200))

    // ── Plan generation, with a scripted provider ────────────────────────────
    await createWorkout(user.id, {
      name: 'Pierna vieja', date: daysAgo(60),
      exercises: [{ title: 'Sentadilla trasera', templateId: null, sets: [{ weight: 140, reps: 5, rpe: 8 }] }]
    })
    const strength = await buildCurrentStrength(user.id)
    check('la fuerza actual ve un compuesto fuera de los últimos 5 entrenos',
      strength.some(l => /sentadilla/i.test(l.exercise)), JSON.stringify(strength.map(l => l.exercise)))

    const feedbackDoc = renderMesocycleFeedback({
      task: 'mesocycle_feedback',
      today: localDayKeyOf(new Date()),
      athlete: await buildAthleteProfile(user.id),
      recent_workouts: [],
      plan: {
        name: 'Propuesto',
        goal: 'Hipertrofia',
        split_description: 'texto libre',
        sessions: [{
          name: 'Empuje',
          day_of_week: 1,
          exercises: [{ name: 'Press de banca (Barra)', target_sets: 4, rep_min: 6, rep_max: 8, target_rir: 2 }]
        }]
      }
    })
    check('el feedback renderiza el plan estructurado, no solo el split',
      feedbackDoc.includes('## PLAN ESTRUCTURADO') && feedbackDoc.includes('Press de banca'),
      feedbackDoc.slice(feedbackDoc.indexOf('PLAN'), feedbackDoc.indexOf('PLAN') + 300))

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
    check('la generación cita la sentadilla antigua como fuerza actual',
      generationDoc.includes('Sentadilla'), generationDoc.slice(generationDoc.indexOf('FUERZA'), generationDoc.indexOf('FUERZA') + 240))
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
