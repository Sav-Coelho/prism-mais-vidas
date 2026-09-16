import { prisma } from '@/lib/prisma'
import { contentKey, flagDuplicates, escopoOrigem } from '@/lib/dedup'
import { NextRequest, NextResponse } from 'next/server'

interface IncomingTx {
  fitid: string
  date: string
  amount: number
  memo: string
  accountId?: string | number | null
  unitId?: string | number | null
  transferToUnitId?: string | number | null
  transferToBankAccountId?: string | number | null
}

interface SaveBody {
  transactions: IncomingTx[]
  bankAccountId?: string | number | null
  ledgerBalance?: { amount: number; date: string | null } | null
  bankInfo?: { bankId: string | null; acctId: string | null; org: string | null } | null
  balanceTransactions?: { date: string; amount: number }[]
  /** Mês/ano da fatura do cartão — quando presente, todos os lançamentos são contabilizados nesse mês */
  invoiceMonth?: number | null
  invoiceYear?: number | null
}

export async function POST(req: NextRequest) {
  const body = await req.json() as SaveBody
  const { transactions, bankAccountId, ledgerBalance, bankInfo, balanceTransactions, invoiceMonth, invoiceYear } = body

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'Nenhuma transação selecionada' }, { status: 400 })
  }

  const bankAccId = bankAccountId ? parseInt(String(bankAccountId)) : null

  const data = transactions.map(tx => {
    const d = new Date(tx.date)
    // Para faturas de cartão: contabiliza no mês da fatura, não na data da compra
    const txMonth = invoiceMonth ?? (d.getMonth() + 1)
    const txYear  = invoiceYear  ?? d.getFullYear()
    return {
      fitid: tx.fitid,
      date: d,
      description: tx.memo,
      memo: tx.memo,
      amount: tx.amount,
      month: txMonth,
      year: txYear,
      accountId: tx.accountId ? parseInt(String(tx.accountId)) : null,
      unitId: tx.unitId ? parseInt(String(tx.unitId)) : null,
      bankAccountId: bankAccId,
      transferToUnitId: tx.transferToUnitId ? parseInt(String(tx.transferToUnitId)) : null,
      transferToBankAccountId: tx.transferToBankAccountId ? parseInt(String(tx.transferToBankAccountId)) : null,
    }
  })

  // ── Rede de proteção contra duplicatas por CONTEÚDO ───────────────────────
  // O FITID do Sicoob embute uma sequência que muda a cada exportação do extrato, e
  // a mesma fatura pode chegar em PDF (sicoob_*), CSV (csv_*) ou OFX (card_*) — três
  // namespaces para a mesma compra. Quem depende da sequência para se distinguir são
  // os itens de valor repetido: parcelas, mensalidades, PIX recorrentes. Comparar
  // data+valor+descrição por multiplicidade impede a dupla contagem sem bloquear dois
  // lançamentos legítimos de mesmo valor no mesmo dia. Ver src/lib/dedup.ts.
  const tempos = data.map(d => d.date.getTime()).filter(t => !isNaN(t))
  let duplicadosPorConteudo = 0
  let aInserir = data

  if (tempos.length > 0) {
    const minDate = new Date(tempos.reduce((a, b) => (b < a ? b : a), tempos[0]))
    const maxDate = new Date(tempos.reduce((a, b) => (b > a ? b : a), tempos[0]))
    minDate.setHours(0, 0, 0, 0)
    maxDate.setHours(23, 59, 59, 999)

    // Fatura de cartão é reconhecida por vir com mês/ano de competência próprios.
    const cardMode = invoiceMonth != null && invoiceYear != null
    const existentes = await prisma.transaction.findMany({
      where: { ...escopoOrigem(cardMode, bankAccId), date: { gte: minDate, lte: maxDate } },
      select: { date: true, amount: true, description: true },
    })

    const jaExiste = flagDuplicates(
      data,
      d => contentKey(d.date, d.amount, d.description),
      existentes.map(e => contentKey(e.date, e.amount, e.description))
    )
    aInserir = data.filter((_, i) => !jaExiste[i])
    duplicadosPorConteudo = data.length - aInserir.length
  }

  const result = aInserir.length > 0
    ? await prisma.transaction.createMany({ data: aInserir, skipDuplicates: true })
    : { count: 0 }
  const imported = result.count
  const skipped = transactions.length - imported

  // ── Contrapartida de transferência ────────────────────────────────────────
  // Só faz sentido criar a entrada espelho para SAÍDAS (amount < 0). Uma entrada
  // classificada como transferência já É o dinheiro chegando — criar contrapartida
  // duplicaria o valor na mesma conta.
  const transferTxs = transactions.filter(tx =>
    tx.transferToBankAccountId && tx.accountId && tx.amount < 0
  )

  let counterpartsCreated = 0
  let counterpartsSkipped = 0

  if (transferTxs.length > 0) {
    // Se o extrato do banco de destino já foi importado, a entrada REAL existe com
    // outro fitid — nesse caso não se cria a espelho, senão o valor entra duas vezes.
    const destIds = Array.from(new Set(
      transferTxs.map(tx => parseInt(String(tx.transferToBankAccountId)))
    ))
    const amounts = transferTxs.map(tx => Math.abs(tx.amount))
    const existingReal = await prisma.transaction.findMany({
      where: { bankAccountId: { in: destIds }, amount: { in: amounts } },
      select: { bankAccountId: true, amount: true, date: true },
    })

    const TOLERANCIA_DIAS = 3
    const jaExisteReal = (tx: IncomingTx) => {
      const destId = parseInt(String(tx.transferToBankAccountId))
      const amt = Math.abs(tx.amount)
      const when = new Date(tx.date).getTime()
      return existingReal.some(r =>
        r.bankAccountId === destId &&
        Math.abs(r.amount - amt) < 0.01 &&
        Math.abs(new Date(r.date).getTime() - when) <= TOLERANCIA_DIAS * 86400000
      )
    }

    const pendentes = transferTxs.filter(tx => !jaExisteReal(tx))
    counterpartsSkipped = transferTxs.length - pendentes.length

    if (pendentes.length > 0) {
      const counterparts = pendentes.map(tx => {
        const d = new Date(tx.date)
        return {
          fitid: tx.fitid + '_entrada',
          date: d,
          description: 'Entrada de Transferência - ' + tx.memo,
          memo: 'Entrada de Transferência - ' + tx.memo,
          amount: Math.abs(tx.amount),
          month: d.getMonth() + 1,
          year: d.getFullYear(),
          accountId: tx.accountId ? parseInt(String(tx.accountId)) : null,
          unitId: tx.transferToUnitId ? parseInt(String(tx.transferToUnitId)) : null,
          bankAccountId: parseInt(String(tx.transferToBankAccountId)),
        }
      })
      const res = await prisma.transaction.createMany({ data: counterparts, skipDuplicates: true })
      counterpartsCreated = res.count
    }
  }

  // Save balance snapshots (daily + ledger) in parallel
  const snapshotOps: Promise<unknown>[] = []

  if (bankAccId && Array.isArray(balanceTransactions)) {
    for (const bt of balanceTransactions) {
      const snapDate = new Date(bt.date)
      snapDate.setHours(0, 0, 0, 0)
      snapshotOps.push(
        prisma.balanceSnapshot.upsert({
          where: { bankAccountId_date: { bankAccountId: bankAccId, date: snapDate } },
          update: { balance: bt.amount },
          create: { bankAccountId: bankAccId, date: snapDate, balance: bt.amount },
        }).catch(() => {})
      )
    }
  }

  if (bankAccId && ledgerBalance?.amount != null && ledgerBalance.date) {
    const snapDate = new Date(ledgerBalance.date)
    snapDate.setHours(0, 0, 0, 0)
    snapshotOps.push(
      prisma.balanceSnapshot.upsert({
        where: { bankAccountId_date: { bankAccountId: bankAccId, date: snapDate } },
        update: { balance: ledgerBalance.amount },
        create: { bankAccountId: bankAccId, date: snapDate, balance: ledgerBalance.amount },
      }).catch(() => {})
    )
  }

  // Link OFX identifiers and save snapshots in parallel
  const bankIdentifier = bankInfo?.bankId || bankInfo?.org
  const linkOp = bankAccId && bankIdentifier && bankInfo?.acctId
    ? prisma.bankAccount.findUnique({ where: { id: bankAccId } }).then(acc => {
        if (acc && !acc.ofxBankId) {
          return prisma.bankAccount.update({
            where: { id: bankAccId },
            data: { ofxBankId: bankIdentifier, ofxAcctId: bankInfo!.acctId! },
          })
        }
      }).catch(() => {})
    : Promise.resolve()

  await Promise.all([...snapshotOps, linkOp])

  return NextResponse.json({ imported, skipped, duplicadosPorConteudo, counterpartsCreated, counterpartsSkipped })
}
