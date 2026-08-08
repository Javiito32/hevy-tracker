import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { fetchOffProduct, mapOffToFood, normalizeBarcode } from '../../../utils/openfoodfacts-client'

/**
 * Imports an Open Food Facts product into the user's catalogue by barcode.
 *
 * Always re-fetches the full product rather than trusting anything the client
 * sends: the search index returns kcal and macros only, so importing from a
 * search hit's payload would silently drop every micronutrient.
 *
 * Idempotent — re-importing the same code refreshes the existing row instead of
 * failing on @@unique([user_id, barcode]).
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)
  const code = normalizeBarcode(body?.barcode || body?.code || '')

  if (!code) throw createError({ statusCode: 400, statusMessage: 'Código de barras no válido' })

  const product = await fetchOffProduct(code)
  if (!product) {
    throw createError({
      statusCode: 404,
      statusMessage: `El código ${code} no está en Open Food Facts. Puedes añadir el alimento manualmente.`
    })
  }

  // `image_url` is useful in the preview but is not a Food column.
  const { image_url, ...data } = mapOffToFood(product)

  return prisma.food.upsert({
    where: { user_id_barcode: { user_id: userId, barcode: code } },
    create: { ...data, user_id: userId } as any,
    update: data as any
  })
})
