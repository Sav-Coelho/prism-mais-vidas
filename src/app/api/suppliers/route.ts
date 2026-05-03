import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const suppliers = await prisma.supplier.findMany({
    include: {
      purchaseOrders: {
        select: {
          id: true, status: true, totalAmount: true,
          createdAt: true, receivedDate: true, expectedDate: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(suppliers)
}

export async function POST(req: Request) {
  const { name, cnpj, contactName, email, phone, paymentTermDays, notes } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Nome obrigatório' }, { status: 400 })
  const supplier = await prisma.supplier.create({
    data: {
      name: name.trim(),
      cnpj: cnpj?.trim() || null,
      contactName: contactName?.trim() || null,
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      paymentTermDays: parseInt(paymentTermDays) || 30,
      notes: notes?.trim() || null,
    },
  })
  return NextResponse.json(supplier, { status: 201 })
}
