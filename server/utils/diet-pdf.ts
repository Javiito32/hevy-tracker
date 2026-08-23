import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { localDayKey, localWeekKey } from './dates'
import {
  WEEKDAYS,
  WEEKDAY_LABELS_ES,
  compareMealsByTime,
  type NutrientKey,
  type Nutrients,
  type Weekday
} from './nutrition-calculator'

/**
 * The kitchen sheet: **one landscape page**, the seven days as columns, the
 * meals as rows, and each day's kcal and macros along the bottom.
 *
 * It is a wall chart, not a report. Everything it shows has to be readable
 * from a step back while cooking, and everything it cannot show on one page
 * is worth less than the second page would cost — a sheet you have to turn
 * over is a sheet you stop using. So the type size is *fitted*: the layout is
 * measured at descending sizes and the largest one that fits is drawn.
 *
 * Built with pdf-lib (standard fonts only). Helvetica's WinAnsi set covers
 * Spanish; anything outside it is folded to ASCII so a food named with a
 * stray symbol cannot take the whole download down.
 */

const LANDSCAPE_A4: [number, number] = [841.89, 595.28]
const MARGIN = 26
const PAGE_W = LANDSCAPE_A4[0]
const PAGE_H = LANDSCAPE_A4[1]
const CONTENT_W = PAGE_W - MARGIN * 2

/** Row-label gutter. Narrow: meal names are short, food names are not. */
const LABEL_W = 62
const DAY_W = (CONTENT_W - LABEL_W) / 7
const CELL_PAD = 4

const HEADER_H = 46
const FOOTER_H = 14

/**
 * Descending, because the largest that fits is the one we want: this is read
 * from a step back, so a sparse week should print big rather than print small
 * and leave the page half empty.
 */
const BODY_SIZES = [11, 10, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5]
const MIN_ROW_H = 20
/** How far a row may be stretched to fill leftover height before it just ends. */
const MAX_ROW_STRETCH = 1.9

const INK = rgb(0.11, 0.11, 0.12)
const INK2 = rgb(0.38, 0.38, 0.39)
const INK3 = rgb(0.55, 0.55, 0.56)
const LINE = rgb(0.8, 0.8, 0.78)
const LINE_STRONG = rgb(0.62, 0.62, 0.6)
const BAND = rgb(0.955, 0.955, 0.948)
const WARN = rgb(0.55, 0.38, 0.08)

const GOAL_LABELS: Record<string, string> = {
  bulk: 'Volumen',
  cut: 'Definición',
  maintenance: 'Mantenimiento',
  recomp: 'Recomposición'
}

const NO_VALUE = '—'

export interface DietPdfPlan {
  name: string
  goal?: string | null
  notes?: string | null
}

export interface DietPdfVersion {
  version_number: number
  status: string
  start_date?: string | null
  protein_g_per_kg?: number | null
  planned_days: number[]
  targets: { kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }
  totals: {
    average: Nutrients
    average_coverage?: Partial<Record<string, { known: number; total: number }>>
  }
  days: Array<{
    weekday: number
    planned: boolean
    totals: Nutrients | null
    coverage?: Partial<Record<string, { known: number; total: number }>>
    target: {
      kcal: number | null
      protein_g: number | null
      carbs_g: number | null
      fat_g: number | null
      overridden?: boolean
    }
  }>
  meals: Array<{
    name: string
    weekday: number
    order_index: number
    time_of_day?: string | null
    items: Array<{
      food_name: string
      quantity_g: number
      nutrients_snapshot?: string | null
    }>
  }>
}

export interface DietPdfInput {
  plan: DietPdfPlan
  version: DietPdfVersion
  athleteName?: string | null
  generatedAt?: Date
}

type Meal = DietPdfVersion['meals'][number]
type Day = DietPdfVersion['days'][number]

/** One printed row: a meal slot, and which meal fills it on each weekday. */
interface MealRow {
  label: string
  time: string | null
  /** Indexed 1..7; index 0 unused so `cells[weekday]` reads directly. */
  cells: Array<Meal | null>
}

