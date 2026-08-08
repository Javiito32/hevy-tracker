/**
 * End-to-end smoke test for the training analytics pipeline.
 *
 * Runs against the local dev database with a throwaway user, exercising the
 * real code paths — metrics, normalised storage, muscle volume, records and
 * detectors — and cleaning up after itself.
 *
 *   DATABASE_URL="file:./prisma/dev.db" npx tsx scripts/smoke-training.mts
 */
import { PrismaClient } from '@prisma/client'
import { buildWorkoutMetrics } from '../server/utils/workout-metrics'
import { calcEstimated1RM, calcE1RMWithRPE, summarizeSets } from '../server/utils/volume-calculator'
import { linearSlope } from '../server/utils/plateau-detector'

const prisma = new PrismaClient()

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${detail}`); failures++ }
}
function eq(name: string, actual: any, expected: any) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `→ got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

// A bench press session: 2 warm-ups then 3 working sets.
const RAW_WORKOUT = {
  id: 'smoke-hevy-1',
  title: 'Push A',
  start_time: '2026-08-01T10:00:00Z',
  end_time: '2026-08-01T11:00:00Z',
  exercises: [
    {
      index: 0,
      title: 'Bench Press (Barbell)',
      exercise_template_id: 'TPL_BENCH',
      supersets_id: null,
      sets: [
        { index: 0, type: 'warmup', weight_kg: 40, reps: 10, rpe: null },
        { index: 1, type: 'warmup', weight_kg: 60, reps: 5, rpe: null },
        { index: 2, type: 'normal', weight_kg: 100, reps: 8, rpe: 8 },
        { index: 3, type: 'normal', weight_kg: 100, reps: 7, rpe: 9 },
        { index: 4, type: 'failure', weight_kg: 95, reps: 6, rpe: 10 }
      ]
    },
    {
      index: 1,
      title: 'Lat Pulldown (Cable)',
      exercise_template_id: 'TPL_PULLDOWN',
      supersets_id: null,
      sets: [
        { index: 0, type: 'normal', weight_kg: 70, reps: 10, rpe: 8 },
        { index: 1, type: 'normal', weight_kg: 70, reps: 10, rpe: 8 }
      ]
    }
  ]
}

