/**
 * Simulador de importação — custo desembarcado, margem, viabilidade e fluxo de caixa.
 *
 * ── O cálculo do custo desembarcado (landed cost) ────────────────────────────
 * A Receita Federal não tributa o que você pagou ao fornecedor: tributa o
 * VALOR ADUANEIRO, que é a mercadoria posta no porto brasileiro.
 *
 *   Valor Aduaneiro (VA) = FOB + Frete internacional + Seguro internacional
 *
 * Sobre ele incidem, nesta ordem (cada um entra na base do seguinte):
 *   II     = VA × alíquota do NCM
 *   IPI    = (VA + II) × alíquota do NCM
 *   PIS    = VA × 2,10%
 *   COFINS = VA × 9,65%
 *   ICMS   = (VA + II + IPI + PIS + COFINS + despesas aduaneiras) ÷ (1 − alíquota) × alíquota
 *
 * O ICMS é "por dentro": ele entra na própria base. Por isso se divide por
 * (1 − alíquota) — com 18%, cada R$ 100 de base viram R$ 121,95, e o imposto é
 * R$ 21,95, não R$ 18,00. É o erro mais comum de quem simula importação.
 *
 * ── Crédito tributário: o que mais muda a conta ──────────────────────────────
 * Quem apura pelo lucro real credita PIS, COFINS e ICMS — esses tributos voltam
 * e NÃO são custo. No SIMPLES NACIONAL nada disso é creditável: todo imposto
 * pago na importação vira custo do produto. A mesma importação pode ter custo
 * ~25% maior no Simples. Ver `REGIME_INFO`.
 *
 * ── Rateio ───────────────────────────────────────────────────────────────────
 * Frete, seguro e despesas são da carga inteira e precisam ser distribuídos por
 * item. A aduana usa rateio por VALOR (padrão aqui); por PESO faz sentido quando
 * a carga mistura itens leves e caros com pesados e baratos.
 */

export type Regime = 'simples' | 'presumido' | 'real'
export type Modal = 'maritimo' | 'aereo'
export type Rateio = 'valor' | 'peso'

export const PIS_ALIQ = 0.021
export const COFINS_ALIQ = 0.0965
export const AFRMM_ALIQ = 0.08   // 8% sobre o frete marítimo (aéreo é isento)

export const REGIME_INFO: Record<Regime, { label: string; creditaPisCofins: boolean; creditaIcms: boolean; nota: string }> = {
  simples: {
    label: 'Simples Nacional',
    creditaPisCofins: false,
    creditaIcms: false,
    nota: 'Nenhum tributo da importação é recuperável — II, IPI, PIS, COFINS e ICMS viram custo do produto.',
  },
  presumido: {
    label: 'Lucro Presumido',
    creditaPisCofins: false,
    creditaIcms: true,
    nota: 'PIS/COFINS são cumulativos (não creditam). O ICMS credita se a empresa for contribuinte.',
  },
  real: {
    label: 'Lucro Real',
    creditaPisCofins: true,
    creditaIcms: true,
    nota: 'PIS, COFINS e ICMS creditam e voltam; na prática só II e IPI ficam como custo.',
  },
}

export interface ImportParams {
  moeda: string            // rótulo (USD, CNY…) — só informativo
  cambio: number           // R$ por unidade de moeda
  iofCambioPct: number     // % sobre a remessa ao exterior (0,38 usual)
  modal: Modal
  freteInternacional: number   // na moeda
  seguroPct: number            // % sobre (FOB + frete)
  // Despesas no Brasil, em R$, da carga inteira
  despachante: number
  armazenagem: number
  freteInterno: number
  taxaSiscomex: number
  outrasDespesas: number
  regime: Regime
  icmsAliqPct: number
  rateio: Rateio
  // Prazos em dias, contados do pedido
  pctAdiantamento: number
  prazoProducao: number
  prazoTransito: number
  prazoDesembaraco: number
  prazoInterno: number
  prazoVenda: number
  prazoRecebimento: number
}

