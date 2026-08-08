/**
 * Client-side nutrition labels and formatters (auto-imported, like format.ts).
 *
 * The labels and units mirror `server/utils/nutrition-calculator.ts`, which is
 * the source of truth. They are duplicated rather than imported because pulling
 * a server util into the browser bundle to reuse sixteen strings is a worse
 * trade — the same reason ai-context.ts keeps its own copy of the week helpers
 * instead of importing ai-payload.ts. Keep the two lists in sync.
 */

export const MACRO_KEYS = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const

export const MICRO_KEYS = [
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

export const NUTRIENT_KEYS = [...MACRO_KEYS, ...MICRO_KEYS] as const

export type NutrientKey = (typeof NUTRIENT_KEYS)[number]

export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
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

/** Compact labels for tight spots (table headers, totals strip). */
export const NUTRIENT_SHORT_LABELS: Record<NutrientKey, string> = {
  ...NUTRIENT_LABELS,
  protein_g: 'Prot.',
  carbs_g: 'Carbs',
  fat_g: 'Grasa',
  saturated_fat_g: 'Saturada',
  vitamin_d_ug: 'Vit. D',
  vitamin_c_mg: 'Vit. C',
  vitamin_b12_ug: 'Vit. B12'
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

/** Macro accent colours, reused by bars, dots and the totals strip. */
export const MACRO_COLORS: Record<string, string> = {
  protein_g: 'bg-emerald-500',
  carbs_g: 'bg-sky-500',
  fat_g: 'bg-amber-500'
}

/**
 * Chart series colours for the history timeline, one per metric.
 *
 * These are the **validated** dark categorical slots: they pass all six checks
 * from the `dataviz` skill against this app's surface (`#0f172a`) — the same
 * rule the admin trend chart follows. The Tailwind-500 versions of emerald,
 * sky and amber fail the dark lightness band (L 0.48–0.67), which is why these
 * are the 600 steps. Re-run `scripts/validate_palette.js` before changing any.
 */
export const METRIC_COLORS: Record<string, string> = {
  kcal: '#6366f1',
  protein_g: '#059669',
  carbs_g: '#0284c7',
  fat_g: '#d97706'
}

/**
 * Renders a nutrient value with its unit. `null` means the data is unknown, so
 * it renders as `—`, never as 0 — the same rule the admin panel follows for
 * costs that cannot be computed.
 */
export function formatNutrient(value: number | null | undefined, key: NutrientKey): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE
  const decimals = key === 'kcal' ? 0 : value < 10 ? 1 : 0
  return `${value.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })} ${NUTRIENT_UNITS[key]}`
}

/** Bare number, no unit — for cells that carry the unit in their header. */
export function formatNutrientValue(value: number | null | undefined, key: NutrientKey): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE
  const decimals = key === 'kcal' ? 0 : value < 10 ? 1 : 0
  return value.toLocaleString('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

export function formatGrams(grams: number | null | undefined): string {
  if (grams === null || grams === undefined || !Number.isFinite(grams)) return NO_VALUE
  return `${grams.toLocaleString('es-ES', { maximumFractionDigits: 1 })} g`
}

/**
 * Scales a DietItem's stored per-100 g snapshot to its actual quantity, for the
 * per-item figures in the meal editor. Mirrors `scaleNutrients` on the server;
 * totals still come from the API, so this never becomes a second source of truth.
 */
export function scaleSnapshot(snapshotJson: string | null | undefined, grams: number): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  let snapshot: any = {}
  try {
    snapshot = snapshotJson ? JSON.parse(snapshotJson) : {}
  } catch {
    snapshot = {}
  }
  const factor = (Number(grams) || 0) / 100
  for (const key of NUTRIENT_KEYS) {
    const value = snapshot?.[key]
    out[key] = typeof value === 'number' && Number.isFinite(value) ? value * factor : null
  }
  return out
}

export const GOAL_LABELS: Record<string, string> = {
  bulk: 'Volumen',
  cut: 'Definición',
  maintenance: 'Mantenimiento',
  recomp: 'Recomposición'
}

export const DAY_TYPE_LABELS: Record<string, string> = {
  all: 'Todos los días',
  training: 'Día de entreno',
  rest: 'Día de descanso'
}

export const VERSION_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activa',
  superseded: 'Histórica'
}

export const VERSION_STATUS_BADGES: Record<string, string> = {
  draft: 'bg-amber-950/60 text-amber-400',
  active: 'bg-emerald-950/60 text-emerald-400',
  superseded: 'bg-slate-800 text-slate-500'
}