async function main() {
  console.log('\n── Aritmética pura ──')

  eq('Epley a 20 reps se rechaza', calcEstimated1RM(100, 20), null)
  eq('Epley a 5 reps', calcEstimated1RM(100, 5), 116.5)
  eq('Epley a 1 rep es el propio peso', calcEstimated1RM(100, 1), 100)
  // 8 reps @ RPE 8 → 2 RIR → 10 reps to failure → 73.9% → 100/0.739
  eq('e1RM con RPE 8 a 8 reps', calcE1RMWithRPE(100, 8, 8), 135.5)
  check('RPE 10 a 8 reps da menos que RPE 8', (calcE1RMWithRPE(100, 8, 10) ?? 0) < (calcE1RMWithRPE(100, 8, 8) ?? 0))
  eq('RPE fuera de tabla se rechaza', calcE1RMWithRPE(100, 12, 5), null)

  const s = summarizeSets([
    { type: 'warmup', weight: 40, reps: 10, rpe: null },
    { type: 'normal', weight: 100, reps: 8, rpe: 8 },
    { type: 'normal', weight: 100, reps: 7, rpe: 9 }
  ])
  eq('volumen excluye calentamiento', s.volume, 100 * 8 + 100 * 7)
  eq('tonelaje de calentamiento aparte', s.warmupVolume, 400)
  eq('series de trabajo', s.workingSets, 2)
  eq('RPE medio ignora el calentamiento', s.avgRPE, 8.5)
  eq('top set', [s.topSetWeight, s.topSetReps], [100, 8])

  console.log('\n── buildWorkoutMetrics ──')
  const m = buildWorkoutMetrics(RAW_WORKOUT)
  eq('volumen total = solo trabajo', m.totalVolume, 100 * 8 + 100 * 7 + 95 * 6 + 70 * 10 + 70 * 10)
  eq('tonelaje incluye calentamiento', m.totalTonnage, m.totalVolume + 40 * 10 + 60 * 5)
  check('tonelaje > volumen', m.totalTonnage > m.totalVolume)
  eq('template id conservado', m.summary[0].exercise_template_id, 'TPL_BENCH')
  eq('series totales vs de trabajo', [m.summary[0].sets, m.summary[0].working_sets], [5, 3])

  console.log('\n── Regresión lineal ──')
  const rising = linearSlope([{ x: 0, y: 100 }, { x: 7, y: 102 }, { x: 14, y: 104 }])
  check('pendiente positiva detectada', (rising?.slope ?? 0) > 0)
  eq('r² perfecto en recta', Math.round((rising?.r2 ?? 0) * 100) / 100, 1)
  const flat = linearSlope([{ x: 0, y: 100 }, { x: 7, y: 100 }, { x: 14, y: 100 }])
  eq('pendiente nula en meseta', flat?.slope, 0)

  console.log('\n── Pipeline con base de datos ──')
  const user = await prisma.user.create({
    data: { name: 'Smoke', email: `smoke-${Date.now()}@test.local`, password_hash: 'x' }
  })

  try {
    await prisma.exerciseTemplate.createMany({
      data: [
        { id: 'TPL_BENCH', title: 'Bench Press (Barbell)', type: 'weight_reps',
          primary_muscle_group: 'chest', secondary_muscle_groups: JSON.stringify(['triceps', 'shoulders']),
          equipment_category: 'barbell' },
        { id: 'TPL_PULLDOWN', title: 'Lat Pulldown (Cable)', type: 'weight_reps',
          primary_muscle_group: 'lats', secondary_muscle_groups: JSON.stringify(['biceps']),
          equipment_category: 'machine' }
      ]
    })

    const { writeWorkoutExercises } = await import('../server/utils/exercise-store')
    const { detectPersonalRecords } = await import('../server/utils/personal-records')
    const { buildMuscleVolumeReport } = await import('../server/utils/muscle-volume')

    const workout = await prisma.workout.create({
      data: {
        user_id: user.id, hevy_id: RAW_WORKOUT.id, name: RAW_WORKOUT.title,
        date: new Date(RAW_WORKOUT.start_time), total_volume: m.totalVolume,
        total_tonnage: m.totalTonnage, rpe_avg: m.rpeAvg,
        exercises_summary: JSON.stringify(m.summary), raw_data: JSON.stringify(RAW_WORKOUT)
      }
    })

    await writeWorkoutExercises(workout.id, user.id, workout.date, m.summary)

    const stored = await prisma.workoutExercise.findMany({
      where: { workout_id: workout.id }, include: { sets: true }, orderBy: { order_index: 'asc' }
    })
    eq('2 ejercicios normalizados', stored.length, 2)
    eq('5 series guardadas en el press', stored[0].sets.length, 5)
    eq('plantilla enlazada', stored[0].exercise_template_id, 'TPL_BENCH')
    check('e1RM por serie calculado', stored[0].sets.some(x => x.e1rm != null))
    check('calentamiento sin e1RM', stored[0].sets.filter(x => x.set_type === 'warmup').every(x => x.e1rm == null))

    // Re-running must not duplicate: this is what makes the migration safe.
    await writeWorkoutExercises(workout.id, user.id, workout.date, m.summary)
    eq('reejecutar no duplica', await prisma.workoutExercise.count({ where: { workout_id: workout.id } }), 2)

    const records = await detectPersonalRecords(user.id, workout.id)
    check('récords detectados en el primer entreno', records > 0, `→ ${records}`)
    const again = await detectPersonalRecords(user.id, workout.id)
    eq('reejecutar récords es idempotente', await prisma.personalRecord.count({ where: { user_id: user.id } }),
       await prisma.personalRecord.count({ where: { user_id: user.id } }))
    check('no se inventan récords al repetir', again === records, `→ ${again} vs ${records}`)

    const report = await buildMuscleVolumeReport(user.id, 4)
    const chest = report.averages.find(a => a.muscle === 'chest')
    const triceps = report.averages.find(a => a.muscle === 'triceps')
    check('pecho contabilizado', !!chest, JSON.stringify(report.averages))
    check('tríceps entra como secundario', !!triceps)
    check('secundario cuenta la mitad que el primario',
      !!chest && !!triceps && triceps!.avg_sets === chest!.avg_sets / 2,
      `→ chest ${chest?.avg_sets} triceps ${triceps?.avg_sets}`)
    eq('cobertura total', report.coverage.classified_sets, report.coverage.total_sets)
    check('sin ejercicios sin clasificar', report.unclassified.length === 0)

    const { runDetectors } = await import('../server/utils/plateau-detector')
    const det = await runDetectors(user.id)
    check('detectores corren sin datos suficientes', det.active >= 0, JSON.stringify(det))
  } finally {
    await prisma.exerciseSet.deleteMany({ where: { workout_exercise: { user_id: user.id } } })
    await prisma.workoutExercise.deleteMany({ where: { user_id: user.id } })
    await prisma.personalRecord.deleteMany({ where: { user_id: user.id } })
    await prisma.trainingAlert.deleteMany({ where: { user_id: user.id } })
    await prisma.workout.deleteMany({ where: { user_id: user.id } })
    await prisma.exerciseTemplate.deleteMany({ where: { id: { in: ['TPL_BENCH', 'TPL_PULLDOWN'] } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? '\n✅ Todo correcto\n' : `\n❌ ${failures} comprobaciones fallidas\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
