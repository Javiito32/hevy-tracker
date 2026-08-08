import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const query = getQuery(event)
  const q = (query.q as string | undefined)?.trim()
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)

  return prisma.food.findMany({
    where: {
      user_id: userId,
      // SQLite has no case-insensitive `mode`, so `contains` is already
      // case-insensitive for ASCII here — good enough for a personal catalogue.
      ...(q && {
        OR: [{ name: { contains: q } }, { brand: { contains: q } }, { barcode: { contains: q } }]
      })
    },
    orderBy: { name: 'asc' },
    take: limit
  })
})
