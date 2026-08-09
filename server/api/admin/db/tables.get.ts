import { requireAdmin } from '../../../utils/session'
import { listTables, PAGE_SIZES, CELL_MAX_CHARS, OPERATORS_BY_TYPE } from '../../../utils/db-explorer'

/**
 * The schema as the explorer sees it: every model with its scalar columns and
 * its row count.
 *
 * The operator table and the page sizes ship alongside so the UI builds its
 * controls from the same source the server validates against — a client-side
 * copy of that list would drift and offer operators the server then rejects.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  return {
    tables: await listTables(),
    operators_by_type: OPERATORS_BY_TYPE,
    page_sizes: PAGE_SIZES,
    cell_max_chars: CELL_MAX_CHARS
  }
})
