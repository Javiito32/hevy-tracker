import { Cron } from 'croner'
import { prisma } from '../utils/prisma'
import { syncUserData } from '../utils/sync-user'

export default defineNitroPlugin(() => {
  // Daily sync at 02:00 AM — runs for every user that has a Hevy API key
  new Cron('0 2 * * *', async () => {
    console.log('⏰ Cron: hevy-sync (02:00 AM)')
    try {
      const users = await prisma.user.findMany({
        where: { is_active: true, hevy_api_key: { not: null } },
        select: { id: true, hevy_api_key: true }
      })
      for (const user of users) {
        if (!user.hevy_api_key) continue
        try {
          await syncUserData(user.id, user.hevy_api_key)
        } catch (err) {
          console.error(`Error syncing user ${user.id}:`, err)
        }
      }
    } catch (error) {
      console.error('Error en cron hevy-sync:', error)
    }
  })

  console.log('✅ Cron Plugin iniciado: sync 02:00 AM diario')
})
