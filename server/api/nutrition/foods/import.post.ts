import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { lookupExternalFood } from '../../../utils/barcode-lookup'
import { normalizeBarcode } from '../../../utils/openfoodfacts-client'

/**
 * Imports an external product into the user's catalogue by barcode.
 *
 * Always re-fetches rather than trusting anything the client sends: the OFF
 * search index returns kcal and macros only, so importing from a search hit's
 * payload would silently drop every micronutrient. The re-fetch goes through
 * the same lookup as the preview (OFF, then Nutriinfo) so a Nutriinfo hit
 * cannot 404 here.
 *
 * Idempotent — re-importing the same code refreshes the existing row instead of
 * failing on @@unique([user_id, barcode]).
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)
  const code = normalizeBarcode(body?.barcode || body?.code || '')

  if (!code) throw createError({ statusCode: 400, statusMessage: 'Código de barras no válido' })

  const { food } = await lookupExternalFood(code)

  // `image_url` is useful in the preview but is not a Food column.
  const { image_url, ...data } = food

  return prisma.food.upsert({
    where: { user_id_barcode: { user_id: userId, barcode: code } },
    create: { ...data, user_id: userId } as any,
    update: data as any
  })
})
