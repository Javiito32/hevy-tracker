/**
 * Shared labels and helpers for training data (auto-imported, like the
 * nutrition ones). Mirrors the set-type vocabulary Hevy reports and that
 * `server/utils/volume-calculator.ts` reasons about — keep the two in sync.
 */

export type SetType = 'normal' | 'warmup' | 'dropset' | 'failure'

interface SetTypeStyle {
  /** Single-character marker shown in the set-number column. */
  mark: string
  /** Full name, used as the accessible title on the marker. */
  label: string
  /** Tailwind classes for the marker. */
  badge: string
  /** Tailwind classes applied to the whole row, dimming non-working sets. */
  row: string
}

/**
 * Only 'warmup' is styled as secondary. A drop set or a set to failure is
 * effective work and must not read as filler.
 */
const SET_TYPE_STYLES: Record<SetType, SetTypeStyle> = {
  normal: {
    mark: '', label: 'Serie efectiva',
    badge: 'text-ink-3', row: ''
  },
  warmup: {
    mark: 'C', label: 'Calentamiento',
    badge: 'bg-warn/10 text-warn border border-warn/40',
    row: 'opacity-60'
  },
  dropset: {
    mark: 'D', label: 'Drop set',
    badge: 'bg-surface-2/60 text-ink-2 border border-line-strong/70', row: ''
  },
  failure: {
    mark: 'F', label: 'Al fallo',
    badge: 'bg-danger/10 text-danger border border-danger/40', row: ''
  }
}

/** Sets stored before the type was persisted have none; they were working sets. */
export const setType = (set: { type?: string | null } | null | undefined): SetType => {
  const t = set?.type
  return t && t in SET_TYPE_STYLES ? (t as SetType) : 'normal'
}

export const setTypeStyle = (set: { type?: string | null } | null | undefined): SetTypeStyle =>
  SET_TYPE_STYLES[setType(set)]

export const isWarmupSet = (set: { type?: string | null } | null | undefined): boolean =>
  setType(set) === 'warmup'

export const isWorkingSet = (set: { type?: string | null } | null | undefined): boolean =>
  !isWarmupSet(set)

/**
 * Numbers the sets the way Hevy's own logger does: warm-ups are marked rather
 * than numbered, so the working sets read 1, 2, 3 regardless of how many
 * warm-ups preceded them.
 */
export function numberSets<T extends { type?: string | null }>(
  sets: T[]
): Array<{ set: T; marker: string; style: SetTypeStyle }> {
  let working = 0
  return sets.map((set) => {
    const style = setTypeStyle(set)
    const marker = isWarmupSet(set) ? style.mark : String(++working)
    return { set, marker, style }
  })
}

/** "4 series · 2 de calentamiento", or just "4 series" when there are none. */
export function describeSetCount(sets: Array<{ type?: string | null }>): string {
  const warmups = sets.filter(isWarmupSet).length
  const working = sets.length - warmups
  const base = `${working} ${working === 1 ? 'serie' : 'series'}`
  return warmups > 0 ? `${base} · ${warmups} de calentamiento` : base
}
