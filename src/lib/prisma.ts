import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ log: ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

async function seedTransferAccount() {
  try {
    await prisma.account.upsert({
      where: { code: '9.9.01' },
      update: {},
      create: {
        code: '9.9.01',
        name: 'Transferência entre Contas',
        type: 'NEUTRO',
        dreGroup: 'Transferência entre Contas',
        active: true,
      },
    })
  } catch {
    // non-fatal
  }
}

seedTransferAccount()
