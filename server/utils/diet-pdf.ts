import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { localDayKey, localWeekKey } from './dates'
import {
  computeMealTotals,
  isComplete,
  MACRO_KEYS,
  MICRO_KEYS,
  NUTRIENT_LABELS_ES,
  NUTRIENT_UNITS,
  WEEKDAYS,
  WEEKDAY_LABELS_ES,
  WEEKDAY_SHORT_ES,
  compareMealsByTime,
  type NutrientKey,
  type Nutrients,
  type Weekday
} from './nutrition-calculator'

/**
 * Printable weekly menu. The designer is one day at a time; this is the
 * artefact you take to the kitchen: every weekday, every meal, every gram.
 *
 * Built with pdf-lib (standard fonts only). Helvetica's WinAnsi set covers
 * Spanish; anything outside it is folded to ASCII so a food named with a
 * stray symbol cannot take the whole download down.
 */

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 40
const PAGE_W = A4[0]
const PAGE_H = A4[1]
const CONTENT_W = PAGE_W - MARGIN * 2

const INK = rgb(0.11, 0.11, 0.12)
const INK2 = rgb(0.38, 0.38, 0.39)
const INK3 = rgb(0.55, 0.55, 0.56)
const LINE = rgb(0.8, 0.8, 0.78)
const BAND = rgb(0.945, 0.945, 0.938)
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

interface OpenDay {
  title: string
  kcalLabel: string
  planned: boolean
}

interface Cursor {
  doc: PDFDocument
  page: PDFPage
  font: PDFFont
  bold: PDFFont
  y: number
  pages: PDFPage[]
  /** Day currently being written, so a page break can reprint its heading. */
  openDay: OpenDay | null
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

  const cursor: Cursor = { doc, page: null as unknown as PDFPage, font, bold, y: 0, pages: [], openDay: null }
  newPage(cursor)
  drawDocumentHeader(cursor, input, now)
  drawAverage(cursor, input.version)
  drawWeekTable(cursor, input.version, now)

  for (const weekday of WEEKDAYS) {
    drawDay(cursor, input.version, weekday, now)
  }

  stampFooters(cursor, input, now)
  return doc.save()
}

// ── Header / summary ──────────────────────────────────────────────────────────

function drawDocumentHeader(c: Cursor, input: DietPdfInput, now: Date) {
  const { plan, version } = input
  const isDraft = version.status === 'draft'

  text(c, 'DIETA', MARGIN, 8, { color: INK3, font: c.bold })
  c.y -= 20
  text(c, plan.name || 'Sin nombre', MARGIN, 18, { font: c.bold })

  const meta = [
    `v${version.version_number}`,
    version.status === 'active' ? 'Activa' : version.status === 'draft' ? 'Borrador' : 'Histórica',
    plan.goal ? (GOAL_LABELS[plan.goal] ?? plan.goal) : null,
    input.athleteName || null
  ].filter(Boolean).join('  ·  ')

  const week = currentWeekLabel(now)
  c.y -= 14
  text(c, `${week}  ·  ${meta}`, MARGIN, 9, { color: INK2 })

  if (plan.notes?.trim()) {
    c.y -= 13
    for (const line of wrap(pdfText(plan.notes.trim()), c.font, 8, CONTENT_W).slice(0, 3)) {
      text(c, line, MARGIN, 8, { color: INK3 })
      c.y -= 11
    }
  }

  c.y -= 10
  rule(c)

  if (isDraft) {
    c.y -= 6
    c.page.drawRectangle({
      x: MARGIN,
      y: c.y - 16,
      width: CONTENT_W,
      height: 18,
      color: rgb(0.96, 0.93, 0.86)
    })
    text(c, 'BORRADOR  ·  esta no es la dieta vigente hasta que la publiques', MARGIN + 8, 8, { color: WARN, font: c.bold })
    c.y -= 22
    rule(c)
  }
}