export interface ImportItem {
  key: string
  produto: string
  sku?: string | null
  ncm?: string | null
  quantidade: number
  precoFobUnit: number       // na moeda, por unidade
  pesoUnitKg: number
  iiAliqPct: number
  ipiAliqPct: number
  precoVenda: number         // R$, preço de venda no Brasil
  custoNacionalAtual: number // R$, custo de reposição comprando no mercado interno (0 = sem comparação)
}

export interface ItemResult {
  key: string; produto: string; sku?: string | null; ncm?: string | null
  quantidade: number
  fobBRL: number             // total do item
  freteRateado: number
  seguroRateado: number
  valorAduaneiro: number
  ii: number; ipi: number; pis: number; cofins: number; icms: number
  tributosTotais: number
  creditos: number           // tributos recuperáveis pelo regime
  despesasRateadas: number   // despachante, armazenagem, frete interno, Siscomex, AFRMM, IOF, outras
  custoTotal: number         // desembarcado, líquido de créditos
  custoUnitario: number
  // Comparação e margem
  custoNacionalAtual: number
  economiaUnit: number       // quanto economiza por unidade vs comprar no Brasil
  economiaPct: number
  precoVenda: number
  mcUnit: number | null      // margem de contribuição unitária; null = sem preço de venda definido
  mcPct: number | null
  mcUnitNacional: number | null
  markup: number | null
}

export interface ImportResult {
  itens: ItemResult[]
  // Totais da operação
  fobBRL: number
  freteBRL: number
  seguroBRL: number
  valorAduaneiro: number
  ii: number; ipi: number; pis: number; cofins: number; icms: number; afrmm: number
  iof: number
  tributosTotais: number
  creditos: number
  despesasBrasil: number
  investimentoTotal: number   // tudo que sai do caixa
  custoDesembarcado: number   // investimento − créditos
  // Viabilidade
  receitaPotencial: number
  mcTotal: number
  mcPctMedia: number
  semPrecoVenda: number       // itens sem preço definido — fora do cálculo de margem
  fatorLandedCost: number     // custo desembarcado ÷ FOB — "cada R$ 1 de mercadoria vira R$ X"
  economiaVsNacional: number | null
  roi: number | null          // MC total ÷ investimento
}

const pct = (v: number) => (isFinite(v) ? v : 0) / 100

