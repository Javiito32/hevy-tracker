import {
  NUTRIENT_KEYS,
  MACRO_KEYS,
  NUTRIENT_LABELS_ES,
  NUTRIENT_UNITS,
  NUTRIENT_MAX,
  toNutrients,
  findImplausibleNutrients
} from './nutrition-calculator'

/**
 * Validation for food input, shared by the manual CRUD routes and the external
 * importers (Open Food Facts, Nutriinfo). It lives outside nutrition-calculator.ts
 * because that file is pure arithmetic and knows nothing about HTTP.
 *
 * Both entry points must reject the same values: a food imported with an
 * impossible sodium figure is exactly as poisonous to totals and AI analyses as
 * one typed in by hand.
 */

/** Turns '', null and undefined into null; anything else into a finite number or null. */
const optionalNumber = (raw: any): number | null => {
  if (raw === '' || raw == null) return null
  const num = typeof raw === 'string' ? Number(raw) : raw
  return typeof num === 'number' && Number.isFinite(num) ? num : null
}

/**
 * Throws a 400 listing every out-of-range nutrient, in Spanish with its unit.
 * Values are rejected, never clamped: a clamped figure still reads as
 * authoritative while being wrong.
 */
export const assertPlausible = (nutrients: Record<string, any>, contextLabel?: string) => {
  const bad = findImplausibleNutrients(toNutrients(nutrients))
  if (bad.length === 0) return

  const detail = bad
    .map(k => `${NUTRIENT_LABELS_ES[k]} (máx ${NUTRIENT_MAX[k]} ${NUTRIENT_UNITS[k]}/100 g)`)
    .join(', ')
  throw createError({
    statusCode: 400,
    statusMessage: `Valores nutricionales fuera de rango${contextLabel ? ` en "${contextLabel}"` : ''}: ${detail}. Revisa que estén expresados por 100 g.`
  })
}

/**
 * Builds the Prisma data object for a Food from a request body.
 *
 * `partial` (PATCH) only includes keys the caller actually sent, so omitting a
 * field leaves it untouched while sending an empty string clears it.
 */
export const buildFoodData = (body: any, options: { partial?: boolean } = {}) => {
  const partial = options.partial === true
  const data: Record<string, any> = {}

  const name = typeof body.name === 'string' ? body.name.trim() : undefined
  if (!partial || body.name !== undefined) {
    if (!name) throw createError({ statusCode: 400, statusMessage: 'El nombre del alimento es obligatorio' })
    data.name = name
  }

  for (const key of ['brand', 'serving_label', 'barcode'] as const) {
    if (!partial || body[key] !== undefined) {
      const value = typeof body[key] === 'string' ? body[key].trim() : null
      data[key] = value || null
    }
  }

  if (!partial || body.serving_size_g !== undefined) {
    const grams = optionalNumber(body.serving_size_g)
    if (grams != null && grams <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'La ración debe ser mayor que 0 g' })
    }
    data.serving_size_g = grams
  }

  // kcal and the three macros are non-null columns: a food without them would
  // make every total that includes it silently wrong.
  for (const key of MACRO_KEYS) {
    if (!partial || body[key] !== undefined) {
      const value = optionalNumber(body[key])
      if (key === 'kcal' && value == null) {
        throw createError({ statusCode: 400, statusMessage: 'Las kcal por 100 g son obligatorias' })
      }
      data[key] = value ?? 0
    }
  }

  for (const key of NUTRIENT_KEYS) {
    if ((MACRO_KEYS as readonly string[]).includes(key)) continue
    if (!partial || body[key] !== undefined) data[key] = optionalNumber(body[key])
  }

  assertPlausible({ ...data }, data.name)
  return data
}
