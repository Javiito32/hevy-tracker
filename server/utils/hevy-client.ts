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
