import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { lookupExternalFood } from '../../../utils/barcode-lookup'
import { normalizeBarcode } from '../../../utils/openfoodfacts-client'

/**
 * Preview of an external product by barcode. Open Food Facts first, Nutriinfo
 * if OFF doesn't have a usable record. Does not persist anything — the user
 * confirms first, and `import.post.ts` writes (through the same lookup).
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const code = normalizeBarcode((getQuery(event).code as string) || '')

  if (!code) throw createError({ statusCode: 400, statusMessage: 'Código de barras no válido' })

  // Answer from the user's own catalogue first: re-scanning something already
  // saved shouldn't cost an external request, and the local values may be corrected.
  const existing = await prisma.food.findFirst({ where: { user_id: userId, barcode: code } })
  if (existing) return { source: 'catalog', already_in_catalog: true, food: existing }

  const { source, food } = await lookupExternalFood(code)
  return { source, already_in_catalog: false, food }
})
