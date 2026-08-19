import { prisma } from './prisma'
import { loadTemplateTitles, normalizeExerciseName } from './exercise-aliases'

/**
 * Personal record detection.
 *
 * Records are stored, not derived. Deriving "best ever" on each page load means
 * rescanning the whole history, and it loses the two things that make a record
 * worth showing: when it happened, and what it beat.
 */

export type RecordType = 'max_weight' | 'e1rm' | 'volume' | 'reps_at_weight'

export const RECORD_LABELS: Record<RecordType, string> = {
  max_weight: 'Peso máximo',
  e1rm: '1RM estimado',
  volume: 'Volumen en sesión',
  reps_at_weight: 'Repeticiones a un peso'
}

interface Candidate {
  exercise_name: string
  exercise_template_id: string | null
  type: RecordType
  value: number
  at_weight?: number | null
}

/**
 * Extracts the record candidates a single workout could set.
 *
 * `reps_at_weight` is keyed by the load, so beating 8 reps at 100 kg is a
 * record even when the athlete has lifted 120 kg before — which is the case
 * where the other three record types all stay silent during a hypertrophy block.
 */
function candidatesFromWorkout(exercises: Array<{
  name: string
  exercise_template_id: string | null
  total_volume: number
  best_e1rm: number | null
  top_set_weight: number | null
  top_set_reps: number | null
  sets: Array<{ set_type: string; weight_kg: number | null; reps: number | null }>
}>): Candidate[] {
  const out: Candidate[] = []

  for (const ex of exercises) {
    const base = { exercise_name: ex.name, exercise_template_id: ex.exercise_template_id }

    if (ex.top_set_weight && ex.top_set_weight > 0) {
      out.push({ ...base, type: 'max_weight', value: ex.top_set_weight })
    }
    if (ex.best_e1rm && ex.best_e1rm > 0) {
      out.push({ ...base, type: 'e1rm', value: ex.best_e1rm })
    }
    if (ex.total_volume > 0) {
      out.push({ ...base, type: 'volume', value: ex.total_volume })
    }

    // Best reps at each distinct working load in this session.
    const bestRepsByWeight = new Map<number, number>()
    for (const s of ex.sets) {
      if (s.set_type === 'warmup') continue
      if (!s.weight_kg || !s.reps || s.weight_kg <= 0 || s.reps <= 0) continue
      const cur = bestRepsByWeight.get(s.weight_kg) ?? 0
      if (s.reps > cur) bestRepsByWeight.set(s.weight_kg, s.reps)
    }
    for (const [weight, reps] of bestRepsByWeight) {
      out.push({ ...base, type: 'reps_at_weight', value: reps, at_weight: weight })
    }
  }

  return out
}

/**
 * Detects and persists records set by one workout.
 *
 * Only compares against records achieved STRICTLY EARLIER, so re-running the
 * detector over history in chronological order reproduces the same result and
 * a workout never invalidates its own record.
 */
export async function detectPersonalRecords(userId: string, workoutId: string): Promise<number> {
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, user_id: userId },
    select: {
      id: true, date: true,
      exercises: {
        select: {
          name: true, exercise_template_id: true, total_volume: true,
          best_e1rm: true, top_set_weight: true, top_set_reps: true,
          sets: { select: { set_type: true, weight_kg: true, reps: true } }
        }
      }
    }
  })
  if (!workout) return 0

  const candidates = candidatesFromWorkout(workout.exercises)
  if (candidates.length === 0) return 0

  // Clear anything this workout previously claimed, so re-running is idempotent.
  await prisma.personalRecord.deleteMany({ where: { user_id: userId, workout_id: workoutId } })

  const names = [...new Set(candidates.map(c => c.exercise_name))]
  const templateIds = [...new Set(candidates.map(c => c.exercise_template_id).filter(Boolean))] as string[]
  const priors = await prisma.personalRecord.findMany({
    where: {
      user_id: userId,
      achieved_at: { lt: workout.date },
      OR: [
        { exercise_name: { in: names } },
        ...(templateIds.length ? [{ exercise_template_id: { in: templateIds } }] : [])
      ]
    },
    select: { exercise_name: true, exercise_template_id: true, type: true, value: true, at_weight: true }
  })

  const priorKeysFor = (c: { exercise_name: string; exercise_template_id?: string | null; type: string; at_weight?: number | null }) => {
    const keys = [`name:${normalizeExerciseName(c.exercise_name)}|${c.type}|${c.at_weight ?? ''}`]
    if (c.exercise_template_id) keys.push(`id:${c.exercise_template_id}|${c.type}|${c.at_weight ?? ''}`)
    return keys
  }

  const bestPrior = new Map<string, number>()
  for (const p of priors) {
    for (const k of priorKeysFor(p)) {
      const cur = bestPrior.get(k)
      if (cur == null || p.value > cur) bestPrior.set(k, p.value)
    }
  }

  const previousOf = (c: Candidate): number | null => {
    let best: number | undefined
    for (const k of priorKeysFor(c)) {
      const v = bestPrior.get(k)
      if (v != null && (best == null || v > best)) best = v
    }
    return best ?? null
  }

  const toCreate = candidates
    .filter(c => {
      const prev = previousOf(c)
      return prev == null || c.value > prev
    })
    .map(c => ({
      user_id: userId,
      exercise_template_id: c.exercise_template_id,
      exercise_name: c.exercise_name,
      type: c.type,
      value: c.value,
      previous_value: previousOf(c),
      at_weight: c.at_weight ?? null,
      workout_id: workout.id,
      achieved_at: workout.date
    }))

  if (toCreate.length === 0) return 0
  await prisma.personalRecord.createMany({ data: toCreate })
  return toCreate.length
}