interface Fonts {
  page: PDFPage
  font: PDFFont
  bold: PDFFont
}

const dash = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '')

/** Filename safe to put in Content-Disposition without RFC 5987 gymnastics. */
export function dietPdfFilename(input: DietPdfInput): string {
  const slug = (dash(input.plan.name || 'dieta').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'dieta'
  return `${slug}-v${input.version.version_number}.pdf`
}

/** Monday–Sunday of the week `date` falls in, as a printable label. */
export function currentWeekLabel(date = new Date()): string {
  const monday = mondayOf(date)
  const sunday = addDays(monday, 6)
  const sameMonth = monday.getMonth() === sunday.getMonth()
  const sameYear = monday.getFullYear() === sunday.getFullYear()
  const day = (d: Date) => d.getDate()
  const month = (d: Date) => d.toLocaleDateString('es-ES', { month: 'long' })
  if (sameMonth) {
    return `Semana del ${day(monday)} al ${day(sunday)} de ${month(monday)} de ${sunday.getFullYear()}`
  }
  if (sameYear) {
    return `Semana del ${day(monday)} de ${month(monday)} al ${day(sunday)} de ${month(sunday)} de ${sunday.getFullYear()}`
  }
  return `Semana del ${day(monday)} de ${month(monday)} de ${monday.getFullYear()} al ${day(sunday)} de ${month(sunday)} de ${sunday.getFullYear()}`
}

export async function buildDietPdf(input: DietPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const now = input.generatedAt ?? new Date()

  doc.setTitle(`${input.plan.name} · menú semanal`)
  doc.setAuthor(input.athleteName || 'Hevy Tracker')
  doc.setSubject(currentWeekLabel(now))
  doc.setCreator('Hevy Tracker')
  doc.setCreationDate(now)
  doc.setModificationDate(now)

  const page = doc.addPage(LANDSCAPE_A4)
  const f: Fonts = { page, font, bold }

  drawHeader(f, input, now)
  drawFooter(f, input, now)

  const rows = buildMealRows(input.version)
  const summaryRows = buildSummaryRows(input.version)
  const summaryH = summaryRows.length * SUMMARY_ROW_H + SUMMARY_HEAD_H

  const gridTop = PAGE_H - MARGIN - HEADER_H
  const gridBottom = MARGIN + FOOTER_H + summaryH
  const columnsTop = gridTop - COLUMN_HEAD_H

  drawColumnHeads(f, input.version, gridTop, now)
  const fitted = fitRows(rows, f, columnsTop - gridBottom)
  drawMealGrid(f, rows, fitted, columnsTop)
  drawSummary(f, input.version, summaryRows, gridBottom)
  drawColumnRules(f, gridTop)

  return doc.save()
}

// ── Rows: the meal axis ───────────────────────────────────────────────────────

/**
 * Every weekday holds its own independent meal list, so the row axis has to be
 * *derived* rather than read: meals are grouped by name (a repeated name within
 * one day gets its own row) and ordered by their mean position in the day. A
 * meal that only exists on some days simply leaves the other cells blank, which
 * is the truthful reading — those days don't have it.
 */
function buildMealRows(version: DietPdfVersion): MealRow[] {
  const groups = new Map<string, { row: MealRow; positions: number[] }>()

  for (const weekday of WEEKDAYS) {
    const meals = (version.meals ?? [])
      .filter(m => m.weekday === weekday)
      .sort(compareMealsByTime)
    const seen = new Map<string, number>()

    meals.forEach((meal, index) => {
      const name = (meal.name || 'Comida').trim() || 'Comida'
      const base = dash(name).toLowerCase()
      const repeat = seen.get(base) ?? 0
      seen.set(base, repeat + 1)
      const key = `${base}#${repeat}`

      let group = groups.get(key)
      if (!group) {
        group = { row: { label: name, time: meal.time_of_day ?? null, cells: Array(8).fill(null) }, positions: [] }
        groups.set(key, group)
      }
      if (!group.row.time && meal.time_of_day) group.row.time = meal.time_of_day
      group.row.cells[weekday] = meal
      group.positions.push(index)
    })
  }

  return [...groups.values()]
    .sort((a, b) => {
      const meanA = a.positions.reduce((s, v) => s + v, 0) / a.positions.length
      const meanB = b.positions.reduce((s, v) => s + v, 0) / b.positions.length
      if (meanA !== meanB) return meanA - meanB
      const timeA = a.row.time ?? '99:99'
      const timeB = b.row.time ?? '99:99'
      if (timeA !== timeB) return timeA < timeB ? -1 : 1
      return a.row.label.localeCompare(b.row.label, 'es')
    })
    .map(g => g.row)
}

// ── Header ────────────────────────────────────────────────────────────────────

function drawHeader(f: Fonts, input: DietPdfInput, now: Date) {
  const { plan, version } = input
  const top = PAGE_H - MARGIN

  draw(f, 'DIETA', MARGIN, top - 7, 6.5, f.bold, INK3)
  draw(f, plan.name || 'Sin nombre', MARGIN, top - 22, 14, f.bold, INK)

  const meta = [
    `v${version.version_number}`,
    version.status === 'active' ? 'Activa' : version.status === 'draft' ? 'Borrador' : 'Histórica',
    plan.goal ? (GOAL_LABELS[plan.goal] ?? plan.goal) : null,
    input.athleteName || null,
    plan.notes?.trim() || null
  ].filter(Boolean).join('  ·  ')
  draw(f, clip(meta, f.font, 7.5, CONTENT_W * 0.5), MARGIN, top - 33, 7.5, f.font, INK2)

  // Right: the week, and the average day it plans for.
  const right = PAGE_W - MARGIN
  drawRight(f, currentWeekLabel(now), right, top - 9, 9, f.bold, INK)

  const avg = version.totals.average
  const planned = version.planned_days.length
  const avgLine = [
    `Media de ${planned || 'ningún'} ${planned === 1 ? 'día' : 'días'} con comidas`,
    `${fmt(avg.kcal, 'kcal')} kcal`,
    `P ${fmt(avg.protein_g, 'protein_g')} g`,
    `C ${fmt(avg.carbs_g, 'carbs_g')} g`,
    `G ${fmt(avg.fat_g, 'fat_g')} g`,
    version.protein_g_per_kg != null
      ? `${formatDietPdfNumber(version.protein_g_per_kg, 2)} g prot/kg`
      : null
  ].filter(Boolean).join('  ·  ')
  drawRight(f, avgLine, right, top - 22, 8, f.font, INK2)

  if (version.status === 'draft') {
    const label = 'BORRADOR  ·  no es la dieta vigente'
    const w = f.bold.widthOfTextAtSize(pdfText(label), 7) + 10
    f.page.drawRectangle({ x: right - w, y: top - 36, width: w, height: 12, color: rgb(0.96, 0.93, 0.86) })
    drawRight(f, label, right - 5, top - 33, 7, f.bold, WARN)
  }
}

// ── The grid ──────────────────────────────────────────────────────────────────

const COLUMN_HEAD_H = 20

function columnX(weekday: Weekday): number {
  return MARGIN + LABEL_W + (weekday - 1) * DAY_W
}

function drawColumnHeads(f: Fonts, version: DietPdfVersion, top: number, now: Date) {
  f.page.drawLine({
    start: { x: MARGIN, y: top },
    end: { x: PAGE_W - MARGIN, y: top },
    thickness: 0.8,
    color: LINE_STRONG
  })

  for (const weekday of WEEKDAYS) {
    const day = version.days.find(d => d.weekday === weekday)
    const date = dateForWeekday(weekday, now)
    const x = columnX(weekday)
    if (!day?.planned) {
      f.page.drawRectangle({ x, y: top - COLUMN_HEAD_H, width: DAY_W, height: COLUMN_HEAD_H, color: BAND })
    }
    drawCentered(f, WEEKDAY_LABELS_ES[weekday].toUpperCase(), x, DAY_W, top - 10, 9, f.bold, day?.planned ? INK : INK3)
    const sub = day?.planned ? `${date.getDate()} ${monthShort(date)}` : `${date.getDate()} ${monthShort(date)}  ·  sin comidas`
    drawCentered(f, sub, x, DAY_W, top - 18, 6.5, f.font, INK3)
  }

  f.page.drawLine({
    start: { x: MARGIN, y: top - COLUMN_HEAD_H },
    end: { x: PAGE_W - MARGIN, y: top - COLUMN_HEAD_H },
    thickness: 0.8,
    color: LINE_STRONG
  })
}

interface Fit {
  size: number
  leading: number
  heights: number[]
}

/**
 * Pick the largest body size whose rows fit the space that is left, and only
 * if none does, shrink the rows proportionally and let the cells report what
 * they cut. Silently dropping a food off a menu is the one failure that would
 * matter here, so a clipped cell always says how many it is hiding.
 */
function fitRows(rows: MealRow[], f: Fonts, available: number): Fit {
  if (!rows.length) return { size: BODY_SIZES[0], leading: BODY_SIZES[0] + 1.6, heights: [] }

  let last: Fit = { size: 5, leading: 6.6, heights: [] }
  for (const size of BODY_SIZES) {
    const leading = size + 1.6
    const heights = rows.map(row => measureRow(row, f, size, leading))
    const total = heights.reduce((s, h) => s + h, 0)
    last = { size, leading, heights }
    if (total <= available) return { ...last, heights: stretch(heights, total, available) }
  }

  // Nothing fit: keep the smallest size and share the space out in proportion,
  // so a heavy day loses lines before a light one does.
  const total = last.heights.reduce((s, h) => s + h, 0)
  const floor = Math.min(MIN_ROW_H, available / last.heights.length)
  const scaled = last.heights.map(h => Math.max(floor, (h / total) * available))
  const scaledTotal = scaled.reduce((s, h) => s + h, 0)
  const correction = scaledTotal > available ? available / scaledTotal : 1
  return { ...last, heights: scaled.map(h => h * correction) }
}

/**
 * Spreads leftover height over the rows so the grid reaches the summary
 * instead of floating above it, capped so a two-meal diet doesn't print two
 * enormous bands. Proportional, so the day with most food keeps most room.
 */
function stretch(heights: number[], total: number, available: number): number[] {
  if (total <= 0 || total >= available) return heights
  const factor = Math.min(available / total, MAX_ROW_STRETCH)
  return heights.map(h => h * factor)
}

function measureRow(row: MealRow, f: Fonts, size: number, leading: number): number {
  let lines = 1
  for (const weekday of WEEKDAYS) {
    const meal = row.cells[weekday]
    if (!meal) continue
    lines = Math.max(lines, cellLines(meal, f, size).length)
  }
  const labelLines = wrap(row.label, f.bold, size, LABEL_W - CELL_PAD * 2).length + (row.time ? 1 : 0)
  return Math.max(MIN_ROW_H, CELL_PAD * 2 + Math.max(lines, labelLines) * leading)
}

/** One drawable line of a cell: the grams token is bold, the food name is not. */
interface CellLine {
  grams: string | null
  name: string
}

function cellLines(meal: Meal, f: Fonts, size: number): CellLine[] {
  const items = meal.items ?? []
  if (!items.length) return [{ grams: null, name: 'Sin alimentos' }]

  const width = DAY_W - CELL_PAD * 2
  const out: CellLine[] = []
  for (const item of items) {
    const grams = formatGrams(item.quantity_g)
    const gw = f.bold.widthOfTextAtSize(pdfText(grams), size) + 3
    const name = item.food_name || 'Alimento'
    // A grams token wide enough to leave no room for the name gets its own line.
    const firstWidth = gw > width * 0.55 ? 0 : width - gw
    const lines = wrapVar(name, f.font, size, firstWidth, width)
    if (firstWidth === 0) {
      out.push({ grams, name: '' })
      for (const line of lines) out.push({ grams: null, name: line })
    } else {
      out.push({ grams, name: lines[0] ?? '' })
      for (const line of lines.slice(1)) out.push({ grams: null, name: line })
    }
  }
  return out
}

function drawMealGrid(f: Fonts, rows: MealRow[], fit: Fit, top: number) {
  if (!rows.length) {
    drawCentered(f, 'Esta dieta todavía no tiene comidas.', MARGIN, CONTENT_W, top - 24, 9, f.font, INK3)
    return
  }

  let y = top
  rows.forEach((row, index) => {
    const height = fit.heights[index]
    if (index % 2 === 1) {
      f.page.drawRectangle({ x: MARGIN, y: y - height, width: CONTENT_W, height, color: BAND })
    }
    drawRow(f, row, fit, y, height)
    y -= height
    if (index < rows.length - 1) {
      f.page.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_W - MARGIN, y },
        thickness: 0.4,
        color: LINE
      })
    }
  })

  f.page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.8,
    color: LINE_STRONG
  })
}

