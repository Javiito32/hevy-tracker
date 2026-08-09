<template>
  <UiCard
    eyebrow="Base de datos"
    title="Explorador de tablas"
    hint="Vista directa del contenido de la base. Las credenciales se enmascaran y los textos largos se recortan en la rejilla."
    flush
  >
    <template #actions>
      <span class="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium bg-surface-2 text-ink-2 border border-line-strong">
        Solo lectura
      </span>
    </template>

    <div v-if="tablesPending" class="py-16 flex justify-center text-ink-3"><UiSpinner size="lg" /></div>
    <div v-else-if="tablesError" class="p-8 text-center text-danger">No se pudo leer el esquema.</div>

    <div v-else class="flex flex-col lg:flex-row">
      <!-- Tables -->
      <aside class="lg:w-64 lg:flex-shrink-0 border-b lg:border-b-0 lg:border-r border-line">
        <div class="p-3 border-b border-line">
          <UiInput v-model="tableFilter" placeholder="Buscar tabla…" aria-label="Buscar tabla" />
        </div>
        <div class="max-h-72 lg:max-h-[36rem] overflow-y-auto p-2 space-y-0.5">
          <button
            v-for="t in visibleTables"
            :key="t.name"
            class="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition"
            :class="t.name === table
              ? 'bg-accent text-accent-ink'
              : 'text-ink-2 hover:bg-surface-2'"
            @click="selectTable(t.name)"
          >
            <span class="text-sm truncate">{{ t.name }}</span>
            <span class="text-[11px] font-data flex-shrink-0" :class="t.name === table ? 'opacity-70' : 'text-ink-3'">
              {{ formatTokens(t.count) }}
            </span>
          </button>
          <p v-if="!visibleTables.length" class="px-3 py-6 text-center text-xs text-ink-3">
            Ninguna tabla coincide.
          </p>
        </div>
      </aside>

      <!-- Rows -->
      <div class="min-w-0 flex-grow">
        <!-- Filter bar. Operators come from the server so the UI can never offer
             one the server then rejects. -->
        <div class="p-3 border-b border-line flex flex-wrap items-end gap-2">
          <div class="w-44">
            <label class="block text-[11px] text-ink-3 mb-1">Campo</label>
            <UiSelect v-model="filterField">
              <option value="">— sin filtro —</option>
              <option v-for="f in filterableFields" :key="f.name" :value="f.name">{{ f.name }}</option>
            </UiSelect>
          </div>
          <div class="w-36">
            <label class="block text-[11px] text-ink-3 mb-1">Operador</label>
            <UiSelect v-model="filterOp" :disabled="!filterField">
              <option v-for="op in availableOperators" :key="op" :value="op">{{ OP_LABELS[op] ?? op }}</option>
            </UiSelect>
          </div>
          <div class="w-48">
            <label class="block text-[11px] text-ink-3 mb-1">Valor</label>
            <UiInput
              v-model="filterValue"
              :type="valueInputType"
              :disabled="!filterField || needsNoValue"
              :placeholder="needsNoValue ? '—' : 'valor…'"
              @keyup.enter="applyFilter"
            />
          </div>
          <UiButton size="sm" variant="secondary" :disabled="!filterField" @click="applyFilter">Filtrar</UiButton>
          <UiButton v-if="applied.field" size="sm" variant="ghost" @click="clearFilter">Limpiar</UiButton>

          <div class="ml-auto w-32">
            <label class="block text-[11px] text-ink-3 mb-1">Filas</label>
            <UiSelect v-model="pageSize">
              <option v-for="n in pageSizes" :key="n" :value="n">{{ n }}</option>
            </UiSelect>
          </div>
        </div>

        <div v-if="rowsPending" class="py-16 flex justify-center text-ink-3"><UiSpinner size="lg" /></div>
        <div v-else-if="rowsError" class="p-8 text-center text-danger text-sm">
          {{ rowsErrorMessage }}
        </div>
        <UiEmptyState
          v-else-if="!rows.length"
          title="Sin filas"
          :description="applied.field ? 'Ninguna fila cumple el filtro aplicado.' : 'Esta tabla está vacía.'"
        />

        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-surface-2 text-ink-3 uppercase text-[11px] tracking-wide">
              <tr>
                <th
                  v-for="f in fields"
                  :key="f.name"
                  class="px-3 py-2.5 text-left font-semibold whitespace-nowrap"
                >
                  <button
                    class="inline-flex items-center gap-1 hover:text-ink transition"
                    :class="f.redacted && 'cursor-default hover:text-ink-3'"
                    :disabled="f.redacted"
                    @click="toggleSort(f.name)"
                  >
                    {{ f.name }}
                    <span v-if="sortBy === f.name" aria-hidden="true">{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr
                v-for="(row, i) in rows"
                :key="i"
                class="hover:bg-surface-2 transition cursor-pointer"
                @click="openRow(row)"
              >
                <td
                  v-for="f in fields"
                  :key="f.name"
                  class="px-3 py-2 text-ink-2 font-data text-xs max-w-xs"
                  :title="isTruncated(i, f.name) ? 'Valor recortado — abre la fila para verlo entero' : undefined"
                >
                  <span class="block truncate" :class="row[f.name] === null && 'text-ink-3'">
                    {{ cell(row[f.name], f) }}<span v-if="isTruncated(i, f.name)" class="text-ink-3">…</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="!rowsPending && !rowsError && total > 0" class="px-4 py-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
          <p class="text-xs text-ink-3 font-data">
            Mostrando {{ formatTokens(firstRowIndex) }}–{{ formatTokens(lastRowIndex) }} de {{ formatTokens(total) }}
          </p>
          <div class="flex items-center gap-2">
            <UiButton size="sm" variant="ghost" :disabled="page <= 1" @click="page--">‹ Anterior</UiButton>
            <UiButton size="sm" variant="ghost" :disabled="lastRowIndex >= total" @click="page++">Siguiente ›</UiButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Row detail: the untruncated values, fetched fresh by id. -->
    <UiModal
      :open="!!detailOpen"
      size="xl"
      :title="`${table} · fila`"
      hint="Valores completos. Los campos enmascarados siguen enmascarados."
      @close="detailOpen = false"
    >
      <div v-if="detailPending" class="py-10 flex justify-center text-ink-3"><UiSpinner size="lg" /></div>
      <dl v-else class="divide-y divide-line text-sm">
        <div v-for="f in fields" :key="f.name" class="py-2.5 grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-1 sm:gap-4">
          <dt class="text-xs text-ink-3 font-data pt-0.5">
            {{ f.name }}
            <span class="block text-[10px] text-ink-3/70">{{ f.type }}</span>
          </dt>
          <dd class="min-w-0">
            <pre
              v-if="isLongText(detail?.[f.name])"
              class="font-data text-xs text-ink-2 bg-surface-2 border border-line rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all"
            >{{ pretty(detail?.[f.name]) }}</pre>
            <span v-else class="font-data text-xs" :class="detail?.[f.name] === null ? 'text-ink-3' : 'text-ink-2'">
              {{ cell(detail?.[f.name], f) }}
            </span>
          </dd>
        </div>
      </dl>
    </UiModal>
  </UiCard>
</template>

<script setup lang="ts">
/**
 * Read-only view of the database, in place of running `prisma studio` beside
 * the app: that is a separate process, it writes, and it knows nothing of this
 * interface.
 *
 * Everything the server accepts here is validated against Prisma's DMMF (see
 * `server/utils/db-explorer.ts`); no SQL is built from anything typed below.
 */

interface ExplorerField {
  name: string
  type: string
  isId: boolean
  isRequired: boolean
  redacted: boolean
}

interface TablesResponse {
  tables: Array<{ name: string; delegate: string; fields: ExplorerField[]; count: number }>
  operators_by_type: Record<string, string[]>
  page_sizes: number[]
  cell_max_chars: number
}

interface RowsResponse {
  table: string
  fields: ExplorerField[]
  rows: Array<Record<string, unknown>>
  truncated: string[][]
  total: number
  page: number
  page_size: number
  sort_by: string
  sort_dir: 'asc' | 'desc'
}

const OP_LABELS: Record<string, string> = {
  contains: 'contiene',
  equals: 'igual a',
  startsWith: 'empieza por',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  isNull: 'es nulo',
  isNotNull: 'no es nulo'
}

const { data: schema, pending: tablesPending, error: tablesError } =
  useFetch<TablesResponse>('/api/admin/db/tables')

const tableFilter = ref('')
const table = ref('')
const page = ref(1)
const pageSize = ref(50)
const sortBy = ref('')
const sortDir = ref<'asc' | 'desc'>('desc')

/** Draft filter (the controls) vs applied filter (what the query uses): typing
 *  a value must not re-query on every keystroke. */
const filterField = ref('')
const filterOp = ref('')
const filterValue = ref('')
const applied = ref<{ field: string; op: string; value: string }>({ field: '', op: '', value: '' })

const tables = computed(() => schema.value?.tables ?? [])
const pageSizes = computed(() => schema.value?.page_sizes ?? [25, 50, 100, 200])

const visibleTables = computed(() => {
  const q = tableFilter.value.trim().toLowerCase()
  return q ? tables.value.filter(t => t.name.toLowerCase().includes(q)) : tables.value
})

/** First table selected once the schema lands, so the pane is never blank. */
watch(tables, (list) => {
  if (!table.value && list.length) table.value = list[0]!.name
}, { immediate: true })

const currentTable = computed(() => tables.value.find(t => t.name === table.value))

/** Redacted columns can't be filtered: `contains` over a hash reads it back one
 *  character at a time. The server refuses too — this only hides the option. */
const filterableFields = computed(() => (currentTable.value?.fields ?? []).filter(f => !f.redacted))

const selectedFieldType = computed(
  () => filterableFields.value.find(f => f.name === filterField.value)?.type ?? 'String'
)

const availableOperators = computed(() =>
  schema.value?.operators_by_type[selectedFieldType.value] ?? ['equals', 'isNull', 'isNotNull']
)

const needsNoValue = computed(() => filterOp.value === 'isNull' || filterOp.value === 'isNotNull')

const valueInputType = computed(() => {
  const t = selectedFieldType.value
  if (t === 'Int' || t === 'Float' || t === 'BigInt') return 'number'
  if (t === 'DateTime') return 'date'
  return 'text'
})

/** Picking a new field resets the operator to one that field actually allows. */
watch(filterField, () => {
  filterOp.value = availableOperators.value[0] ?? 'equals'
  filterValue.value = ''
})

const rowsQuery = computed(() => ({
  table: table.value,
  page: page.value,
  pageSize: pageSize.value,
  ...(sortBy.value ? { sortBy: sortBy.value, sortDir: sortDir.value } : {}),
  ...(applied.value.field
    ? { field: applied.value.field, op: applied.value.op, value: applied.value.value }
    : {})
}))

/**
 * Loaded with `$fetch` rather than `useFetch`, deliberately.
 *
 * The grid can't fetch until a table name exists, and `useFetch(…, { immediate:
 * false, watch: [rowsQuery] })` only ever fires on a *change*: when the schema
 * arrives in the hydration payload the table is picked during setup, before the
 * fetch is even created, so nothing changes afterwards and the grid sat at
 * "Sin filas" forever. Sorting, filtering and paging are client-side
 * interactions anyway — there is nothing here to render on the server.
 *
 * `rowsPending` starts true so "not loaded yet" and "this table is empty" can
 * never look the same, which is what made the bug invisible.
 */
const rowsData = ref<RowsResponse | null>(null)
const rowsPending = ref(true)
const rowsError = ref<string | null>(null)

/** Guards against out-of-order responses: clicking two tables quickly must not
 *  paint the first one's rows over the second's. */
let requestSeq = 0

const loadRows = async () => {
  // Nothing to render on the server: the result would be thrown away at
  // hydration, where the immediate watch below runs again with the table
  // already picked from the payload.
  if (!import.meta.client || !table.value) return
  const seq = ++requestSeq
  rowsPending.value = true
  rowsError.value = null
  try {
    const res = await $fetch<RowsResponse>('/api/admin/db/rows', { query: rowsQuery.value })
    if (seq !== requestSeq) return
    rowsData.value = res
  } catch (err: any) {
    if (seq !== requestSeq) return
    rowsData.value = null
    rowsError.value = err?.data?.message ?? 'No se pudieron cargar las filas.'
  } finally {
    if (seq === requestSeq) rowsPending.value = false
  }
}

// Immediate: the table may already be selected by the time this runs (schema
// from the payload), in which case there is no later change to wait for.
watch(rowsQuery, loadRows, { immediate: true })

const rows = computed(() => rowsData.value?.rows ?? [])
const fields = computed(() => rowsData.value?.fields ?? currentTable.value?.fields ?? [])
const total = computed(() => rowsData.value?.total ?? 0)
const truncated = computed(() => rowsData.value?.truncated ?? [])

const rowsErrorMessage = computed(() => rowsError.value ?? 'No se pudieron cargar las filas.')

const firstRowIndex = computed(() => (page.value - 1) * pageSize.value + 1)
const lastRowIndex = computed(() => Math.min(page.value * pageSize.value, total.value))

const isTruncated = (rowIndex: number, field: string) =>
  truncated.value[rowIndex]?.includes(field) ?? false

const selectTable = (name: string) => {
  if (name === table.value) return
  table.value = name
  page.value = 1
  sortBy.value = ''
  clearFilter()
}

const applyFilter = () => {
  page.value = 1
  applied.value = {
    field: filterField.value,
    op: filterOp.value || 'equals',
    value: needsNoValue.value ? '' : String(filterValue.value ?? '')
  }
}

const clearFilter = () => {
  filterField.value = ''
  filterOp.value = ''
  filterValue.value = ''
  applied.value = { field: '', op: '', value: '' }
  page.value = 1
}

const toggleSort = (field: string) => {
  if (sortBy.value === field) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortDir.value = 'desc'
  }
  page.value = 1
}

