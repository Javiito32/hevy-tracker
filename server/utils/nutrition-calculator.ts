/**
 * Nutrition arithmetic. The counterpart of volume-calculator.ts for the diet
 * side of the app: everything that turns "X grams of food Y" into totals lives
 * here, and nowhere else.
 *
 * Two rules govern the whole file:
 *
 * 1. All nutrient values are PER 100 g. Foods are stored that way, snapshots are
 *    stored that way, and scaling to an actual quantity happens only here.
 * 2. `null` means UNKNOWN, not zero. A food with no potassium data must not make
 *    a day's potassium total look complete but low — a total that includes any
 *    unknown contribution is itself unknown. `sumNutrients` propagates that.
 */

/** The 16 tracked nutrients: energy, 3 macros, 12 micros. All per 100 g. */
export interface Nutrients {
  kcal: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sugars_g: number | null
  saturated_fat_g: number | null
  sodium_mg: number | null
  potassium_mg: number | null
  calcium_mg: number | null
  iron_mg: number | null
  magnesium_mg: number | null
  zinc_mg: number | null
  vitamin_d_ug: number | null
  vitamin_c_mg: number | null
  vitamin_b12_ug: number | null
}

export const NUTRIENT_KEYS = [
  'kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'sugars_g',
  'saturated_fat_g',
  'sodium_mg',
  'potassium_mg',
  'calcium_mg',
  'iron_mg',
  'magnesium_mg',
  'zinc_mg',
  'vitamin_d_ug',
  'vitamin_c_mg',
  'vitamin_b12_ug'
] as const

export type NutrientKey = (typeof NUTRIENT_KEYS)[number]

/** The four that every food must have, and that drive the hot total columns. */
export const MACRO_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const

/** The 12 micronutrients, in the order the UI groups them. */
export const MICRO_KEYS = NUTRIENT_KEYS.filter(
  k => !(MACRO_KEYS as readonly string[]).includes(k)
) as readonly NutrientKey[]

export const NUTRIENT_LABELS_ES: Record<NutrientKey, string> = {
  kcal: 'Calorías',
  protein_g: 'Proteína',
  carbs_g: 'Carbohidratos',
  fat_g: 'Grasa',
  fiber_g: 'Fibra',
  sugars_g: 'Azúcares',
  saturated_fat_g: 'Grasa saturada',
  sodium_mg: 'Sodio',
  potassium_mg: 'Potasio',
  calcium_mg: 'Calcio',
  iron_mg: 'Hierro',
  magnesium_mg: 'Magnesio',
  zinc_mg: 'Zinc',
  vitamin_d_ug: 'Vitamina D',
  vitamin_c_mg: 'Vitamina C',
  vitamin_b12_ug: 'Vitamina B12'
}

export const NUTRIENT_UNITS: Record<NutrientKey, string> = {
  kcal: 'kcal',
  protein_g: 'g',
  carbs_g: 'g',
  fat_g: 'g',
  fiber_g: 'g',
  sugars_g: 'g',
  saturated_fat_g: 'g',
  sodium_mg: 'mg',
  potassium_mg: 'mg',
  calcium_mg: 'mg',
  iron_mg: 'mg',
  magnesium_mg: 'mg',
  zinc_mg: 'mg',
  vitamin_d_ug: 'µg',
  vitamin_c_mg: 'mg',
  vitamin_b12_ug: 'µg'
}

/** kcal per gram of each macro, for the consistency check in macroSplit(). */
const KCAL_PER_G = { protein_g: 4, carbs_g: 4, fat_g: 9 } as const

