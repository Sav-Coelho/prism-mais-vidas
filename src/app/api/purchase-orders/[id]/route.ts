import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { supplier: true, unit: true, items: true },
  })
  if (!order) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  return NextResponse.json(order)
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const body = await req.json()

  // Receive action: update received quantities per item
  if (body.action === 'receive') {
    const { receivedItems } = body // [{ itemId, receivedQty }]
    await Promise.all(
      receivedItems.map((ri: { itemId: number; receivedQty: number }) =>
        prisma.purchaseItem.update({
          where: { id: ri.itemId },
          data: { receivedQty: parseFloat(String(ri.receivedQty)) },
        })
      )
    )
    // Check if fully received
    const order = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } })
    const allReceived = order?.items.every(i => i.receivedQty >= i.quantity)
    const anyReceived = order?.items.some(i => i.receivedQty > 0)
    const newStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIAL' : order?.status
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: newStatus,
        receivedDate: allReceived ? new Date() : order?.receivedDate,
      },
      include: { supplier: true, unit: true, items: true },
    })
    return NextResponse.json(updated)
  }

  // Status change
  if (body.status) {
    const updated = await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: body.status,
        receivedDate: body.status === 'RECEIVED' ? new Date() : undefined,
      },
      include: { supplier: true, unit: true, items: true },
    })
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const order = await prisma.purchaseOrder.findUnique({ where: { id } })
  if (order?.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Só é possível excluir pedidos em rascunho' }, { status: 409 })
  }
  await prisma.purchaseItem.deleteMany({ where: { orderId: id } })
  await prisma.purchaseOrder.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