function drawRow(f: Fonts, row: MealRow, fit: Fit, top: number, height: number) {
  const { size, leading } = fit
  const maxLines = Math.max(1, Math.floor((height - CELL_PAD * 2) / leading))

  let labelY = top - CELL_PAD - size
  for (const line of wrap(row.label, f.bold, size, LABEL_W - CELL_PAD * 2)) {
    draw(f, line, MARGIN + CELL_PAD, labelY, size, f.bold, INK)
    labelY -= leading
  }
  if (row.time) draw(f, row.time, MARGIN + CELL_PAD, labelY, size - 1, f.font, INK3)

  for (const weekday of WEEKDAYS) {
    const meal = row.cells[weekday]
    if (!meal) continue
    const x = columnX(weekday) + CELL_PAD
    const lines = cellLines(meal, f, size)
    const shown = lines.length > maxLines ? lines.slice(0, Math.max(1, maxLines - 1)) : lines
    let y = top - CELL_PAD - size

    for (const line of shown) {
      let tx = x
      if (line.grams) {
        draw(f, line.grams, tx, y, size, f.bold, INK)
        tx += f.bold.widthOfTextAtSize(pdfText(line.grams), size) + 3
      }
      if (line.name) draw(f, line.name, tx, y, size, f.font, INK)
      y -= leading
    }
    if (shown.length < lines.length) {
      const hidden = (meal.items ?? []).length - shown.filter(l => l.grams).length
      draw(f, `+${hidden} alimento${hidden === 1 ? '' : 's'} más`, x, y, size - 0.5, f.font, INK3)
    }
  }
}

