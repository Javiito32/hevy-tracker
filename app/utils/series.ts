/**
 * Data-series colours (auto-imported, like `theme.ts`).
 *
 * The one place a chart asks for a colour. Every series resolves to a CSS
 * custom property, so light and dark are two *selected* palettes rather than an
 * automatic flip, and a chart never carries a hex of its own — which is how
 * `body.vue` ended up with 27 literals sprayed through its template and no
 * constant anywhere.
 *
 * Both columns are validated with `scripts/validate_palette.js` against this
 * app's two surfaces (#131316 iron / #F7F7F5 chalk). Re-run it before changing
 * any of them:
 *
 *   node scripts/validate_palette.js "#3987e5,#d95926,#199e70,#c98500,#d55181" --mode dark  --surface "#131316"
 *   node scripts/validate_palette.js "#2a78d6,#c2521f,#12855c,#9a6a00,#c04b76" --mode light --surface "#F7F7F5"
 *
 * Rules that come with the palette:
 * - Slots are assigned in fixed order and **never cycled**. Past slot 5 a
 *   series folds into `SERIES_OTHER`, which is deliberately outside the palette
 *   because "everything else" is not an identity.
 * - Colour follows the entity, not its rank, so a filter that changes how many
 *   series are in view must not repaint the ones that survive.
 * - Status colours (`--positive` / `--warn` / `--danger`) are reserved and are
 *   never reused as a series.
 */

export const SERIES_SLOTS = 5

/** `rgb(var(--series-N))` for slot `i` (0-based), folding past the last slot. */
export function seriesColor(i: number): string {
  return i >= 0 && i < SERIES_SLOTS ? `rgb(var(--series-${i + 1}))` : SERIES_OTHER
}

/** The folded tail. Not a palette slot — it has no identity to carry. */
export const SERIES_OTHER = 'rgb(var(--series-other))'

/** Same slots as Tailwind classes, for marks that take a class instead of a style. */
export const SERIES_CLASSES = [
  'bg-series-1', 'bg-series-2', 'bg-series-3', 'bg-series-4', 'bg-series-5'
] as const

export const seriesClass = (i: number): string =>
  i >= 0 && i < SERIES_SLOTS ? SERIES_CLASSES[i]! : 'bg-series-other'
