import {
  fetchOffProduct,
  mapOffToFood,
  normalizeBarcode,
  type MappedOffFood
} from './openfoodfacts-client'
import {
  fetchNutriinfoProduct,
  isNutriinfoConfigured,
  mapNutriinfoToFood,
  type MappedNutriinfoFood
} from './nutriinfo-client'

/**
 * Resolves a barcode against the external catalogues, in order:
 *
 *  1. Open Food Facts (no key, richer micros when the product exists)
 *  2. Nutriinfo, only when OFF doesn't know the code or its nutrition is
 *     unusable — and only if `NUTRIINFO_API_KEY` is set
 *
 * Both preview (`barcode.get`) and import (`import.post`) go through here so
 * a product the user just confirmed from Nutriinfo cannot 404 on save because
 * import still spoke only to OFF.
 */

export type MappedExternalFood = MappedOffFood | MappedNutriinfoFood
export type ExternalFoodSource = MappedExternalFood['source']

const isUnusableNutrition = (err: unknown): boolean =>
  Boolean(err && typeof err === 'object' && (err as { statusCode?: number }).statusCode === 422)

const isOffUnreachable = (err: unknown): boolean =>
  Boolean(err && typeof err === 'object' && (err as { statusCode?: number }).statusCode === 502)

export interface ExternalFoodLookup {
  source: ExternalFoodSource
  food: MappedExternalFood
}

export const lookupExternalFood = async (barcode: string): Promise<ExternalFoodLookup> => {
  const code = normalizeBarcode(barcode)
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Código de barras no válido' })

  let offUnreachable = false
  let offUnusable: unknown = null

  try {
    const product = await fetchOffProduct(code)
    if (product) {
      try {
        return { source: 'openfoodfacts', food: mapOffToFood(product) }
      } catch (err) {
        if (!isUnusableNutrition(err)) throw err
        offUnusable = err
      }
    }
  } catch (err) {
    if (!isOffUnreachable(err)) throw err
    offUnreachable = true
  }

  if (isNutriinfoConfigured()) {
    const product = await fetchNutriinfoProduct(code)
    if (product) {
      return { source: 'nutriinfo', food: mapNutriinfoToFood(product, code) }
    }
  }

  if (offUnusable) throw offUnusable

  if (offUnreachable) {
    throw createError({
      statusCode: 502,
      statusMessage: 'No se pudo consultar las bases de productos. Inténtalo de nuevo en unos segundos.'
    })
  }

  throw createError({
    statusCode: 404,
    statusMessage: isNutriinfoConfigured()
      ? `El código ${code} no está en Open Food Facts ni en Nutriinfo. Puedes añadir el alimento manualmente.`
      : `El código ${code} no está en Open Food Facts. Puedes añadir el alimento manualmente.`
  })
}
