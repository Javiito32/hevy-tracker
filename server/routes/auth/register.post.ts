import bcrypt from 'bcryptjs'
import { prisma } from '../../utils/prisma'

export default defineEventHandler(async (event) => {
  const { name, email, password } = await readBody(event)

  if (!name?.trim() || !email?.trim() || !password) {
    throw createError({ statusCode: 400, message: 'Nombre, email y contraseña son obligatorios' })
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, message: 'La contraseña debe tener al menos 8 caracteres' })
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (existing) {
    throw createError({ statusCode: 409, message: 'Ya existe una cuenta con ese email' })
  }

  const userCount = await prisma.user.count()
  const role = userCount === 0 ? 'admin' : 'user'

  const password_hash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: { name: name.trim(), email: email.toLowerCase(), password_hash, role }
  })

  await setUserSession(event, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  })

  return { id: user.id, name: user.name, email: user.email, role: user.role }
})
