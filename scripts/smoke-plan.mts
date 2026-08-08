/**
 * Exercises the structured plan: saving, load suggestion, next session and
 * adherence.
 *
 *   DATABASE_URL="file:./prisma/dev.db" npx tsx scripts/smoke-plan.mts
 */
import { PrismaClient } from '@prisma/client'
import { savePlan, loadPlan, getNextSession, getAdherence, suggestLoad, renderSplitDescription } from '../server/utils/plan-service'
import { searchExerciseTemplates } from '../server/utils/exercise-search'
import { buildWorkoutMetrics } from '../server/utils/workout-metrics'
import { writeWorkoutExercises } from '../server/utils/exercise-store'

const prisma = new PrismaClient()
let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${detail}`); failures++ }
}

async function main() {
  const user = await prisma.user.create({
    data: { name: 'SmokePlan', email: `smokeplan-${Date.now()}@test.local`, password_hash: 'x' }
  })

  try {
    await prisma.exerciseTemplate.createMany({
      data: [
        { id: 'SP_BENCH', title: 'Bench Press (Barbell)', type: 'weight_reps',
          primary_muscle_group: 'chest', secondary_muscle_groups: JSON.stringify(['triceps']),
          equipment_category: 'barbell' },
        { id: 'SP_ROW', title: 'Barbell Row', type: 'weight_reps',
          primary_muscle_group: 'upper_back', secondary_muscle_groups: JSON.stringify(['biceps']),
          equipment_category: 'barbell' }
      ]
    })

    const start = new Date()
    start.setDate(start.getDate() - 14) // two weeks in
    const meso = await prisma.mesocycle.create({
      data: { user_id: user.id, name: 'Bloque prueba', start_date: start, status: 'active' }
    })

    console.log('\n── Búsqueda en el catálogo ──')
    const search = await searchExerciseTemplates(user.id, { query: 'Bench' })
    check('encuentra por texto', search.results.some(r => r.id === 'SP_BENCH'), JSON.stringify(search))
    const byMuscle = await searchExerciseTemplates(user.id, { muscle_group: 'upper_back' })
    check('encuentra por grupo muscular', byMuscle.results.some(r => r.id === 'SP_ROW'))
    const nothing = await searchExerciseTemplates(user.id, { query: 'zzzzz' })
    check('sin resultados devuelve nota explicativa', nothing.count === 0 && !!nothing.note)

    console.log('\n── Guardar plan ──')
    const result = await savePlan(meso.id, user.id, [
      {
        name: 'Empuje', day_of_week: 1,
        exercises: [{
          exercise_template_id: 'SP_BENCH', name: 'Bench Press (Barbell)',
          target_sets: 4, rep_min: 6, rep_max: 8, target_rir: 2, rest_seconds: 180
        }]
      },
      {
        name: 'Tirón', day_of_week: 3,
        exercises: [
          { exercise_template_id: 'SP_ROW', name: 'Barbell Row', target_sets: 4, rep_min: 8, rep_max: 10, target_rir: 2 },
          { exercise_template_id: 'NO_EXISTE', name: 'Ejercicio fantasma', target_sets: 3, rep_min: 10, rep_max: 12 }
        ]
      }
    ], [
      { week_number: 1, target_rir: 3, volume_multiplier: 1 },
      { week_number: 2, target_rir: 2, volume_multiplier: 1 },
      { week_number: 3, target_rir: 1, volume_multiplier: 1 },
      { week_number: 4, is_deload: true, target_rir: 4, volume_multiplier: 0.5 }
    ])

    check('guarda 2 sesiones y 3 ejercicios', result.sessions === 2 && result.exercises === 3, JSON.stringify(result))
    check('reporta el id inexistente', result.unmatched.includes('Ejercicio fantasma'), JSON.stringify(result.unmatched))

    const stored = await prisma.mesocycle.findUnique({ where: { id: meso.id } })
    check('split_description derivado del plan', (stored?.split_description ?? '').includes('4×6-8'),
      stored?.split_description ?? '')
    check('target_sessions_weekly derivado', stored?.target_sessions_weekly === 2)

    const ghost = await prisma.plannedExercise.findFirst({ where: { name: 'Ejercicio fantasma' } })
    check('el id inválido se guarda como null, no rompe', ghost !== null && ghost.exercise_template_id === null)

    // Replace, don't merge: dropping a session must actually drop it.
    await savePlan(meso.id, user.id, [
      { name: 'Full body', day_of_week: null,
        exercises: [{ exercise_template_id: 'SP_BENCH', name: 'Bench Press (Barbell)', target_sets: 3, rep_min: 8, rep_max: 10 }] }
    ])
    const afterReplace = await loadPlan(meso.id, user.id)
    check('reemplaza en vez de acumular', afterReplace.sessions.length === 1, `→ ${afterReplace.sessions.length}`)

    console.log('\n── Sugerencia de carga ──')
    const noHistory = await suggestLoad(user.id, 'Bench Press (Barbell)', 8, 2)
    check('sin historial no inventa peso', noHistory.weight_kg === null, `→ ${noHistory.weight_kg}`)
    check('explica por qué no hay sugerencia', noHistory.basis.length > 20)

    // Log a session so there is history to anchor to.
    const raw = {
      id: 'sp-1', title: 'Empuje',
      start_time: new Date(Date.now() - 3 * 86400000).toISOString(),
      end_time: new Date(Date.now() - 3 * 86400000).toISOString(),
      exercises: [{
        title: 'Bench Press (Barbell)', exercise_template_id: 'SP_BENCH',
        sets: [
          { type: 'warmup', weight_kg: 50, reps: 8, rpe: null },
          { type: 'normal', weight_kg: 100, reps: 8, rpe: 8 }
        ]
      }]
    }
    const m = buildWorkoutMetrics(raw)
    const w = await prisma.workout.create({
      data: {
        user_id: user.id, hevy_id: raw.id, name: raw.title, mesocycle_id: meso.id,
        date: new Date(raw.start_time), total_volume: m.totalVolume, total_tonnage: m.totalTonnage,
        rpe_avg: m.rpeAvg, exercises_summary: JSON.stringify(m.summary), raw_data: JSON.stringify(raw)
      }
    })
    await writeWorkoutExercises(w.id, user.id, w.date, m.summary)

    const withHistory = await suggestLoad(user.id, 'Bench Press (Barbell)', 8, 2)
    check('con historial sugiere un peso', withHistory.weight_kg !== null, `→ ${withHistory.weight_kg}`)
    check('el peso es múltiplo de 2,5 kg', (withHistory.weight_kg ?? 0) % 2.5 === 0, `→ ${withHistory.weight_kg}`)
    // 100x8 @RPE8 → e1RM 135.5 → 8 reps @2 RIR is the same 73.9% → back to ~100
    check('reproduce la carga cuando la prescripción coincide',
      Math.abs((withHistory.weight_kg ?? 0) - 100) <= 2.5, `→ ${withHistory.weight_kg}`)
    check('un RIR más alto pide menos peso',
      ((await suggestLoad(user.id, 'Bench Press (Barbell)', 8, 4)).weight_kg ?? 0) < (withHistory.weight_kg ?? 0))
    check('cita la sesión de referencia', withHistory.last_performance?.weight_kg === 100)

    console.log('\n── Próxima sesión ──')
    const next = await getNextSession(user.id, meso.id)
    check('devuelve una sesión', next.has_plan && !!next.session, JSON.stringify(next).slice(0, 200))
    check('calcula la semana del bloque', next.has_plan && next.week === 3, `→ ${next.has_plan ? next.week : '-'}`)
    check('adjunta sugerencia a cada ejercicio',
      next.has_plan && next.exercises.every((e: any) => 'suggestion' in e))

    console.log('\n── Semana de descarga ──')
    await savePlan(meso.id, user.id, [
      { name: 'Empuje', day_of_week: null,
        exercises: [{ exercise_template_id: 'SP_BENCH', name: 'Bench Press (Barbell)', target_sets: 4, rep_min: 8, rep_max: 8, target_rir: 1 }] }
    ], [{ week_number: 3, is_deload: true, target_rir: 4, volume_multiplier: 0.5 }])

    const deload = await getNextSession(user.id, meso.id)
    check('marca la semana como descarga', deload.has_plan && deload.is_deload)
    check('recorta las series a la mitad',
      deload.has_plan && deload.exercises[0].target_sets === 2, `→ ${deload.has_plan ? deload.exercises[0].target_sets : '-'}`)
    check('el RIR de la semana manda sobre el del ejercicio',
      deload.has_plan && deload.exercises[0].effective_rir === 4,
      `→ ${deload.has_plan ? deload.exercises[0].effective_rir : '-'}`)

    console.log('\n── Adherencia ──')
    const adherence = await getAdherence(user.id, meso.id)
    check('calcula adherencia', adherence.has_plan && adherence.rows.length === 1, JSON.stringify(adherence).slice(0, 200))
    if (adherence.has_plan) {
      const row = adherence.rows[0]
      // 1 session done x 1 working set = 1; planned 4 sets x 3 weeks = 12
      check('cuenta series hechas, no sesiones', row.actual_sets === 1, `→ ${row.actual_sets}`)
      check('compara contra lo prescrito a la fecha', row.planned_sets_to_date === 12, `→ ${row.planned_sets_to_date}`)
      check('porcentaje coherente', row.adherence_pct === Math.round((1 / 12) * 100), `→ ${row.adherence_pct}`)
    }

    console.log('\n── renderSplitDescription ──')
    const rendered = renderSplitDescription([
      { name: 'Empuje', day_of_week: 1, exercises: [
        { name: 'Press', target_sets: 4, rep_min: 6, rep_max: 8, target_rir: 2 }
      ] }
    ])
    check('incluye día, series, reps y RIR',
      rendered.includes('Lunes') && rendered.includes('4×6-8') && rendered.includes('@2 RIR'), rendered)

  } finally {
    await prisma.exerciseSet.deleteMany({ where: { workout_exercise: { user_id: user.id } } })
    await prisma.workoutExercise.deleteMany({ where: { user_id: user.id } })
    await prisma.workout.deleteMany({ where: { user_id: user.id } })
    await prisma.plannedExercise.deleteMany({ where: { planned_session: { mesocycle: { user_id: user.id } } } })
    await prisma.plannedSession.deleteMany({ where: { mesocycle: { user_id: user.id } } })
    await prisma.mesocycleWeek.deleteMany({ where: { mesocycle: { user_id: user.id } } })
    await prisma.mesocycle.deleteMany({ where: { user_id: user.id } })
    await prisma.exerciseTemplate.deleteMany({ where: { id: { in: ['SP_BENCH', 'SP_ROW'] } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? '\n✅ Todo correcto\n' : `\n❌ ${failures} comprobaciones fallidas\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
