import { toNutrients, findImplausibleNutrients } from './nutrition-calculator'

/**
 * Open Food Facts client. Same shape as hevy-client.ts: plain `$fetch`, errors
 * handled here, nothing vendor-specific leaking upward.
 *
 * No API key. OFF asks every caller to identify itself with a descriptive
 * User-Agent and rate-limits by IP (documented at 10 req/min for search), which
 * is why searches are cached and callers must debounce.
 */

export const OFF_USER_AGENT = 'HevyTracker/1.0 (personal fitness tracker)'

const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product'
/** Search-a-licious. The legacy `cgi/search.pl` still answers but is being retired. */
const SEARCH_URL = 'https://search.openfoodfacts.org/search'

const PRODUCT_FIELDS = [
  'code',
  'product_name',
  'product_name_es',
  'brands',
  'quantity',
  'serving_size',
  'serving_quantity',
  'nutriments',
  'image_front_small_url'
].join(',')

/**
 * The search index carries only a reduced nutriment set — no micronutrients at
 * all. Importing therefore always re-fetches the full product by code; see
 * `searchOffProducts`.
 */
const SEARCH_FIELDS = ['code', 'product_name', 'brands', 'nutriments', 'image_front_small_url'].join(',')

const CACHE_TTL_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; value: any }>()

const cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Digits only — OFF codes are EAN/UPC and anything else is a guaranteed miss. */
export const normalizeBarcode = (raw: string): string => (raw || '').replace(/\D/g, '')