/**
 * The seven column rules run the whole height of the sheet, summary included:
 * a day is one column from its heading to its kcal, and a rule that stopped
 * above the totals would leave the reader matching numbers to headings by eye.
 */
function drawColumnRules(f: Fonts, top: number) {
  for (const weekday of WEEKDAYS) {
    const x = columnX(weekday)
    f.page.drawLine({ start: { x, y: top }, end: { x, y: MARGIN + FOOTER_H }, thickness: 0.4, color: LINE })
  }
  f.page.drawLine({
    start: { x: MARGIN + LABEL_W, y: top },
    end: { x: MARGIN + LABEL_W, y: MARGIN + FOOTER_H },
    thickness: 0.8,
    color: LINE_STRONG
  })
  f.page.drawLine({
    start: { x: PAGE_W - MARGIN, y: top },
    end: { x: PAGE_W - MARGIN, y: MARGIN + FOOTER_H },
    thickness: 0.4,
    color: LINE
  })
  f.page.drawLine({
    start: { x: MARGIN, y: top },
    end: { x: MARGIN, y: MARGIN + FOOTER_H },
    thickness: 0.4,
    color: LINE
  })
}

// ── The day summary ───────────────────────────────────────────────────────────

const SUMMARY_ROW_H = 14
const SUMMARY_HEAD_H = 12

