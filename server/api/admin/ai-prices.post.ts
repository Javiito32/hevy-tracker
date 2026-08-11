import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'

/**
 * Creates or updates the price of a model. One upsert endpoint rather than
 * separate create/patch routes: the model slug is the natural key, and the admin
 * table edits rows in place.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const body = await readBody<{
    model?: string
    input_per_1m?: number | string
    output_per_1m?: number | string
    cached_input_per_1m?: number | string | null
    currency?: string
  }>(event)

  const model = body?.model?.trim()
  if (!model) throw createError({ statusCode: 400, statusMessage: 'El modelo es obligatorio' })

  const inputPer1m = parsePrice(body?.input_per_1m, 'precio de entrada')
  const outputPer1m = parsePrice(body?.output_per_1m, 'precio de salida')
  // Optional. Left empty, cached input is billed at the full input rate — an
  // overestimate rather than an invented discount.
  const cachedInputPer1m = body?.cached_input_per_1m == null || body.cached_input_per_1m === ''
    ? null
    : parsePrice(body.cached_input_per_1m, 'precio de entrada cacheada')
  const currency = body?.currency?.trim().toUpperCase() || 'USD'

  return prisma.aiModelPrice.upsert({
    where: { model },
    create: { model, input_per_1m: inputPer1m, output_per_1m: outputPer1m, cached_input_per_1m: cachedInputPer1m, currency },
    update: { input_per_1m: inputPer1m, output_per_1m: outputPer1m, cached_input_per_1m: cachedInputPer1m, currency }
  })
})

/**
 * Rejects non-numeric and negative prices. A silent NaN would land in the DB and
 * turn every cost total for that model into NaN.
 */
function parsePrice(raw: unknown, label: string): number {
  const value = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw createError({ statusCode: 400, statusMessage: `El ${label} debe ser un número mayor o igual que 0` })
  }
  return value
}
