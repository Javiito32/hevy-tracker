import { prisma } from '../utils/prisma'
import { getSessionUser } from '../utils/session'
import bcrypt from 'bcryptjs'

export default defineEventHandler(async (event) => {
  const sessionUser = await getSessionUser(event)
  const body = await readBody(event)
  const { name, height, sex, birth_date, hevy_api_key, email, current_password, new_password } = body

  const data: Record<string, any> = {}
  if (name !== undefined) data.name = name
  if (height !== undefined) data.height = height ? Number(height) : null
  if (sex !== undefined) data.sex = sex || null
  if (birth_date !== undefined) data.birth_date = birth_date ? new Date(birth_date) : null
  if (hevy_api_key && !hevy_api_key.includes('••••')) data.hevy_api_key = hevy_api_key

  // Email change
  if (email && email !== sessionUser.email) {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) throw createError({ statusCode: 409, message: 'Ese email ya está en uso.' })
    data.email = email
  }

  // Password change — consistent cost factor with registration (12)
  if (new_password) {
    if (!current_password) {
      throw createError({ statusCode: 400, message: 'Introduce tu contraseña actual para cambiarla.' })
    }
    const user = await prisma.user.findUnique({ where: { id: sessionUser.id } })
    const valid = await bcrypt.compare(current_password, user!.password_hash)
    if (!valid) {
      throw createError({ statusCode: 401, message: 'La contraseña actual no es correcta.' })
    }
    data.password_hash = await bcrypt.hash(new_password, 12)
  }

  await prisma.user.update({ where: { id: sessionUser.id }, data })

  // Refresh session if identity fields changed so the navbar reflects new values immediately
  if (data.name || data.email) {
    const updated = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, name: true, email: true, role: true }
    })
    if (updated) {
      await setUserSession(event, { user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role } })
    }
  }

  return { success: true }
})
