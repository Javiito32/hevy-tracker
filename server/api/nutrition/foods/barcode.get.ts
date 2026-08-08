import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { fetchOffProduct, mapOffToFood, normalizeBarcode } from '../../../utils/openfoodfacts-client'

/**
 * Preview of an Open Food Facts product by barcode. Does not persist anything —
 * the user confirms first, and `import.post.ts` writes.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const code = normalizeBarcode((getQuery(event).code as string) || '')

  if (!code) throw createError({ statusCode: 400, statusMessage: 'Código de barras no válido' })

  // Answer from the user's own catalogue first: re-scanning something already
  // saved shouldn't cost an OFF request, and the local values may be corrected.
  const existing = await prisma.food.findFirst({ where: { user_id: userId, barcode: code } })
  if (existing) return { source: 'catalog', already_in_catalog: true, food: existing }

  const product = await fetchOffProduct(code)
  if (!product) {
    throw createError({
      statusCode: 404,
      statusMessage: `El código ${code} no está en Open Food Facts. Puedes añadir el alimento manualmente.`
    })
  }

  return { source: 'openfoodfacts', already_in_catalog: false, food: mapOffToFood(product) }
})
