/**
 * Curva ABC (classificação de Pareto) e indicadores de estoque.
 *
 * Curva ABC: itens ordenados por valor decrescente; classe pela % acumulada.
 *   A = até 80% acumulado · B = até 95% · C = restante.
 *
 * Estoque (cruzando com o CMV da DRE):
 *   Giro       = CMV / Estoque médio (a custo)            → vezes no período
 *   Cobertura  = Estoque médio / (CMV / dias do período)  → dias
 *   GMROI      = Margem Bruta / Estoque médio (a custo)   → R$ de margem por R$ investido
 */

export type ABCClass = 'A' | 'B' | 'C'

export interface ABCItem {
  key: string
  label: string
  value: number
  sublabel?: string
  quantity?: number
}

export interface ABCRow extends ABCItem {
  rank: number
  pct: number       // participação individual (% do total)
  cumPct: number    // participação acumulada
  class: ABCClass
}

export interface ABCSummary {
  total: number
  count: number
  byClass: Record<ABCClass, { count: number; value: number; valuePct: number }>
}

export function calcABC(items: ABCItem[]): { rows: ABCRow[]; summary: ABCSummary } {
  const sorted = items
    .filter(i => i.value > 0)
    .sort((a, b) => b.value - a.value)
  const total = sorted.reduce((s, i) => s + i.value, 0)

  let cum = 0
  const rows: ABCRow[] = sorted.map((it, i) => {
    cum += it.value
    const cumPct = total > 0 ? (cum / total) * 100 : 0
    const cls: ABCClass = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C'
    return {
      ...it,
      rank: i + 1,
      pct: total > 0 ? (it.value / total) * 100 : 0,
      cumPct,
      class: cls,
    }
  })

  const byClass: Record<ABCClass, { count: number; value: number; valuePct: number }> = {
    A: { count: 0, value: 0, valuePct: 0 },
    B: { count: 0, value: 0, valuePct: 0 },
    C: { count: 0, value: 0, valuePct: 0 },
  }
  rows.forEach(r => {
    byClass[r.class].count++
    byClass[r.class].value += r.value
  })
  ;(['A', 'B', 'C'] as ABCClass[]).forEach(c => {
    byClass[c].valuePct = total > 0 ? (byClass[c].value / total) * 100 : 0
  })

  return { rows, summary: { total, count: rows.length, byClass } }
}

export interface StockMetrics {
  estoqueValor: number   // valor do estoque a custo (qtd × custo unitário)
  cmv: number            // custo da mercadoria vendida no período (da DRE)
  margemBruta: number    // receita líquida − CMV (da DRE)
  giro: number | null    // vezes no período
  coberturaDias: number | null
  gmroi: number | null
}

export function calcStockMetrics(
  estoqueValor: number,
  cmv: number,
  margemBruta: number,
  diasPeriodo = 30
): StockMetrics {
  const giro = estoqueValor > 0 ? cmv / estoqueValor : null
  const coberturaDias = cmv > 0 ? (estoqueValor * diasPeriodo) / cmv : null
  const gmroi = estoqueValor > 0 ? margemBruta / estoqueValor : null
  return { estoqueValor, cmv, margemBruta, giro, coberturaDias, gmroi }
}

// Classe ABC é ORDINAL (A > B > C): rampa de um só matiz (azul da marca), do mais
// escuro ao mais claro. Verde/âmbar/vermelho ficam reservados para ESTADO (situação
// do estoque), para que classe e situação nunca disputem a mesma cor na tela.
export const ABC_COLOR: Record<ABCClass, string> = {
  A: '#2b3272',
  B: '#5762a8',
  C: '#9aa2d8',
}

// ─── Situação do estoque: Quebra · Normal · Excesso ──────────────────────────
// Cruza inventário × vendas do mês SKU a SKU (chave = código; sem código, nome).
//   cobertura (dias) = estoque ÷ (vendas ÷ dias do mês)
//   Quebra  = cobertura < mínimo, ou vendeu e não há estoque no inventário
//   Normal  = mínimo ≤ cobertura ≤ máximo
//   Excesso = cobertura > máximo, ou em estoque sem nenhuma venda no mês (parado)

export type StockStatus = 'quebra' | 'normal' | 'excesso'

export const STOCK_STATUS_ORDER: StockStatus[] = ['quebra', 'normal', 'excesso']

