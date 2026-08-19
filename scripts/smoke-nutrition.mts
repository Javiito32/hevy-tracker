/**
 * Exercises the weekday diet: per-day totals, the weekly mean, the copy-day
 * operation, the target overrides and the one-off fan-out migration.
 *
 * The checks that matter most are the ones a well-meaning refactor would break
 * without any test noticing: that the fan-out is idempotent, that it preserves
 * the figures it migrates, and that averaging keeps a partial micronutrient a
 * LOWER BOUND rather than quietly inflating it.
 *
 *   DATABASE_URL="file:./prisma/dev.db" npx tsx scripts/smoke-nutrition.mts
 */
import { PrismaClient } from '@prisma/client'
import {
  computeVersionTotals,
  divideNutrients,
  buildSnapshot,
  WEEKDAYS
} from '../server/utils/nutrition-calculator'
import {
  recalcVersionTotals,
  copyWeekday,
  saveDayTargets,
  effectiveTarget,
  serializeVersion,
  serializeDietForAi,
  parseTotals,
  loadVersionFull,
  assertDraft
} from '../server/utils/diet-service'
import { PDFDocument } from 'pdf-lib'
import {
  buildDietPdf,
  dietPdfFilename,
  currentWeekLabel,
  weekdayDateKey,
  formatDietPdfNumber
} from '../server/utils/diet-pdf'
import { runFanoutDietWeekdays } from '../server/utils/maintenance'

