import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('test1234', 10)

  const user = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {},
    create: {
      name: 'Admin Test',
      email: 'admin@test.com',
      password_hash: passwordHash,
      role: 'admin',
      is_active: true,
    },
  })

  console.log(`✅ Usuario creado: ${user.email} (role: ${user.role})`)
  console.log(`   Password: test1234`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
