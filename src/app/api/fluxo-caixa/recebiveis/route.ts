import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { NextRequest, NextResponse } from 'next/server'
import { readSheetMatrix, parseNumberBR } from '@/lib/spreadsheet'

export const runtime = 'nodejs'
export const maxDuration = 60

// Importa o relatório "Vendas a receber" do Mercado Pago (Seu negócio → Relatórios
// → Vendas). É dele que o Fluxo de Caixa tira a data REAL em que cada venda vira
// dinheiro disponível — o Mercado Livre só libera depois da entrega.
//
// As colunas trazem o nome técnico entre parênteses — "Data de liberação do
// dinheiro (date_released)" — e a leitura se orienta por ele: o texto em português
// muda entre versões do relatório, o nome técnico não.
//
// Reenviar um relatório que se sobrepõe ao anterior não duplica nada: a chave é o
// número da transação, e o status mais recente (aprovada → reembolsada) prevalece.

const COLUNAS: Record<string, { tecnico: string; nomes: string[]; obrigatoria: boolean }> = {
  id: { tecnico: 'operation_id', nomes: ['número da transação do mercado pago'], obrigatoria: true },
  compra: { tecnico: 'date_created', nomes: ['data da compra'], obrigatoria: true },
  liberacao: { tecnico: 'date_released', nomes: ['data de liberação do dinheiro'], obrigatoria: true },
  status: { tecnico: 'status', nomes: ['status da operação'], obrigatoria: true },
  liquido: { tecnico: 'net_received_amount', nomes: ['valor total recebido'], obrigatoria: true },
  bruto: { tecnico: 'transaction_amount', nomes: ['valor do produto'], obrigatoria: false },
  sku: { tecnico: 'seller_custom_field', nomes: ['sku do produto'], obrigatoria: false },
  pedido: { tecnico: 'order_id', nomes: ['número da venda no mercado livre'], obrigatoria: false },
}

const nomeTecnico = (h: string) => {
  const m = String(h || '').match(/\(([^()]+)\)\s*$/)
  return m ? m[1].trim().toLowerCase() : ''
}
const semTecnico = (h: string) => String(h || '').toLowerCase().replace(/\s*\([^()]*\)\s*$/, '').trim()

function acharColuna(cab: string[], tecnico: string, nomes: string[]): number {
  const t = cab.map(nomeTecnico).indexOf(tecnico)
  if (t >= 0) return t
  const pt = cab.map(semTecnico)
  for (let i = 0; i < nomes.length; i++) {
    const k = pt.indexOf(nomes[i])
    if (k >= 0) return k
  }
  return -1
}

/** "26/10/2026 12:09:37", "2026-10-26T…" ou número de série do Excel → AAAA-MM-DD. */
function dia(valor: string): string | null {
  const t = String(valor || '').trim()
  if (!t) return null
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  if (/^\d+(\.\d+)?$/.test(t) && Number(t) > 20000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000).toISOString().slice(0, 10)
  }
  return null
}

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  let matriz: string[][]
  try {
    matriz = readSheetMatrix(await file.arrayBuffer(), file.name)
  } catch {
    return NextResponse.json({ error: 'Não foi possível ler a planilha' }, { status: 422 })
  }

  // O cabeçalho pode vir depois de linhas de título, conforme a exportação.
  const linhaCab = matriz.slice(0, 15).findIndex(l => l.some(c => nomeTecnico(c) === 'date_created' || semTecnico(c) === 'data da compra'))
  if (linhaCab < 0) {
    return NextResponse.json({
      error: 'Isso não parece o relatório "Vendas a receber" do Mercado Pago — não achei a coluna "Data da compra (date_created)".',
    }, { status: 422 })
  }
  const cab = matriz[linhaCab]
  const col: Record<string, number> = {}
  const faltando: string[] = []
  Object.keys(COLUNAS).forEach(k => {
    const c = COLUNAS[k]
    col[k] = acharColuna(cab, c.tecnico, c.nomes)
    if (col[k] < 0 && c.obrigatoria) faltando.push(`${c.nomes[0]} (${c.tecnico})`)
  })
  if (faltando.length) {
    return NextResponse.json({ error: `Faltam colunas no relatório: ${faltando.join(', ')}` }, { status: 422 })
  }

  const porId = new Map<string, {
    id: string; compra: string; liberacao: string | null; status: string
    bruto: number; liquido: number; sku: string | null; pedido: string | null
  }>()
  let ignoradas = 0
  matriz.slice(linhaCab + 1).forEach(l => {
    const id = String(l[col.id] || '').trim()
    const compra = dia(l[col.compra])
    const liquido = parseNumberBR(l[col.liquido])
    if (!id || !compra || isNaN(liquido)) { ignoradas++; return }
    const bruto = col.bruto >= 0 ? parseNumberBR(l[col.bruto]) : NaN
    porId.set(id, {
      id, compra,
      liberacao: dia(l[col.liberacao]),
      status: String(l[col.status] || '').trim().toLowerCase(),
      bruto: isNaN(bruto) ? 0 : bruto,
      liquido,
      sku: col.sku >= 0 ? String(l[col.sku] || '').trim() || null : null,
      pedido: col.pedido >= 0 ? String(l[col.pedido] || '').trim() || null : null,
    })
  })
  const registros = Array.from(porId.values())
  if (!registros.length) {
    return NextResponse.json({ error: 'Nenhuma venda reconhecida no arquivo.' }, { status: 422 })
  }

  // Apaga e recria só os ids do arquivo, em lotes: o Postgres aceita no máximo
  // 65.535 parâmetros por consulta, e um relatório de vários meses passaria disso.
  const LOTE = 2000
  const operacoes: Prisma.PrismaPromise<unknown>[] = []
  for (let i = 0; i < registros.length; i += LOTE) {
    const lote = registros.slice(i, i + LOTE)
    operacoes.push(prisma.recebivelML.deleteMany({ where: { id: { in: lote.map(r => r.id) } } }))
    operacoes.push(prisma.recebivelML.createMany({ data: lote }))
  }
  try {
    await prisma.$transaction(operacoes)
  } catch (e: any) {
    return NextResponse.json({ error: `Não foi possível gravar: ${String(e?.message || e).slice(0, 200)}` }, { status: 500 })
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const aprovadas = registros.filter(r => r.status === 'approved')
  const compras = registros.map(r => r.compra).sort()
  return NextResponse.json({
    importadas: registros.length,
    aprovadas: aprovadas.length,
    ignoradas,
    de: compras[0],
    ate: compras[compras.length - 1],
    aLiberar: aprovadas.filter(r => r.liberacao && r.liberacao > hoje).reduce((a, r) => a + r.liquido, 0),
  })
}
