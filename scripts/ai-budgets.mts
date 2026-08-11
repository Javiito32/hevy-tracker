/**
 * What each AI task actually spends, per task type.
 *
 *   DATABASE_URL="file:/abs/path/prisma/dev.db" npx tsx scripts/ai-budgets.mts
 *
 * Exists because `MAX_OUTPUT_TOKENS` and `REASONING_BY_TASK` are the two dials
 * most tempting to turn on intuition, and the failure mode of turning them the
 * wrong way is invisible: a budget set too low does not error, it truncates —
 * the answer stops mid-sentence, or the reasoning eats the whole allowance and
 * the response comes back empty. So the rule is measure first, and the figures
 * that decide it are these.
 *
 * How to read the columns:
 *  - **out p95 / out max** against `MAX_OUTPUT_TOKENS` for that task. A p95
 *    close to the cap means truncation is already happening or about to; a p95
 *    at a small fraction of it is headroom, which is only worth reclaiming if
 *    `max` is also far from the cap.
 *  - **reasoning p95** is part of output and is spent BEFORE the answer starts,
 *    so it is the part of the budget the visible answer never gets.
 *  - **vacías** counts responses with no text at all — the signature of a call
 *    that spent its budget thinking. Any number above zero here is a reason to
 *    RAISE a cap, never to lower one.
 *  - **cache p95 / write p95** say whether the prompt cache is being read or
 *    only written. Writes with no reads is a cost increase, not a saving.
 *
 * Reports "sin datos" rather than inventing a distribution from an empty table.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const percentile = (values: number[], p: number): number | null => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

const rows = await prisma.aiMessage.findMany({
  where: { role: 'assistant', model_used: { not: null } },
  select: {
    input_tokens: true, output_tokens: true, reasoning_tokens: true,
    cached_input_tokens: true, cache_write_tokens: true,
    latency_ms: true, tool_rounds: true, content: true,
    conversation: { select: { context_type: true } }
  }
})

if (!rows.length) {
  console.log('Sin datos: no hay ninguna llamada de IA registrada en esta base de datos.')
  console.log('Los presupuestos NO deben tocarse sin estas cifras.')
  await prisma.$disconnect()
  process.exit(0)
}

const byTask = new Map<string, typeof rows>()
for (const row of rows) {
  const key = row.conversation.context_type
  if (!byTask.has(key)) byTask.set(key, [])
  byTask.get(key)!.push(row)
}

const HEADERS = [
  'tarea', 'n', 'in p50', 'in p95', 'out p50', 'out p95', 'out max',
  'reas p95', 'lat p95 ms', 'rondas máx', 'cache lec p95', 'cache esc p95', 'vacías'
]
console.log(HEADERS.join(' | '))

for (const [task, taskRows] of [...byTask.entries()].sort()) {
  const column = (pick: (r: (typeof rows)[number]) => number | null): number[] =>
    taskRows.map(pick).filter((v): v is number => v != null)

  const out = column(r => r.output_tokens)
  console.log([
    task,
    taskRows.length,
    percentile(column(r => r.input_tokens), 0.5) ?? 'n/d',
    percentile(column(r => r.input_tokens), 0.95) ?? 'n/d',
    percentile(out, 0.5) ?? 'n/d',
    percentile(out, 0.95) ?? 'n/d',
    out.length ? Math.max(...out) : 'n/d',
    percentile(column(r => r.reasoning_tokens), 0.95) ?? 'n/d',
    percentile(column(r => r.latency_ms), 0.95) ?? 'n/d',
    column(r => r.tool_rounds).length ? Math.max(...column(r => r.tool_rounds)) : 'n/d',
    percentile(column(r => r.cached_input_tokens), 0.95) ?? 'n/d',
    percentile(column(r => r.cache_write_tokens), 0.95) ?? 'n/d',
    taskRows.filter(r => !r.content?.trim()).length
  ].join(' | '))
}

await prisma.$disconnect()