/** Custo desembarcado item a item + totais da operação. `varRatePct` = despesas variáveis sobre a venda (da DRE). */
export function calcImportacao(p: ImportParams, itens: ImportItem[], varRatePct: number): ImportResult {
  const cambio = p.cambio || 0
  const validos = itens.filter(i => i.quantidade > 0 && i.precoFobUnit >= 0)

  // ── Bases de rateio ───────────────────────────────────────────────────────
  const fobMoedaTotal = validos.reduce((a, i) => a + i.precoFobUnit * i.quantidade, 0)
  const pesoTotal = validos.reduce((a, i) => a + (i.pesoUnitKg || 0) * i.quantidade, 0)
  const usaPeso = p.rateio === 'peso' && pesoTotal > 0
  const baseRateio = (i: ImportItem) => usaPeso ? (i.pesoUnitKg || 0) * i.quantidade : i.precoFobUnit * i.quantidade
  const baseTotal = usaPeso ? pesoTotal : fobMoedaTotal
  const quota = (i: ImportItem) => (baseTotal > 0 ? baseRateio(i) / baseTotal : 0)

  // ── Valores da carga em R$ ────────────────────────────────────────────────
  const fobBRL = fobMoedaTotal * cambio
  const freteBRL = (p.freteInternacional || 0) * cambio
  const seguroBRL = (fobBRL + freteBRL) * pct(p.seguroPct)
  const valorAduaneiroTotal = fobBRL + freteBRL + seguroBRL

  // AFRMM incide só sobre frete marítimo. IOF incide sobre a remessa (FOB + frete).
  const afrmm = p.modal === 'maritimo' ? freteBRL * AFRMM_ALIQ : 0
  const iof = (fobBRL + freteBRL) * pct(p.iofCambioPct)

  // Despesas aduaneiras entram na base do ICMS; frete interno e despachante também
  // são custo da operação. Siscomex e AFRMM são obrigatórias.
  const despesasBrasil =
    (p.despachante || 0) + (p.armazenagem || 0) + (p.freteInterno || 0) +
    (p.taxaSiscomex || 0) + (p.outrasDespesas || 0) + afrmm
  const despesasAduaneiras = (p.armazenagem || 0) + (p.taxaSiscomex || 0) + afrmm

  const reg = REGIME_INFO[p.regime] ?? REGIME_INFO.simples
  const icmsAliq = pct(p.icmsAliqPct)

  const res: ItemResult[] = validos.map(i => {
    const q = quota(i)
    const fobItem = i.precoFobUnit * i.quantidade * cambio
    const freteItem = freteBRL * q
    const seguroItem = seguroBRL * q
    const va = fobItem + freteItem + seguroItem

    const ii = va * pct(i.iiAliqPct)
    const ipi = (va + ii) * pct(i.ipiAliqPct)
    const pis = va * PIS_ALIQ
    const cofins = va * COFINS_ALIQ

    // ICMS por dentro: a base inclui o próprio imposto
    const despAduanItem = despesasAduaneiras * q
    const baseSemIcms = va + ii + ipi + pis + cofins + despAduanItem
    const icms = icmsAliq < 1 ? (baseSemIcms / (1 - icmsAliq)) * icmsAliq : 0

    const tributos = ii + ipi + pis + cofins + icms
    const creditos = (reg.creditaPisCofins ? pis + cofins : 0) + (reg.creditaIcms ? icms : 0)

    // Demais desembolsos rateados (fora os já contados em despesasAduaneiras)
    const outrosRateados = ((p.despachante || 0) + (p.freteInterno || 0) + (p.outrasDespesas || 0) + iof) * q
    const despesasRateadas = despAduanItem + outrosRateados

    const custoTotal = va + tributos + despesasRateadas - creditos
    const custoUnitario = i.quantidade > 0 ? custoTotal / i.quantidade : 0

    // Margem de contribuição: MC = Preço − (Custo + Despesas Variáveis) — mesma
    // definição da aba Produtos, para os números conversarem entre si.
    // Produto novo ainda sem preço definido não tem margem a calcular: fica nulo em
    // vez de virar "MC negativa", que faria parecer prejuízo onde só falta informação.
    const temPreco = i.precoVenda > 0
    const despVarUnit = temPreco ? i.precoVenda * pct(varRatePct) : 0
    const mcUnit = temPreco ? i.precoVenda - custoUnitario - despVarUnit : null
    const custoNac = i.custoNacionalAtual || 0
    const mcUnitNacional = temPreco && custoNac > 0 ? i.precoVenda - custoNac - despVarUnit : null

    return {
      key: i.key, produto: i.produto, sku: i.sku, ncm: i.ncm,
      quantidade: i.quantidade,
      fobBRL: fobItem, freteRateado: freteItem, seguroRateado: seguroItem, valorAduaneiro: va,
      ii, ipi, pis, cofins, icms, tributosTotais: tributos, creditos,
      despesasRateadas, custoTotal, custoUnitario,
      custoNacionalAtual: custoNac,
      economiaUnit: custoNac > 0 ? custoNac - custoUnitario : 0,
      economiaPct: custoNac > 0 ? (custoNac - custoUnitario) / custoNac : 0,
      precoVenda: i.precoVenda,
      mcUnit, mcPct: mcUnit != null && i.precoVenda > 0 ? mcUnit / i.precoVenda : null,
      mcUnitNacional,
      markup: temPreco && custoUnitario > 0 ? i.precoVenda / custoUnitario : null,
    }
  })

  const soma = (f: (r: ItemResult) => number) => res.reduce((a, r) => a + f(r), 0)
  const tributosTotais = soma(r => r.tributosTotais)
  const creditos = soma(r => r.creditos)
  const investimentoTotal = valorAduaneiroTotal + tributosTotais + despesasBrasil + iof
  const custoDesembarcado = investimentoTotal - creditos
  // Itens sem preço de venda ficam fora de receita e margem — não dá para projetar o
  // que ainda não foi precificado. Eles continuam no custo e no caixa, que são certos.
  const semPrecoVenda = res.filter(r => r.mcUnit == null).length
  const receitaPotencial = soma(r => (r.mcUnit == null ? 0 : r.precoVenda * r.quantidade))
  const mcTotal = soma(r => (r.mcUnit == null ? 0 : r.mcUnit * r.quantidade))
  const economiaTotal = soma(r => (r.custoNacionalAtual > 0 ? r.economiaUnit * r.quantidade : 0))
  const temComparacao = res.some(r => r.custoNacionalAtual > 0)

  return {
    itens: res,
    fobBRL, freteBRL, seguroBRL, valorAduaneiro: valorAduaneiroTotal,
    ii: soma(r => r.ii), ipi: soma(r => r.ipi), pis: soma(r => r.pis),
    cofins: soma(r => r.cofins), icms: soma(r => r.icms), afrmm, iof,
    tributosTotais, creditos, despesasBrasil,
    investimentoTotal, custoDesembarcado,
    receitaPotencial, mcTotal, semPrecoVenda,
    mcPctMedia: receitaPotencial > 0 ? mcTotal / receitaPotencial : 0,
    fatorLandedCost: fobBRL > 0 ? custoDesembarcado / fobBRL : 0,
    economiaVsNacional: temComparacao ? economiaTotal : null,
    roi: investimentoTotal > 0 ? mcTotal / investimentoTotal : null,
  }
}

