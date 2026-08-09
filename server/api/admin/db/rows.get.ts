import { requireAdmin } from '../../../utils/session'
import { queryRows } from '../../../utils/db-explorer'

/**
 * A page of rows from one table. Read-only by construction: everything the
 * caller supplies is validated against the DMMF in `db-explorer.ts` before it
 * reaches Prisma, and only `findMany`/`count` are ever called.
 *
 * `full=1` skips the grid truncation — the row-detail dialog, which asks for a
 * single row by its id.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const q = getQuery(event)
  const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v))

  return queryRows({
    table: q.table,
    page: num(q.page),
    pageSize: num(q.pageSize),
    sortBy: q.sortBy as string | undefined,
    sortDir: q.sortDir as string | undefined,
    field: q.field as string | undefined,
    op: q.op as string | undefined,
    value: q.value as string | undefined,
    full: q.full === '1' || q.full === 'true'
  })
})
