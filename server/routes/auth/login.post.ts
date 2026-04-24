import bcrypt from 'bcryptjs'
import { prisma } from '../../utils/prisma'

// In-memory rate limiter: max 5 failed attempts per IP within 15 minutes
const failedAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000

function isBlocked(ip: string): boolean {
  const now = Date.now()
  const record = failedAttempts.get(ip)
  if (!record || now > record.resetAt) return false
  return record.count >= MAX_FAILURES
}

function getBlockMessage(ip: string): string {
  const record = failedAttempts.get(ip)!
  const minutesLeft = Math.ceil((record.resetAt - Date.now()) / 60000)
  return `Demasiados intentos fallidos. Espera ${minutesLeft} minuto${minutesLeft !== 1 ? 's' : ''}.`
}

function recordFailure(ip: string) {
  const now = Date.now()
  const record = failedAttempts.get(ip)
  if (!record || now > record.resetAt) {
    failedAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
  } else {
    record.count++
  }
}

function clearFailures(ip: string) {
  failedAttempts.delete(ip)
}

export default defineEventHandler(async (event) => {
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'

  if (isBlocked(ip)) {
    throw createError({ statusCode: 429, message: getBlockMessage(ip) })
  }

  const { email, password } = await readBody(event)

  if (!email || !password) {
    throw createError({ statusCode: 400, message: 'Email y contraseña son obligatorios' })
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })

  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    recordFailure(ip)
    // Keep generic message to avoid revealing whether the email exists
    throw createError({ statusCode: 401, message: 'Email o contraseña incorrectos' })
  }

  if (!user.is_active) {
    throw createError({ statusCode: 403, message: 'Cuenta desactivada. Contacta al administrador.' })
  }

  clearFailures(ip)

  await prisma.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } })

  await setUserSession(event, {
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  })

  return { id: user.id, name: user.name, email: user.email, role: user.role }
})
