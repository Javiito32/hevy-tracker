import { prisma } from '../utils/prisma'
import { getSessionUser } from '../utils/session'
import { startJob, runSync } from '../utils/maintenance'

/**
 * Launches the Hevy sync as a background job and returns its id.
 *
 * It used to run inline. A first sync of two years of history is ~50 API calls
 * (Hevy caps pageSize at 10, so this cannot be paginated away) plus hundreds of
 * writes — well past any sensible request timeout, and with no way for the UI
 * to show what was happening.
 *
 * Poll GET /api/sync/:jobId for progress.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hevy_api_key: true }
  })

  if (!user?.hevy_api_key || user.hevy_api_key.includes('your_hevy_api_key')) {
    return {
      success: false,
      message: 'Configura tu API Key de Hevy en Ajustes para poder sincronizar.',
      jobId: null
    }
  }

  const apiKey = user.hevy_api_key
  const jobId = await startJob('sync', userId, (ctx) => runSync(ctx, userId, apiKey))

  return { success: true, jobId, message: 'Sincronización iniciada.' }
})
