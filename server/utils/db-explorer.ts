import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

/**
 * Read-only introspection for the admin database explorer.
 *
 * The whole design rests on one property: **no SQL is ever constructed here.**
 * Table names, sort fields and filter fields are resolved against Prisma's DMMF
 * (the schema as the generated client knows it) and only `findMany` / `count`
 * are ever called on the resulting delegate. An unrecognised name is a 400, not
 * a query — which is what makes a user-supplied `?table=` safe in a way a raw
 * `$queryRawUnsafe` never could be.
 *
 * Introspection, redaction and truncation live together in this one module for
 * the same reason cost arithmetic lives only in `ai-usage.ts`: two endpoints
 * read this, and a divergent redaction list between them would leak.
 */

/** Scalar-ish field as the explorer reports it. Relations never appear. */
export interface ExplorerField {
  name: string
  type: string
  isId: boolean
  isRequired: boolean
  /** True when the value is replaced by a mask before leaving the server. */
  redacted: boolean
}

export interface ExplorerTable {
  name: string
  delegate: string
  fields: ExplorerField[]
  count: number
}

/**
 * Fields whose value never leaves the server. This is an admin panel, but a
 * leaked password hash is a leaked password hash, and the Hevy key is a live
 * credential for someone else's account — neither is ever the thing an admin
 * opened this table to read.
 */
export const REDACTED_FIELDS = new Set(['password_hash', 'hevy_api_key'])

/** What a redacted, non-null value renders as. Null stays null: "hidden" and
 *  "empty" must not look the same. */
export const REDACTED_MASK = '••••••••'

/**
 * Text longer than this is cut in the grid. A single `Workout.raw_data` is tens
 * of kilobytes of JSON; 50 of them is a multi-megabyte response for a table
 * nobody can read anyway. The full value is one click away in the row detail.
 */
export const CELL_MAX_CHARS = 200

/** Allowed page sizes. A free-form `take` is a trivial DoS against the panel. */
export const PAGE_SIZES = [25, 50, 100, 200] as const
export const DEFAULT_PAGE_SIZE = 50

/** Model name → Prisma delegate key: only the first letter is lowercased
 *  (`MaintenanceJob` → `maintenanceJob`). */
export const delegateFor = (model: string) => model.charAt(0).toLowerCase() + model.slice(1)

type DmmfModel = typeof Prisma.dmmf.datamodel.models[number]

/** Scalars and enums only, never lists: relation fields would pull whole object
 *  graphs and aren't columns in any case. */
const scalarFields = (model: DmmfModel) =>
  model.fields.filter(f => (f.kind === 'scalar' || f.kind === 'enum') && !f.isList)

export const fieldsOf = (model: DmmfModel): ExplorerField[] =>
  scalarFields(model).map(f => ({
    name: f.name,
    type: f.type,
    isId: f.isId,
    isRequired: f.isRequired,
    redacted: REDACTED_FIELDS.has(f.name)
  }))

/** The `select` passed to Prisma — explicit, so a column added to the schema
 *  tomorrow doesn't silently start shipping. */
export const selectFor = (model: DmmfModel): Record<string, true> =>
  Object.fromEntries(scalarFields(model).map(f => [f.name, true as const]))

/** Resolves a caller-supplied table name, or refuses. */
export function resolveModel(name: unknown): DmmfModel {
  const found = typeof name === 'string'
    ? Prisma.dmmf.datamodel.models.find(m => m.name === name)
    : undefined
  if (!found) throw createError({ statusCode: 400, message: `Tabla desconocida: ${String(name)}` })
  return found
}

const delegate = (model: DmmfModel) => {
  const d = (prisma as unknown as Record<string, any>)[delegateFor(model.name)]
  if (!d?.findMany) throw createError({ statusCode: 400, message: `Tabla no consultable: ${model.name}` })
  return d as { findMany: (a: any) => Promise<any[]>; count: (a?: any) => Promise<number> }
}

/** Every model with its columns and row count. 27 counts on SQLite is cheap,
 *  and "how many rows" is the first thing anyone looks at. */
export async function listTables(): Promise<ExplorerTable[]> {
  return Promise.all(
    Prisma.dmmf.datamodel.models.map(async (m) => ({
      name: m.name,
      delegate: delegateFor(m.name),
      fields: fieldsOf(m),
      count: await delegate(m).count().catch(() => 0)
    }))
  )
}

