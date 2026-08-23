import { toNutrients, findImplausibleNutrients } from './nutrition-calculator'
import { normalizeBarcode } from './openfoodfacts-client'

/**
 * Nutriinfo client (https://www.nutriinfo.es/desarrolladores).
 *
 * Read-only public API, Spanish supermarket catalogue, keyed by EAN. Requires
 * `NUTRIINFO_API_KEY` (header `x-api-key`). The documented cap is **20 requests
 * per hour**, which is why this module is a barcode fallback only — never a
 * typeahead — and why both hits and misses are cached for an hour. A miss that
 * wasn't cached would burn the quota on a second scan of the same unknown code.
 *
 * `nutrition` is `null` when they have the product but not the table; that is
 * treated as unusable, the same as an Open Food Facts row with no energy.
 */

const PRODUCT_URL = 'https://www.nutriinfo.es/api/public/v1/products'
const USER_AGENT = 'HevyTracker/1.0 (personal fitness tracker)'
const CACHE_TTL_MS = 60 * 60 * 1000

const cache = new Map<string, { at: number; value: NutriinfoProduct | null }>()
const inflight = new Map<string, Promise<NutriinfoProduct | null>>()

export interface NutriinfoPer100g {
  energy_kcal?: number | null
  energy_kj?: number | null
  fats_g?: number | null
  saturated_fats_g?: number | null
  carbs_g?: number | null
  sugars_g?: number | null
  fiber_g?: number | null
  proteins_g?: number | null
  salt_g?: number | null
}

export interface NutriinfoProduct {
  id: string
  ean: string
  name: string
  nutrition: { per100g?: NutriinfoPer100g | null } | null
}

export interface MappedNutriinfoFood {
  name: string
  brand: string | null
  barcode: string
  source: 'nutriinfo'
  external_id: string
  serving_size_g: number | null
  serving_label: string | null
  image_url: string | null
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  [nutrient: string]: any
}

const nutriinfoKey = (): string => {
  const key = useRuntimeConfig().nutriinfoApiKey
  return typeof key === 'string' ? key.trim() : ''
}

export const isNutriinfoConfigured = (): boolean => Boolean(nutriinfoKey())

