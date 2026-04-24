import { PrismaClient } from '@prisma/client'

const prismaGlobal = global as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = prismaGlobal.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') {
  prismaGlobal.prisma = prisma
}

// Enable WAL mode for better durability and concurrent read performance
prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;').catch(() => {})
