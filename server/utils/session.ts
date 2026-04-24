import type { H3Event } from 'h3'

export const getSessionUser = async (event: H3Event) => {
  const session = await getUserSession(event)
  if (!session?.user) throw createError({ statusCode: 401, message: 'No autenticado' })
  return session.user as { id: string; name: string; email: string; role: string }
}

export const requireAdmin = async (event: H3Event) => {
  const user = await getSessionUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, message: 'Acceso restringido a administradores' })
  return user
}
