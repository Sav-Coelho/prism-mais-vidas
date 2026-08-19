import { prisma } from '@/lib/prisma'
import { parseOFX } from '@/lib/ofx-parser'
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

  const transactions = parsed.map(tx => {
    const fitid = mkFitid(tx.fitid)
    return {
      fitid,
      date: tx.date.toISOString(),
      amount: tx.amount,
      memo: tx.memo,
      alreadyImported: existingSet.has(fitid),
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
