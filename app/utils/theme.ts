/**
 * The semantic vocabulary of the «Instrumento» direction (auto-imported, like
 * `format.ts`, `nutrition.ts` and `training.ts`).
 *
 * The interface is achromatic: surfaces, borders and text are ink on iron or
 * chalk, and **colour is reserved for verdicts and data series**. This module is
 * the single place that decides what a verdict looks like, so a green here and
 * an amber there can never drift apart.
 *
 * It generalises the frozen-`STYLES`-record idiom that already worked well in
 * `ToastHost.vue` and `TrainingAlerts.vue`, rather than introducing a new one.
 *
 * Colour is never the only cue: every entry ships a `glyph` and a written
 * `label` too. The palette's positive and danger sit ~ΔE 4 apart under
 * deuteranopia, so a reader who cannot separate them still gets the verdict.
 */

export type Verdict = 'positive' | 'warn' | 'danger' | 'neutral'

export interface VerdictStyle {
  /** Text colour token. */
  text: string
  /** Quiet tinted container for badges and callouts. */
  chip: string
  /** Bordered callout, for alerts that occupy a block. */
  callout: string
  /** Non-colour cue. Required — colour never carries meaning alone. */
  glyph: string
}

export const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  positive: {
    text: 'text-positive',
    chip: 'bg-positive/10 text-positive',
    callout: 'bg-positive/5 border-positive/30 text-positive',
    glyph: '✓'
  },
  warn: {
    text: 'text-warn',
    chip: 'bg-warn/10 text-warn',
    callout: 'bg-warn/5 border-warn/30 text-warn',
    glyph: '↓'
  },
  danger: {
    text: 'text-danger',
    chip: 'bg-danger/10 text-danger',
    callout: 'bg-danger/5 border-danger/30 text-danger',
    glyph: '↑'
  },
  neutral: {
    text: 'text-ink-2',
    chip: 'bg-surface-2 text-ink-2',
    callout: 'bg-surface-2 border-line text-ink-2',
    glyph: '·'
  }
}

export const verdictStyle = (v: Verdict): VerdictStyle => VERDICT_STYLES[v]

/**
 * Which direction is good for this measurement.
 *
 * Not every delta means the same thing: gaining 2 kg of body weight is progress
 * in a bulk and a problem in a cut, and a rising resting heart rate is never
 * good. `body.vue` already encoded that per metric, but every other page hard-
 * coded `diff > 0 ? rose : emerald` inline and so got it wrong for anything
 * where up is bad.
 */
export type Polarity = 'up-good' | 'down-good' | 'neutral'

/** Text colour for a signed delta, given what the metric wants. */
export function deltaClass(delta: number | null | undefined, polarity: Polarity = 'up-good'): string {
  if (delta === null || delta === undefined || delta === 0 || polarity === 'neutral') {
    return 'text-ink-3'
  }
  const good = polarity === 'up-good' ? delta > 0 : delta < 0
  return good ? 'text-positive' : 'text-danger'
}

/** Arrow for a signed delta. Pairs with `deltaClass` so the sign is never colour-only. */
export function deltaGlyph(delta: number | null | undefined): string {
  if (delta === null || delta === undefined || delta === 0) return '·'
  return delta > 0 ? '▲' : '▼'
}

/**
 * Lifecycle status shared by mesocycles, macrocycles and diet versions.
 *
 * There used to be three separate copies of this map, and they disagreed:
 * `completed` was slate-500 in one, slate-400 in another and indigo in a third.
 */
export type LifecycleStatus = 'active' | 'paused' | 'completed' | 'draft' | 'archived'

export const STATUS_STYLES: Record<LifecycleStatus, { label: string; chip: string; dot: string }> = {
  active:    { label: 'Activo',     chip: 'bg-positive/10 text-positive', dot: 'bg-positive' },
  paused:    { label: 'Pausado',    chip: 'bg-warn/10 text-warn',         dot: 'bg-warn' },
  completed: { label: 'Completado', chip: 'bg-surface-2 text-ink-3',      dot: 'bg-ink-3' },
  draft:     { label: 'Borrador',   chip: 'bg-surface-2 text-ink-2',      dot: 'bg-ink-2' },
  archived:  { label: 'Archivado',  chip: 'bg-surface-2 text-ink-3',      dot: 'bg-ink-3' }
}

export const statusStyle = (s: string | null | undefined) =>
  STATUS_STYLES[(s ?? '') as LifecycleStatus] ?? STATUS_STYLES.completed
