<template>
  <div class="max-w-7xl mx-auto space-y-7">

    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">Métricas Corporales</h1>
        <p v-if="metrics.length" class="text-sm text-ink-3 mt-1">
          {{ metrics.length }} registros · último {{ latestDate }}
        </p>
      </div>
      <button @click="openModal(null)"
        class="flex items-center gap-2 bg-accent text-accent-ink hover:opacity-85 px-4 py-2 rounded-lg text-sm font-semibold transition">
        + Añadir medida
      </button>
    </div>

    <!-- Loading -->
    <div v-if="pending" class="flex justify-center py-20">
      <UiSpinner size="lg" class="text-ink-3" />
    </div>

    <template v-else>
      <!-- Empty -->
      <div v-if="!metrics.length"
        class="bg-surface rounded-card border border-line p-20 text-center">
        <p class="text-5xl mb-4">📏</p>
        <p class="text-ink-2 font-medium mb-1">Sin datos corporales</p>
        <p class="text-sm text-ink-3">Sincroniza con Hevy o añade una medida manual.</p>
      </div>

      <template v-else>

        <!-- ── HRV Status Badge ───────────────────────────────────────────── -->
        <div v-if="hrvStatus"
          class="rounded-card border p-5 flex items-center gap-5"
          :class="{
            'border-positive/40 bg-positive/10': hrvStatus.level === 'optimal',
            'border-warn/40 bg-warn/10':    hrvStatus.level === 'caution',
            'border-danger/40 bg-danger/10':      hrvStatus.level === 'fatigued',
          }">
          <div class="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 ring-2"
            :class="{
              'bg-positive/15 ring-positive/40': hrvStatus.level === 'optimal',
              'bg-warn/15 ring-warn/40':    hrvStatus.level === 'caution',
              'bg-danger/15 ring-danger/40':      hrvStatus.level === 'fatigued',
            }">
            <svg viewBox="0 0 24 24" class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2.5"
              :class="{
                'text-positive': hrvStatus.level === 'optimal',
                'text-warn':   hrvStatus.level === 'caution',
                'text-danger':    hrvStatus.level === 'fatigued',
              }">
              <path v-if="hrvStatus.level === 'optimal'"
                stroke-linecap="round" stroke-linejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z" />
              <path v-else-if="hrvStatus.level === 'caution'"
                stroke-linecap="round" stroke-linejoin="round"
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <path v-else
                stroke-linecap="round" stroke-linejoin="round"
                d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1 flex-wrap">
              <span class="text-lg font-bold"
                :class="{
                  'text-positive': hrvStatus.level === 'optimal',
                  'text-warn':   hrvStatus.level === 'caution',
                  'text-danger':    hrvStatus.level === 'fatigued',
                }">{{ hrvStatus.label }}</span>
              <span class="text-xs px-2 py-0.5 rounded-full font-medium border"
                :class="{
                  'bg-positive/10 text-positive border-positive/40': hrvStatus.level === 'optimal',
                  'bg-warn/10 text-warn border-warn/40':       hrvStatus.level === 'caution',
                  'bg-danger/10 text-danger border-danger/40':          hrvStatus.level === 'fatigued',
                }">{{ hrvStatus.sublabel }}</span>
            </div>
            <p class="text-sm text-ink-2">{{ hrvStatus.text }}</p>
          </div>
          <div class="text-right flex-shrink-0 pl-2">
            <p class="font-data text-3xl text-ink leading-none">{{ hrvStatus.hrv.toFixed(0) }}</p>
            <p class="text-xs text-ink-3 mt-1">ms · HRV</p>
            <p class="text-xs mt-1 font-medium"
              :class="{
                'text-positive': hrvStatus.level === 'optimal',
                'text-warn':   hrvStatus.level === 'caution',
                'text-danger':    hrvStatus.level === 'fatigued',
              }">
              {{ hrvStatus.pct > 0 ? '+' : '' }}{{ (hrvStatus.pct * 100).toFixed(1) }}% vs media
            </p>
          </div>
        </div>

        <!-- ── Charts ─────────────────────────────────────────────────────── -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">

          <!-- Chart 1: Peso & Composición -->
          <div class="bg-surface rounded-card border border-line p-5">
            <p class="text-xs font-semibold text-ink-2 uppercase tracking-wider mb-4">Peso &amp; Composición</p>
            <div v-if="!c1" class="h-40 flex items-center justify-center text-ink-3 text-sm">Sin datos</div>
            <svg v-else :viewBox="`0 0 ${W} ${H}`" class="w-full" :style="`height:${H}px`">
              <!-- Grid -->
              <line v-for="y in gridYs" :key="y" :x1="pL" :y1="y" :x2="W - pR" :y2="y"
                class="stroke-line" stroke-width="1" />
              <!-- Left Y labels (kg) -->
              <text v-for="l in c1.leftLabels" :key="l.y" :x="pL - 4" :y="l.y + 3.5"
                text-anchor="end" font-size="9" class="fill-ink-3 font-data">{{ l.label }}</text>
              <!-- Right Y labels (%) -->
              <text v-for="l in c1.rightLabels" :key="'r'+l.y" :x="W - pR + 4" :y="l.y + 3.5"
                text-anchor="start" font-size="9" class="fill-series-4 font-data">{{ l.label }}%</text>
              <!-- Paths -->
              <path v-if="c1.weight.path" :d="c1.weight.path" fill="none" class="stroke-series-1" stroke-width="1.8" stroke-linejoin="round" />
              <path v-if="c1.lean.path" :d="c1.lean.path" fill="none" class="stroke-series-3" stroke-width="1.8" stroke-linejoin="round" />
              <path v-if="c1.fat.path" :d="c1.fat.path" fill="none" class="stroke-series-4" stroke-width="1.5" stroke-dasharray="4 2" stroke-linejoin="round" />
              <!-- Dots -->
              <circle v-for="p in c1.weight.points" :key="`w${p.x}`" :cx="p.x" :cy="p.y" r="2.5" class="fill-series-1" />
              <circle v-for="p in c1.lean.points" :key="`l${p.x}`" :cx="p.x" :cy="p.y" r="2.5" class="fill-series-3" />
              <!-- X labels -->
              <text v-for="l in c1.xLabels" :key="l.x" :x="l.x" :y="H - 4"
                text-anchor="middle" font-size="9" class="fill-ink-3 font-data">{{ l.label }}</text>
            </svg>
            <div class="flex flex-wrap gap-3 mt-3 text-xs">
              <span class="flex items-center gap-1.5 text-ink-2"><span class="w-3 h-px bg-series-1 inline-block"/>Peso</span>
              <span class="flex items-center gap-1.5 text-ink-2"><span class="w-3 h-px bg-series-3 inline-block"/>Masa magra</span>
              <span class="flex items-center gap-1.5 text-ink-2"><span class="w-3 h-px bg-series-4 inline-block"/>% Grasa</span>
            </div>
          </div>

          <!-- Chart 2: Perímetros -->
          <div class="bg-surface rounded-card border border-line p-5">
            <p class="text-xs font-semibold text-ink-2 uppercase tracking-wider mb-4">Perímetros Principales</p>
            <div v-if="!c2" class="h-40 flex items-center justify-center text-ink-3 text-sm">Sin datos</div>
            <svg v-else :viewBox="`0 0 ${W} ${H}`" class="w-full" :style="`height:${H}px`">
              <line v-for="y in gridYs" :key="y" :x1="pL" :y1="y" :x2="W - pR2" :y2="y"
                class="stroke-line" stroke-width="1" />
              <text v-for="l in c2.labels" :key="l.y" :x="pL - 4" :y="l.y + 3.5"
                text-anchor="end" font-size="9" class="fill-ink-3 font-data">{{ l.label }}</text>
              <path v-if="c2.waist.path" :d="c2.waist.path" fill="none" class="stroke-series-2" stroke-width="1.8" />
              <path v-if="c2.hips.path" :d="c2.hips.path" fill="none" class="stroke-series-5" stroke-width="1.8" />
              <path v-if="c2.chest.path" :d="c2.chest.path" fill="none" class="stroke-series-3" stroke-width="1.8" />
              <circle v-for="p in c2.waist.points" :key="`w${p.x}`" :cx="p.x" :cy="p.y" r="2.5" class="fill-series-2" />
              <circle v-for="p in c2.hips.points" :key="`h${p.x}`" :cx="p.x" :cy="p.y" r="2.5" class="fill-series-5" />
              <circle v-for="p in c2.chest.points" :key="`c${p.x}`" :cx="p.x" :cy="p.y" r="2.5" class="fill-series-3" />
              <text v-for="l in c2.xLabels" :key="l.x" :x="l.x" :y="H - 4"
                text-anchor="middle" font-size="9" class="fill-ink-3 font-data">{{ l.label }}</text>
            </svg>
            <div class="flex flex-wrap gap-3 mt-3 text-xs">
              <span class="flex items-center gap-1.5 text-ink-2"><span class="w-3 h-px bg-series-2 inline-block"/>Cintura</span>
              <span class="flex items-center gap-1.5 text-ink-2"><span class="w-3 h-px bg-series-5 inline-block"/>Caderas</span>
              <span class="flex items-center gap-1.5 text-ink-2"><span class="w-3 h-px bg-series-3 inline-block"/>Pecho</span>
            </div>
          </div>

          <!-- Chart 3: HRV · Últimos 30 días -->
          <div class="bg-surface rounded-card border border-line p-5">
            <p class="text-xs font-semibold text-ink-2 uppercase tracking-wider mb-4">HRV · Últimos 30 días</p>
            <div v-if="!c3" class="h-40 flex items-center justify-center text-ink-3 text-sm">Sin datos de recuperación</div>
            <svg v-else :viewBox="`0 0 ${W} ${H}`" class="w-full" :style="`height:${H}px`">
              <!-- Normal zone band -->
              <rect v-if="c3.bandRect"
                :x="c3.bandRect.x" :y="c3.bandRect.y"
                :width="c3.bandRect.width" :height="c3.bandRect.height"
                fill="rgba(99,102,241,0.10)" rx="2" />
              <!-- Mean line -->
              <line v-if="c3.meanLineY != null"
                :x1="pL" :y1="c3.meanLineY" :x2="W - pR" :y2="c3.meanLineY"
                class="stroke-ink-3" stroke-width="1" stroke-dasharray="3 3" opacity="0.6" />
              <!-- Grid -->
              <line v-for="y in gridYs" :key="y" :x1="pL" :y1="y" :x2="W - pR" :y2="y"
                class="stroke-line" stroke-width="1" />
              <!-- Y labels -->
              <text v-for="l in c3.leftLabels" :key="l.y" :x="pL - 4" :y="l.y + 3.5"
                text-anchor="end" font-size="9" class="fill-ink-3 font-data">{{ l.label }}</text>
              <text v-for="l in c3.rightLabels" :key="'r'+l.y" :x="W - pR + 4" :y="l.y + 3.5"
                text-anchor="start" font-size="9" class="fill-ink-3 font-data">{{ l.label }}</text>
              <!-- Resting HR path (secondary) -->
              <path v-if="c3.hr.path" :d="c3.hr.path" fill="none" class="stroke-series-2"
                stroke-width="1.3" stroke-dasharray="4 2" opacity="0.45" />
              <!-- HRV path -->
              <path v-if="c3.hrv.path" :d="c3.hrv.path" fill="none" class="stroke-series-1" stroke-width="1.8" />
              <!-- Resting HR dots -->
              <circle v-for="p in c3.hr.points" :key="`hr${p.x}`" :cx="p.x" :cy="p.y" r="2" class="fill-series-2" opacity="0.45" />
              <!-- HRV colored dots -->
              <circle v-for="p in c3.hrvPoints" :key="`hrv${p.x}`" :cx="p.x" :cy="p.y" r="3" :fill="p.color" />
              <!-- X labels -->
              <text v-for="l in c3.xLabels" :key="l.x" :x="l.x" :y="H - 4"
                text-anchor="middle" font-size="9" class="fill-ink-3 font-data">{{ l.label }}</text>
            </svg>
            <div class="flex flex-wrap gap-3 mt-3 text-xs text-ink-3">
              <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-positive inline-block"/>Óptimo</span>
              <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-warn inline-block"/>Precaución</span>
              <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-danger inline-block"/>Fatigado</span>
              <span class="flex items-center gap-1.5 opacity-50"><span class="w-3 h-px bg-series-2 inline-block"/>FC reposo</span>
            </div>
          </div>
        </div>

        <!-- ── Snapshot ───────────────────────────────────────────────────── -->
        <div class="bg-surface rounded-card border border-line p-6">
          <h2 class="text-xs font-semibold text-ink-2 uppercase tracking-wider mb-5">
            Última medición · {{ latestDate }}
          </h2>
          <div class="space-y-6">

            <!-- Composición -->
            <div>
              <p class="text-xs text-ink-3 mb-3">Composición corporal</p>
              <div class="grid grid-cols-3 gap-3">
                <SnapCell label="Peso" :v="snap('weight')" unit="kg" />
                <SnapCell label="Masa magra" :v="snap('lean_mass')" unit="kg" :higherIsBetter="true" />
                <SnapCell label="% Grasa" :v="snap('body_fat_percentage')" unit="%" :lowerIsBetter="true" />
              </div>
            </div>

            <!-- Torso -->
            <div>
              <p class="text-xs text-ink-3 mb-3">Torso</p>
              <div class="grid grid-cols-3 sm:grid-cols-6 gap-3">
                <SnapCell label="Cuello" :v="snap('neck')" unit="cm" />
                <SnapCell label="Hombros" :v="snap('shoulder')" unit="cm" />
                <SnapCell label="Pecho" :v="snap('chest')" unit="cm" />
                <SnapCell label="Abdomen" :v="snap('abdomen')" unit="cm" :lowerIsBetter="true" />
                <SnapCell label="Cintura" :v="snap('waist')" unit="cm" :lowerIsBetter="true" />
                <SnapCell label="Caderas" :v="snap('hips')" unit="cm" />
              </div>
            </div>

            <!-- Brazos -->
            <div>
              <p class="text-xs text-ink-3 mb-3">Brazos</p>
              <div class="grid grid-cols-3 sm:grid-cols-6 gap-3">
                <SnapCell label="Bícep flex. izq." :v="snap('left_bicep')" unit="cm" :higherIsBetter="true" />
                <SnapCell label="Bícep flex. der." :v="snap('right_bicep')" unit="cm" :higherIsBetter="true" />
                <SnapCell label="Bícep relax. izq." :v="snap('left_bicep_relaxed')" unit="cm" :higherIsBetter="true" />
                <SnapCell label="Bícep relax. der." :v="snap('right_bicep_relaxed')" unit="cm" :higherIsBetter="true" />
                <SnapCell label="Antebrazo izq." :v="snap('left_forearm')" unit="cm" :higherIsBetter="true" />
                <SnapCell label="Antebrazo der." :v="snap('right_forearm')" unit="cm" :higherIsBetter="true" />
              </div>
            </div>

            <!-- Piernas -->
            <div>
              <p class="text-xs text-ink-3 mb-3">Piernas</p>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SnapCell label="Muslo izq." :v="snap('left_thigh')" unit="cm" :higherIsBetter="true" />
                <SnapCell label="Muslo der." :v="snap('right_thigh')" unit="cm" :higherIsBetter="true" />
                <SnapCell label="Gemelo izq." :v="snap('left_calf')" unit="cm" :higherIsBetter="true" />
                <SnapCell label="Gemelo der." :v="snap('right_calf')" unit="cm" :higherIsBetter="true" />
              </div>
            </div>

            <!-- Recuperación -->
            <div>
              <p class="text-xs text-ink-3 mb-3">Recuperación</p>
              <div class="grid grid-cols-2 gap-3 max-w-xs">
                <SnapCell label="HRV" :v="snap('hrv')" unit="ms" :higherIsBetter="true" :decimals="0" />
                <SnapCell label="FC reposo" :v="snap('resting_hr')" unit="bpm" :lowerIsBetter="true" :decimals="0" />
              </div>
            </div>
          </div>
        </div>

        <!-- ── History table ──────────────────────────────────────────────── -->
        <div class="bg-surface rounded-card border border-line overflow-hidden">
          <div class="px-5 py-3.5 border-b border-line flex items-center justify-between">
            <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Historial</h2>
            <span class="text-xs text-ink-3">{{ metrics.length }} entradas</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-line text-[11px] text-ink-3 uppercase tracking-wide">
                  <th class="px-6 py-3 text-left">Fecha</th>
                  <th class="px-4 py-3 text-right">Peso</th>
                  <th class="px-4 py-3 text-right">% Grasa</th>
                  <th class="px-4 py-3 text-right">Cintura</th>
                  <th class="px-4 py-3 text-right">Bícep flex.</th>
                  <th class="px-4 py-3 text-right">HRV</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in pagedMetrics" :key="m.id"
                  @click="openModal(m)"
                  class="border-b border-line/50 hover:bg-surface-2/40 cursor-pointer transition group">
                  <td class="px-6 py-3 text-ink-2 font-medium">{{ m.date }}</td>
                  <td class="px-4 py-3 text-right text-ink-2">
                    {{ m.weight != null ? m.weight.toFixed(1) + ' kg' : '—' }}
                  </td>
                  <td class="px-4 py-3 text-right text-ink-2">
                    {{ m.body_fat_percentage != null ? m.body_fat_percentage.toFixed(1) + '%' : '—' }}
                  </td>
                  <td class="px-4 py-3 text-right text-ink-2">
                    {{ m.waist != null ? m.waist.toFixed(1) + ' cm' : '—' }}
                  </td>
                  <td class="px-4 py-3 text-right text-ink-2">
                    <span v-if="m.left_bicep != null || m.right_bicep != null">
                      {{ m.left_bicep?.toFixed(1) ?? '—' }} / {{ m.right_bicep?.toFixed(1) ?? '—' }}
                    </span>
                    <span v-else>—</span>
                  </td>
                  <td class="px-4 py-3 text-right text-ink-2">
                    {{ m.hrv != null ? m.hrv.toFixed(0) + ' ms' : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="px-6 py-3 border-t border-line flex items-center justify-between">
            <span class="text-xs text-ink-3">Página {{ page + 1 }} de {{ totalPages }}</span>
            <div class="flex gap-2">
              <button @click="page = Math.max(0, page - 1)" :disabled="page === 0"
                class="px-3 py-1 text-xs rounded-lg bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2 disabled:opacity-30 transition">
                ←
              </button>
              <button @click="page = Math.min(totalPages - 1, page + 1)" :disabled="page >= totalPages - 1"
                class="px-3 py-1 text-xs rounded-lg bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2 disabled:opacity-30 transition">
                →
              </button>
            </div>
          </div>
        </div>

      </template>
    </template>

    <!-- ── Modal ─────────────────────────────────────────────────────────── -->
    <ClientOnly>
    <Teleport to="body">
      <div v-if="modalOpen"
        class="fixed inset-0 bg-bg/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4"
        @click.self="closeModal">
        <div class="bg-surface border border-line-strong rounded-card w-full max-w-2xl max-h-[90vh] flex flex-col">
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-line flex-shrink-0">
            <h3 class="font-semibold text-ink">
              {{ editEntry ? 'Editar medida' : 'Añadir medida' }}
            </h3>
            <button @click="closeModal" class="text-ink-3 hover:text-ink-2 text-2xl leading-none transition">×</button>
          </div>

          <div class="overflow-y-auto flex-grow p-6 space-y-6">
            <!-- Date -->
            <div>
              <label class="block text-[11px] text-ink-3 uppercase tracking-wide mb-1.5">Fecha</label>
              <input type="date" v-model="form.date"
                class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:ring-2 focus:ring-focus transition" />
            </div>

            <!-- Sections -->
            <div v-for="section in formSections" :key="section.title">
              <p class="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">{{ section.title }}</p>
              <div class="grid grid-cols-2 gap-3">
                <div v-for="field in section.fields" :key="field.key">
                  <label class="block text-xs text-ink-3 mb-1">{{ field.label }}</label>
                  <div class="flex items-center bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-focus transition">
                    <input
                      type="number"
                      :step="field.int ? '1' : '0.1'"
                      :min="0"
                      v-model="(form as any)[field.key]"
                      placeholder="—"
                      class="flex-1 bg-transparent px-3 py-2 text-ink text-sm focus:outline-none min-w-0" />
                    <span class="px-2.5 text-xs text-ink-3 flex-shrink-0">{{ field.unit }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="px-6 py-4 border-t border-line flex gap-3 justify-end flex-shrink-0">
            <button @click="closeModal"
              class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition">
              Cancelar
            </button>
            <button @click="saveMetric" :disabled="saving"
              class="px-5 py-2 bg-accent text-accent-ink hover:opacity-85 text-sm font-semibold rounded-lg transition disabled:opacity-60">
              {{ saving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
    </ClientOnly>

  </div>
</template>

<script setup lang="ts">

const toast = useToast()
type Metric = {
  id: string; date: string
  weight: number | null; lean_mass: number | null; body_fat_percentage: number | null
  neck: number | null; shoulder: number | null; chest: number | null
  left_bicep: number | null; right_bicep: number | null
  left_bicep_relaxed: number | null; right_bicep_relaxed: number | null
  left_forearm: number | null; right_forearm: number | null
  abdomen: number | null; waist: number | null; hips: number | null
  left_thigh: number | null; right_thigh: number | null
  left_calf: number | null; right_calf: number | null
  hrv: number | null; resting_hr: number | null
}

// ── Data ──────────────────────────────────────────────────────────────────────
const { data: rawData, pending, refresh } = useFetch<Metric[]>('/api/metrics')
const metrics = computed(() => rawData.value ?? [])
const latest = computed(() => metrics.value[metrics.value.length - 1] ?? null)
const previous = computed(() => metrics.value[metrics.value.length - 2] ?? null)
const latestDate = computed(() => latest.value?.date ?? '—')

// ── SVG helpers ───────────────────────────────────────────────────────────────
const W = 400, H = 160
const pL = 44, pR = 40, pR2 = 18, pT = 14, pB = 28
const gridYs = [0, 1, 2, 3].map(i => pT + (i / 3) * (H - pT - pB))

function valRange(data: Metric[], fields: string[]) {
  const vals = data.flatMap(m => fields.map(f => (m as any)[f])).filter((v): v is number => v != null)
  if (!vals.length) return null
  const min = Math.min(...vals), max = Math.max(...vals)
  const pad = (max - min) * 0.1 || 2
  return { min: min - pad, max: max + pad }
}

function buildPath(data: Metric[], field: string, min: number, max: number, padR: number) {
  const range = max - min || 1
  const n = data.length - 1 || 1
  const pts = data
    .map((m, i) => {
      const v = (m as any)[field] as number | null
      if (v == null) return null
      return { x: pL + (i / n) * (W - pL - padR), y: pT + (1 - (v - min) / range) * (H - pT - pB), v }
    })
    .filter((p): p is { x: number; y: number; v: number } => p != null)

  if (pts.length < 2) return { path: '', points: pts }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const dx = (pts[i].x - pts[i - 1].x) / 3
    d += ` C ${(pts[i - 1].x + dx).toFixed(1)} ${pts[i - 1].y.toFixed(1)},${(pts[i].x - dx).toFixed(1)} ${pts[i].y.toFixed(1)},${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`
  }
  return { path: d, points: pts }
}

function yLabels(min: number, max: number) {
  const range = max - min
  return [0, 1, 2, 3].map(i => ({
    y: pT + (i / 3) * (H - pT - pB),
    label: (max - (range * i) / 3).toFixed(0),
  }))
}

function xLabels(data: Metric[], padR: number) {
  if (data.length < 2) return []
  const step = Math.max(1, Math.floor(data.length / 4))
  const n = data.length - 1
  return data
    .filter((_, i) => i % step === 0 || i === data.length - 1)
    .map((m) => {
      const i = data.indexOf(m)
      return { x: pL + (i / n) * (W - pL - padR), label: m.date.slice(5) }
    })
}

// ── Chart computed ─────────────────────────────────────────────────────────────
const c1 = computed(() => {
  const d = metrics.value
  if (d.length < 2) return null
  const lR = valRange(d, ['weight', 'lean_mass'])
  const rR = valRange(d, ['body_fat_percentage'])
  if (!lR) return null
  const r = rR ?? { min: 0, max: 40 }
  return {
    weight: buildPath(d, 'weight', lR.min, lR.max, pR),
    lean: buildPath(d, 'lean_mass', lR.min, lR.max, pR),
    fat: buildPath(d, 'body_fat_percentage', r.min, r.max, pR),
    leftLabels: yLabels(lR.min, lR.max),
    rightLabels: yLabels(r.min, r.max),
    xLabels: xLabels(d, pR),
  }
})

const c2 = computed(() => {
  const d = metrics.value
  if (d.length < 2) return null
  const r = valRange(d, ['waist', 'hips', 'chest'])
  if (!r) return null
  return {
    waist: buildPath(d, 'waist', r.min, r.max, pR2),
    hips: buildPath(d, 'hips', r.min, r.max, pR2),
    chest: buildPath(d, 'chest', r.min, r.max, pR2),
    labels: yLabels(r.min, r.max),
    xLabels: xLabels(d, pR2),
  }
})

const c3 = computed(() => {
  const allData = metrics.value
  if (allData.length < 2) return null

  // Last 30 days
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const d = allData.filter(m => m.date >= cutoffStr)
  if (d.length < 2) return null

  const lR = valRange(d, ['hrv'])
  const rR = valRange(d, ['resting_hr'])
  if (!lR && !rR) return null
  const l = lR ?? { min: 0, max: 100 }
  const r = rR ?? { min: 40, max: 80 }

  // Band: mean ± stddev of HRV in window
  const hrvVals = d.map(m => m.hrv).filter((v): v is number => v != null)
  let bandRect: { x: number; y: number; width: number; height: number } | null = null
  let meanLineY: number | null = null
  let hrvMean: number | null = null

  if (hrvVals.length >= 2) {
    hrvMean = hrvVals.reduce((a, b) => a + b, 0) / hrvVals.length
    const variance = hrvVals.reduce((a, b) => a + Math.pow(b - hrvMean!, 2), 0) / hrvVals.length
    const stddev = Math.sqrt(variance)
    const range = l.max - l.min || 1
    const toY = (v: number) => pT + (1 - (v - l.min) / range) * (H - pT - pB)
    const yHigh = toY(Math.min(hrvMean + stddev, l.max))
    const yLow  = toY(Math.max(hrvMean - stddev, l.min))
    bandRect = { x: pL, y: yHigh, width: W - pL - pR, height: Math.max(0, yLow - yHigh) }
    meanLineY = toY(hrvMean)
  }

  // Color each HRV point by deviation from mean
  const rawHrvPoints = buildPath(d, 'hrv', l.min, l.max, pR).points
  const hrvPoints = rawHrvPoints.map(p => {
    if (hrvMean == null) return { ...p, color: "rgb(var(--series-1))" }
    const pct = (p.v - hrvMean) / Math.abs(hrvMean)
    const color = pct >= -0.05 ? "rgb(var(--positive))" : pct >= -0.15 ? "rgb(var(--warn))" : "rgb(var(--danger))"
    return { ...p, color }
  })

  return {
    hrv: buildPath(d, 'hrv', l.min, l.max, pR),
    hr: buildPath(d, 'resting_hr', r.min, r.max, pR),
    hrvPoints,
    bandRect,
    meanLineY,
    leftLabels: yLabels(l.min, l.max),
    rightLabels: yLabels(r.min, r.max),
    xLabels: xLabels(d, pR),
  }
})

// ── HRV Status badge ──────────────────────────────────────────────────────────
const hrvStatus = computed(() => {
  const hrvAll = metrics.value.filter(m => m.hrv != null)
  if (hrvAll.length < 2) return null

  const vals = hrvAll.map(m => m.hrv as number)
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const todayHrv = vals[vals.length - 1]
  const pct = (todayHrv - mean) / Math.abs(mean)

  if (pct >= -0.05) return {
    level: 'optimal' as const,
    label: '¡A darle caña!',
    sublabel: 'Óptimo',
    text: 'Tu sistema nervioso está al 100%. Hoy es el día para buscar récords o meter volumen máximo.',
    hrv: todayHrv, mean, pct,
  }
  if (pct >= -0.15) return {
    level: 'caution' as const,
    label: 'Precaución',
    sublabel: 'Fatiga moderada',
    text: 'Estás acumulando fatiga. Mantén el peso, pero quítale un par de series a tu rutina hoy. No llegues al fallo.',
    hrv: todayHrv, mean, pct,
  }
  return {
    level: 'fatigued' as const,
    label: 'Fatigado, chill out',
    sublabel: 'Simpático dominante',
    text: 'Tu cuerpo necesita recuperación urgente. Toca descanso activo, movilidad o un paseo. Si entrenas, hazlo súper ligero.',
    hrv: todayHrv, mean, pct,
  }
})

// ── Snapshot ──────────────────────────────────────────────────────────────────
function snap(field: string) {
  const cur = latest.value ? (latest.value as any)[field] as number | null : null
  const prev = previous.value ? (previous.value as any)[field] as number | null : null
  return { cur, diff: cur != null && prev != null ? cur - prev : null }
}

// ── Snapshot cell component (inline) ──────────────────────────────────────────
const SnapCell = defineComponent({
  props: {
    label: String,
    v: Object as () => { cur: number | null; diff: number | null },
    unit: String,
    higherIsBetter: Boolean,
    lowerIsBetter: Boolean,
    decimals: { type: Number, default: 1 },
  },
  setup(props) {
    const diffClass = computed(() => {
      const d = props.v?.diff
      if (d == null || d === 0) return 'text-ink-3'
      if (props.higherIsBetter) return d > 0 ? 'text-positive' : 'text-danger'
      if (props.lowerIsBetter) return d < 0 ? 'text-positive' : 'text-danger'
      return d > 0 ? 'text-ink-2' : 'text-ink-2'
    })
    const diffText = computed(() => {
      const d = props.v?.diff
      if (d == null || d === 0) return ''
      return `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(props.decimals)}`
    })
    return { diffClass, diffText }
  },
  template: `
    <div class="bg-surface-2/60 rounded-lg px-3 py-2.5 border border-line-strong/50">
      <p class="text-xs text-ink-3 mb-1 truncate">{{ label }}</p>
      <p class="text-ink font-semibold text-sm">
        {{ v?.cur != null ? v.cur.toFixed(decimals) : '—' }}
        <span class="text-xs font-normal text-ink-3">{{ v?.cur != null ? unit : '' }}</span>
      </p>
      <p v-if="diffText" :class="['text-xs mt-0.5', diffClass]">{{ diffText }}</p>
    </div>
  `,
})

// ── Pagination ─────────────────────────────────────────────────────────────────
const page = ref(0)
const PER_PAGE = 10
const sortedDesc = computed(() => [...metrics.value].reverse())
const totalPages = computed(() => Math.max(1, Math.ceil(sortedDesc.value.length / PER_PAGE)))
const pagedMetrics = computed(() => sortedDesc.value.slice(page.value * PER_PAGE, (page.value + 1) * PER_PAGE))

// ── Modal ─────────────────────────────────────────────────────────────────────
const modalOpen = ref(false)
const editEntry = ref<Metric | null>(null)
const saving = ref(false)

const FORM_FIELDS = [
  'weight', 'lean_mass', 'body_fat_percentage',
  'neck', 'shoulder', 'chest',
  'left_bicep', 'right_bicep', 'left_bicep_relaxed', 'right_bicep_relaxed',
  'left_forearm', 'right_forearm',
  'abdomen', 'waist', 'hips',
  'left_thigh', 'right_thigh', 'left_calf', 'right_calf',
  'hrv', 'resting_hr',
]

const form = reactive<Record<string, any>>({ date: '' })
FORM_FIELDS.forEach(k => (form[k] = ''))

function openModal(entry: Metric | null) {
  editEntry.value = entry
  form.date = entry?.date ?? new Date().toISOString().slice(0, 10)
  FORM_FIELDS.forEach(k => {
    const v = entry ? (entry as any)[k] : null
    form[k] = v != null ? String(v) : ''
  })
  modalOpen.value = true
}

function closeModal() { modalOpen.value = false }

async function saveMetric() {
  if (!form.date) return
  saving.value = true
  try {
    const body: Record<string, any> = { date: form.date }
    FORM_FIELDS.forEach(k => {
      if (form[k] !== '' && form[k] != null) body[k] = Number(form[k])
    })
    await $fetch('/api/metrics', { method: 'POST', body })
    await refresh()
    closeModal()
  } catch {
    toast.error('Error al guardar la medida.')
  } finally {
    saving.value = false
  }
}

const formSections = [
  { title: 'Composición corporal', fields: [
    { key: 'weight', label: 'Peso', unit: 'kg' },
    { key: 'lean_mass', label: 'Masa magra', unit: 'kg' },
    { key: 'body_fat_percentage', label: '% Grasa corporal', unit: '%' },
  ]},
  { title: 'Torso', fields: [
    { key: 'neck', label: 'Cuello', unit: 'cm' },
    { key: 'shoulder', label: 'Hombros', unit: 'cm' },
    { key: 'chest', label: 'Pecho', unit: 'cm' },
    { key: 'abdomen', label: 'Abdomen', unit: 'cm' },
    { key: 'waist', label: 'Cintura', unit: 'cm' },
    { key: 'hips', label: 'Caderas', unit: 'cm' },
  ]},
  { title: 'Brazos', fields: [
    { key: 'left_bicep', label: 'Bícep flex. izq.', unit: 'cm' },
    { key: 'right_bicep', label: 'Bícep flex. der.', unit: 'cm' },
    { key: 'left_bicep_relaxed', label: 'Bícep relax. izq.', unit: 'cm' },
    { key: 'right_bicep_relaxed', label: 'Bícep relax. der.', unit: 'cm' },
    { key: 'left_forearm', label: 'Antebrazo izq.', unit: 'cm' },
    { key: 'right_forearm', label: 'Antebrazo der.', unit: 'cm' },
  ]},
  { title: 'Piernas', fields: [
    { key: 'left_thigh', label: 'Muslo izq.', unit: 'cm' },
    { key: 'right_thigh', label: 'Muslo der.', unit: 'cm' },
    { key: 'left_calf', label: 'Gemelo izq.', unit: 'cm' },
    { key: 'right_calf', label: 'Gemelo der.', unit: 'cm' },
  ]},
  { title: 'Recuperación', fields: [
    { key: 'hrv', label: 'HRV', unit: 'ms' },
    { key: 'resting_hr', label: 'FC reposo', unit: 'bpm', int: true },
  ]},
]
</script>
