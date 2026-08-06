/**
 * Shared formatters for the admin analytics (auto-imported, like renderMarkdown).
 *
 * Costs and token counts are rendered in several components; keeping the
 * formatting here stops each table from picking its own decimal count and
 * currency symbol.
 */

/** Placeholder for values that genuinely cannot be computed — never "0". */
export const NO_VALUE = '—'

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
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
