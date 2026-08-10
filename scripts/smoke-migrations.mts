/**
 * Exercises the admin migrations and the detectors against a synthetic history.
 *
 * Builds a user with 10 weeks of training where the bench press deliberately
 * stalls and RPE drifts upward at a constant load, then checks that the
 * detectors actually fire — a detector that never fires is worse than none.
 *
 *   DATABASE_URL="file:./prisma/dev.db" npx tsx scripts/smoke-migrations.mts
 */
import { PrismaClient } from '@prisma/client'
import { buildWorkoutMetrics } from '../server/utils/workout-metrics'
import { runRebuildExercises, runRecalcMetrics, runRecalcRecords } from '../server/utils/maintenance'
import { runDetectors } from '../server/utils/plateau-detector'
import { findUnclassifiedExercises } from '../server/utils/exercise-store'
import { getCurrentRecords } from '../server/utils/personal-records'

const prisma = new PrismaClient()
let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${detail}`); failures++ }
}

const ctx = {
  jobId: 'smoke',
  progress: async () => {} // the real one writes to MaintenanceJob; irrelevant here
}

/** Bench that stalls at 100 kg while RPE climbs 7 → 9.5: textbook accumulated fatigue. */
function benchSession(weekIndex: number) {
  const rpe = Math.min(9.5, 7 + weekIndex * 0.25)
  return {
    index: 0,
    title: 'Bench Press (Barbell)',
    exercise_template_id: 'SM_BENCH',
    sets: [
      { index: 0, type: 'warmup', weight_kg: 50, reps: 8, rpe: null },
      { index: 1, type: 'normal', weight_kg: 100, reps: 8, rpe: rpe },
      { index: 2, type: 'normal', weight_kg: 100, reps: 8, rpe: rpe }
    ]
  }
}

/** Squat that genuinely progresses, so the detector must NOT flag it. */
function squatSession(weekIndex: number) {
  return {
    index: 1,
    title: 'Squat (Barbell)',
    exercise_template_id: 'SM_SQUAT',
    sets: [
      { index: 0, type: 'warmup', weight_kg: 60, reps: 5, rpe: null },
      { index: 1, type: 'normal', weight_kg: 100 + weekIndex * 2.5, reps: 5, rpe: 8 }
    ]
  }
}

/** An exercise with no template at all — must land in "unclassified". */
const mysteryExercise = {
  index: 2,
  title: 'Máquina rara del gimnasio',
  exercise_template_id: null,
  sets: [{ index: 0, type: 'normal', weight_kg: 40, reps: 12, rpe: 8 }]
}

async function main() {
  const user = await prisma.user.create({
    data: { name: 'SmokeMig', email: `smokemig-${Date.now()}@test.local`, password_hash: 'x' }
  })

  try {
    await prisma.exerciseTemplate.createMany({
      data: [
        { id: 'SM_BENCH', title: 'Bench Press (Barbell)', type: 'weight_reps',
          primary_muscle_group: 'chest', secondary_muscle_groups: JSON.stringify(['triceps']) },
        { id: 'SM_SQUAT', title: 'Squat (Barbell)', type: 'weight_reps',
          primary_muscle_group: 'quadriceps', secondary_muscle_groups: JSON.stringify(['glutes']) }
      ]
    })

    console.log('\n── Sembrando 10 semanas ──')
    const WEEKS = 10
    for (let w = 0; w < WEEKS; w++) {
      const date = new Date()
      date.setDate(date.getDate() - (WEEKS - w) * 7)
      const raw = {
        id: `sm-${w}`,
        title: `Sesión ${w + 1}`,
        start_time: date.toISOString(),
        end_time: date.toISOString(),
        exercises: [benchSession(w), squatSession(w), ...(w === 0 ? [mysteryExercise] : [])]
      }
      const m = buildWorkoutMetrics(raw)
      await prisma.workout.create({
        data: {
          user_id: user.id, hevy_id: raw.id, name: raw.title, date,
          // Deliberately WRONG on disk: recalc_metrics must correct these.
          total_volume: 999999, total_tonnage: 999999, rpe_avg: 1,
          exercises_summary: JSON.stringify(m.summary), raw_data: JSON.stringify(raw)
        }
      })
    }
    console.log(`  sembrados ${WEEKS} entrenos`)

    console.log('\n── Migración 2: reconstruir estructura ──')
    const rebuild = await runRebuildExercises(ctx as any, user.id)
    check('reconstruye todos los entrenos', rebuild.rebuilt === WEEKS, JSON.stringify(rebuild))
    check('ninguno descartado', rebuild.skipped === 0)
    check('detecta el ejercicio sin plantilla', rebuild.unlinked_exercises === 1, `→ ${rebuild.unlinked_exercises}`)

    // The rebuild is also the offline route to relearning the athlete's own
    // name for each template — the link it writes is what the name is read from.
    check('aprende los nombres de los ejercicios', rebuild.exercise_names_updated >= 1,
      JSON.stringify(rebuild))

    const rebuild2 = await runRebuildExercises(ctx as any, user.id)
    check('reejecutable sin duplicar', rebuild2.rebuilt === WEEKS &&
      await prisma.workoutExercise.count({ where: { user_id: user.id } }) === WEEKS * 2 + 1)
    check('y no reescribe los nombres ya aprendidos', rebuild2.exercise_names_updated === 0,
      `→ ${rebuild2.exercise_names_updated}`)

    console.log('\n── Migración 5: ejercicios sin clasificar ──')
    const unclassified = await findUnclassifiedExercises(user.id)
    check('lista el ejercicio huérfano', unclassified.length === 1 &&
      unclassified[0].name === 'Máquina rara del gimnasio', JSON.stringify(unclassified))
    check('aún sin override', unclassified[0]?.has_override === false)

    await prisma.exerciseMuscleOverride.create({
      data: { user_id: user.id, exercise_name: 'Máquina rara del gimnasio',
        primary_muscle_group: 'lats', secondary_muscle_groups: JSON.stringify([]) }
    })
    const after = await findUnclassifiedExercises(user.id)
    check('el override lo marca como resuelto', after[0]?.has_override === true)

    console.log('\n── Migración 3: recalcular métricas ──')
    const recalc = await runRecalcMetrics(ctx as any, user.id)
    check('actualiza todos', recalc.updated === WEEKS, JSON.stringify(recalc))
    check('reporta el delta de volumen', typeof recalc.volume_delta_kg === 'number')
    const fixed = await prisma.workout.findFirst({ where: { user_id: user.id }, orderBy: { date: 'asc' } })
    check('el volumen falso fue corregido', (fixed?.total_volume ?? 0) < 999999 && (fixed?.total_volume ?? 0) > 0,
      `→ ${fixed?.total_volume}`)
    check('tonelaje > volumen (calentamiento aparte)',
      (fixed?.total_tonnage ?? 0) > (fixed?.total_volume ?? 0),
      `→ ${fixed?.total_tonnage} vs ${fixed?.total_volume}`)
    check('RPE recalculado desde las series', (fixed?.rpe_avg ?? 0) > 1, `→ ${fixed?.rpe_avg}`)

    console.log('\n── Migración 4: récords ──')
    const records = await runRecalcRecords(ctx as any, user.id)
    check('genera récords', records.records > 0, `→ ${records.records}`)
    const current = await getCurrentRecords(user.id, 'Squat (Barbell)')
    const bestWeight = current.find(r => r.type === 'max_weight')
    check('el récord de sentadilla es el último peso', bestWeight?.value === 100 + (WEEKS - 1) * 2.5,
      `→ ${bestWeight?.value}`)
    check('registra la marca anterior', bestWeight?.previous_value != null)

    const rerun = await runRecalcRecords(ctx as any, user.id)
    check('recalcular récords es idempotente', rerun.records === records.records,
      `→ ${rerun.records} vs ${records.records}`)

    console.log('\n── Detectores ──')
    await runDetectors(user.id)
    const alerts = await prisma.trainingAlert.findMany({ where: { user_id: user.id, status: 'active' } })
    const byType = new Map(alerts.map(a => [`${a.type}|${a.subject}`, a]))

    check('detecta el estancamiento del press', byType.has('plateau|Bench Press (Barbell)'),
      `alertas: ${[...byType.keys()].join(', ')}`)
    check('NO marca la sentadilla, que sí progresa', !byType.has('plateau|Squat (Barbell)'))
    check('detecta la deriva de RPE', byType.has('fatigue|Bench Press (Barbell)'))

    const plateau = byType.get('plateau|Bench Press (Barbell)')
    const evidence = plateau?.payload_json ? JSON.parse(plateau.payload_json) : null
    check('la alerta lleva su evidencia', evidence?.sessions >= 4 && evidence?.span_days >= 21,
      JSON.stringify(evidence))

    const firstDetectedAt = plateau?.detected_at
    await runDetectors(user.id)
    const again = await prisma.trainingAlert.findFirst({
      where: { user_id: user.id, type: 'plateau', subject: 'Bench Press (Barbell)' }
    })
    check('reejecutar no duplica alertas',
      await prisma.trainingAlert.count({ where: { user_id: user.id, type: 'plateau' } }) === 1)
    check('conserva detected_at original', again?.detected_at.getTime() === firstDetectedAt?.getTime(),
      'si se reiniciara, "lleva N días estancado" mentiría')

    await prisma.trainingAlert.update({
      where: { id: again!.id }, data: { status: 'dismissed', dismissed_at: new Date() }
    })
    await runDetectors(user.id)
    const dismissed = await prisma.trainingAlert.findFirst({ where: { id: again!.id } })
    check('respeta el descarte del usuario', dismissed?.status === 'dismissed')

  } finally {
    await prisma.exerciseSet.deleteMany({ where: { workout_exercise: { user_id: user.id } } })
    await prisma.workoutExercise.deleteMany({ where: { user_id: user.id } })
    await prisma.personalRecord.deleteMany({ where: { user_id: user.id } })
    await prisma.trainingAlert.deleteMany({ where: { user_id: user.id } })
    await prisma.exerciseMuscleOverride.deleteMany({ where: { user_id: user.id } })
    await prisma.exerciseTemplateAlias.deleteMany({ where: { user_id: user.id } })
    await prisma.workout.deleteMany({ where: { user_id: user.id } })
    await prisma.exerciseTemplate.deleteMany({ where: { id: { in: ['SM_BENCH', 'SM_SQUAT'] } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? '\n✅ Todo correcto\n' : `\n❌ ${failures} comprobaciones fallidas\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