// ─── Fluxo de caixa: o descasamento ──────────────────────────────────────────

export interface EventoCaixa { dia: number; rotulo: string; valor: number; tipo: 'saida' | 'entrada' }
export interface FluxoResult {
  eventos: EventoCaixa[]
  serie: { dia: number; saldo: number }[]
  piorSaldo: number          // necessidade máxima de capital de giro
  diaPiorSaldo: number
  diaPayback: number | null  // dia em que o caixa volta a zero
  cicloTotal: number         // do pedido ao último recebimento
  diasEstoqueParado: number  // do pagamento ao início das vendas
}

/**
 * Monta o cronograma de caixa da operação. O desembolso não é um só: o sinal sai
 * no pedido, o saldo no embarque e os impostos só no desembaraço — semanas depois.
 * A receita começa ainda mais tarde e entra diluída ao longo do giro, com o prazo
 * de recebimento do marketplace por cima.
 */
export function calcFluxoImportacao(p: ImportParams, r: ImportResult): FluxoResult {
  const ev: EventoCaixa[] = []
  const dEmbarque = p.prazoProducao
  const dChegada = dEmbarque + p.prazoTransito
  const dLiberado = dChegada + p.prazoDesembaraco
  const dEstoque = dLiberado + p.prazoInterno

  const sinalPct = Math.min(Math.max(p.pctAdiantamento, 0), 100) / 100
  const mercadoria = r.fobBRL + r.iof
  ev.push({ dia: 0, rotulo: `Sinal ao fornecedor (${p.pctAdiantamento}%)`, valor: -mercadoria * sinalPct, tipo: 'saida' })
  if (sinalPct < 1) ev.push({ dia: dEmbarque, rotulo: 'Saldo ao fornecedor (embarque)', valor: -mercadoria * (1 - sinalPct), tipo: 'saida' })
  if (r.freteBRL + r.seguroBRL > 0) ev.push({ dia: dEmbarque, rotulo: 'Frete e seguro internacional', valor: -(r.freteBRL + r.seguroBRL), tipo: 'saida' })
  ev.push({ dia: dLiberado, rotulo: 'Impostos de importação', valor: -r.tributosTotais, tipo: 'saida' })
  ev.push({ dia: dLiberado, rotulo: 'Despesas no Brasil (despachante, porto, frete)', valor: -r.despesasBrasil, tipo: 'saida' })
  if (r.creditos > 0) ev.push({ dia: dLiberado + 30, rotulo: 'Créditos tributários recuperados', valor: r.creditos, tipo: 'entrada' })

  // Vendas distribuídas ao longo do giro; o dinheiro entra após o prazo de recebimento
  const nVendas = Math.max(1, Math.round(p.prazoVenda / 15))
  const receitaPorFatia = r.receitaPotencial / nVendas
  for (let k = 1; k <= nVendas; k++) {
    const diaVenda = dEstoque + Math.round((p.prazoVenda * k) / nVendas)
    ev.push({ dia: diaVenda + p.prazoRecebimento, rotulo: `Recebimento de vendas ${k}/${nVendas}`, valor: receitaPorFatia, tipo: 'entrada' })
  }
  // Despesas variáveis saem junto com a venda (taxa de marketplace, imposto sobre venda)
  const despVarTotal = r.receitaPotencial - r.mcTotal - r.custoDesembarcado
  if (despVarTotal > 0) {
    for (let k = 1; k <= nVendas; k++) {
      const diaVenda = dEstoque + Math.round((p.prazoVenda * k) / nVendas)
      ev.push({ dia: diaVenda + p.prazoRecebimento, rotulo: `Despesas variáveis s/ vendas ${k}/${nVendas}`, valor: -despVarTotal / nVendas, tipo: 'saida' })
    }
  }

  ev.sort((a, b) => a.dia - b.dia)
  const fim = ev.length ? ev[ev.length - 1].dia : 0
  const porDia = new Map<number, number>()
  ev.forEach(e => porDia.set(e.dia, (porDia.get(e.dia) || 0) + e.valor))

  const serie: { dia: number; saldo: number }[] = []
  let acc = 0, pior = 0, diaPior = 0, payback: number | null = null
  for (let d = 0; d <= fim; d++) {
    acc += porDia.get(d) || 0
    serie.push({ dia: d, saldo: acc })
    if (acc < pior) { pior = acc; diaPior = d }
    if (payback == null && d > 0 && acc >= 0 && pior < 0) payback = d
  }

  return {
    eventos: ev, serie,
    piorSaldo: pior, diaPiorSaldo: diaPior,
    diaPayback: payback, cicloTotal: fim,
    diasEstoqueParado: dEstoque,
  }
}