interface SummaryRow {
  label: string
  value: (day: Day | undefined) => string
  strong?: boolean
}

function buildSummaryRows(version: DietPdfVersion): SummaryRow[] {
  const macro = (key: Exclude<NutrientKey, 'kcal'>): SummaryRow['value'] => (day) =>
    day?.planned ? `${fmt(day.totals?.[key] ?? null, key)} g` : NO_VALUE

  const rows: SummaryRow[] = [
    {
      label: 'kcal',
      strong: true,
      value: (day) => (day?.planned ? fmt(day.totals?.kcal ?? null, 'kcal') : NO_VALUE)
    },
    { label: 'Proteína', value: macro('protein_g') },
    { label: 'Carbohidratos', value: macro('carbs_g') },
    { label: 'Grasa', value: macro('fat_g') }
  ]

  // The objective only earns a row when there is one to compare against.
  if (version.days.some(d => d.target.kcal != null)) {
    rows.push({ label: 'Objetivo', value: (day) => formatTargetCell(day) })
  }
  return rows
}

function drawSummary(f: Fonts, version: DietPdfVersion, rows: SummaryRow[], top: number) {
  const height = rows.length * SUMMARY_ROW_H + SUMMARY_HEAD_H
  f.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_W, height, color: BAND })
  f.page.drawLine({
    start: { x: MARGIN, y: top },
    end: { x: PAGE_W - MARGIN, y: top },
    thickness: 0.8,
    color: LINE_STRONG
  })

  draw(f, 'RESUMEN DEL DÍA', MARGIN + CELL_PAD, top - 8.5, 6.5, f.bold, INK3)

  let y = top - SUMMARY_HEAD_H
  for (const row of rows) {
    const baseline = y - SUMMARY_ROW_H + 4
    draw(f, row.label, MARGIN + CELL_PAD, baseline, 7.5, f.font, INK2)
    for (const weekday of WEEKDAYS) {
      const day = version.days.find(d => d.weekday === weekday)
      const planned = !!day?.planned
      drawCentered(
        f,
        row.value(day),
        columnX(weekday),
        DAY_W,
        baseline,
        row.strong ? 10 : 8,
        row.strong ? f.bold : f.font,
        planned ? (row.strong ? INK : INK2) : INK3
      )
    }
    y -= SUMMARY_ROW_H
    if (row !== rows[rows.length - 1]) {
      f.page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.3, color: LINE })
    }
  }

  f.page.drawLine({
    start: { x: MARGIN, y: top - height },
    end: { x: PAGE_W - MARGIN, y: top - height },
    thickness: 0.8,
    color: LINE_STRONG
  })
}

