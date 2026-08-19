/**
 * Calendar helpers, in one place.
 *
 * Everything here is **local time and Monday-first**, which is what the app
 * means by "a week" everywhere else (`mondayIndex()` in the calendar, the
 * `weekday` 1..7 convention shared by `DietMeal` and `PlannedSession`).
 *
 * They live here rather than beside their first caller because there were four
 * copies — one per module that had to bucket by week — and they disagreed. Two
 * of them keyed a week with `toISOString()` after moving a Date to local
 * midnight, which in any positive-offset timezone hands back the *previous*
 * day: a Monday in Madrid labelled itself as the Sunday before. The label is
 * what a model reads, so a week that says it starts on Sunday is a week the
 * coach reasons about wrongly.
 */

/** `YYYY-MM-DD` from **local** components. Never `toISOString()`. */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Monday 00:00 local of the week `date` falls in. */
export function localMonday(date: Date = new Date()): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday
}

/** Monday of the week `date` falls in, as a local day key. */
export function localWeekKey(date: Date): string {
  return localDayKey(localMonday(date))
}

/** 1 = Monday … 7 = Sunday, the convention the whole schema uses. */
export function isoWeekday(date: Date = new Date()): number {
  return ((date.getDay() + 6) % 7) + 1
}

/**
 * Days left in the week **after** today, Monday-first: 6 on a Monday, 0 on a
 * Sunday. The Sunday-first arithmetic this replaces (`6 - getDay()`) was off by
 * one every day and declared Saturday the last day of the week.
 */
export function daysLeftInWeek(date: Date = new Date()): number {
  return 7 - isoWeekday(date)
}

/** 1-based week of a block on a given date. */
export function weekNumberFor(startDate: Date | string, on: Date = new Date()): number {
  const ms = on.getTime() - new Date(startDate).getTime()
  return Math.max(1, Math.floor(ms / (7 * 86_400_000)) + 1)
}
