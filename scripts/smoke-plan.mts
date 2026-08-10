/**
 * Exercises the structured plan: saving, load suggestion, next session and
 * adherence.
 *
 *   DATABASE_URL="file:./prisma/dev.db" npx tsx scripts/smoke-plan.mts
 */
import { PrismaClient } from '@prisma/client'
import { savePlan, loadPlan, getNextSession, getAdherence, suggestLoad, renderSplitDescription, relabelPlannedExercises } from '../server/utils/plan-service'
import { searchExerciseTemplates } from '../server/utils/exercise-search'
import { buildWorkoutMetrics } from '../server/utils/workout-metrics'
import { writeWorkoutExercises } from '../server/utils/exercise-store'
import { refreshTemplateAliases } from '../server/utils/exercise-aliases'

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

    console.log('\n── Qué toca después de entrenar ──')
    // The athlete follows a coach's routines, so the workout is titled whatever
    // the coach called it — never the plan's session name. Identifying the
    // session by its title left "lo siguiente" stuck on sessions[0] forever.
    const rotationPlan = [
      { name: 'Empuje', day_of_week: null,
        exercises: [{ exercise_template_id: 'SP_BENCH', name: 'Bench Press (Barbell)', target_sets: 4, rep_min: 6, rep_max: 8 }] },
      { name: 'Tirón', day_of_week: null,
        exercises: [{ exercise_template_id: 'SP_ROW', name: 'Barbell Row', target_sets: 4, rep_min: 8, rep_max: 10 }] }
    ]
    await savePlan(meso.id, user.id, rotationPlan, [{ week_number: 3, target_rir: 2, volume_multiplier: 1 }])

    // The only workout so far is the bench session, logged as "Empuje".
    const afterBench = await getNextSession(user.id, meso.id)
    check('reconoce la sesión entrenada por sus ejercicios',
      afterBench.has_plan && afterBench.last_trained?.session_name === 'Empuje',
      JSON.stringify(afterBench.has_plan ? afterBench.last_trained : null))
    check('y propone la siguiente, no la que ya hiciste',
      afterBench.has_plan && afterBench.session.name === 'Tirón', `→ ${afterBench.has_plan ? afterBench.session.name : '-'}`)

    // Retitle it the way a coach's routine would be, leaving the exercises
    // untouched: the answer must not change.
    await prisma.workout.updateMany({
      where: { user_id: user.id, hevy_id: 'sp-1' }, data: { name: 'Semana 3 · Día A (entrenador)' }
    })
    const coachTitled = await getNextSession(user.id, meso.id)
    check('el título de la rutina del entrenador no la despista',
      coachTitled.has_plan && coachTitled.session.name === 'Tirón', `→ ${coachTitled.has_plan ? coachTitled.session.name : '-'}`)

    // Same session, now assigned to today's weekday and already trained today.
    const todayIso = new Date().getDay() === 0 ? 7 : new Date().getDay()
    const tomorrowIso = (todayIso % 7) + 1
    await prisma.workout.updateMany({
      where: { user_id: user.id, hevy_id: 'sp-1' }, data: { date: new Date() }
    })
    await savePlan(meso.id, user.id, [
      { ...rotationPlan[0], day_of_week: todayIso },
      { ...rotationPlan[1], day_of_week: tomorrowIso }
    ], [{ week_number: 3, target_rir: 2, volume_multiplier: 1 }])

    const already = await getNextSession(user.id, meso.id)
    check('sabe que hoy ya entrenaste', already.has_plan && already.trained_today === true)
    check('no repite la sesión de hoy ya registrada',
      already.has_plan && already.session.name === 'Tirón', `→ ${already.has_plan ? already.session.name : '-'}`)
    check('y lo justifica como el siguiente día del plan',
      already.has_plan && already.reason === 'next_weekday', `→ ${already.has_plan ? already.reason : '-'}`)

    // Move that workout back a week: today's session is due again.
    await prisma.workout.updateMany({
      where: { user_id: user.id, hevy_id: 'sp-1' }, data: { date: new Date(Date.now() - 7 * 86400000) }
    })
    const dueAgain = await getNextSession(user.id, meso.id)
    check('si hoy no has entrenado, toca la sesión de hoy',
      dueAgain.has_plan && dueAgain.session.name === 'Empuje' && dueAgain.reason === 'weekday',
      `→ ${dueAgain.has_plan ? `${dueAgain.session.name}/${dueAgain.reason}` : '-'}`)

    await prisma.workout.updateMany({
      where: { user_id: user.id, hevy_id: 'sp-1' },
      data: { name: 'Empuje', date: new Date(Date.now() - 3 * 86400000) }
    })

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

    console.log('\n── Editar el plan conserva el enlace con Hevy ──')
    // savePlan replaces rather than merges, which destroys the rows carrying
    // hevy_routine_id. If that link is not carried across, the next push builds
    // a second set of routines beside the ones already in the athlete's account.
    await prisma.plannedSession.updateMany({
      where: { mesocycle_id: meso.id, name: 'Empuje' },
      data: { hevy_routine_id: 'HEVY_R1', pushed_at: new Date() }
    })
    const beforeEdit = await loadPlan(meso.id, user.id)
    await savePlan(meso.id, user.id, beforeEdit.sessions.map(s => ({
      name: s.name,
      day_of_week: s.day_of_week,
      notes: s.notes,
      exercises: s.exercises.map(e => ({
        exercise_template_id: e.exercise_template_id,
        name: e.name,
        target_sets: e.target_sets + 1, // a real edit
        rep_min: e.rep_min, rep_max: e.rep_max, target_rir: e.target_rir, rest_seconds: e.rest_seconds
      }))
    })), beforeEdit.weeks.map(w => ({
      week_number: w.week_number, is_deload: w.is_deload,
      target_rir: w.target_rir, volume_multiplier: w.volume_multiplier, notes: w.notes
    })))
    const afterEdit = await loadPlan(meso.id, user.id)
    const pushed = afterEdit.sessions.find(s => s.name === 'Empuje')
    check('conserva hevy_routine_id al editar', pushed?.hevy_routine_id === 'HEVY_R1', `→ ${pushed?.hevy_routine_id}`)
    check('conserva pushed_at', pushed?.pushed_at != null)
    check('aplica la edición', pushed?.exercises[0].target_sets === 5, `→ ${pushed?.exercises[0].target_sets}`)
    check('una sesión nunca enviada sigue sin id',
      afterEdit.sessions.filter(s => s.name !== 'Empuje').every(s => s.hevy_routine_id === null))

    // Renaming is the one case that legitimately drops the link: re-pointing
    // "Empuje A" at the routine that used to be "Tirón A" would be worse.
    await savePlan(meso.id, user.id, [{
      name: 'Empuje renombrado', day_of_week: 1,
      exercises: [{ exercise_template_id: 'SP_BENCH', name: 'Bench Press (Barbell)', target_sets: 4 }]
    }], [])
    const renamed = await loadPlan(meso.id, user.id)
    check('renombrar una sesión suelta el enlace', renamed.sessions[0].hevy_routine_id === null,
      `→ ${renamed.sessions[0].hevy_routine_id}`)

    console.log('\n── El plan y la sesión, en dos idiomas ──')
    // The case every check above missed, because they log the workout under the
    // very title the catalogue gave the plan. Hevy does not: `GET
    // /v1/exercise_templates` answers in English whatever language the app is
    // set to, while the workout it returns carries the title as it was logged.
    // So a default exercise arrives under two names, and pairing plan with
    // session *by name* found nothing but custom exercises — the ones the
    // athlete named themselves, once, in their own language.
    const rawEs = {
      id: 'sp-2', title: 'Tirón',
      start_time: new Date(Date.now() - 2 * 86400000).toISOString(),
      end_time: new Date(Date.now() - 2 * 86400000).toISOString(),
      exercises: [{
        title: 'Remo con barra (Barra)', exercise_template_id: 'SP_ROW',
        sets: [
          { type: 'warmup', weight_kg: 40, reps: 10, rpe: null },
          { type: 'normal', weight_kg: 80, reps: 10, rpe: 8 },
          { type: 'normal', weight_kg: 80, reps: 9, rpe: 9 }
        ]
      }]
    }
    const mEs = buildWorkoutMetrics(rawEs)
    const wEs = await prisma.workout.create({
      data: {
        user_id: user.id, hevy_id: rawEs.id, name: rawEs.title, mesocycle_id: meso.id,
        date: new Date(rawEs.start_time), total_volume: mEs.totalVolume, total_tonnage: mEs.totalTonnage,
        rpe_avg: mEs.rpeAvg, exercises_summary: JSON.stringify(mEs.summary), raw_data: JSON.stringify(rawEs)
      }
    })
    await writeWorkoutExercises(wEs.id, user.id, wEs.date, mEs.summary)

    const learned = await refreshTemplateAliases(user.id)
    check('aprende el nombre del ejercicio del historial', learned.written >= 1, JSON.stringify(learned))
    const alias = await prisma.exerciseTemplateAlias.findFirst({
      where: { user_id: user.id, exercise_template_id: 'SP_ROW' }
    })
    check('guarda el título en el idioma del atleta',
      alias?.title === 'Remo con barra (Barra)', `→ ${alias?.title}`)

    // Saved exactly as the picker used to store it: the English catalogue title.
    await savePlan(meso.id, user.id, [{
      name: 'Tirón', day_of_week: null,
      exercises: [{
        exercise_template_id: 'SP_ROW', name: 'Barbell Row',
        target_sets: 4, rep_min: 8, rep_max: 10, target_rir: 2
      }]
    }], [{ week_number: 3, target_rir: 2, volume_multiplier: 1 }])

    const bilingual = await loadPlan(meso.id, user.id)
    check('el plan se lee en el idioma del atleta',
      bilingual.sessions[0].exercises[0].name === 'Remo con barra (Barra)',
      `→ ${bilingual.sessions[0].exercises[0].name}`)
    const storedEs = await prisma.plannedExercise.findFirst({
      where: { exercise_template_id: 'SP_ROW' }, select: { name: true }
    })
    check('y se guarda así, no solo al leerlo', storedEs?.name === 'Remo con barra (Barra)', `→ ${storedEs?.name}`)
    const splitEs = await prisma.mesocycle.findUnique({ where: { id: meso.id }, select: { split_description: true } })
    check('la prosa derivada hereda el nombre',
      (splitEs?.split_description ?? '').includes('Remo con barra'), splitEs?.split_description ?? '')

    // A plan written before the alias existed keeps the English name in the row
    // and in the prose derived from it. Both are what `relabelPlannedExercises`
    // catches up on the next sync, without the athlete re-saving anything.
    await prisma.plannedExercise.updateMany({
      where: { exercise_template_id: 'SP_ROW' }, data: { name: 'Barbell Row' }
    })
    await prisma.mesocycle.update({
      where: { id: meso.id }, data: { split_description: 'Tirón\n  · Barbell Row — 4×8-10 @2 RIR' }
    })
    const relabelled = await relabelPlannedExercises(user.id)
    check('renombra el plan ya guardado', relabelled.exercises === 1, JSON.stringify(relabelled))
    const afterRelabel = await prisma.mesocycle.findUnique({
      where: { id: meso.id }, select: { split_description: true }
    })
    check('y vuelve a derivar la prosa',
      (afterRelabel?.split_description ?? '').includes('Remo con barra'), afterRelabel?.split_description ?? '')
    check('una segunda pasada no toca nada',
      (await relabelPlannedExercises(user.id)).exercises === 0)

    const adhEs = await getAdherence(user.id, meso.id)
    // 2 working sets logged; the warm-up is not work. Prescribed 4×3 semanas.
    check('cuenta las series aunque los nombres no coincidan',
      adhEs.has_plan && adhEs.rows[0].actual_sets === 2,
      `→ ${adhEs.has_plan ? adhEs.rows[0].actual_sets : '-'}`)
    check('y no marca como no entrenado lo que sí se entrenó',
      adhEs.has_plan && (adhEs.rows[0].adherence_pct ?? 0) > 0)

    const loadEs = await suggestLoad(user.id, 'Barbell Row', 10, 2, 'SP_ROW')
    check('sugiere carga desde un historial con otro nombre',
      loadEs.weight_kg !== null, `→ ${loadEs.weight_kg}`)
    check('cita la sesión en español', loadEs.last_performance?.weight_kg === 80)
    // Pinning what the id buys: on the name alone there is nothing to find.
    check('sin el id no habría historial que encontrar',
      (await suggestLoad(user.id, 'Barbell Row', 10, 2)).weight_kg === null)

    // A session logged before its template linked carries no id at all, and the
    // name is the only thing left identifying it. Passing an id must not hide it.
    await prisma.workoutExercise.updateMany({
      where: { user_id: user.id, exercise_template_id: 'SP_ROW' },
      data: { exercise_template_id: null }
    })
    const viaName = await suggestLoad(user.id, 'Remo con barra (Barra)', 10, 2, 'SP_ROW')
    check('sin enlace, el nombre recupera el historial', viaName.weight_kg !== null, `→ ${viaName.weight_kg}`)
    await prisma.workoutExercise.updateMany({
      where: { user_id: user.id, name: 'Remo con barra (Barra)' },
      data: { exercise_template_id: 'SP_ROW' }
    })

    const searchEs = await searchExerciseTemplates(user.id, { query: 'Remo' })
    check('el buscador encuentra por el nombre en español',
      searchEs.results.some(r => r.id === 'SP_ROW'), JSON.stringify(searchEs.results.map(r => r.title)))
    check('y devuelve el título que verá el atleta',
      searchEs.results.find(r => r.id === 'SP_ROW')?.title === 'Remo con barra (Barra)')
    check('el nombre en inglés del catálogo sigue encontrándolo',
      (await searchExerciseTemplates(user.id, { query: 'Barbell Row' })).results.some(r => r.id === 'SP_ROW'))

    console.log('\n── Eliminar el mesociclo ──')
    const delMeso = await prisma.mesocycle.create({
      data: { user_id: user.id, name: 'A borrar', start_date: new Date(), status: 'paused' }
    })
    await savePlan(delMeso.id, user.id, [{
      name: 'S1', day_of_week: 1,
      exercises: [{ exercise_template_id: 'SP_BENCH', name: 'Bench Press (Barbell)', target_sets: 3 }]
    }], [{ week_number: 1 }])
    await prisma.mesocycleEvaluation.create({
      data: { mesocycle_id: delMeso.id, week_number: 1, evaluation_date: new Date(), summary: 'x' }
    })
    await prisma.mesocycleNote.create({
      data: { mesocycle_id: delMeso.id, date: new Date(), content: 'x' }
    })
    const keptWorkout = await prisma.workout.findFirst({ where: { user_id: user.id } })
    if (keptWorkout) {
      await prisma.workout.update({ where: { id: keptWorkout.id }, data: { mesocycle_id: delMeso.id } })
    }

    // Restrict on MesocycleEvaluation used to make any evaluated block
    // undeletable; the cascade added in 20260809142206 is what this asserts.
    await prisma.mesocycle.delete({ where: { id: delMeso.id } })
    check('borra el mesociclo', (await prisma.mesocycle.findUnique({ where: { id: delMeso.id } })) === null)
    check('cascada: evaluaciones',
      (await prisma.mesocycleEvaluation.count({ where: { mesocycle_id: delMeso.id } })) === 0)
    check('cascada: notas',
      (await prisma.mesocycleNote.count({ where: { mesocycle_id: delMeso.id } })) === 0)
    check('cascada: sesiones planificadas',
      (await prisma.plannedSession.count({ where: { mesocycle_id: delMeso.id } })) === 0)
    check('cascada: semanas',
      (await prisma.mesocycleWeek.count({ where: { mesocycle_id: delMeso.id } })) === 0)
    if (keptWorkout) {
      const survivor = await prisma.workout.findUnique({ where: { id: keptWorkout.id } })
      check('el entrenamiento sobrevive al borrado', survivor !== null)
      check('y solo pierde la asociación al bloque', survivor?.mesocycle_id === null, `→ ${survivor?.mesocycle_id}`)
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
    await prisma.exerciseTemplateAlias.deleteMany({ where: { user_id: user.id } })
    await prisma.exerciseTemplate.deleteMany({ where: { id: { in: ['SP_BENCH', 'SP_ROW'] } } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? '\n✅ Todo correcto\n' : `\n❌ ${failures} comprobaciones fallidas\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
