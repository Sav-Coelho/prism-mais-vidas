import { NextRequest, NextResponse } from 'next/server'
import { readSheetMatrix, findCol, parseNumberBR } from '@/lib/spreadsheet'

export const runtime = 'nodejs'

// Lê a planilha de itens da importação — tipicamente a *proforma invoice* do
// fornecedor chinês, que vem em inglês. Não grava nada: devolve as linhas para o
// simulador preencher a tabela. Cabeçalhos aceitos em português e inglês.

const PRODUTO = ['produto', 'descrição', 'descricao', 'description', 'item name', 'mercadoria', 'nome', 'product', 'product name', 'goods', 'item']
const SKU = ['sku', 'código', 'codigo', 'cod', 'referência', 'referencia', 'ref', 'item no', 'item no.', 'model', 'modelo', 'part number', 'art no']
const NCM = ['ncm', 'código ncm', 'codigo ncm', 'classificação fiscal', 'hs code', 'hscode', 'h.s. code', 'hs']
const QTD = ['quantidade', 'qtd', 'qtde', 'qty', 'quantity', 'pcs', 'unidades', 'q.ty']
// Mais específico primeiro: "unit price" antes de "price", para não casar com "sale price"
const FOB = ['preço unitário fob', 'preco unitario fob', 'fob unitário', 'fob unit', 'fob unit price', 'unit price', 'preço unitário', 'preco unitario', 'valor unitário', 'valor unitario', 'unit cost', 'preço fob', 'preco fob', 'fob', 'u/price', 'unitprice']
const TOTAL = ['valor total', 'total amount', 'amount', 'total fob', 'total price', 'total']
const PESO = ['peso unitário', 'peso unitario', 'peso un', 'unit weight', 'net weight', 'n.w.', 'nw', 'g.w.', 'peso', 'weight']
const II = ['ii', 'ii %', 'ii%', 'imposto de importação', 'imposto importacao', 'import duty', 'duty', 'aliquota ii', 'alíquota ii']
const IPI = ['ipi', 'ipi %', 'ipi%', 'aliquota ipi', 'alíquota ipi']
const PVENDA = ['preço de venda', 'preco de venda', 'preço venda', 'preco venda', 'sale price', 'selling price', 'retail price', 'pv']
const CNAC = ['custo nacional', 'custo interno', 'custo de reposição', 'custo de reposicao', 'custo atual', 'preço nacional', 'preco nacional', 'custo brasil']

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  let matrix: string[][]
  try {
    matrix = readSheetMatrix(await file.arrayBuffer(), file.name)
  } catch {
    return NextResponse.json({ error: 'Não foi possível ler a planilha' }, { status: 422 })
  }

  // A proforma costuma ter título e dados do fornecedor antes da tabela. Procura a
  // primeira linha que pareça cabeçalho (tem produto/descrição e quantidade ou preço).
  let hIdx = -1
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    const h = matrix[i]
    if (findCol(h, PRODUTO) >= 0 && (findCol(h, QTD) >= 0 || findCol(h, FOB) >= 0)) { hIdx = i; break }
  }
  if (hIdx < 0) {
    return NextResponse.json({
      error: 'Não achei o cabeçalho da tabela. Precisa ter ao menos uma coluna de produto/descrição e uma de quantidade ou preço unitário.',
      cabecalhos: matrix.slice(0, 6).map(r => r.filter(Boolean).join(' | ')).filter(Boolean),
    }, { status: 422 })
  }

  const headers = matrix[hIdx]
  const c = {
    produto: findCol(headers, PRODUTO), sku: findCol(headers, SKU), ncm: findCol(headers, NCM),
    qtd: findCol(headers, QTD), fob: findCol(headers, FOB), total: findCol(headers, TOTAL),
    peso: findCol(headers, PESO), ii: findCol(headers, II), ipi: findCol(headers, IPI),
    pvenda: findCol(headers, PVENDA), cnac: findCol(headers, CNAC),
  }

  const val = (row: string[], idx: number) => (idx >= 0 ? parseNumberBR(row[idx]) : NaN)
  const itens: any[] = []
  const avisos: string[] = []

  for (let i = hIdx + 1; i < matrix.length; i++) {
    const row = matrix[i]
    const produto = (row[c.produto] || '').trim()
    if (!produto) continue
    // Linha de total no rodapé da proforma
    if (/^(total|subtotal|grand total|sum)\b/i.test(produto)) continue

    const qtd = val(row, c.qtd)
    let fob = val(row, c.fob)
    // Sem preço unitário mas com valor total: deriva o unitário
    if ((isNaN(fob) || fob <= 0) && c.total >= 0 && qtd > 0) {
      const t = val(row, c.total)
      if (!isNaN(t) && t > 0) fob = t / qtd
    }
    if ((isNaN(qtd) || qtd <= 0) && (isNaN(fob) || fob <= 0)) continue
    if (isNaN(qtd) || qtd <= 0) { avisos.push(`Linha ${i + 1}: "${produto.slice(0, 32)}" sem quantidade`); continue }
    if (isNaN(fob) || fob <= 0) { avisos.push(`Linha ${i + 1}: "${produto.slice(0, 32)}" sem preço unitário`); continue }

    const peso = val(row, c.peso)
    const ii = val(row, c.ii)
    const ipi = val(row, c.ipi)
    const pv = val(row, c.pvenda)
    const cn = val(row, c.cnac)

    itens.push({
      produto,
      sku: c.sku >= 0 ? (row[c.sku] || '').trim() || null : null,
      ncm: c.ncm >= 0 ? (row[c.ncm] || '').trim() || '' : '',
      quantidade: qtd,
      precoFobUnit: fob,
      pesoUnitKg: isNaN(peso) ? 0 : peso,
      // Alíquotas em branco ficam nulas para o simulador aplicar o padrão da tela
      iiAliqPct: isNaN(ii) ? null : ii,
      ipiAliqPct: isNaN(ipi) ? null : ipi,
      precoVenda: isNaN(pv) ? 0 : pv,
      custoNacionalAtual: isNaN(cn) ? 0 : cn,
    })
  }

  if (itens.length === 0) {
    return NextResponse.json({
      error: avisos[0] || 'Nenhum item válido encontrado. Cada linha precisa de produto, quantidade e preço unitário.',
      cabecalhosDetectados: headers.filter(Boolean).join(' | '),
    }, { status: 422 })
  }

  return NextResponse.json({
    itens,
    avisos,
    colunasDetectadas: Object.entries(c)
      .filter(([, idx]) => idx >= 0)
      .map(([k, idx]) => `${k} → "${headers[idx]}"`),
    semColuna: Object.entries(c).filter(([, idx]) => idx < 0).map(([k]) => k),
  })
}
