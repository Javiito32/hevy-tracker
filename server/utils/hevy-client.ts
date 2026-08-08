export const fetchHevyWorkouts = async (apiKey: string, page: number = 1): Promise<{ data: any[], pageCount: number }> => {
  const endpoint = `https://api.hevyapp.com/v1/workouts?page=${page}&pageSize=10`
  try {
    const res = await $fetch<{ workouts?: any[]; items?: any[]; data?: any[]; page_count?: number }>(endpoint, {
      method: 'GET',
      headers: { 'api-key': apiKey, 'accept': 'application/json' }
    })
    return { data: res.workouts || res.items || res.data || [], pageCount: res.page_count ?? 1 }
  } catch (error) {
    console.error('❌ Error fetching full workouts from Hevy API:', error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch Hevy Workouts' })
  }
}

export const fetchHevyWorkoutEvents = async (apiKey: string, page: number = 1, since?: Date): Promise<{ events: any[], pageCount: number }> => {
  const endpoint = `https://api.hevyapp.com/v1/workouts/events?page=${page}&pageSize=10${since ? `&since=${since.toISOString()}` : ''}`
  try {
    const res = await $fetch<{ events?: any[]; items?: any[]; data?: any[]; page_count?: number }>(endpoint, {
      method: 'GET',
      headers: { 'api-key': apiKey, 'accept': 'application/json' }
    })
    return { events: res.events || res.items || res.data || [], pageCount: res.page_count ?? 1 }
  } catch (error) {
    console.error('❌ Error fetching from Hevy API:', error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to fetch Hevy Workouts' })
  }
}

export const fetchHevyBodyMeasurements = async (apiKey: string, page: number = 1): Promise<{ data: any[], pageCount: number }> => {
  const endpoint = `https://api.hevyapp.com/v1/body_measurements?page=${page}&pageSize=10`
  try {
    const res = await $fetch<{ page: number; page_count: number; body_measurements: any[] }>(endpoint, {
      method: 'GET',
      headers: { 'api-key': apiKey, 'accept': 'application/json' }
    })
    return { data: res.body_measurements || [], pageCount: res.page_count || 1 }
  } catch (error) {
    console.error('❌ Error fetching body measurements from Hevy API:', error)
    return { data: [], pageCount: 0 }
  }
}

/**
 * The exercise catalogue. pageSize 100 is the documented maximum here (unlike
 * workouts, capped at 10), so the whole catalogue is 4-5 requests.
 */
export const fetchHevyExerciseTemplates = async (
  apiKey: string,
  page: number = 1
): Promise<{ data: any[]; pageCount: number }> => {
  const endpoint = `https://api.hevyapp.com/v1/exercise_templates?page=${page}&pageSize=100`
  try {
    const res = await $fetch<{ page_count?: number; exercise_templates?: any[] }>(endpoint, {
      method: 'GET',
      headers: { 'api-key': apiKey, 'accept': 'application/json' }
    })
    return { data: res.exercise_templates || [], pageCount: res.page_count ?? 1 }
  } catch (error) {
    console.error('❌ Error fetching exercise templates from Hevy API:', error)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch Hevy exercise templates' })
  }
}

/**
 * Creates a routine folder. Returns its numeric id, which routines reference.
 * Hevy has no "find folder by name", so the caller stores the id.
 */
export const createHevyRoutineFolder = async (apiKey: string, title: string): Promise<number | null> => {
  try {
    const res = await $fetch<any>('https://api.hevyapp.com/v1/routine_folders', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'accept': 'application/json', 'Content-Type': 'application/json' },
      body: { routine_folder: { title } }
    })
    return res?.routine_folder?.id ?? res?.id ?? null
  } catch (error) {
    console.error('❌ Error creating Hevy routine folder:', error)
    throw createError({ statusCode: 502, statusMessage: 'Failed to create Hevy routine folder' })
  }
}

export interface HevyRoutinePayload {
  title: string
  folder_id: number | null
  notes?: string
  exercises: Array<{
    exercise_template_id: string
    superset_id?: number | null
    rest_seconds?: number | null
    notes?: string | null
    sets: Array<{
      type: 'warmup' | 'normal' | 'failure' | 'dropset'
      weight_kg?: number | null
      reps?: number | null
      rep_range?: { start: number; end: number } | null
    }>
  }>
}

export const createHevyRoutine = async (apiKey: string, routine: HevyRoutinePayload): Promise<string | null> => {
  try {
    const res = await $fetch<any>('https://api.hevyapp.com/v1/routines', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'accept': 'application/json', 'Content-Type': 'application/json' },
      body: { routine }
    })
    const created = Array.isArray(res?.routine) ? res.routine[0] : res?.routine
    return created?.id ?? res?.id ?? null
  } catch (error: any) {
    console.error('❌ Error creating Hevy routine:', error)
    throw createError({
      statusCode: 502,
      statusMessage: `Hevy rechazó la rutina "${routine.title}": ${error?.data?.error ?? error?.message ?? 'error desconocido'}`
    })
  }
}

/** Updates a routine already pushed, so re-sending a block doesn't duplicate it. */
export const updateHevyRoutine = async (
  apiKey: string,
  routineId: string,
  routine: Omit<HevyRoutinePayload, 'folder_id'>
): Promise<boolean> => {
  try {
    await $fetch(`https://api.hevyapp.com/v1/routines/${routineId}`, {
      method: 'PUT',
      headers: { 'api-key': apiKey, 'accept': 'application/json', 'Content-Type': 'application/json' },
      body: { routine }
    })
    return true
  } catch (error: any) {
    console.error(`❌ Error updating Hevy routine ${routineId}:`, error)
    throw createError({
      statusCode: 502,
      statusMessage: `No se pudo actualizar la rutina "${routine.title}" en Hevy`
    })
  }
}

export const fetchHevyBodyMeasurementByDate = async (apiKey: string, dateStr: string): Promise<any | null> => {
  const endpoint = `https://api.hevyapp.com/v1/body_measurements/${dateStr}`
  try {
    return await $fetch<any>(endpoint, {
      method: 'GET',
      headers: { 'api-key': apiKey, 'accept': 'application/json' }
    })
  } catch (error: any) {
    if (error?.response?.status === 404) return null
    console.error(`❌ Error fetching body measurement for date ${dateStr}:`, error)
    return null
  }
}
