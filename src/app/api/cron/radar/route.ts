import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

// Disparo semanal do radar (agendado em vercel.json, segundas às 09:00 BRT).
//
// A varredura roda em lotes por causa do teto de tempo da função. Aqui o cron
// encadeia os lotes dentro do seu próprio orçamento; se não der tempo de varrer
// tudo, a varredura fica registrada como parcial e pode ser retomada na tela —
// melhor um resultado parcial e honesto do que a função ser cortada no meio.

const ORCAMENTO_MS = 50_000

export async function GET(req: NextRequest) {
  // A Vercel assina a chamada do cron. Em produção exigimos o segredo para que
  // a rota não possa ser disparada por qualquer um.
  const segredo = process.env.CRON_SECRET
  if (segredo) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${segredo}`) {
      return NextResponse.json({ error: 'não autorizado' }, { status: 401 })
    }
  }

  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(req.url).origin
  const inicio = Date.now()
  let scanId: number | undefined
  let offset = 0
  let concluido = false
  let lotes = 0
  let ultima: any = null

  while (!concluido && Date.now() - inicio < ORCAMENTO_MS && lotes < 20) {
    const res = await fetch(`${base}/api/radar/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId, offset, origem: 'semanal' }),
    })
    ultima = await res.json().catch(() => null)
    if (!res.ok) return NextResponse.json({ ok: false, etapa: 'scan', detalhe: ultima }, { status: res.status })
    scanId = ultima?.scanId ?? scanId
    offset = ultima?.offset ?? offset
    concluido = Boolean(ultima?.concluido)
    lotes++
  }

  return NextResponse.json({ ok: true, scanId, lotes, concluido, parcial: !concluido, resultado: ultima })
}
