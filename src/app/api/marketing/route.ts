import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

// Indicadores de Marketing / E-commerce por mês.
// GET  — lista (filtrável por year e unitId)
// POST — upsert de um período (month/year/unitId): cria ou substitui a linha.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const year = searchParams.get('year')
  const unitId = searchParams.get('unitId')

  const where: Record<string, unknown> = {}
  if (year) where.year = parseInt(year)
  if (unitId) where.unitId = parseInt(unitId)

  const metrics = await prisma.marketingMetric.findMany({
    where,
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  })
  return NextResponse.json(metrics)
}

const NUM_FIELDS = [
  'revenueBilled', 'revenueCaptured', 'investment', 'ticket',
  'conversionRate', 'roas', 'cpa', 'approvalRate', 'paidTrafficPct',
] as const
const INT_FIELDS = ['sessions', 'orders'] as const

export async function POST(req: NextRequest) {
  const body = await req.json()
  const month = parseInt(String(body.month))
  const year = parseInt(String(body.year))
  const unitId = body.unitId ? parseInt(String(body.unitId)) : null

  if (!month || month < 1 || month > 12 || !year) {
    return NextResponse.json({ error: 'Mês (1–12) e ano são obrigatórios' }, { status: 400 })
  }

  const num = (v: unknown) => {
    const n = parseFloat(String(v ?? '').replace(',', '.'))
    return isNaN(n) ? 0 : n
  }

  const data: Record<string, number | string | null> = { month, year, unitId }
  NUM_FIELDS.forEach(f => { data[f] = num(body[f]) })
  INT_FIELDS.forEach(f => { data[f] = Math.round(num(body[f])) })
  data.notes = body.notes ? String(body.notes).trim() || null : null

  // Upsert manual por (month, year, unitId) — unitId nullable não permite @@unique confiável.
  const existing = await prisma.marketingMetric.findFirst({ where: { month, year, unitId } })
  const saved = existing
    ? await prisma.marketingMetric.update({ where: { id: existing.id }, data })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : await prisma.marketingMetric.create({ data: data as any })

  return NextResponse.json(saved, { status: existing ? 200 : 201 })
}
