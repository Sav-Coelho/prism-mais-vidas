import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { PREFIXOS_CARTAO } from '@/lib/dedup'
import {
  montarEntrada, CATEGORIAS_SAIDA,
  type CategoriaSaida, type ContaBancaria, type LancamentoHist, type Recebivel,
} from '@/lib/fluxo-caixa'

export const runtime = 'nodejs'
// Sem isto o Next 14 trata um GET que não lê a requisição como estático e serve o
// fluxo calculado no build — o saldo ficaria congelado no dia do deploy.
export const dynamic = 'force-dynamic'

// Junta o que o motor (src/lib/fluxo-caixa.ts) precisa: saldo dos bancos numa data
// comum, o histórico classificado e os recebíveis do Mercado Livre. As contas ficam
// todas no motor; aqui só se lê o banco de dados e se traduz o formato.

const CHAVE_PARAMETROS = 'fluxo_caixa_parametros'

const ehCartao = (fitid: string | null) => PREFIXOS_CARTAO.some(p => String(fitid || '').startsWith(p))
const dia = (d: Date) => d.toISOString().slice(0, 10)

/** Parâmetros guardados. `aplicacao: null` = usar a estimativa feita pelos lançamentos. */
interface ParametrosSalvos {
  ajusteVendas: number
  saldoMercadoPago: number
  aplicacao: number | null
  mensal: Partial<Record<CategoriaSaida, number>>
}

function sanear(bruto: any): ParametrosSalvos {
  const num = (v: any, min: number, max: number, padrao: number) => {
    const n = Number(v)
    return isFinite(n) ? Math.min(Math.max(n, min), max) : padrao
  }
  const mensal: Partial<Record<CategoriaSaida, number>> = {}
  CATEGORIAS_SAIDA.forEach(c => {
    const v = bruto?.mensal?.[c.chave]
    if (v !== null && v !== undefined && v !== '' && isFinite(Number(v)) && Number(v) >= 0) mensal[c.chave] = Number(v)
  })
  const ap = bruto?.aplicacao
  return {
    ajusteVendas: num(bruto?.ajusteVendas, -0.9, 3, 0),
    saldoMercadoPago: num(bruto?.saldoMercadoPago, 0, 1e9, 0),
    aplicacao: ap === null || ap === undefined || ap === '' ? null : num(ap, 0, 1e9, 0),
    mensal,
  }
}

export async function GET() {
  const [contasDb, lancDb, cfg] = await Promise.all([
    prisma.bankAccount.findMany({
      include: { balanceSnapshots: { orderBy: { date: 'asc' }, select: { date: true, balance: true } } },
      orderBy: { id: 'asc' },
    }),
    prisma.transaction.findMany({
      select: {
        date: true, month: true, year: true, amount: true, fitid: true, bankAccountId: true,
        account: { select: { name: true, dreGroup: true } },
      },
    }),
    prisma.setting.findUnique({ where: { key: CHAVE_PARAMETROS } }).catch(() => null),
  ])

  // A tabela de recebíveis nasce com este deploy; se o `prisma db push` do build não
  // tiver rodado (Neon dormindo), o fluxo segue com a média dos depósitos e avisa.
  let recebiveis: Recebivel[] = []
  let recebiveisIndisponivel = false
  try {
    const rs = await prisma.recebivelML.findMany({ select: { compra: true, liberacao: true, liquido: true, status: true } })
    recebiveis = rs.map(r => ({ compra: r.compra, liberacao: r.liberacao, liquido: r.liquido, aprovado: r.status === 'approved' }))
  } catch {
    recebiveisIndisponivel = true
  }

  // ── Saldo de cada conta na data comum ──
  // A data comum é a do extrato que termina primeiro: somar o Itaú de hoje com o
  // Sicoob de três dias atrás daria um saldo que nunca existiu.
  const base = contasDb.map(c => {
    const proprios = lancDb.filter(l => l.bankAccountId === c.id && !ehCartao(l.fitid))
    const datasTx = proprios.map(l => dia(l.date)).sort()
    const snaps = c.balanceSnapshots.map(s => ({ data: dia(s.date), saldo: s.balance }))
    return { c, proprios, datasTx, snaps }
  })
  const fins = base
    .map(b => (b.snaps.length ? b.snaps[b.snaps.length - 1].data : b.datasTx[b.datasTx.length - 1]))
    .filter((d): d is string => !!d)
    .sort()
  const dataComum = fins.length ? fins[0] : new Date().toISOString().slice(0, 10)

  const contas: ContaBancaria[] = base.map(b => {
    const antes = b.snaps.filter(s => s.data <= dataComum)
    // Sem foto de saldo, reconstrói pelo saldo inicial + lançamentos até a data.
    const saldo = antes.length
      ? antes[antes.length - 1].saldo
      : b.c.initialBalance + b.proprios.filter(l => dia(l.date) <= dataComum).reduce((a, l) => a + l.amount, 0)
    const fimSnap = b.snaps.length ? b.snaps[b.snaps.length - 1].data : null
    const fimTx = b.datasTx.length ? b.datasTx[b.datasTx.length - 1] : null
    const ate = [fimSnap, fimTx].filter((d): d is string => !!d).sort().pop() || null
    return { nome: b.c.name, saldo, data: dataComum, coberturaDe: b.datasTx[0] || null, coberturaAte: ate }
  })

  const lancamentos: LancamentoHist[] = lancDb.map(l => ({
    data: dia(l.date), ano: l.year, mes: l.month, valor: l.amount,
    grupo: l.account ? l.account.dreGroup : null,
    conta: l.account ? l.account.name : null,
  }))

  const { entrada, meta } = montarEntrada({ contas, lancamentos, recebiveis })

  // Lançamento sem classificação não entra em categoria nenhuma — some do fluxo
  // sem aviso. Conta-se nos meses que formam as premissas para a tela alertar.
  const mesesBase = new Set(meta.mesesBase.map(m => `${m.ano}-${m.mes}`))
  const soltos = lancamentos.filter(l => mesesBase.has(`${l.ano}-${l.mes}`) && !l.grupo)
  const naoClassificados = { quantidade: soltos.length, valor: soltos.reduce((a, l) => a + l.valor, 0) }

  let parametros = sanear({})
  if (cfg?.value) {
    try { parametros = sanear(JSON.parse(cfg.value)) } catch { /* parâmetro corrompido volta ao padrão */ }
  }

  return NextResponse.json({ entrada, meta, parametros, avisos: { naoClassificados, recebiveisIndisponivel } })
}

export async function PUT(req: NextRequest) {
  const corpo = await req.json().catch(() => null)
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  const parametros = sanear(corpo)
  await prisma.setting.upsert({
    where: { key: CHAVE_PARAMETROS },
    update: { value: JSON.stringify(parametros) },
    create: { key: CHAVE_PARAMETROS, value: JSON.stringify(parametros) },
  })
  return NextResponse.json({ parametros })
}
