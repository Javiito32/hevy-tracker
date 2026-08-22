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
  protein_g: 'bg-positive',
  carbs_g: 'bg-surface-2',
  fat_g: 'bg-warn'
}

/**
 * Chart series colours for the history timeline, one per metric.
 *
 * These are slots off the shared palette in `app/utils/series.ts`, not hexes of
 * their own: they used to be four literals validated against a single dark
 * surface, which meant this file and the admin chart each held a private copy
 * of "the categorical palette" and only one theme worked.
 */
export const METRIC_COLORS: Record<string, string> = {
  kcal: seriesColor(0),
  protein_g: seriesColor(1),
  carbs_g: seriesColor(2),
  fat_g: seriesColor(3)
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

// ── Weekdays ──────────────────────────────────────────────────────────────────
// Mirrors server/utils/nutrition-calculator.ts, for the same reason the nutrient
// labels above are mirrored rather than imported.

/** 1 = Monday … 7 = Sunday, the convention the whole app uses. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const isWeekday = (value: unknown): value is Weekday =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7

export const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo'
}

export const WEEKDAY_SHORT: Record<number, string> = {
  1: 'Lun',
  2: 'Mar',
  3: 'Mié',
  4: 'Jue',
  5: 'Vie',
  6: 'Sáb',
  7: 'Dom'
}

/**
 * Today as a Monday-first weekday. Same formula as `mondayIndex` in
 * CalendarGrid.vue — duplicated rather than extracted, like the labels above:
 * one line is cheaper than coupling the diet designer to the calendar.
 */
export const todayWeekday = (date = new Date()): Weekday =>
  (((date.getDay() + 6) % 7) + 1) as Weekday

/**
 * Minutes from midnight for a `time_of_day` label ("08:00"). Null when the
 * field is empty or isn't a clock time. Mirrors `minutesFromTimeOfDay` in
 * nutrition-calculator.ts.
 */
export const minutesFromTimeOfDay = (value: string | null | undefined): number | null => {
  if (!value) return null
  const match = /^([01]?\d|2[0-3]):([0-5]\d)/.exec(String(value).trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Draft editor order: clock time first, then `order_index` for meals without
 * a time. Mirrors `compareMealsByTime` on the server.
 */
export const compareMealsByTime = (
  a: { weekday?: number; time_of_day?: string | null; order_index?: number },
  b: { weekday?: number; time_of_day?: string | null; order_index?: number }
): number => {
  const day = (a.weekday ?? 0) - (b.weekday ?? 0)
  if (day) return day
  const ta = minutesFromTimeOfDay(a.time_of_day)
  const tb = minutesFromTimeOfDay(b.time_of_day)
  if (ta != null && tb != null && ta !== tb) return ta - tb
  if (ta != null && tb == null) return -1
  if (ta == null && tb != null) return 1
  return (a.order_index ?? 0) - (b.order_index ?? 0)
}

/** "lun", "lun y mar", "lun, mar y mié" — for captions and group headings. */
export const formatWeekdayList = (days: number[], long = false): string => {
  const names = days.map(d => (long ? WEEKDAY_LABELS[d] : WEEKDAY_SHORT[d])?.toLowerCase()).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

export const VERSION_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  active: 'Activa',
  superseded: 'Histórica'
}

export const VERSION_STATUS_BADGES: Record<string, string> = {
  draft: 'bg-warn/10 text-warn',
  active: 'bg-positive/10 text-positive',
  superseded: 'bg-surface-2 text-ink-3'
}