const cached = async (
  key: string,
  load: () => Promise<NutriinfoProduct | null>
): Promise<NutriinfoProduct | null> => {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const pending = inflight.get(key)
  if (pending) return pending

  const promise = (async () => {
    try {
      const value = await load()
      cache.set(key, { at: Date.now(), value })
      return value
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, promise)
  return promise
}

const httpStatus = (error: unknown): number | undefined => {
  const err = error as { statusCode?: number; status?: number; response?: { status?: number } }
  return err?.statusCode ?? err?.status ?? err?.response?.status
}

const retryAfterSeconds = (error: unknown): string | null => {
  const err = error as {
    response?: { headers?: { get?: (name: string) => string | null } }
    headers?: { get?: (name: string) => string | null; 'retry-after'?: string }
  }
  const raw =
    err?.response?.headers?.get?.('retry-after') ||
    err?.headers?.get?.('retry-after') ||
    err?.headers?.['retry-after'] ||
    null
  return raw ? String(raw) : null
}

/**
 * Fetches one product by EAN. Returns null when Nutriinfo doesn't know it
 * (HTTP 404) or when no API key is configured — callers treat both as a miss
 * so the user can still add the food by hand.
 *
 * 429 / auth / network failures throw rather than returning null: a rate-limit
 * is not "the product does not exist", and collapsing them would make the
 * fallback look empty while the quota is merely exhausted.
 */
export const fetchNutriinfoProduct = async (barcode: string): Promise<NutriinfoProduct | null> => {
  const code = normalizeBarcode(barcode)
  const key = nutriinfoKey()
  if (!code || !key) return null

  return cached(`ean:${code}`, async () => {
    try {
      const res = await $fetch<{ ok?: boolean; data?: NutriinfoProduct }>(PRODUCT_URL, {
        headers: {
          'x-api-key': key,
          accept: 'application/json',
          'User-Agent': USER_AGENT
        },
        query: { ean: code }
      })
      if (!res?.ok || !res.data) return null
      return res.data
    } catch (error) {
      const status = httpStatus(error)
      if (status === 404) return null

      // Don't cache these — a later retry (or a fixed key) should actually run.
      if (status === 429) {
        const wait = retryAfterSeconds(error)
        throw createError({
          statusCode: 429,
          statusMessage: wait
            ? `Nutriinfo ha alcanzado el límite de consultas. Prueba en ${wait} segundos o añade el alimento a mano.`
            : 'Nutriinfo ha alcanzado el límite de 20 consultas por hora. Prueba más tarde o añade el alimento a mano.'
        })
      }
      if (status === 401 || status === 403) {
        console.error('❌ Nutriinfo API key rejected:', status)
        throw createError({
          statusCode: 503,
          statusMessage: 'La consulta a Nutriinfo no está disponible. Puedes añadir el alimento manualmente.'
        })
      }
      console.error(`❌ Error fetching Nutriinfo product ${code}:`, error)
      throw createError({
        statusCode: 502,
        statusMessage: 'No se pudo consultar Nutriinfo. Inténtalo de nuevo en unos segundos.'
      })
    }
  })
}

const num = (raw: unknown): number | null => {
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const energyKcal = (per: NutriinfoPer100g | null | undefined): number | null => {
  const kcal = num(per?.energy_kcal)
  if (kcal != null) return kcal
  const kj = num(per?.energy_kj)
  if (kj == null) return null
  return Math.round((kj / 4.184) * 10) / 10
}

/**
 * Maps a Nutriinfo product to our Food shape, or throws a 4xx explaining why
 * it cannot be imported. Same two rejections as Open Food Facts: no resolvable
 * energy, and implausible values. Quantities are per 100 g already.
 *
 * Sodium is derived from salt (NaCl → Na, ×400 to milligrams) — Nutriinfo
 * publishes salt, not sodium, and this is the same conversion Open Food Facts
 * uses when only salt is present.
 */
export const mapNutriinfoToFood = (product: NutriinfoProduct, barcode: string): MappedNutriinfoFood => {
  const name = (product?.name || '').toString().trim()
  const per = product?.nutrition?.per100g
  const kcal = energyKcal(per)

  if (kcal == null) {
    throw createError({
      statusCode: 422,
      statusMessage: `"${name || 'El producto'}" no tiene información energética en Nutriinfo. Añádelo manualmente.`
    })
  }

  const saltG = num(per?.salt_g)

  const mapped: MappedNutriinfoFood = {
    name: name || 'Producto sin nombre',
    brand: null,
    barcode: normalizeBarcode(barcode) || String(product?.ean || ''),
    source: 'nutriinfo',
    external_id: String(product?.id || product?.ean || barcode),
    serving_size_g: null,
    serving_label: null,
    image_url: null,

    kcal,
    protein_g: num(per?.proteins_g) ?? 0,
    carbs_g: num(per?.carbs_g) ?? 0,
    fat_g: num(per?.fats_g) ?? 0,

    fiber_g: num(per?.fiber_g),
    sugars_g: num(per?.sugars_g),
    saturated_fat_g: num(per?.saturated_fats_g),
    sodium_mg: saltG != null ? saltG * 400 : null,
    potassium_mg: null,
    calcium_mg: null,
    iron_mg: null,
    magnesium_mg: null,
    zinc_mg: null,
    vitamin_d_ug: null,
    vitamin_c_mg: null,
    vitamin_b12_ug: null
  }

  const implausible = findImplausibleNutrients(toNutrients(mapped))
  if (implausible.length > 0) {
    throw createError({
      statusCode: 422,
      statusMessage: `"${mapped.name}" tiene datos imposibles en Nutriinfo (${implausible.join(', ')}). Añádelo manualmente con valores correctos.`
    })
  }

  return mapped
}
