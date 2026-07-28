import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { readSheetMatrix, findCol, parseNumberBR } from '@/lib/spreadsheet'

export const runtime = 'nodejs'

// Despesas fixas projetadas (contas a pagar futuras) — base do Fluxo de Caixa Projetado.
// Aceita dois layouts de planilha:
//   LARGO: Descrição | Categoria | Ago | Set | Out | Nov | Dez   (uma coluna por mês)
//   LONGO: Mês | Descrição | Valor                                (uma linha por mês/despesa)
// Re-upload substitui apenas os meses presentes no arquivo (não apaga os demais).

const DESC_NAMES = ['descrição', 'descricao', 'despesa', 'conta', 'item', 'histórico', 'historico', 'nome', 'rubrica']
const CATEGORY_NAMES = ['categoria', 'grupo', 'tipo', 'classificação', 'classificacao', 'natureza']
const VALUE_NAMES = ['valor', 'total', 'montante', 'valor (r$)', 'valor r$', 'previsto', 'vlr']
const MONTH_COL_NAMES = ['mês', 'mes', 'período', 'periodo', 'competência', 'competencia', 'data', 'vencimento']

const MONTH_TOKENS: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4,
  mai: 5, maio: 5, jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8,
  set: 9, sep: 9, setembro: 9, out: 10, outubro: 10, nov: 11, novembro: 11,
  dez: 12, dezembro: 12,
}

function deaccent(s: string): string {
  return s
    .replace(/[àáâãä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/ç/g, 'c')
}

/** Reconhece "Ago", "ago/26", "Agosto/2026", "08/2026", "2026-08". */
function parseMonthLabel(raw: string): { month: number; year: number | null } | null {
  const s = deaccent(String(raw || '').trim().toLowerCase())
  if (!s) return null

  let m = s.match(/^(\d{4})[-/](\d{1,2})$/)
  if (m && +m[2] >= 1 && +m[2] <= 12) return { month: +m[2], year: +m[1] }

  m = s.match(/^(\d{1,2})[-/](\d{2,4})$/)
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    let y = +m[2]
    if (y < 100) y += 2000
    return { month: +m[1], year: y }
  }

  m = s.match(/^([a-z]+)\.?\s*[-/]?\s*(\d{2,4})?$/)
  if (m) {
    const mo = MONTH_TOKENS[m[1]]
    if (mo) {
      let y: number | null = m[2] ? +m[2] : null
      if (y != null && y < 100) y += 2000
      return { month: mo, year: y }
    }
  }
  return null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const year = searchParams.get('year')
  const unitId = searchParams.get('unitId')

  const where: Record<string, unknown> = {}
  if (year) where.year = parseInt(year)
  if (unitId) where.unitId = parseInt(unitId)

  const expenses = await prisma.fixedExpense.findMany({
    where,
    orderBy: [{ year: 'asc' }, { month: 'asc' }, { amount: 'desc' }],
  })
  return NextResponse.json(expenses)
}

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const fallbackYear = parseInt(String(formData.get('year') || '')) || new Date().getFullYear()
  const unitRaw = formData.get('unitId')
  const unitId = unitRaw ? parseInt(String(unitRaw)) : null

  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  let matrix: string[][]
  try {
    matrix = readSheetMatrix(await file.arrayBuffer(), file.name)
  } catch {
    return NextResponse.json({ error: 'Não foi possível ler a planilha' }, { status: 422 })
  }
  if (matrix.length < 2) {
    return NextResponse.json({ error: 'Planilha vazia ou sem dados' }, { status: 422 })
  }

  const headers = matrix[0]
  const cDesc = findCol(headers, DESC_NAMES)
  const cCategory = findCol(headers, CATEGORY_NAMES)

  // Colunas cujo cabeçalho é um mês → layout LARGO
  const monthCols: { idx: number; month: number; year: number }[] = []
  headers.forEach((h, i) => {
    if (i === cDesc || i === cCategory) return
    const p = parseMonthLabel(h)
    if (p) monthCols.push({ idx: i, month: p.month, year: p.year ?? fallbackYear })
  })

  const records: {
    description: string; category: string | null; amount: number
    unitId: number | null; month: number; year: number
  }[] = []
  const warnings: string[] = []
  const descIdx = cDesc >= 0 ? cDesc : 0

  if (monthCols.length >= 2) {
    // ── LAYOUT LARGO ──
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i]
      const description = (row[descIdx] || '').trim()
      if (!description) continue
      // ignora linhas de totalização
      if (/^(total|soma|subtotal)\b/i.test(description)) continue
      const category = cCategory >= 0 ? (row[cCategory] || '').trim() || null : null
      monthCols.forEach(mc => {
        const v = parseNumberBR(row[mc.idx])
        if (isNaN(v) || v === 0) return
        records.push({
          description, category, amount: Math.abs(v),
          unitId, month: mc.month, year: mc.year,
        })
      })
    }
  } else {
    // ── LAYOUT LONGO ──
    const cMonth = findCol(headers, MONTH_COL_NAMES)
    const cValue = findCol(headers, VALUE_NAMES)
    if (cMonth < 0 || cValue < 0) {
      return NextResponse.json({
        error: `Não identifiquei o layout da planilha. Esperado colunas de mês (ex: Ago, Set...) ou as colunas "Mês" e "Valor". Cabeçalhos encontrados: ${headers.join(', ')}`,
      }, { status: 422 })
    }
    for (let i = 1; i < matrix.length; i++) {
      const row = matrix[i]
      const description = (row[descIdx] || '').trim()
      if (!description || /^(total|soma|subtotal)\b/i.test(description)) continue
      const p = parseMonthLabel(row[cMonth])
      if (!p) { warnings.push(`Linha ${i + 1}: mês inválido "${row[cMonth]}"`); continue }
      const v = parseNumberBR(row[cValue])
      if (isNaN(v) || v === 0) { warnings.push(`Linha ${i + 1}: valor inválido "${row[cValue]}"`); continue }
      records.push({
        description,
        category: cCategory >= 0 ? (row[cCategory] || '').trim() || null : null,
        amount: Math.abs(v),
        unitId, month: p.month, year: p.year ?? fallbackYear,
      })
    }
  }

  if (records.length === 0) {
    return NextResponse.json({
      error: warnings[0] || 'Nenhuma despesa válida encontrada na planilha',
    }, { status: 422 })
  }

  // Substitui apenas os períodos presentes no arquivo
  const periodKeys: string[] = []
  records.forEach(r => {
    const k = `${r.year}-${r.month}`
    if (periodKeys.indexOf(k) < 0) periodKeys.push(k)
  })
  const periods = periodKeys.map(k => {
    const parts = k.split('-')
    return { year: parseInt(parts[0]), month: parseInt(parts[1]) }
  })

  await prisma.$transaction([
    prisma.fixedExpense.deleteMany({ where: { unitId, OR: periods } }),
    prisma.fixedExpense.createMany({ data: records }),
  ])

  const total = records.reduce((a, r) => a + r.amount, 0)
  return NextResponse.json({
    imported: records.length,
    periodos: periods.sort((a, b) => (a.year * 100 + a.month) - (b.year * 100 + b.month)),
    total,
    layout: monthCols.length >= 2 ? 'largo' : 'longo',
    warnings,
  })
}
