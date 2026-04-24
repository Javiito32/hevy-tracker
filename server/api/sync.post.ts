import { prisma } from '../utils/prisma'
import { getSessionUser } from '../utils/session'
import { syncUserData } from '../utils/sync-user'

export default defineEventHandler(async (event) => {
  try {
    const { id: userId } = await getSessionUser(event)

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { hevy_api_key: true } })
    if (!user?.hevy_api_key || user.hevy_api_key.includes('your_hevy_api_key')) {
      return {
        success: false,
        message: 'Por favor, configura tu API Key de Hevy en Ajustes',
        synced: 0
      }
    }

    const { syncedWorkouts, syncedMetrics } = await syncUserData(userId, user.hevy_api_key)

    return {
      success: true,
      message: `Sincronización Hevy completada. (${syncedWorkouts} entrenos, ${syncedMetrics} medidas).`,
      syncedWorkouts,
      syncedMetrics
    }
  } catch (error: any) {
    console.error('API Sync Error:', error)
    throw createError({ statusCode: 500, message: error.message || 'Error en el proceso de sincronización' })
  }
})
