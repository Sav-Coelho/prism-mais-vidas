import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const { name, cnpj, contactName, email, phone, paymentTermDays, notes, active } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      name: name.trim(),
      cnpj: cnpj?.trim() || null,
      contactName: contactName?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      paymentTermDays: parseInt(paymentTermDays) || 30,
      notes: notes?.trim() || null,
      active: active !== undefined ? Boolean(active) : undefined,
    },
  })
  return NextResponse.json(supplier)
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseInt(params.id)
  const hasOrders = await prisma.purchaseOrder.findFirst({ where: { supplierId: id } })
  if (hasOrders) return NextResponse.json({ error: 'Fornecedor possui pedidos vinculados' }, { status: 409 })
  await prisma.supplier.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