function drawAverage(c: Cursor, version: DietPdfVersion) {
  ensure(c, 78)
  c.y -= 16
  text(c, 'MEDIA SEMANAL', MARGIN, 8, { color: INK3, font: c.bold })
  c.y -= 18

  const avg = version.totals.average
  const kcal = fmt(avg.kcal, 'kcal')
  text(c, kcal, MARGIN, 16, { font: c.bold })
  const kcalW = c.bold.widthOfTextAtSize(pdfText(kcal), 16)
  text(c, 'kcal', MARGIN + kcalW + 5, 9, { color: INK3 })

  const macros: Array<{ key: NutrientKey; short: string }> = [
    { key: 'protein_g', short: 'prot' },
    { key: 'carbs_g', short: 'carbs' },
    { key: 'fat_g', short: 'grasa' }
  ]
  let x = MARGIN + 150
  for (const { key, short } of macros) {
    const value = `${fmt(avg[key], key)} g`
    text(c, value, x, 11, { font: c.bold })
    const w = c.bold.widthOfTextAtSize(pdfText(value), 11)
    text(c, short, x + w + 4, 8, { color: INK3 })
    x += 110
  }

  c.y -= 16
  const planned = version.planned_days.length
  const captionParts = [
    planned
      ? `Media de ${planned} ${planned === 1 ? 'día' : 'días'} con comidas (${formatWeekdayList(version.planned_days)})`
      : 'Ningún día tiene comidas todavía',
    version.protein_g_per_kg != null
      ? `${version.protein_g_per_kg.toLocaleString('es-ES', { maximumFractionDigits: 2 })} g proteína / kg`
      : null
  ].filter(Boolean)
  text(c, captionParts.join('  ·  '), MARGIN, 8, { color: INK3 })

  const microTokens = formatMicroTokens(avg, version.totals.average_coverage)
  if (microTokens.length) {
    c.y -= 12
    for (const line of wrapTokens(microTokens, c.font, 8, CONTENT_W)) {
      text(c, line, MARGIN, 8, { color: INK3 })
      c.y -= 11
    }
  } else {
    c.y -= 4
  }

  c.y -= 8
  rule(c)
}

function drawWeekTable(c: Cursor, version: DietPdfVersion, now: Date) {
  const cols = [
    { key: 'day', label: 'Día', width: 118, align: 'left' as const },
    { key: 'kcal', label: 'kcal', width: 64, align: 'right' as const },
    { key: 'protein_g', label: 'Prot.', width: 56, align: 'right' as const },
    { key: 'carbs_g', label: 'Carbs', width: 56, align: 'right' as const },
    { key: 'fat_g', label: 'Grasa', width: 56, align: 'right' as const },
    { key: 'target', label: 'Objetivo', width: 165, align: 'right' as const }
  ]
  const rowH = 16
  ensure(c, 28 + rowH * 8)

  c.y -= 16
  text(c, 'SEMANA', MARGIN, 8, { color: INK3, font: c.bold })
  c.y -= 8

  const headerY = c.y - 12
  let x = MARGIN
  for (const col of cols) {
    drawAligned(c, col.label, x, headerY, col.width, 8, c.font, INK3, col.align)
    x += col.width
  }
  c.y = headerY - 4
  rule(c)
  c.y -= 2

  for (const weekday of WEEKDAYS) {
    const day = version.days.find(d => d.weekday === weekday)
    const date = dateForWeekday(weekday, now)
    const label = `${WEEKDAY_SHORT_ES[weekday]} ${date.getDate()} ${monthShort(date)}`
    const kcal = day?.planned ? fmt(day.totals?.kcal ?? null, 'kcal') : NO_VALUE
    const protein = day?.planned ? fmt(day.totals?.protein_g ?? null, 'protein_g') : NO_VALUE
    const carbs = day?.planned ? fmt(day.totals?.carbs_g ?? null, 'carbs_g') : NO_VALUE
    const fat = day?.planned ? fmt(day.totals?.fat_g ?? null, 'fat_g') : NO_VALUE
    const target = formatTargetCell(day)

    const y = c.y - 12
    const values = [label, kcal, protein, carbs, fat, target]
    x = MARGIN
    cols.forEach((col, i) => {
      const useBold = col.key === 'day' || (col.key === 'kcal' && day?.planned)
      drawAligned(c, values[i], x, y, col.width, 9, useBold ? c.bold : c.font, day?.planned ? INK : INK3, col.align)
      x += col.width
    })
    c.y -= rowH
  }

  c.y -= 6
  rule(c)
}

// ── Days ──────────────────────────────────────────────────────────────────────

function drawDay(c: Cursor, version: DietPdfVersion, weekday: Weekday, now: Date) {
  const day = version.days.find(d => d.weekday === weekday)
  const meals = version.meals
    .filter(m => m.weekday === weekday)
    .sort(compareMealsByTime)

  const date = dateForWeekday(weekday, now)
  const title = `${WEEKDAY_LABELS_ES[weekday]} ${date.getDate()} ${monthShort(date)}`
  const kcalLabel = day?.planned ? `${fmt(day.totals?.kcal ?? null, 'kcal')} kcal` : 'sin comidas'
  const openDay: OpenDay = { title, kcalLabel, planned: !!day?.planned }

  // Header + first line of content travel together. The rest of the day may
  // split, but then `ensure` reprints this heading so a page never starts
  // with a stray "Comida" and no weekday.
  ensure(c, 56)
  c.openDay = openDay
  drawDayBand(c, openDay, false)

  const targetLine = formatDayTargetLine(day)
  if (targetLine) {
    c.y -= 12
    text(c, targetLine, MARGIN + 8, 8, { color: INK3 })
  }

  if (!meals.length) {
    c.y -= 14
    text(c, 'Este día no tiene comidas.', MARGIN + 8, 9, { color: INK3 })
    c.y -= 8
    c.openDay = null
    return
  }

  for (const meal of meals) {
    drawMeal(c, meal)
  }
  c.y -= 4
  c.openDay = null
}