// Cores de status (fixas, nunca reutilizadas como série) — sempre com ícone + rótulo.
export const STOCK_STATUS_META: Record<StockStatus, { label: string; icon: string; color: string; action: string; hint: string }> = {
  quebra:  { label: 'Quebra',  icon: '▼', color: '#d03b3b', action: 'Repor com urgência',        hint: 'abaixo do mínimo de cobertura ou sem estoque' },
  normal:  { label: 'Normal',  icon: '●', color: '#1a7a4a', action: 'Manter',                    hint: 'cobertura dentro da faixa' },
  excesso: { label: 'Excesso', icon: '▲', color: '#ec835a', action: 'Reduzir compra / promover', hint: 'acima do máximo de cobertura ou sem venda no mês' },
}

export interface StockRowInput { product: string; sku?: string | null; category?: string | null; quantity?: number; unitCost?: number }
export interface SalesRowInput { product: string; sku?: string | null; quantity?: number }

export interface StockStatusItem {
  key: string
  label: string
  sku: string | null
  category: string | null
  abcClass: ABCClass | null   // classe na ABC de vendas do mês (por quantidade); null = não vendeu
  estoque: number             // unidades em estoque
  custo: number               // custo unitário médio
  valor: number               // estoque a custo (R$)
  vendas: number              // unidades vendidas no mês
  cobertura: number | null    // dias; null = sem venda (cobertura infinita)
  status: StockStatus
  parado: boolean             // em estoque e sem venda no mês
}

export interface StockStatusOptions { diasMes: number; minDias: number; maxDias: number }

const joinKey = (r: { sku?: string | null; product: string }) =>
  String(r.sku || '').trim() || String(r.product || '').toLowerCase().trim()

export function classifyStock(stock: StockRowInput[], sales: SalesRowInput[], opts: StockStatusOptions): StockStatusItem[] {
  const salesMap = new Map<string, { label: string; sku: string | null; qty: number }>()
  sales.forEach(r => {
    const k = joinKey(r)
    if (!k) return
    const ex = salesMap.get(k)
    if (ex) ex.qty += r.quantity || 0
    else salesMap.set(k, { label: r.product, sku: r.sku || null, qty: r.quantity || 0 })
  })

  // Classe ABC de vendas por quantidade — a mesma da aba Vendas
  const abc = calcABC(Array.from(salesMap.entries()).map(([k, v]) => ({ key: k, label: v.label, value: v.qty })))
  const classOf = new Map<string, ABCClass>()
  abc.rows.forEach(r => classOf.set(r.key, r.class))

  const stockMap = new Map<string, { label: string; sku: string | null; category: string | null; qtd: number; valor: number }>()
  stock.forEach(r => {
    const k = joinKey(r)
    if (!k) return
    const q = r.quantity || 0
    const c = r.unitCost || 0
    const ex = stockMap.get(k)
    if (ex) { ex.qtd += q; ex.valor += q * c }
    else stockMap.set(k, { label: r.product, sku: r.sku || null, category: r.category || null, qtd: q, valor: q * c })
  })

  const out: StockStatusItem[] = []
  Array.from(stockMap.entries()).forEach(([k, s]) => {
    if (s.qtd <= 0) return
    const v = salesMap.get(k)?.qty || 0
    const cob = v > 0 ? s.qtd / (v / opts.diasMes) : null
    const status: StockStatus =
      cob == null ? 'excesso' : cob < opts.minDias ? 'quebra' : cob > opts.maxDias ? 'excesso' : 'normal'
    out.push({
      key: k, label: s.label, sku: s.sku, category: s.category,
      abcClass: classOf.get(k) ?? null,
      estoque: s.qtd, custo: s.valor / s.qtd, valor: s.valor,
      vendas: v, cobertura: cob, status, parado: v === 0,
    })
  })

  // Vendeu no mês mas não há estoque no inventário → ruptura total
  Array.from(salesMap.entries()).forEach(([k, v]) => {
    const st = stockMap.get(k)
    if (v.qty > 0 && !(st && st.qtd > 0)) {
      out.push({
        key: k, label: v.label, sku: v.sku, category: null,
        abcClass: classOf.get(k) ?? null,
        estoque: 0, custo: 0, valor: 0, vendas: v.qty, cobertura: 0, status: 'quebra', parado: false,
      })
    }
  })

  return out
}