// Changing the page size re-pages from the top; staying on page 7 of a 25-row
// paging lands somewhere unrelated at 200.
watch(pageSize, () => { page.value = 1 })

/** Cell rendering. A missing value is `—`, never `0` and never blank. */
const cell = (v: unknown, f: ExplorerField): string => {
  if (v === null || v === undefined) return NO_VALUE
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (f.type === 'DateTime') return formatDateTime(v as string)
  return String(v)
}

const isLongText = (v: unknown) => typeof v === 'string' && v.length > 80

/** Pretty-prints the JSON columns (`raw_data`, `totals_json`, …) and leaves
 *  anything else alone. */
const pretty = (v: unknown): string => {
  if (typeof v !== 'string') return String(v ?? NO_VALUE)
  try {
    return JSON.stringify(JSON.parse(v), null, 2)
  } catch {
    return v
  }
}

const detailOpen = ref(false)
const detailPending = ref(false)
const detail = ref<Record<string, unknown> | null>(null)

/**
 * Re-fetches the clicked row with `full=1`. The grid only ever holds the cut
 * values, so the dialog cannot reconstruct them from what is on screen.
 */
const openRow = async (row: Record<string, unknown>) => {
  const idField = fields.value.find(f => f.isId)
  detailOpen.value = true

  if (!idField || row[idField.name] === null || row[idField.name] === undefined) {
    detail.value = row
    return
  }

  detailPending.value = true
  try {
    const res = await $fetch<RowsResponse>('/api/admin/db/rows', {
      query: {
        table: table.value,
        field: idField.name,
        op: 'equals',
        value: String(row[idField.name]),
        pageSize: 25,
        full: '1'
      }
    })
    detail.value = res.rows[0] ?? row
  } catch {
    detail.value = row
  } finally {
    detailPending.value = false
  }
}
</script>
