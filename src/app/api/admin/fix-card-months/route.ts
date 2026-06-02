import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Endpoint de migração temporária — corrige o month/year de lançamentos de cartão
 * já salvos para o mês/ano da fatura informado.
 *
 * POST /api/admin/fix-card-months
 * Body: { month: 5, year: 2026 }
 *
 * REMOVER após uso.
 */
export async function POST(req: NextRequest) {
  const { month, year } = await req.json()

  if (!month || !year) {
    return NextResponse.json({ error: 'Informe month e year' }, { status: 400 })
  }

  const result = await prisma.transaction.updateMany({
    where: {
      OR: [
        { fitid: { startsWith: 'sicoob_' } },
        { fitid: { startsWith: 'csv_' } },
      ],
    },
    data: { month: parseInt(month), year: parseInt(year) },
  })

  return NextResponse.json({ updated: result.count, month, year })
}
