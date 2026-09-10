/**
 * Margem de Contribuição por produto.
 *
 *   MC = Preço − (Custo de Reposição + Despesas Variáveis)
 *
 * Despesas variáveis (deduções sobre a venda, taxas de cartão, comissões) vêm da DRE
 * do mês de referência como % da receita bruta e são aplicadas ao preço de cada item.
 * Custos FIXOS não são rateados na MC — são cobertos pelo ponto de equilíbrio. O único
 * uso do custo fixo aqui é o PEO por produto: quantas unidades cobrem a fatia de custo
 * fixo proporcional à participação do produto no preço total do catálogo.
 */

export function dreGroup(dre: any, label: string): number {
  if (!dre?.lines) return 0
  const l = (dre.lines as any[]).find(x => x.label === label && x.type === 'group')
  return l ? Math.abs(l.value) : 0
}

export interface DreRef {
  receitaBruta: number
  deducoes: number
  despVar: number
  varRate: number      // (deduções + despesa variável) ÷ receita bruta
  custosFixos: number
}

export function dreVarRate(dre: any): DreRef {
  const receitaBruta = dre?.receitaBruta ?? 0
  const deducoes = dreGroup(dre, 'Deduções sobre a Venda')
  const despVar = dreGroup(dre, 'Despesa Variável')
  return {
    receitaBruta, deducoes, despVar,
    varRate: receitaBruta > 0 ? (deducoes + despVar) / receitaBruta : 0,
    custosFixos: Math.abs(dre?.custosFixos ?? 0),
  }
}

export interface MargemInput { key: string; product: string; sku: string | null; salePrice: number; replacementCost: number }
export interface MargemOverride { price?: number; cost?: number }

export interface MargemRow {
  key: string
  product: string
  sku: string | null
  basePrice: number
  baseCost: number
  price: number          // com simulação aplicada
  cost: number
  edited: boolean
  despVarUnit: number
  mcUnit: number
  mcPct: number
  markup: number | null
  fcRateado: number
  peoUn: number | null   // unidades para cobrir a fatia de custo fixo
}

export function calcMargem(
  products: MargemInput[],
  overrides: Record<string, MargemOverride>,
  varRate: number,
  custosFixos: number
): MargemRow[] {
  // Base do rateio (só para o PEO) = participação de cada produto no preço total do catálogo
  const totalPrice = products.reduce((a, p) => a + (p.salePrice || 0), 0)
  return products.map(p => {
    const basePrice = p.salePrice || 0
    const baseCost = p.replacementCost || 0
    const ov = overrides[p.key] || {}
    const price = ov.price != null ? ov.price : basePrice
    const cost = ov.cost != null ? ov.cost : baseCost
    const despVarUnit = varRate * price
    const mcUnit = price - cost - despVarUnit
    const fcRateado = totalPrice > 0 ? (basePrice / totalPrice) * custosFixos : 0
    return {
      key: p.key, product: p.product, sku: p.sku,
      basePrice, baseCost, price, cost,
      edited: ov.price != null || ov.cost != null,
      despVarUnit, mcUnit,
      mcPct: price > 0 ? mcUnit / price : 0,
      markup: cost > 0 ? price / cost : null,
      fcRateado,
      peoUn: fcRateado > 0 && mcUnit > 0 ? fcRateado / mcUnit : null,
    }
  })
}