// ── Footer ────────────────────────────────────────────────────────────────────

function drawFooter(f: Fonts, input: DietPdfInput, now: Date) {
  const y = MARGIN
  const left = [
    input.version.status === 'draft' ? 'BORRADOR' : null,
    input.plan.name,
    `v${input.version.version_number}`,
    currentWeekLabel(now)
  ].filter(Boolean).join('  ·  ')
  draw(f, clip(left, f.font, 7, CONTENT_W * 0.7), MARGIN, y, 7, f.font, INK3)

  const stamp = `Generado ${now.toLocaleDateString('es-ES')} ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
  drawRight(f, stamp, PAGE_W - MARGIN, y, 7, f.font, INK3)
}

// ── Drawing primitives ────────────────────────────────────────────────────────

function draw(f: Fonts, value: string, x: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const drawn = pdfText(value)
  if (!drawn) return
  f.page.drawText(drawn, { x, y, size, font, color })
}

function drawRight(f: Fonts, value: string, right: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const drawn = pdfText(value)
  if (!drawn) return
  f.page.drawText(drawn, { x: right - font.widthOfTextAtSize(drawn, size), y, size, font, color })
}

function drawCentered(f: Fonts, value: string, x: number, width: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const drawn = pdfText(value)
  if (!drawn) return
  f.page.drawText(drawn, { x: x + (width - font.widthOfTextAtSize(drawn, size)) / 2, y, size, font, color })
}

/** Cuts a single line to width, with an ellipsis so the cut is visible. */
function clip(value: string, font: PDFFont, size: number, maxWidth: number): string {
  const drawn = pdfText(value)
  if (font.widthOfTextAtSize(drawn, size) <= maxWidth) return drawn
  let out = ''
  for (const ch of drawn) {
    if (font.widthOfTextAtSize(`${out}${ch}...`, size) > maxWidth) break
    out += ch
  }
  return `${out.trimEnd()}...`
}

function wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return wrapVar(value, font, size, maxWidth, maxWidth)
}

/**
 * Wraps with a first line narrower than the rest — which is what a food line
 * needs, since the grams token sits in front of the name.
 */
function wrapVar(value: string, font: PDFFont, size: number, firstWidth: number, restWidth: number): string[] {
  const textValue = pdfText(value)
  if (!textValue) return []
  const widthAt = (index: number) => (index === 0 ? firstWidth : restWidth)
  const words = textValue.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  const flush = () => {
    lines.push(current)
    current = ''
  }
  const hardBreak = (word: string) => {
    let chunk = ''
    for (const ch of word) {
      const next = chunk + ch
      if (font.widthOfTextAtSize(next, size) <= widthAt(lines.length)) chunk = next
      else {
        if (chunk) lines.push(chunk)
        chunk = ch
      }
    }
    current = chunk
  }

  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= widthAt(lines.length)) {
      current = next
      continue
    }
    if (current) flush()
    if (font.widthOfTextAtSize(word, size) <= widthAt(lines.length)) current = word
    else hardBreak(word)
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

/**
 * Helvetica is WinAnsi. Fold the handful of characters a food name or note
 * actually uses that sit outside that set, rather than letting drawText throw
 * mid-document and turn a finished plan into a 502.
 */
function pdfText(value: string): string {
  return Array.from(value ?? '').map((ch) => {
    const code = ch.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13) return ' '
    if (code < 32) return ''
    if (code <= 255) return ch
    return (
      ({
        '–': '-',
        '—': '-',
        '−': '-',
        '•': '-',
        '…': '...',
        '‘': "'",
        '’': "'",
        '“': '"',
        '”': '"',
        '≥': '>=',
        '≤': '<=',
        '≈': '~',
        'μ': 'u',
        '™': '',
        ' ': ' '
      } as Record<string, string>)[ch] ?? ''
    )
  }).join('').replace(/ {2,}/g, ' ')
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * `toLocaleString('es-ES')` follows the process locale, which on a slim
 * container is often C and prints 1918 instead of 1.918. The thousands
 * separator is the whole point of a Spanish readout, so do it by hand.
 */
/** Exported so the smoke test can pin the Spanish grouping without rendering. */
export function formatDietPdfNumber(value: number, decimals: number): string {
  const negative = value < 0
  const factor = 10 ** decimals
  const rounded = Math.round(Math.abs(value) * factor) / factor
  const [intRaw, frac] = rounded.toFixed(decimals).split('.')
  const int = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const body = decimals > 0 ? `${int},${frac}` : int
  return negative ? `-${body}` : body
}

function fmt(value: number | null | undefined, key: NutrientKey): string {
  if (value == null || !Number.isFinite(value)) return NO_VALUE
  const decimals = key === 'kcal' ? 0 : value < 10 ? 1 : 0
  return formatDietPdfNumber(value, decimals)
}

function formatGrams(grams: number | null | undefined): string {
  if (grams == null || !Number.isFinite(grams)) return NO_VALUE
  const decimals = Number.isInteger(grams) ? 0 : 1
  return `${formatDietPdfNumber(grams, decimals)} g`
}

function formatTargetCell(day: Day | undefined): string {
  if (!day?.target.kcal) return NO_VALUE
  const target = fmt(day.target.kcal, 'kcal')
  if (!day.planned || day.totals?.kcal == null) return target
  const delta = Math.round(day.totals.kcal - day.target.kcal)
  if (delta === 0) return `${target} (=)`
  return `${target} (${delta > 0 ? '+' : ''}${formatDietPdfNumber(delta, 0)})`
}

function mondayOf(date: Date): Date {
  const key = localWeekKey(date)
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function dateForWeekday(weekday: Weekday, now: Date): Date {
  return addDays(mondayOf(now), weekday - 1)
}

function monthShort(date: Date): string {
  return date.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')
}

/** Exposed for smoke tests that assert the week is dated, not just named. */
export function weekdayDateKey(weekday: Weekday, now = new Date()): string {
  return localDayKey(dateForWeekday(weekday, now))
}