const prisma = new PrismaClient()
let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${detail}`); failures++ }
}

const ctx = { jobId: 'smoke', progress: async () => {} }

/** 100 g of this is 200 kcal / 20 P / 20 C / 6 F, with potassium known. */
const FULL_FOOD = {
  kcal: 200, protein_g: 20, carbs_g: 20, fat_g: 6,
  potassium_mg: 300, iron_mg: 2
}
/** Same energy, but no potassium at all — the partial-coverage case. */
const NO_POTASSIUM_FOOD = { kcal: 100, protein_g: 10, carbs_g: 5, fat_g: 3 }

async function main() {
  const user = await prisma.user.create({
    data: { name: 'SmokeNut', email: `smokenut-${Date.now()}@test.local`, password_hash: 'x' }
  })

  try {
    const [fullFood, poorFood] = await Promise.all([
      prisma.food.create({ data: { user_id: user.id, name: 'Comida completa', ...FULL_FOOD } }),
      prisma.food.create({ data: { user_id: user.id, name: 'Comida sin potasio', ...NO_POTASSIUM_FOOD } })
    ])

    const plan = await prisma.dietPlan.create({
      data: { user_id: user.id, name: 'Smoke', status: 'active' }
    })

    const makeVersion = async (versionNumber: number, status = 'draft') =>
      prisma.dietVersion.create({
        data: { diet_plan_id: plan.id, version_number: versionNumber, status }
      })

    const addMeal = async (versionId: string, weekday: number, foods: Array<{ food: any; grams: number }>) =>
      prisma.dietMeal.create({
        data: {
          diet_version_id: versionId,
          name: 'Comida',
          weekday,
          order_index: 0,
          items: {
            create: foods.map((f, index) => ({
              food_id: f.food.id,
              food_name: f.food.name,
              quantity_g: f.grams,
              order_index: index,
              nutrients_snapshot: buildSnapshot(f.food)
            }))
          }
        }
      })

    // ── 1. Averaging over planned days ───────────────────────────────────────
    console.log('\nMedia sobre los días planificados')
    const v1 = await makeVersion(1)
    // Mon–Fri get food; Sat and Sun stay empty, one of them with an empty meal.
    for (const weekday of [1, 2, 3, 4, 5]) {
      await addMeal(v1.id, weekday, [{ food: fullFood, grams: 100 }])
    }
    await prisma.dietMeal.create({
      data: { diet_version_id: v1.id, name: 'Cena vacía', weekday: 6, order_index: 0 }
    })
    await recalcVersionTotals(v1.id)

    let loaded = await loadVersionFull(v1.id)
    let totals = computeVersionTotals(loaded!.meals)

    check('cuenta 5 días planificados', totals.planned_days.length === 5,
      `fueron ${totals.planned_days.length}`)
    check('una comida vacía NO hace planificado su día', !totals.planned_days.includes(6),
      'el sábado tiene una comida sin alimentos')
    check('la media es la de los días con comida', totals.average.kcal === 200,
      `fue ${totals.average.kcal}`)
    check('un día vacío es null, no 0', totals.days['7'].nutrients.kcal === null,
      `fue ${totals.days['7'].nutrients.kcal}`)
    check('un día vacío distingue comidas de alimentos',
      totals.days['6'].meals === 1 && totals.days['6'].items === 0)

    const stored = await prisma.dietVersion.findUnique({ where: { id: v1.id } })
    check('la columna caliente guarda la media', stored?.total_kcal === 200, `fue ${stored?.total_kcal}`)
    check('planned_days se persiste', stored?.planned_days === 5, `fue ${stored?.planned_days}`)

    // ── 2. Partial micronutrient stays a lower bound ─────────────────────────
    console.log('\nMicronutriente parcial')
    const v2 = await makeVersion(2)
    // Mon and Tue: full food (potassium known). Wed: only the food without it.
    await addMeal(v2.id, 1, [{ food: fullFood, grams: 100 }])
    await addMeal(v2.id, 2, [{ food: fullFood, grams: 100 }])
    await addMeal(v2.id, 3, [{ food: poorFood, grams: 100 }])
    await recalcVersionTotals(v2.id)

    loaded = await loadVersionFull(v2.id)
    totals = computeVersionTotals(loaded!.meals)

    check('divide entre TODOS los días planificados, no solo los que tienen el dato',
      totals.average.potassium_mg === 200,
      `fue ${totals.average.potassium_mg}; 600 mg entre 3 días = 200, entre 2 sería 300 y sobreestimaría`)
    check('la cobertura declara que es parcial',
      totals.average_coverage.potassium_mg?.known === 2 && totals.average_coverage.potassium_mg?.total === 3,
      JSON.stringify(totals.average_coverage.potassium_mg))
    check('un nutriente completo se omite de la cobertura',
      totals.average_coverage.kcal === undefined,
      'omitirlo es lo que mantiene pequeño el totals_json')

    check('divideNutrients preserva null', divideNutrients({ ...totals.average, kcal: null } as any, 3).kcal === null)
    check('divideNutrients con divisor 0 no produce Infinity',
      divideNutrients(totals.average, 0).kcal === null)

    // ── 3. copyWeekday replaces ──────────────────────────────────────────────
    console.log('\nCopiar un día')
    const v3 = await makeVersion(3)
    await addMeal(v3.id, 1, [{ food: fullFood, grams: 150 }])
    // Tuesday starts with something different that must be GONE, not merged.
    await addMeal(v3.id, 2, [{ food: poorFood, grams: 999 }])
    await addMeal(v3.id, 2, [{ food: poorFood, grams: 888 }])
    await copyWeekday(v3.id, 1, [2, 3])
    await recalcVersionTotals(v3.id)

    loaded = await loadVersionFull(v3.id)
    const tuesday = loaded!.meals.filter((m: any) => m.weekday === 2)
    check('reemplaza, no fusiona', tuesday.length === 1, `quedaron ${tuesday.length} comidas`)
    check('copia los gramos del origen', tuesday[0].items[0].quantity_g === 150)
    check('copia el snapshot literalmente',
      tuesday[0].items[0].nutrients_snapshot === loaded!.meals.find((m: any) => m.weekday === 1)!.items[0].nutrients_snapshot,
      'debe ser la misma cadena, no un snapshot recalculado desde Food')
    check('copiar un día vacío sobre uno lleno lo vacía',
      (await copyWeekday(v3.id, 7, [3])) && (await prisma.dietMeal.count({ where: { diet_version_id: v3.id, weekday: 3 } })) === 0)
    check('copiar sobre sí mismo es un no-op',
      (await copyWeekday(v3.id, 1, [1])).copied === 0)

    // ── 4. Day groups ────────────────────────────────────────────────────────
    console.log('\nAgrupación de días idénticos')
    const v4 = await makeVersion(4)
    for (const weekday of WEEKDAYS) {
      await addMeal(v4.id, weekday, [{ food: fullFood, grams: 100 }])
    }
    await recalcVersionTotals(v4.id)
    let serialized = serializeVersion(await loadVersionFull(v4.id))
    check('siete días iguales son un solo grupo', serialized.day_groups.length === 1,
      `fueron ${serialized.day_groups.length}`)

    const tuesdayMeal = (await loadVersionFull(v4.id))!.meals.find((m: any) => m.weekday === 2)!
    await prisma.dietItem.updateMany({ where: { diet_meal_id: tuesdayMeal.id }, data: { quantity_g: 250 } })
    await recalcVersionTotals(v4.id)
    serialized = serializeVersion(await loadVersionFull(v4.id))
    check('cambiar un día lo separa del grupo', serialized.day_groups.length === 2,
      `fueron ${serialized.day_groups.length}`)

    // ── 5. Per-day targets ───────────────────────────────────────────────────
    console.log('\nObjetivos por día')
    await prisma.dietVersion.update({
      where: { id: v4.id },
      data: { target_kcal: 2000, target_protein_g: 150 }
    })
    await saveDayTargets(v4.id, [4], { target_kcal: 2600, target_protein_g: null, target_carbs_g: null, target_fat_g: null })

    let full = await loadVersionFull(v4.id)
    check('el día con override usa su propio objetivo', effectiveTarget(full, 4).kcal === 2600)
    check('un macro sin override hereda el de la versión', effectiveTarget(full, 4).protein_g === 150,
      'null en el override significa heredar, no borrar')
    check('el resto de días usan el objetivo base', effectiveTarget(full, 5).kcal === 2000)
    check('overridden distingue el día propio', effectiveTarget(full, 4).overridden && !effectiveTarget(full, 5).overridden)

    await saveDayTargets(v4.id, [4], { target_kcal: null, target_protein_g: null, target_carbs_g: null, target_fat_g: null })
    check('vaciar los cuatro macros borra la fila',
      (await prisma.dietDayTarget.count({ where: { diet_version_id: v4.id, weekday: 4 } })) === 0,
      '"sin override" y "override vacío" deben ser un solo estado')

    // ── 6. Immutability ──────────────────────────────────────────────────────
    console.log('\nInmutabilidad')
    const published = await makeVersion(5, 'active')
    let threw = false
    try { assertDraft(published) } catch { threw = true }
    check('una versión publicada rechaza cambios (409)', threw)

    // ── 7. parseTotals ───────────────────────────────────────────────────────
    console.log('\nCompatibilidad de totals_json')
    check('el formato antiguo devuelve null',
      parseTotals(JSON.stringify({ all: { kcal: 1 }, training: {}, rest: {} })) === null,
      'debe recalcularse, no sintetizar siete días idénticos')
    check('el formato nuevo se lee', parseTotals(JSON.stringify({ days: {}, average: {} })) !== null)
    check('un JSON corrupto no revienta', parseTotals('{{{') === null)

    // ── 8. Fan-out migration ─────────────────────────────────────────────────
    console.log('\nMigración de reparto por días')
    const legacy = await makeVersion(6)
    await addMeal(legacy.id, 1, [{ food: fullFood, grams: 100 }])
    await addMeal(legacy.id, 1, [{ food: poorFood, grams: 50 }])
    // The state the schema migration leaves behind: everything on Monday, totals
    // still in the pre-weekday shape.
    const legacyTotals = computeVersionTotals((await loadVersionFull(legacy.id))!.meals)
    await prisma.dietVersion.update({
      where: { id: legacy.id },
      data: {
        totals_json: JSON.stringify({ all: legacyTotals.days['1'].nutrients, training: {}, rest: {}, coverage: {} }),
        total_kcal: legacyTotals.days['1'].nutrients.kcal ?? 0,
        planned_days: 1
      }
    })

    const before = await prisma.dietVersion.findUnique({ where: { id: legacy.id } })
    const mondayIdsBefore = (await prisma.dietMeal.findMany({
      where: { diet_version_id: legacy.id, weekday: 1 }, select: { id: true }, orderBy: { order_index: 'asc' }
    })).map(m => m.id)

    const first = await runFanoutDietWeekdays(ctx, user.id)
    const mealCount = await prisma.dietMeal.count({ where: { diet_version_id: legacy.id } })
    const itemCount = await prisma.dietItem.count({ where: { diet_meal: { diet_version_id: legacy.id } } })

    check('reparte 2 comidas en 14', mealCount === 14, `fueron ${mealCount}`)
    check('clona los alimentos de cada día', itemCount === 14, `fueron ${itemCount}`)
    check('solo migra la versión legada', first.versions === 1, `migró ${first.versions}`)

    const after = await prisma.dietVersion.findUnique({ where: { id: legacy.id } })
    check('la migración NO cambia la cifra diaria', after?.total_kcal === before?.total_kcal,
      `antes ${before?.total_kcal}, después ${after?.total_kcal} — la media de 7 días idénticos es el día`)
    check('ahora los 7 días están planificados', after?.planned_days === 7, `fue ${after?.planned_days}`)

    const mondayIdsAfter = (await prisma.dietMeal.findMany({
      where: { diet_version_id: legacy.id, weekday: 1 }, select: { id: true }, orderBy: { order_index: 'asc' }
    })).map(m => m.id)
    check('conserva los ids del lunes', JSON.stringify(mondayIdsBefore) === JSON.stringify(mondayIdsAfter),
      'nada que apuntara a una comida debe romperse')

    const migrated = await loadVersionFull(legacy.id)
    const mondaySnapshot = migrated!.meals.find((m: any) => m.weekday === 1)!.items[0].nutrients_snapshot
    const sundaySnapshot = migrated!.meals.find((m: any) => m.weekday === 7)!.items[0].nutrients_snapshot
    check('los snapshots se copian tal cual', mondaySnapshot === sundaySnapshot)

    const second = await runFanoutDietWeekdays(ctx, user.id)
    check('reejecutarla no hace nada', second.versions === 0 && second.meals_created === 0,
      `migró ${second.versions} versiones y creó ${second.meals_created} comidas`)
    check('y no duplica filas',
      (await prisma.dietMeal.count({ where: { diet_version_id: legacy.id } })) === 14)

    // ── 9. AI payload ────────────────────────────────────────────────────────
    console.log('\nPayload de IA')
    const aiFull = serializeDietForAi(await loadVersionFull(v4.id), { detail: 'full' })
    check('declara sobre cuántos días promedia', aiFull.planned_days_per_week === 7)
    check('nombra los días en castellano', aiFull.planned_weekdays[0] === 'lunes')
    check('manda un grupo por patrón distinto', aiFull.days.length === 2, `fueron ${aiFull.days.length}`)
    check('el detalle completo lleva las comidas de cada grupo',
      Array.isArray((aiFull as any).meals_by_day) && (aiFull as any).meals_by_day.length === 2)

    const aiRep = serializeDietForAi(await loadVersionFull(v4.id), { detail: 'representative' })
    check('el payload reducido dice a qué días se refieren sus comidas',
      Array.isArray((aiRep as any).meals_apply_to) && (aiRep as any).meals_apply_to.length === 6,
      'el grupo mayoritario son los 6 días sin tocar')
    check('y avisa de que omite los demás', (aiRep as any).meals_other_days_omitted === true,
      'sin esto el modelo responde del sábado con el menú del lunes')

    // ── 10. Weekly PDF ───────────────────────────────────────────────────────
    console.log('\nPDF de la semana')
    const pdfVersion = serializeVersion(await loadVersionFull(v4.id))
    const pdfInput = {
      plan: { name: 'Volumen invierno 2026', goal: 'bulk', notes: 'Sin lácteos.' },
      version: pdfVersion,
      athleteName: 'Smoke',
      generatedAt: new Date('2026-08-19T12:00:00')
    }
    const bytes = await buildDietPdf(pdfInput)
    const header = Buffer.from(bytes.subarray(0, 5)).toString('utf8')
    check('el documento es un PDF', header === '%PDF-', `fue ${JSON.stringify(header)}`)
    check('los miles llevan punto aunque el locale del proceso sea C',
      formatDietPdfNumber(1918, 0) === '1.918')
    check('los decimales llevan coma', formatDietPdfNumber(5.3, 1) === '5,3')

    const loadedPdf = await PDFDocument.load(bytes)
    check('tiene al menos una página', loadedPdf.getPageCount() >= 1, `fueron ${loadedPdf.getPageCount()}`)
    check('el título lleva el nombre de la dieta',
      loadedPdf.getTitle()?.includes('Volumen invierno 2026') === true,
      `fue ${loadedPdf.getTitle()}`)
    check('el nombre del archivo es ASCII y versionado',
      dietPdfFilename(pdfInput) === 'volumen-invierno-2026-v4.pdf',
      `fue ${dietPdfFilename(pdfInput)}`)
    check('la semana se etiqueta con fechas, no solo con el día de la semana',
      currentWeekLabel(new Date('2026-08-19T12:00:00')) === 'Semana del 17 al 23 de agosto de 2026',
      currentWeekLabel(new Date('2026-08-19T12:00:00')))
    check('el lunes de esa semana es el 17',
      weekdayDateKey(1, new Date('2026-08-19T12:00:00')) === '2026-08-17',
      weekdayDateKey(1, new Date('2026-08-19T12:00:00')))

    const emptyPdf = await buildDietPdf({
      plan: { name: 'Vacía', goal: null, notes: null },
      version: serializeVersion(await loadVersionFull(v1.id)),
      generatedAt: new Date('2026-08-19T12:00:00')
    })
    check('una dieta a medio rellenar también genera PDF',
      (await PDFDocument.load(emptyPdf)).getPageCount() >= 1)

    const weird = await buildDietPdf({
      plan: { name: 'Dieta™ con — rayas y μgramos', goal: 'cut', notes: 'Café ≥ 2 tazas… “sí”' },
      version: serializeVersion(await loadVersionFull(v4.id)),
      generatedAt: new Date('2026-08-19T12:00:00')
    })
    check('caracteres fuera de WinAnsi no tiran la generación',
      (await PDFDocument.load(weird)).getPageCount() >= 1)
    check('el slug del archivo pierde marcas y acentos',
      dietPdfFilename({
        plan: { name: 'Dieta™ con — rayas y μgramos', goal: 'cut' },
        version: { version_number: 1 } as any
      }) === 'dieta-con-rayas-y-gramos-v1.pdf',
      dietPdfFilename({
        plan: { name: 'Dieta™ con — rayas y μgramos', goal: 'cut' },
        version: { version_number: 1 } as any
      }))

  } finally {
    await prisma.dietItem.deleteMany({ where: { diet_meal: { diet_version: { diet_plan: { user_id: user.id } } } } })
    await prisma.dietMeal.deleteMany({ where: { diet_version: { diet_plan: { user_id: user.id } } } })
    await prisma.dietDayTarget.deleteMany({ where: { diet_version: { diet_plan: { user_id: user.id } } } })
    await prisma.dietVersion.deleteMany({ where: { diet_plan: { user_id: user.id } } })
    await prisma.dietPlan.deleteMany({ where: { user_id: user.id } })
    await prisma.food.deleteMany({ where: { user_id: user.id } })
    await prisma.maintenanceJob.deleteMany({ where: { user_id: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.$disconnect()
  }

  console.log(failures === 0 ? '\n✅ Todo correcto\n' : `\n❌ ${failures} comprobaciones fallidas\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