/**
 * Rebuilds every record for a user from scratch.
 *
 * Walks workouts oldest-first because a record is defined relative to what came
 * before it; processing out of order would mark the first workout examined as a
 * record for everything.
 */
export async function rebuildPersonalRecords(
  userId: string,
  onProgress?: (done: number, total: number) => Promise<void> | void
): Promise<number> {
  await prisma.personalRecord.deleteMany({ where: { user_id: userId } })

  const workouts = await prisma.workout.findMany({
    where: { user_id: userId },
    orderBy: { date: 'asc' },
    select: { id: true }
  })

  let created = 0
  for (let i = 0; i < workouts.length; i++) {
    created += await detectPersonalRecords(userId, workouts[i].id)
    if (onProgress && (i % 25 === 0 || i === workouts.length - 1)) {
      await onProgress(i + 1, workouts.length)
    }
  }
  return created
}

/** The current best per exercise and type — what the progress page marks. */
export async function getCurrentRecords(userId: string, exerciseName?: string) {
  const where = exerciseName
    ? { user_id: userId, OR: await recordMatchFilter(userId, exerciseName) }
    : { user_id: userId }

  const records = await prisma.personalRecord.findMany({
    where,
    orderBy: { achieved_at: 'desc' }
  })

  const best = new Map<string, typeof records[number]>()
  for (const r of records) {
    const identity = r.exercise_template_id || `name:${normalizeExerciseName(r.exercise_name)}`
    const key = `${identity}|${r.type}|${r.at_weight ?? ''}`
    const cur = best.get(key)
    if (!cur || r.value > cur.value) best.set(key, r)
  }
  return [...best.values()]
}

/**
 * Catalogue title, athlete alias and logged name all name the same lift.
 * Matching only `exercise_name` is how "Bench Press" returned nothing next to
 * years of "Press de banca".
 */
async function recordMatchFilter(userId: string, query: string): Promise<Array<Record<string, unknown>>> {
  const needle = normalizeExerciseName(query)
  const [distinct, aliases] = await Promise.all([
    prisma.personalRecord.findMany({
      where: { user_id: userId },
      select: { exercise_name: true, exercise_template_id: true }
    }),
    prisma.exerciseTemplateAlias.findMany({
      where: { user_id: userId },
      select: { exercise_template_id: true, title: true }
    })
  ])

  const templateIds = [...new Set(distinct.map(r => r.exercise_template_id).filter(Boolean))] as string[]
  const titles = templateIds.length
    ? await loadTemplateTitles(userId, templateIds)
    : new Map<string, string>()
  const catalogue = templateIds.length
    ? new Map((await prisma.exerciseTemplate.findMany({
        where: { id: { in: templateIds } },
        select: { id: true, title: true }
      })).map(t => [t.id, t.title]))
    : new Map<string, string>()

  const matchedIds = new Set<string>()
  const matchedNames = new Set<string>()

  const labelsOf = (r: { exercise_name: string; exercise_template_id: string | null }) => {
    const labels = [r.exercise_name]
    if (r.exercise_template_id) {
      const alias = titles.get(r.exercise_template_id)
        ?? aliases.find(a => a.exercise_template_id === r.exercise_template_id)?.title
      const cat = catalogue.get(r.exercise_template_id)
      if (alias) labels.push(alias)
      if (cat) labels.push(cat)
    }
    return labels
  }

  const hits = (labels: string[], mode: 'exact' | 'sub') =>
    labels.some(l => {
      const n = normalizeExerciseName(l)
      return mode === 'exact' ? n === needle : n.includes(needle)
    })

  const collect = (mode: 'exact' | 'sub') => {
    for (const r of distinct) {
      if (!hits(labelsOf(r), mode)) continue
      matchedNames.add(r.exercise_name)
      if (r.exercise_template_id) matchedIds.add(r.exercise_template_id)
    }
    for (const a of aliases) {
      if (!hits([a.title], mode)) continue
      matchedIds.add(a.exercise_template_id)
    }
  }

  collect('exact')
  if (!matchedIds.size && !matchedNames.size) collect('sub')

  if (!matchedIds.size && !matchedNames.size) {
    return [{ exercise_name: query }]
  }
  return [
    ...(matchedIds.size ? [{ exercise_template_id: { in: [...matchedIds] } }] : []),
    ...(matchedNames.size ? [{ exercise_name: { in: [...matchedNames] } }] : [])
  ]
}
