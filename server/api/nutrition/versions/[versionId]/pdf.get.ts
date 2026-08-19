import { prisma } from '../../../../utils/prisma'
import { getSessionUser } from '../../../../utils/session'
import { requireOwnedVersion, loadVersionFull, serializeVersion } from '../../../../utils/diet-service'
import { buildDietPdf, dietPdfFilename } from '../../../../utils/diet-pdf'

/**
 * Printable menu of the seven weekdays in this version.
 *
 * Binary, not JSON: the client saves the body as a file. Ownership is the
 * same filter every other version route uses — someone else's id 404s.
 */
export default defineEventHandler(async (event) => {
  const user = await getSessionUser(event)
  const versionId = getRouterParam(event, 'versionId')!

  const owned = await requireOwnedVersion(user.id, versionId)

  const [full, latestWeight] = await Promise.all([
    loadVersionFull(versionId),
    prisma.bodyMetric.findFirst({
      where: { user_id: user.id, weight: { not: null } },
      orderBy: { date: 'desc' },
      select: { weight: true }
    })
  ])

  const version = serializeVersion(full, { weightKg: latestWeight?.weight ?? null })
  const bytes = await buildDietPdf({
    plan: owned.diet_plan,
    version,
    athleteName: user.name,
    generatedAt: new Date()
  })

  const filename = dietPdfFilename({ plan: owned.diet_plan, version })
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  setHeader(event, 'Cache-Control', 'no-store')
  return Buffer.from(bytes)
})