export interface OffSearchHit {
  code: string
  name: string
  brand: string | null
  image_url: string | null
  kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

/**
 * Fetches one product by barcode. Returns null when OFF doesn't know it.
 *
 * The null case is the whole reason this wrapper exists: an unknown barcode
 * comes back as **HTTP 200** with `{"status":0}`, so a try/catch on the status
 * code — the hevy-client.ts idiom — would never fire and the caller would go on
 * to read `undefined.nutriments`.
 */
export const fetchOffProduct = async (barcode: string): Promise<any | null> => {
  const code = normalizeBarcode(barcode)
  if (!code) return null

  return cached(`product:${code}`, async () => {
    try {
      const res = await $fetch<{ status?: number; product?: any }>(
        `${PRODUCT_URL}/${code}.json?fields=${PRODUCT_FIELDS}`,
        { headers: { 'User-Agent': OFF_USER_AGENT, accept: 'application/json' } }
      )
      return res?.status === 1 && res.product ? res.product : null
    } catch (error) {
      console.error(`❌ Error fetching Open Food Facts product ${code}:`, error)
      throw createError({
        statusCode: 502,
        statusMessage: 'No se pudo consultar Open Food Facts. Inténtalo de nuevo en unos segundos.'
      })
    }
  })
}

/**
 * Free-text product search. Returns a reduced view (kcal + macros only) —
 * enough to pick the right product, never enough to import one.
 */
export const searchOffProducts = async (query: string, limit = 20): Promise<OffSearchHit[]> => {
  const q = (query || '').trim()
  if (q.length < 2) return []
  const size = Math.min(Math.max(limit, 1), 20)

  return cached(`search:${q.toLowerCase()}:${size}`, async () => {
    try {
      const res = await $fetch<{ hits?: any[] }>(SEARCH_URL, {
        headers: { 'User-Agent': OFF_USER_AGENT, accept: 'application/json' },
        query: { q, page_size: size, page: 1, fields: SEARCH_FIELDS }
      })
      return (res?.hits || [])
        .filter(hit => hit?.code)
        .map(hit => {
          const n = hit.nutriments || {}
          return {
            code: String(hit.code),
            name: hit.product_name || 'Sin nombre',
            brand: firstBrand(hit.brands),
            image_url: hit.image_front_small_url || null,
            kcal: energyKcal(n),
            protein_g: num(n.proteins_100g),
            carbs_g: num(n.carbohydrates_100g),
            fat_g: num(n.fat_100g)
          } satisfies OffSearchHit
        })
    } catch (error) {
      console.error(`❌ Error searching Open Food Facts for "${q}":`, error)
      throw createError({
        statusCode: 502,
        statusMessage: 'No se pudo buscar en Open Food Facts. Inténtalo de nuevo en unos segundos.'
      })
    }
  })
}

// ── Nutriment mapping ─────────────────────────────────────────────────────────

const num = (raw: any): number | null => {
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const firstBrand = (brands: any): string | null => {
  const list = Array.isArray(brands) ? brands : typeof brands === 'string' ? brands.split(',') : []
  const first = list[0]?.toString().trim()
  return first || null
}

/**
 * `<nutrient>_100g` is normalised to GRAMS by OFF for every mass nutrient,
 * regardless of what the sibling `_unit` says — verified live: almonds report
 * `calcium_100g: 0.2367` with `calcium_unit: 'g'`, i.e. 237 mg/100 g.
 *
 * So the unit field must NOT be applied to `_100g`; doing so would be a 1000×
 * error on any product whose contributor entered milligrams. `_unit` is only
 * consulted on the fallback path, where the `_value` field is the as-entered
 * number and genuinely carries that unit.
 */
const UNIT_TO_GRAMS: Record<string, number> = {
  g: 1,
  mg: 1e-3,
  µg: 1e-6,
  ug: 1e-6,
  mcg: 1e-6
}

const grams = (nutriments: any, key: string): number | null => {
  // Always ignore `_prepared` variants: those describe the reconstituted
  // product (powder + water), which would break per-gram-of-product arithmetic.
  const direct = num(nutriments?.[`${key}_100g`])
  if (direct != null) return direct

  const value = num(nutriments?.[`${key}_value`])
  const factor = UNIT_TO_GRAMS[String(nutriments?.[`${key}_unit`] || '').toLowerCase()]
  return value != null && factor != null ? value * factor : null
}

const mg = (nutriments: any, key: string): number | null => {
  const g = grams(nutriments, key)
  return g == null ? null : g * 1000
}

const ug = (nutriments: any, key: string): number | null => {
  const g = grams(nutriments, key)
  return g == null ? null : g * 1_000_000
}

/** kcal per 100 g, falling back to the kJ figure when only that is recorded. */
const energyKcal = (nutriments: any): number | null => {
  const kcal = num(nutriments?.['energy-kcal_100g'])
  if (kcal != null) return kcal

  const kj = num(nutriments?.['energy-kj_100g']) ?? num(nutriments?.energy_100g)
  const unit = String(nutriments?.energy_unit || 'kJ').toLowerCase()
  if (kj != null && unit === 'kj') return Math.round((kj / 4.184) * 10) / 10
  return null
}

export interface MappedOffFood {
  name: string
  brand: string | null
  barcode: string
  source: 'openfoodfacts'
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

/**
 * Maps an OFF product to our Food shape, or throws a 4xx explaining why it
 * cannot be imported.
 *
 * Two rejections, both deliberate:
 * - **No resolvable energy** — `kcal` is a non-null column precisely so that no
 *   total can be quietly wrong; a product without it must not be stored.
 * - **Implausible values** — OFF data is contributor-supplied and does contain
 *   impossible figures (a real "avena" listing declares 85 g of sodium per
 *   100 g). Rejecting beats clamping: a clamped number still reads as
 *   authoritative while being wrong.
 */
export const mapOffToFood = (product: any): MappedOffFood => {
  const n = product?.nutriments || {}
  const name = (product?.product_name_es || product?.product_name || '').toString().trim()
  const kcal = energyKcal(n)

  if (kcal == null) {
    throw createError({
      statusCode: 422,
      statusMessage: `"${name || 'El producto'}" no tiene información energética en Open Food Facts. Añádelo manualmente.`
    })
  }

  const mapped: MappedOffFood = {
    name: name || 'Producto sin nombre',
    brand: firstBrand(product?.brands),
    barcode: String(product?.code || ''),
    source: 'openfoodfacts',
    external_id: String(product?.code || ''),
    serving_size_g: num(product?.serving_quantity),
    serving_label: (product?.serving_size || '').toString().trim() || null,
    image_url: product?.image_front_small_url || null,

    kcal,
    protein_g: grams(n, 'proteins') ?? 0,
    carbs_g: grams(n, 'carbohydrates') ?? 0,
    fat_g: grams(n, 'fat') ?? 0,

    fiber_g: grams(n, 'fiber'),
    sugars_g: grams(n, 'sugars'),
    saturated_fat_g: grams(n, 'saturated-fat'),
    // Salt is recorded far more often than sodium: sodium = salt / 2.5.
    sodium_mg: mg(n, 'sodium') ?? (grams(n, 'salt') != null ? grams(n, 'salt')! * 400 : null),
    potassium_mg: mg(n, 'potassium'),
    calcium_mg: mg(n, 'calcium'),
    iron_mg: mg(n, 'iron'),
    magnesium_mg: mg(n, 'magnesium'),
    zinc_mg: mg(n, 'zinc'),
    vitamin_d_ug: ug(n, 'vitamin-d'),
    vitamin_c_mg: mg(n, 'vitamin-c'),
    vitamin_b12_ug: ug(n, 'vitamin-b12')
  }

  const implausible = findImplausibleNutrients(toNutrients(mapped))
  if (implausible.length > 0) {
    throw createError({
      statusCode: 422,
      statusMessage: `"${mapped.name}" tiene datos imposibles en Open Food Facts (${implausible.join(', ')}). Añádelo manualmente con valores correctos.`
    })
  }

  return mapped
}