function drawDayBand(c: Cursor, day: OpenDay, continued: boolean) {
  c.y -= continued ? 8 : 10
  c.page.drawRectangle({
    x: MARGIN,
    y: c.y - 16,
    width: CONTENT_W,
    height: 20,
    color: BAND
  })
  const title = continued ? `${day.title}  (sigue)` : day.title
  text(c, title, MARGIN + 8, 10, { font: c.bold })
  const kcalW = c.bold.widthOfTextAtSize(pdfText(day.kcalLabel), 10)
  text(c, day.kcalLabel, MARGIN + CONTENT_W - 8 - kcalW, 10, {
    font: c.bold,
    color: day.planned ? INK : INK3
  })
  c.y -= 18
}

function drawMeal(c: Cursor, meal: DietPdfVersion['meals'][number]) {
  const items = meal.items ?? []
  const mealKcal = computeMealTotals(meal).kcal
  // Only the heading + first food must stay together. Reserving the whole
  // meal used to shove "Comida" onto the next page and leave a hole.
  ensure(c, 36)

  c.y -= 15
  const name = meal.time_of_day ? `${meal.name}  ·  ${meal.time_of_day}` : meal.name
  text(c, name, MARGIN + 8, 10, { font: c.bold })
  if (items.length && mealKcal != null) {
    const right = `${fmt(mealKcal, 'kcal')} kcal`
    const w = c.font.widthOfTextAtSize(pdfText(right), 9)
    text(c, right, MARGIN + CONTENT_W - 8 - w, 9, { color: INK2 })
  }

  if (!items.length) {
    c.y -= 13
    text(c, 'Sin alimentos', MARGIN + 16, 9, { color: INK3 })
    return
  }

  const gramsCol = 72
  const nameWidth = CONTENT_W - 32 - gramsCol
  for (const item of items) {
    const lines = wrap(pdfText(item.food_name || 'Alimento'), c.font, 9, nameWidth)
    ensure(c, 4 + lines.length * 12)
    c.y -= 13
    text(c, lines[0], MARGIN + 16, 9)
    const grams = formatGrams(item.quantity_g)
    const gw = c.font.widthOfTextAtSize(pdfText(grams), 9)
    text(c, grams, MARGIN + CONTENT_W - 8 - gw, 9, { color: INK2 })
    for (const extra of lines.slice(1)) {
      c.y -= 11
      text(c, extra, MARGIN + 16, 9)
    }
  }
}

// ── Footer ────────────────────────────────────────────────────────────────────

function stampFooters(c: Cursor, input: DietPdfInput, now: Date) {
  const total = c.pages.length
  const left = [
    input.version.status === 'draft' ? 'BORRADOR' : null,
    input.plan.name,
    `v${input.version.version_number}`,
    currentWeekLabel(now)
  ].filter(Boolean).join('  ·  ')

  for (const [i, page] of c.pages.entries()) {
    page.drawLine({
      start: { x: MARGIN, y: MARGIN - 8 },
      end: { x: PAGE_W - MARGIN, y: MARGIN - 8 },
      thickness: 0.4,
      color: LINE
    })
    page.drawText(pdfText(left).slice(0, 90), {
      x: MARGIN,
      y: MARGIN - 20,
      size: 7,
      font: c.font,
      color: INK3
    })
    const right = `${i + 1} / ${total}`
    const w = c.font.widthOfTextAtSize(right, 7)
    page.drawText(right, {
      x: PAGE_W - MARGIN - w,
      y: MARGIN - 20,
      size: 7,
      font: c.font,
      color: INK3
    })
  }
}

// ── Drawing primitives ────────────────────────────────────────────────────────

function newPage(c: Cursor) {
  const page = c.doc.addPage(A4)
  c.page = page
  c.pages.push(page)
  c.y = PAGE_H - MARGIN
}

function ensure(c: Cursor, needed: number) {
  if (c.y - needed >= MARGIN + 18) return
  newPage(c)
  if (c.openDay) drawDayBand(c, c.openDay, true)
}

