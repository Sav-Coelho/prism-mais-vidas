import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const orders = await prisma.purchaseOrder.findMany({
    include: {
      supplier: true,
      unit: true,
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(orders)
}

export async function POST(req: Request) {
  const { supplierId, unitId, expectedDate, notes, items } = await req.json()
  if (!supplierId) return NextResponse.json({ error: 'Fornecedor obrigatório' }, { status: 400 })
  if (!items?.length) return NextResponse.json({ error: 'Adicione ao menos um item' }, { status: 400 })

  const totalAmount = items.reduce(
    (sum: number, i: { quantity: number; unitPrice: number }) => sum + i.quantity * i.unitPrice,
    0
  )

  const d = expectedDate ? new Date(expectedDate) : new Date()
  const order = await prisma.purchaseOrder.create({
    data: {
      supplierId: parseInt(supplierId),
      unitId: unitId ? parseInt(unitId) : null,
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      totalAmount,
      notes: notes?.trim() || null,
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      items: {
        create: items.map((i: { description: string; quantity: number; unitPrice: number; notes?: string }) => ({
          description: i.description.trim(),
          quantity: parseFloat(String(i.quantity)),
          unitPrice: parseFloat(String(i.unitPrice)),
          notes: i.notes?.trim() || null,
        })),
      },
    },
    include: { supplier: true, unit: true, items: true },
  })
  return NextResponse.json(order, { status: 201 })
}
