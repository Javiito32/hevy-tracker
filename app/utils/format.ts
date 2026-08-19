/**
 * Shared formatters for the admin analytics (auto-imported, like renderMarkdown).
 *
 * Costs and token counts are rendered in several components; keeping the
 * formatting here stops each table from picking its own decimal count and
 * currency symbol.
 */

/** Placeholder for values that genuinely cannot be computed — never "0". */
export const NO_VALUE = '—'

/** `YYYY-MM-DD` from local components. Never `toISOString()`. */
export function localDayKey(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function asLocalDate(d: string | Date): Date {
  if (d instanceof Date) return d
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  }
  return new Date(d)
}

export function formatTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return NO_VALUE
  return n.toLocaleString('es-ES')
}

/**
 * Money with 4 decimals: per-interaction costs are fractions of a cent, and 2
 * decimals would render most rows of the detail log as "0,00 $".
 */
export function formatCost(cost: number | null | undefined, currency = 'USD'): string {
  if (cost === null || cost === undefined) return NO_VALUE
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency,
    minimumFractionDigits: cost > 0 && cost < 0.01 ? 4 : 2,
    maximumFractionDigits: 4
  }).format(cost)
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return NO_VALUE
  return new Date(d).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  })
}

export function formatDateShort(d: string | Date | null | undefined): string {
  if (!d) return NO_VALUE
  return asLocalDate(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