/** Operators offered per field type. The UI mirrors this table. */
export const OPERATORS_BY_TYPE: Record<string, readonly string[]> = {
  String: ['contains', 'equals', 'startsWith', 'isNull', 'isNotNull'],
  Int: ['equals', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull'],
  Float: ['equals', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull'],
  BigInt: ['equals', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull'],
  DateTime: ['equals', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull'],
  Boolean: ['equals', 'isNull', 'isNotNull']
}

export const operatorsFor = (type: string): readonly string[] =>
  OPERATORS_BY_TYPE[type] ?? ['equals', 'isNull', 'isNotNull']

/**
 * A validated `where`. The field must exist on the model and the operator must
 * be one this field's type allows, so nothing caller-supplied reaches Prisma
 * except a value.
 *
 * Note there is no `mode: 'insensitive'`: Prisma's SQLite connector doesn't
 * support it. `contains` compiles to `LIKE`, which SQLite already treats
 * case-insensitively for ASCII.
 */
export function buildWhere(
  model: DmmfModel,
  field?: string,
  op?: string,
  value?: string
): Record<string, unknown> {
  if (!field) return {}

  const f = scalarFields(model).find(x => x.name === field)
  if (!f) throw createError({ statusCode: 400, message: `Campo desconocido: ${field}` })
  // A redacted column is not a searchable one: filtering by `contains` over a
  // hash is a way to read it back one character at a time.
  if (REDACTED_FIELDS.has(field)) {
    throw createError({ statusCode: 400, message: `Campo no filtrable: ${field}` })
  }

  const operator = op || 'equals'
  if (!operatorsFor(f.type).includes(operator)) {
    throw createError({ statusCode: 400, message: `Operador no válido para ${f.type}: ${operator}` })
  }

  if (operator === 'isNull') return { [field]: null }
  if (operator === 'isNotNull') return { [field]: { not: null } }

  if (value === undefined || value === '') return {}

  const coerced = coerce(f.type, value, field)
  return { [field]: operator === 'equals' && f.type !== 'String' ? coerced : { [operator]: coerced } }
}

function coerce(type: string, value: string, field: string): unknown {
  switch (type) {
    case 'Int':
    case 'Float':
    case 'BigInt': {
      const n = Number(value)
      if (Number.isNaN(n)) throw createError({ statusCode: 400, message: `Valor no numérico para ${field}: ${value}` })
      return type === 'Int' || type === 'BigInt' ? Math.trunc(n) : n
    }
    case 'DateTime': {
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) throw createError({ statusCode: 400, message: `Fecha no válida para ${field}: ${value}` })
      return d
    }
    case 'Boolean':
      return value === 'true' || value === '1'
    default:
      return value
  }
}

/** Newest-first on whichever timestamp the model actually has, id otherwise. */
export function defaultOrder(model: DmmfModel): { field: string; dir: 'asc' | 'desc' } {
  const names = new Set(scalarFields(model).map(f => f.name))
  for (const candidate of ['created_at', 'date', 'updated_at']) {
    if (names.has(candidate)) return { field: candidate, dir: 'desc' }
  }
  const id = scalarFields(model).find(f => f.isId)
  return { field: id?.name ?? scalarFields(model)[0]!.name, dir: 'desc' }
}

export function resolveOrder(
  model: DmmfModel,
  sortBy?: string,
  sortDir?: string
): { field: string; dir: 'asc' | 'desc' } {
  const dir: 'asc' | 'desc' = sortDir === 'asc' ? 'asc' : 'desc'
  if (!sortBy) return defaultOrder(model)
  if (!scalarFields(model).some(f => f.name === sortBy)) {
    throw createError({ statusCode: 400, message: `Campo de orden desconocido: ${sortBy}` })
  }
  // Ordering by a redacted column reveals it: page through a sort on a hash and
  // you have read it, one comparison at a time.
  if (REDACTED_FIELDS.has(sortBy)) {
    throw createError({ statusCode: 400, message: `Campo no ordenable: ${sortBy}` })
  }
  return { field: sortBy, dir }
}

export interface SerializedRow {
  values: Record<string, unknown>
  /** Fields whose text was cut — the UI offers the full value from the detail. */
  truncated: string[]
}

/** Applies redaction always, truncation only for the grid. */
export function serializeRow(
  model: DmmfModel,
  row: Record<string, unknown>,
  opts: { truncate: boolean }
): SerializedRow {
  const values: Record<string, unknown> = {}
  const truncated: string[] = []

  for (const f of scalarFields(model)) {
    const raw = row[f.name]

    if (REDACTED_FIELDS.has(f.name)) {
      values[f.name] = raw === null || raw === undefined ? null : REDACTED_MASK
      continue
    }

    if (opts.truncate && typeof raw === 'string' && raw.length > CELL_MAX_CHARS) {
      values[f.name] = raw.slice(0, CELL_MAX_CHARS)
      truncated.push(f.name)
      continue
    }

    // BigInt has no JSON representation; the schema has none today, but a
    // column added tomorrow would otherwise throw at serialisation time.
    values[f.name] = typeof raw === 'bigint' ? raw.toString() : raw
  }

  return { values, truncated }
}

export interface QueryRowsArgs {
  table: unknown
  page?: number
  pageSize?: number
  sortBy?: string
  sortDir?: string
  field?: string
  op?: string
  value?: string
  /** Full values, no cutting — the row-detail view. */
  full?: boolean
}

export async function queryRows(args: QueryRowsArgs) {
  const model = resolveModel(args.table)
  const where = buildWhere(model, args.field, args.op, args.value)
  const order = resolveOrder(model, args.sortBy, args.sortDir)

  const pageSize = (PAGE_SIZES as readonly number[]).includes(args.pageSize ?? 0)
    ? args.pageSize!
    : DEFAULT_PAGE_SIZE
  const page = Math.max(1, Math.trunc(args.page ?? 1))

  const d = delegate(model)
  const [total, raw] = await Promise.all([
    d.count({ where }),
    d.findMany({
      where,
      select: selectFor(model),
      orderBy: { [order.field]: order.dir },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  const rows = raw.map(r => serializeRow(model, r, { truncate: !args.full }))

  return {
    table: model.name,
    fields: fieldsOf(model),
    rows: rows.map(r => r.values),
    truncated: rows.map(r => r.truncated),
    total,
    page,
    page_size: pageSize,
    sort_by: order.field,
    sort_dir: order.dir
  }
}