function rule(c: Cursor) {
  c.page.drawLine({
    start: { x: MARGIN, y: c.y },
    end: { x: PAGE_W - MARGIN, y: c.y },
    thickness: 0.5,
    color: LINE
  })
}

function text(
  c: Cursor,
  value: string,
  x: number,
  size: number,
  opts: { font?: PDFFont; color?: ReturnType<typeof rgb> } = {}
) {
  const drawn = pdfText(value)
  if (!drawn) return
  c.page.drawText(drawn, {
    x,
    y: c.y,
    size,
    font: opts.font ?? c.font,
    color: opts.color ?? INK
  })
}

function drawAligned(
  c: Cursor,
  value: string,
  x: number,
  y: number,
  width: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  align: 'left' | 'right'
) {
  const drawn = pdfText(value)
  if (!drawn) return
  const w = font.widthOfTextAtSize(drawn, size)
  const tx = align === 'right' ? x + width - w : x
  c.page.drawText(drawn, { x: tx, y, size, font, color })
}

function wrap(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const textValue = pdfText(value)
  if (!textValue) return []
  const words = textValue.split(/\s+/)
  const lines: string[] = []
  let current = ''
  const pushChunk = (word: string) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word
      return
    }
    let chunk = ''
    for (const ch of word) {
      const next = chunk + ch
      if (font.widthOfTextAtSize(next, size) <= maxWidth) chunk = next
      else {
        if (chunk) lines.push(chunk)
        chunk = ch
      }
    }
    current = chunk
  }
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next
    else {
      if (current) lines.push(current)
      pushChunk(word)
    }
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
        '\u2013': '-',
        '\u2014': '-',
        '\u2212': '-',
        '\u2022': '-',
        '\u2026': '...',
        '\u2018': "'",
        '\u2019': "'",
        '\u201C': '"',
        '\u201D': '"',
        '\u2265': '>=',
        '\u2264': '<=',
        '\u2248': '~',
        '\u03BC': 'u',
        '\u2122': '',
        '\u00A0': ' '
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

function formatTargetCell(day: DietPdfVersion['days'][number] | undefined): string {
  if (!day?.target.kcal) return NO_VALUE
  const target = fmt(day.target.kcal, 'kcal')
  if (!day.planned || day.totals?.kcal == null) return target
  const delta = Math.round(day.totals.kcal - day.target.kcal)
  if (delta === 0) return `${target} (=)`
  return `${target} (${delta > 0 ? '+' : ''}${formatDietPdfNumber(delta, 0)})`
}

function formatDayTargetLine(day: DietPdfVersion['days'][number] | undefined): string | null {
  if (!day) return null
  const bits: string[] = []
  if (day.target.kcal) bits.push(`Objetivo ${fmt(day.target.kcal, 'kcal')} kcal`)
  const macros = MACRO_KEYS.filter((k): k is Exclude<typeof k, 'kcal'> => k !== 'kcal')
    .map((key) => {
      const value = day.target[key]
      if (value == null) return null
      const short = key === 'protein_g' ? 'P' : key === 'carbs_g' ? 'C' : 'G'
      return `${short} ${fmt(value, key)} g`
    })
    .filter(Boolean)
  if (macros.length) bits.push(macros.join('  ·  '))
  if (day.target.overridden) bits.push('propio de este día')
  return bits.length ? bits.join('  ·  ') : null
}

function formatMicroTokens(
  nutrients: Nutrients,
  coverage?: Partial<Record<string, { known: number; total: number }>>
): string[] {
  const parts: string[] = []
  for (const key of MICRO_KEYS) {
    const value = nutrients[key]
    if (value == null) continue
    const unit = NUTRIENT_UNITS[key] === 'µg' ? 'ug' : NUTRIENT_UNITS[key]
    const prefix = isComplete(coverage, key) ? '' : 'mín. '
    parts.push(`${NUTRIENT_LABELS_ES[key]} ${prefix}${fmt(value, key)} ${unit}`)
  }
  return parts
}

/** Packs "Fibra mín. 12 g" tokens so a unit never wraps away from its number. */
function wrapTokens(tokens: string[], font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const token of tokens) {
    const next = current ? `${current}  ·  ${token}` : token
    if (font.widthOfTextAtSize(pdfText(next), size) <= maxWidth) current = next
    else {
      if (current) lines.push(current)
      current = token
    }
  }
  if (current) lines.push(current)
  return lines
}

function formatWeekdayList(days: number[]): string {
  const names = days.map(d => WEEKDAY_SHORT_ES[d as Weekday]?.toLowerCase()).filter(Boolean)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
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
