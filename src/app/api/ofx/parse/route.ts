import { prisma } from '@/lib/prisma'
import { parseOFX } from '@/lib/ofx-parser'
import { contentKey, flagDuplicates } from '@/lib/dedup'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  // Modo fatura de cartão: OFX <CREDITCARDMSGSRSV1>. Prefixa fitid com "card_" para
  // identificar como cartão (badge/filtro) e NÃO tenta casar conta bancária — a
  // competência dos lançamentos é definida pelo mês/ano da página (invoiceMonth).
  const cardMode = String(formData.get('card') || '') === 'true'

  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const text = await file.text()
  const { transactions: parsed, bankInfo, ledgerBalance } = parseOFX(text)

  if (parsed.length === 0) {
    return NextResponse.json({ error: 'Nenhuma transação encontrada no arquivo OFX' }, { status: 422 })
  }

  const mkFitid = (f: string) => (cardMode ? `card_${f}` : f)

  // Detect bank account first so fitid check can be scoped to the same account
  let matchedBankAccount: { id: number; name: string; unitId: number; unitName: string } | null = null
  const acctId = bankInfo.acctId
  if (acctId && !cardMode) {
    const candidates = [bankInfo.bankId, bankInfo.org].filter(Boolean) as string[]
    for (const identifier of candidates) {
      const found = await prisma.bankAccount.findFirst({
        where: { ofxBankId: identifier, ofxAcctId: acctId },
        include: { unit: { select: { id: true, name: true } } }
      })
      if (found) {
        matchedBankAccount = {
          id: found.id,
          name: found.name,
          unitId: found.unitId,
          unitName: found.unit.name,
        }
        break
      }
    }
  }

  // Scope duplicate check to the matched bank account to avoid false positives across different banks
  const fitids = parsed.map(tx => mkFitid(tx.fitid)).filter(Boolean) as string[]
  const existing = await prisma.transaction.findMany({
    where: {
      fitid: { in: fitids },
      ...(matchedBankAccount ? { bankAccountId: matchedBankAccount.id } : {}),
    },
    select: { fitid: true }
  })
  const existingSet = new Set(existing.map(e => e.fitid))

  // Além do FITID, confere por CONTEÚDO (data + valor + descrição): o FITID do Sicoob
  // muda de uma exportação para outra e a mesma fatura pode vir em PDF/CSV/OFX. Sem
  // isso a prévia diria "novo" para algo que já está lançado — o caso das parcelas e
  // dos lançamentos recorrentes de mesmo valor. Ver src/lib/dedup.ts.
  const tempos = parsed.map(tx => tx.date.getTime()).filter(t => !isNaN(t))
  let jaLancado: boolean[] = parsed.map(() => false)
  if (tempos.length > 0) {
    const minDate = new Date(tempos.reduce((a, b) => (b < a ? b : a), tempos[0]))
    const maxDate = new Date(tempos.reduce((a, b) => (b > a ? b : a), tempos[0]))
    minDate.setHours(0, 0, 0, 0)
    maxDate.setHours(23, 59, 59, 999)
    const noPeriodo = await prisma.transaction.findMany({
      where: {
        bankAccountId: matchedBankAccount ? matchedBankAccount.id : null,
        date: { gte: minDate, lte: maxDate },
      },
      select: { date: true, amount: true, description: true },
    })
    jaLancado = flagDuplicates(
      parsed,
      tx => contentKey(tx.date, tx.amount, tx.memo),
      noPeriodo.map(e => contentKey(e.date, e.amount, e.description))
    )
  }

  const transactions = parsed.map((tx, i) => {
    const fitid = mkFitid(tx.fitid)
    return {
      fitid,
      date: tx.date.toISOString(),
      amount: tx.amount,
      memo: tx.memo,
      alreadyImported: existingSet.has(fitid) || jaLancado[i],
      isBalance: tx.isBalance,
    }
  })

  return NextResponse.json({
    transactions,
    bankInfo,
    // Cartão: o LEDGERBAL é o saldo da fatura, não vira snapshot de conta bancária
    ledgerBalance: cardMode || !ledgerBalance
      ? null
      : { amount: ledgerBalance.amount, date: ledgerBalance.date?.toISOString() ?? null },
    matchedBankAccount,
    isCreditCard: cardMode || bankInfo.isCreditCard,
  })
}
