import { getSessionUser } from '../../../utils/session'
import { searchOffProducts } from '../../../utils/openfoodfacts-client'

export default defineEventHandler(async (event) => {
  await getSessionUser(event)
  const query = getQuery(event)
  const q = (query.q as string | undefined)?.trim() || ''

  if (q.length < 2) return { query: q, count: 0, results: [] }

  const results = await searchOffProducts(q, Number(query.limit) || 20)

  return {
    query: q,
    count: results.length,
    // Search hits carry kcal and macros only; the micronutrients arrive when the
    // chosen product is imported by code. Flagged so the UI can say so.
    macros_only: true,
    results
  }
})
