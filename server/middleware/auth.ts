export default defineEventHandler(async (event) => {
  const path = event.path

  // Only protect /api/* routes (not /auth/*)
  if (!path.startsWith('/api/')) return

  const session = await getUserSession(event)
  if (!session?.user) {
    throw createError({ statusCode: 401, message: 'No autenticado' })
  }
})
