import { prisma } from '../utils/prisma'
import { getSessionUser } from '../utils/session'

export default defineEventHandler(async (event) => {
  const sessionUser = await getSessionUser(event)
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id } })
  if (!user) throw createError({ statusCode: 404, message: 'Usuario no encontrado' })

  return {
    name: user.name,
    email: user.email,
    height: user.height ?? null,
    sex: user.sex ?? null,
    birth_date: user.birth_date ? user.birth_date.toISOString().slice(0, 10) : null,
    hevy_api_key: user.hevy_api_key ? maskKey(user.hevy_api_key) : '',
    has_hevy_key: !!user.hevy_api_key,
    // OpenAI key only visible to admin
    ...(user.role === 'admin' ? {
      openai_api_key: user.openai_api_key ? maskKey(user.openai_api_key) : '',
      has_openai_key: !!user.openai_api_key,
    } : {})
  }
})

const maskKey = (key: string) => {
  if (key.length <= 8) return '••••••••'
  return key.slice(0, 6) + '••••••••' + key.slice(-4)
}
