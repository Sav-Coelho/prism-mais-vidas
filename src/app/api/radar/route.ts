import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Resultado da varredura mais recente (ou de uma específica, por ?scanId=).
// Devolve também o histórico, para a tela mostrar a evolução semanal.

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const scanIdParam = searchParams.get('scanId')

  try {
    const historico = await prisma.radarScan.findMany({
      orderBy: { startedAt: 'desc' },
      take: 12,
      select: {
        id: true, startedAt: true, finishedAt: true, status: true, origem: true,
        produtos: true, semConcorrente: true, ofertas: true, criticos: true, erro: true,
      },
    })

    // Última varredura com resultado; se não houver, a mais recente (para expor o erro)
    const alvo = scanIdParam
      ? historico.find(h => h.id === parseInt(scanIdParam)) ?? null
      : historico.find(h => h.status === 'concluido' && h.ofertas > 0)
        ?? historico.find(h => h.ofertas > 0)
        ?? historico[0] ?? null

    if (!alvo) return NextResponse.json({ scan: null, ofertas: [], historico: [] })

    const ofertas = await prisma.radarOffer.findMany({
      where: { scanId: alvo.id },
      orderBy: { divergencia: 'desc' },
    })
    return NextResponse.json({ scan: alvo, ofertas, historico })
  } catch {
    // Tabelas ainda não criadas (deploy sem db push): a tela mostra o aviso
    return NextResponse.json({ scan: null, ofertas: [], historico: [], indisponivel: true })
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = parseInt(searchParams.get('scanId') || '')
  if (!id) return NextResponse.json({ error: 'scanId obrigatório' }, { status: 400 })
  try {
    await prisma.radarScan.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível excluir a varredura' }, { status: 503 })
  }
}