// ─── Sensibilidade ao câmbio ─────────────────────────────────────────────────

export interface SensibilidadeLinha { cambio: number; variacaoPct: number; custoDesembarcado: number; mcPct: number; mcTotal: number }

/** Recalcula a operação em vários níveis de câmbio — o maior risco de quem importa. */
export function calcSensibilidadeCambio(
  p: ImportParams, itens: ImportItem[], varRatePct: number, variacoes = [-20, -10, -5, 0, 5, 10, 20, 30]
): SensibilidadeLinha[] {
  return variacoes.map(v => {
    const cambio = p.cambio * (1 + v / 100)
    const r = calcImportacao({ ...p, cambio }, itens, varRatePct)
    return { cambio, variacaoPct: v, custoDesembarcado: r.custoDesembarcado, mcPct: r.mcPctMedia, mcTotal: r.mcTotal }
  })
}

/**
 * Câmbio em que a operação empata: a margem de contribuição do lote zera.
 * Acima dele, importar passa a dar prejuízo — é o número que define até onde
 * o dólar pode subir antes de a operação virar.
 */
export function cambioDeEquilibrio(p: ImportParams, itens: ImportItem[], varRatePct: number): number | null {
  const mcEm = (c: number) => calcImportacao({ ...p, cambio: c }, itens, varRatePct).mcTotal
  if (mcEm(p.cambio) <= 0) return null
  let lo = p.cambio, hi = p.cambio * 6
  if (mcEm(hi) > 0) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (mcEm(mid) > 0) lo = mid; else hi = mid
  }
  return (lo + hi) / 2
}

/** Câmbio a partir do qual comprar do importador nacional fica mais barato. */
export function cambioParidadeNacional(p: ImportParams, itens: ImportItem[], varRatePct: number): number | null {
  const comparaveis = itens.filter(i => (i.custoNacionalAtual || 0) > 0 && i.quantidade > 0)
  if (comparaveis.length === 0) return null
  const custoNac = comparaveis.reduce((a, i) => a + i.custoNacionalAtual * i.quantidade, 0)
  const impEm = (c: number) => {
    const r = calcImportacao({ ...p, cambio: c }, comparaveis, varRatePct)
    return r.custoDesembarcado
  }
  if (impEm(p.cambio) >= custoNac) return null   // já não compensa no câmbio atual
  let lo = p.cambio, hi = p.cambio * 6
  if (impEm(hi) < custoNac) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (impEm(mid) < custoNac) lo = mid; else hi = mid
  }
  return (lo + hi) / 2
}