/** Rounds to `decimals` places, preserving null. */
const round = (v: number | null, decimals = 1): number | null => {
  if (v == null || !Number.isFinite(v)) return null
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/** An all-null Nutrients object — the identity element for sumNutrients(). */
export const emptyNutrients = (): Nutrients =>
  Object.fromEntries(NUTRIENT_KEYS.map(k => [k, null])) as unknown as Nutrients

/**
 * Coerces an arbitrary object (a Food row, a parsed snapshot, a request body)
 * into a Nutrients. Missing, non-numeric and non-finite values all become null.
 */
export const toNutrients = (source: any): Nutrients => {
  const out = emptyNutrients()
  if (!source || typeof source !== 'object') return out
  for (const key of NUTRIENT_KEYS) {
    const raw = source[key]
    const num = typeof raw === 'string' ? Number(raw) : raw
    if (typeof num === 'number' && Number.isFinite(num)) out[key] = num
  }
  return out
}

/**
 * Reads a DietItem.nutrients_snapshot. Never throws: a corrupted snapshot
 * degrades to all-unknown rather than taking down the whole diet page.
 */
export const parseSnapshot = (json: string | null | undefined): Nutrients => {
  if (!json) return emptyNutrients()
  try {
    return toNutrients(JSON.parse(json))
  } catch {
    return emptyNutrients()
  }
}

/** Serialises a food's per-100 g values for storage on a DietItem. */
export const buildSnapshot = (food: any): string => JSON.stringify(toNutrients(food))

/** Scales per-100 g values to an actual quantity in grams. */
export const scaleNutrients = (per100g: Nutrients, grams: number): Nutrients => {
  const factor = (Number(grams) || 0) / 100
  const out = emptyNutrients()
  for (const key of NUTRIENT_KEYS) {
    const v = per100g[key]
    if (v != null) out[key] = v * factor
  }
  return out
}

/** How many contributions actually carried a value for each nutrient. */
export type Coverage = Partial<Record<NutrientKey, { known: number; total: number }>>

/**
 * Sums already-scaled contributions.
 *
 * A nutrient is null only when NO contribution reported it. When some did and
 * others didn't, the partial sum is returned — but `sumCoverage` records how
 * many foods it came from, and every consumer must surface that.
 *
 * The alternative (null as soon as one food lacks the data) was tried and is
 * wrong in practice: Open Food Facts records micronutrients for a small
 * minority of products, so one incomplete food would blank out the nutrient for
 * the whole diet and the micronutrient feature would show nothing but dashes.
 * A partial sum is a legitimate lower bound; what makes it honest rather than
 * misleading is shipping the coverage alongside it, never the bare number.
 */
export const sumNutrients = (contributions: Nutrients[]): Nutrients => {
  const out = emptyNutrients()
  if (contributions.length === 0) return out

  for (const key of NUTRIENT_KEYS) {
    let total = 0
    let sawValue = false
    for (const c of contributions) {
      if (c[key] == null) continue
      total += c[key] as number
      sawValue = true
    }
    out[key] = sawValue ? round(total) : null
  }
  return out
}

/**
 * Per-nutrient tally of how many of the contributions had the data.
 * `known < total` means the matching figure in `sumNutrients` is a lower bound.
 */
export const sumCoverage = (contributions: Nutrients[]): Coverage => {
  const out: Coverage = {}
  for (const key of NUTRIENT_KEYS) {
    const known = contributions.filter(c => c[key] != null).length
    out[key] = { known, total: contributions.length }
  }
  return out
}

/** True when the figure for `key` came from every contribution. */
export const isComplete = (coverage: Coverage | null | undefined, key: NutrientKey): boolean => {
  const entry = coverage?.[key]
  return !entry || entry.known === entry.total
}

/** A meal shaped as the totals code needs it: a day_type and scaled items. */
export interface MealForTotals {
  day_type?: string | null
  items: Array<{ quantity_g: number; nutrients_snapshot: string | null }>
}

/** Totals for one meal, from its items' snapshots. */
export const computeMealTotals = (meal: MealForTotals): Nutrients =>
  sumNutrients(
    (meal.items || []).map(item =>
      scaleNutrients(parseSnapshot(item.nutrients_snapshot), item.quantity_g)
    )
  )

export interface VersionTotals {
  /** Meals eaten every day. The reference figure shown when no day split exists. */
  all: Nutrients
  /** day_type 'all' + 'training'. */
  training: Nutrients
  /** day_type 'all' + 'rest'. */
  rest: Nutrients
  /** How many foods backed each figure above. See `sumCoverage`. */
  coverage: { all: Coverage; training: Coverage; rest: Coverage }
}

/**
 * Totals for a whole diet version, per day type.
 *
 * `all` is the baseline eaten every day; a training day is that baseline plus
 * the training-only meals, and likewise for rest. A version with no day-specific
 * meals therefore reports the same figures in all three, which is what the
 * phase-1 UI shows.
 */
export const computeVersionTotals = (meals: MealForTotals[]): VersionTotals => {
  const contributionsFor = (types: string[]) =>
    (meals || [])
      .filter(m => types.includes(m.day_type || 'all'))
      .flatMap(m =>
        (m.items || []).map(item =>
          scaleNutrients(parseSnapshot(item.nutrients_snapshot), item.quantity_g)
        )
      )

  const all = contributionsFor(['all'])
  const training = contributionsFor(['all', 'training'])
  const rest = contributionsFor(['all', 'rest'])

  return {
    all: sumNutrients(all),
    training: sumNutrients(training),
    rest: sumNutrients(rest),
    coverage: {
      all: sumCoverage(all),
      training: sumCoverage(training),
      rest: sumCoverage(rest)
    }
  }
}

export interface MacroSplit {
  protein_pct: number | null
  carbs_pct: number | null
  fat_pct: number | null
  /** kcal implied by the macros (4/4/9). */
  kcal_from_macros: number | null
  /**
   * Difference between the stated kcal and the macro-derived figure. A large
   * gap means a manually entered food has inconsistent numbers, which is worth
   * flagging in the UI rather than silently averaging away.
   */
  kcal_discrepancy: number | null
}

export const macroSplit = (t: Nutrients): MacroSplit => {
  const { protein_g, carbs_g, fat_g, kcal } = t
  if (protein_g == null || carbs_g == null || fat_g == null) {
    return {
      protein_pct: null,
      carbs_pct: null,
      fat_pct: null,
      kcal_from_macros: null,
      kcal_discrepancy: null
    }
  }

  const fromMacros =
    protein_g * KCAL_PER_G.protein_g + carbs_g * KCAL_PER_G.carbs_g + fat_g * KCAL_PER_G.fat_g
  // Percentages are of the macro-derived energy, not the stated kcal: otherwise
  // an inconsistent entry would produce percentages that don't add up to 100.
  const base = fromMacros || 1

  return {
    protein_pct: round((protein_g * KCAL_PER_G.protein_g * 100) / base, 0),
    carbs_pct: round((carbs_g * KCAL_PER_G.carbs_g * 100) / base, 0),
    fat_pct: round((fat_g * KCAL_PER_G.fat_g * 100) / base, 0),
    kcal_from_macros: round(fromMacros, 0),
    kcal_discrepancy: kcal == null ? null : round(kcal - fromMacros, 0)
  }
}

/** Grams of protein per kg of bodyweight — the figure coaches actually use. */
export const proteinPerKg = (t: Nutrients, weightKg: number | null | undefined): number | null => {
  if (t.protein_g == null || !weightKg || weightKg <= 0) return null
  return round(t.protein_g / weightKg, 2)
}

/**
 * Plausibility bounds per 100 g, used to reject junk before it reaches a total.
 *
 * Open Food Facts data is contributor-supplied and genuinely contains
 * impossible values — a real "avena" product in the search index declares
 * 85 g of sodium per 100 g. Storing that would poison every total and every AI
 * analysis downstream, so imports are rejected rather than clamped: a clamped
 * value looks authoritative and is still wrong.
 */
export const NUTRIENT_MAX: Record<NutrientKey, number> = {
  kcal: 900, // pure fat is 900 kcal/100 g
  protein_g: 100,
  carbs_g: 100,
  fat_g: 100,
  fiber_g: 100,
  sugars_g: 100,
  saturated_fat_g: 100,
  sodium_mg: 40000, // pure salt is ~39 g sodium/100 g
  potassium_mg: 20000,
  calcium_mg: 20000,
  iron_mg: 1000,
  magnesium_mg: 5000,
  zinc_mg: 1000,
  vitamin_d_ug: 2000,
  vitamin_c_mg: 20000,
  vitamin_b12_ug: 5000
}

/**
 * Returns the keys whose values are negative or above NUTRIENT_MAX.
 * Empty array = plausible.
 */
export const findImplausibleNutrients = (n: Nutrients): NutrientKey[] =>
  NUTRIENT_KEYS.filter(key => {
    const v = n[key]
    return v != null && (v < 0 || v > NUTRIENT_MAX[key])
  })
