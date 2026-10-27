/**
 * Fluxo de caixa projetado — motor de cálculo puro (sem banco e sem rede).
 *
 * Projeta o caixa DIA A DIA e só depois agrupa em semanas ou meses, para que as
 * duas visões contem a mesma história.
 *
 * ── Ponto de partida ─────────────────────────────────────────────────────────
 * O saldo dos bancos na data do último extrato importado. Não "hoje": entre o
 * extrato e hoje há movimento que o sistema ainda não conhece.
 *
 * ── Entradas do Mercado Livre, em duas partes que não se sobrepõem ───────────
 *   1. Vendas JÁ FEITAS: o relatório "Vendas a receber" do Mercado Pago traz a data
 *      exata em que cada venda é liberada. Entra o que é liberado DEPOIS do saldo
 *      inicial — o que foi liberado antes já está no banco.
 *   2. Vendas FUTURAS: a venda líquida diária recente, espalhada pelos prazos de
 *      liberação observados no mesmo relatório. Começa no dia seguinte à última
 *      venda do relatório, então não repete a parte 1.
 * Sem relatório importado, o Mercado Livre cai na média recente dos depósitos.
 *
 * ── Saídas ───────────────────────────────────────────────────────────────────
 * Compras de estoque: média dos meses completos SEM os meses atípicos. Compra de
 * importação é concentrada — um mês de R$ 221 mil puxaria a média para cima e o
 * fluxo passaria a prever, todo mês, um gasto que não se repete todo mês.
 * Demais despesas: média dos 3 últimos meses completos, mantida constante.
 * Cada categoria cai nos dias do mês em que costuma ser paga (aluguel no 16,
 * parcela do empréstimo no 5…), aprendido do próprio extrato.
 *
 * Valores de saída são POSITIVOS neste módulo; o sinal só aparece na tela.
 * Restrição do build da Vercel: nada de for...of em Map/Set nem spread de Set.
 */

// ─── Categorias ──────────────────────────────────────────────────────────────

export type CategoriaSaida =
  | 'compras' | 'pessoal' | 'impostos' | 'administrativas'
  | 'marketing' | 'financeiras' | 'variaveis' | 'comerciais'

export const CATEGORIAS_SAIDA: { chave: CategoriaSaida; rotulo: string; grupos: string[] }[] = [
  { chave: 'compras', rotulo: 'Compras de estoque', grupos: ['Custo do Produto/Serviço'] },
  { chave: 'pessoal', rotulo: 'Pessoal e pró-labore', grupos: ['Despesas com Pessoal'] },
  { chave: 'impostos', rotulo: 'Impostos', grupos: ['Impostos'] },
  { chave: 'administrativas', rotulo: 'Administrativas', grupos: ['Despesas Administrativas'] },
  { chave: 'marketing', rotulo: 'Marketing', grupos: ['Despesas com Marketing'] },
  { chave: 'financeiras', rotulo: 'Empréstimos e tarifas', grupos: ['Despesas Financeiras'] },
  { chave: 'variaveis', rotulo: 'Logística e comissões', grupos: ['Despesa Variável', 'Deduções sobre a Venda'] },
  { chave: 'comerciais', rotulo: 'Comerciais', grupos: ['Despesas Comerciais'] },
]

export const GRUPO_RECEITA = 'Receita Operacional'

export function categoriaDoGrupo(grupo: string | null | undefined): CategoriaSaida | null {
  const g = String(grupo || '')
  const c = CATEGORIAS_SAIDA.find(x => x.grupos.indexOf(g) >= 0)
  return c ? c.chave : null
}

const semAcento = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const ehContaMercadoLivre = (nome: string | null | undefined) => /mercado ?livre/.test(semAcento(nome || ''))
const ehAplicacao = (nome: string | null | undefined) => /^aplicacao financeira/.test(semAcento(nome || ''))
const ehResgate = (nome: string | null | undefined) => /^resgate de aplicacao/.test(semAcento(nome || ''))

// ─── Datas (texto AAAA-MM-DD; contas em UTC, que não tem horário de verão) ─────

function partes(s: string): [number, number, number] {
  const p = s.split('-')
  return [Number(p[0]), Number(p[1]), Number(p[2])]
}
function utc(s: string): number {
  const p = partes(s)
  return Date.UTC(p[0], p[1] - 1, p[2])
}
export function somarDias(s: string, n: number): string {
  return new Date(utc(s) + n * 86400000).toISOString().slice(0, 10)
}
export function diasEntre(de: string, ate: string): number {
  return Math.round((utc(ate) - utc(de)) / 86400000)
}
export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}
const chaveMes = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}`

// ─── Estatística ─────────────────────────────────────────────────────────────

function media(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
}
function mediana(v: number[]): number {
  if (!v.length) return 0
  const s = v.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface PontoMensal { ano: number; mes: number; valor: number }

export interface Normalizacao {
  regra: 'sem-atipicos' | 'media-recente'
  usados: PontoMensal[]
  excluidos: (PontoMensal & { motivo: string })[]
  mediana: number | null
  valorMensal: number
}

/**
 * Faixa em torno da mediana fora da qual um mês é atípico: menos da metade ou
 * mais do dobro. Com 4 a 6 meses de histórico, z-score robusto não enxerga nada
 * (o próprio mês atípico infla a dispersão); a faixa é simples de explicar ao
 * cliente e pega exatamente o caso que importa — a importação concentrada.
 */
export const FAIXA_ATIPICO: [number, number] = [0.5, 2]

export function normalizarSemAtipicos(serie: PontoMensal[], faixa: [number, number] = FAIXA_ATIPICO): Normalizacao {
  const med = mediana(serie.map(p => p.valor))
  // Com menos de 3 meses não há como dizer o que é atípico; mediana ≤ 0 não forma faixa.
  if (serie.length < 3 || !(med > 0)) {
    return { regra: 'sem-atipicos', usados: serie.slice(), excluidos: [], mediana: serie.length ? med : null, valorMensal: media(serie.map(p => p.valor)) }
  }
  const lo = med * faixa[0]
  const hi = med * faixa[1]
  const usados = serie.filter(p => p.valor >= lo && p.valor <= hi)
  const excluidos = serie.filter(p => p.valor < lo || p.valor > hi).map(p => ({
    ano: p.ano, mes: p.mes, valor: p.valor,
    motivo: `${(p.valor / med).toFixed(1).replace('.', ',')}× a mediana`,
  }))
  return { regra: 'sem-atipicos', usados, excluidos, mediana: med, valorMensal: usados.length ? media(usados.map(p => p.valor)) : med }
}

/** Média dos últimos `n` meses — o nível atual, mantido constante daqui em diante. */
export function mediaRecente(serie: PontoMensal[], n = 3): Normalizacao {
  const usados = serie.slice(-n)
  return { regra: 'media-recente', usados, excluidos: [], mediana: null, valorMensal: media(usados.map(p => p.valor)) }
}

// ─── Dia do mês em que cada coisa costuma acontecer ──────────────────────────

/** Pesos dos dias 1..31 (somam 1). null = sem histórico → espalha por igual. */
export type PerfilMes = number[] | null

export function perfilDoMes(pontos: { dia: number; valor: number }[]): PerfilMes {
  const p: number[] = []
  for (let i = 0; i < 31; i++) p.push(0)
  let total = 0
  pontos.forEach(x => {
    const v = Math.abs(x.valor)
    if (x.dia >= 1 && x.dia <= 31 && v > 0) { p[x.dia - 1] += v; total += v }
  })
  return total > 0 ? p.map(v => v / total) : null
}

/** Parte do valor mensal que cai no `dia` de um mês com `nDias` dias. */
export function pesoDoDia(perfil: PerfilMes, dia: number, nDias: number): number {
  if (!perfil) return 1 / nDias
  if (dia < nDias) return perfil[dia - 1]
  // Dias que o mês não tem (29 a 31) são pagos no último dia do mês.
  let s = 0
  for (let i = nDias; i <= 31; i++) s += perfil[i - 1]
  return s
}

// ─── Recebíveis do Mercado Livre ─────────────────────────────────────────────

export interface Recebivel {
  compra: string            // AAAA-MM-DD
  liberacao: string | null  // AAAA-MM-DD
  liquido: number           // valor total recebido (já sem tarifas e frete)
  aprovado: boolean
}

export const PRAZO_MAXIMO = 60

/** Fração do dinheiro de uma venda liberada k dias depois dela (k = 0..60). */
export function distribuicaoDePrazo(rs: Recebivel[]): number[] | null {
  const p: number[] = []
  for (let i = 0; i <= PRAZO_MAXIMO; i++) p.push(0)
  let total = 0
  rs.forEach(r => {
    if (!r.aprovado || !r.liberacao || !(r.liquido > 0)) return
    const k = diasEntre(r.compra, r.liberacao)
    if (k < 0) return
    p[Math.min(k, PRAZO_MAXIMO)] += r.liquido
    total += r.liquido
  })
  return total > 0 ? p.map(v => v / total) : null
}

export function prazoMediano(dist: number[]): number {
  let a = 0
  for (let k = 0; k < dist.length; k++) { a += dist[k]; if (a >= 0.5) return k }
  return dist.length - 1
}

/**
 * Venda líquida diária recente (só aprovadas). Ignora o último dia do relatório:
 * ele é gerado no meio do dia e esse dia sai pela metade.
 */
export function vendaDiariaRecente(rs: Recebivel[], janela = 28):
  { porDia: number; de: string; ate: string; dias: number; ultimaVenda: string } | null {
  if (!rs.length) return null
  const datas = rs.map(r => r.compra).sort()
  const primeira = datas[0]
  const ultima = datas[datas.length - 1]
  const ate = primeira < ultima ? somarDias(ultima, -1) : ultima
  const inicioJanela = somarDias(ate, -(janela - 1))
  const de = inicioJanela > primeira ? inicioJanela : primeira
  const dias = diasEntre(de, ate) + 1
  let soma = 0
  rs.forEach(r => { if (r.aprovado && r.compra >= de && r.compra <= ate) soma += r.liquido })
  return { porDia: dias > 0 ? soma / dias : 0, de, ate, dias, ultimaVenda: ultima }
}

// ─── Histórico do extrato ────────────────────────────────────────────────────

export interface LancamentoHist {
  data: string              // AAAA-MM-DD da movimentação (no cartão, a data da compra)
  ano: number               // competência: no cartão é o mês da fatura
  mes: number
  valor: number             // como no extrato: saída negativa
  grupo: string | null      // grupo da DRE
  conta: string | null      // nome da conta do plano
}

export interface ContaBancaria {
  nome: string
  saldo: number
  data: string              // data do saldo
  coberturaDe: string | null
  coberturaAte: string | null
}

/**
 * Meses em que TODOS os extratos cobrem o mês inteiro. Mês pela metade puxaria a
 * média para baixo (o salário do dia 5 está lá, o pró-labore do dia 26 não).
 * Tolerância de alguns dias nas pontas: o extrato só tem linha em dia com movimento.
 */
export function mesesCompletos(contas: ContaBancaria[], maxMeses = 6): { ano: number; mes: number }[] {
  const com = contas.filter(c => c.coberturaDe && c.coberturaAte)
  if (!com.length) return []
  const de = com.map(c => c.coberturaDe as string).sort()
  const ate = com.map(c => c.coberturaAte as string).sort()
  const inicioComum = de[de.length - 1]   // o extrato que começa por último manda
  const fimComum = ate[0]                  // o que termina primeiro manda
  const out: { ano: number; mes: number }[] = []
  const p = partes(inicioComum)
  let ano = p[0], mes = p[1]
  for (let guarda = 0; guarda < 60; guarda++) {
    const primeiro = `${chaveMes(ano, mes)}-01`
    const ultimo = `${chaveMes(ano, mes)}-${String(diasNoMes(ano, mes)).padStart(2, '0')}`
    if (primeiro > fimComum) break
    const cobreInicio = diasEntre(primeiro, inicioComum) <= 4
    const cobreFim = diasEntre(fimComum, ultimo) <= 2
    if (cobreInicio && cobreFim) out.push({ ano, mes })
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return out.slice(-maxMeses)
}

function serieMensal(lanc: LancamentoHist[], meses: { ano: number; mes: number }[], filtro: (l: LancamentoHist) => boolean, sinal: 1 | -1): PontoMensal[] {
  const soma = new Map<string, number>()
  meses.forEach(m => soma.set(chaveMes(m.ano, m.mes), 0))
  lanc.forEach(l => {
    const k = chaveMes(l.ano, l.mes)
    if (soma.has(k) && filtro(l)) soma.set(k, (soma.get(k) || 0) + l.valor * sinal)
  })
  return meses.map(m => ({ ano: m.ano, mes: m.mes, valor: soma.get(chaveMes(m.ano, m.mes)) || 0 }))
}

function perfilDosLancamentos(lanc: LancamentoHist[], meses: { ano: number; mes: number }[], filtro: (l: LancamentoHist) => boolean): PerfilMes {
  const validos = new Set(meses.map(m => chaveMes(m.ano, m.mes)))
  return perfilDoMes(lanc
    .filter(l => validos.has(chaveMes(l.ano, l.mes)) && filtro(l))
    .map(l => ({ dia: partes(l.data)[2], valor: l.valor })))
}

/**
 * Quanto está aplicado, estimado pelos lançamentos: aplicações menos resgates. Se
 * o histórico resgata mais do que aplicou, já havia saldo antes dele — e o maior
 * "buraco" no acumulado é o mínimo que precisava existir. É um piso, não o saldo:
 * rendimento e movimento anterior ao histórico ficam de fora.
 */
export function estimarAplicacao(lanc: LancamentoHist[]): { estimado: number; aplicado: number; resgatado: number; saldoAnterior: number } {
  const mov = lanc
    .filter(l => ehAplicacao(l.conta) || ehResgate(l.conta))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
  let acumulado = 0, minimo = 0, aplicado = 0, resgatado = 0
  mov.forEach(l => {
    // Aplicação sai do banco (negativo) e entra na aplicação; resgate faz o inverso.
    acumulado -= l.valor
    if (ehAplicacao(l.conta)) aplicado += -l.valor
    else resgatado += l.valor
    if (acumulado < minimo) minimo = acumulado
  })
  const saldoAnterior = -minimo
  return { estimado: Math.max(0, acumulado + saldoAnterior), aplicado, resgatado, saldoAnterior }
}

// ─── Montagem da entrada ─────────────────────────────────────────────────────

export interface EntradaFluxo {
  inicio: string
  saldoBancos: number
  recebiveis: { data: string; valor: number }[]
  ml:
    | { modo: 'recebiveis'; vendaDia: number; iniciaEm: string; prazo: number[] }
    | { modo: 'historico'; mensal: number; perfil: PerfilMes }
  outrosCanais: { mensal: number; perfil: PerfilMes }
  saidas: { categoria: CategoriaSaida; mensal: number; perfil: PerfilMes }[]
}

export interface MetaCategoria {
  categoria: CategoriaSaida
  rotulo: string
  serie: PontoMensal[]
  normalizacao: Normalizacao
  /**
   * Último mês completo contra a média usada (0,77 = 77% acima). A média de 3
   * meses atrasa mudança de patamar — o marketing saltou de R$ 3,7 mil para
   * R$ 10,8 mil quando os anúncios do Mercado Livre começaram, e a média dizia
   * R$ 6,1 mil. Só para despesas: em compras o último mês costuma ser o atípico.
   */
  variacaoUltimoMes: number | null
}

/** Variação a partir da qual a tela pergunta se a despesa mudou de patamar. */
export const LIMIAR_MUDANCA_PATAMAR = 0.5

export interface MetaFluxo {
  inicio: string
  contas: ContaBancaria[]
  mesesBase: { ano: number; mes: number }[]
  categorias: MetaCategoria[]
  outrosCanais: { serie: PontoMensal[]; normalizacao: Normalizacao }
  mercadoLivre: {
    modo: 'recebiveis' | 'historico'
    serieDepositos: PontoMensal[]
    normalizacaoDepositos: Normalizacao
    relatorio: null | {
      de: string; ate: string; transacoes: number; aprovadas: number
      vendaDiaria: number; janelaDe: string; janelaAte: string; janelaDias: number
      prazoMediano: number; prazoMaximo: number
      aLiberarAposInicio: number
    }
  }
  aplicacao: { estimado: number; aplicado: number; resgatado: number; saldoAnterior: number }
}

export function montarEntrada(dados: { contas: ContaBancaria[]; lancamentos: LancamentoHist[]; recebiveis: Recebivel[] }): { entrada: EntradaFluxo; meta: MetaFluxo } {
  const contas = dados.contas
  // Todas as contas são lidas na MESMA data; a API já entrega cada saldo nela.
  const inicio = contas.length ? contas.map(c => c.data).sort()[0] : new Date().toISOString().slice(0, 10)
  const saldoBancos = contas.reduce((a, c) => a + c.saldo, 0)
  const meses = mesesCompletos(contas)
  const lanc = dados.lancamentos

  const categorias: MetaCategoria[] = CATEGORIAS_SAIDA.map(c => {
    const filtro = (l: LancamentoHist) => categoriaDoGrupo(l.grupo) === c.chave
    const serie = serieMensal(lanc, meses, filtro, -1)
    const normalizacao = c.chave === 'compras' ? normalizarSemAtipicos(serie) : mediaRecente(serie)
    const ultimo = serie.length ? serie[serie.length - 1].valor : 0
    const variacaoUltimoMes = c.chave !== 'compras' && normalizacao.valorMensal > 0 && serie.length
      ? ultimo / normalizacao.valorMensal - 1 : null
    return { categoria: c.chave, rotulo: c.rotulo, serie, normalizacao, variacaoUltimoMes }
  })
  const saidas = categorias.map(c => ({
    categoria: c.categoria,
    mensal: Math.max(0, c.normalizacao.valorMensal),
    perfil: perfilDosLancamentos(lanc, meses, l => categoriaDoGrupo(l.grupo) === c.categoria),
  }))

  const ehReceita = (l: LancamentoHist) => l.grupo === GRUPO_RECEITA
  const filtroOutros = (l: LancamentoHist) => ehReceita(l) && !ehContaMercadoLivre(l.conta)
  const filtroML = (l: LancamentoHist) => ehReceita(l) && ehContaMercadoLivre(l.conta)
  const serieOutros = serieMensal(lanc, meses, filtroOutros, 1)
  const normOutros = mediaRecente(serieOutros)
  const serieML = serieMensal(lanc, meses, filtroML, 1)
  const normML = mediaRecente(serieML)

  const rs = dados.recebiveis
  const prazo = distribuicaoDePrazo(rs)
  const venda = vendaDiariaRecente(rs)

  // Pendentes: aprovadas que liberam depois do saldo inicial, somadas por dia.
  const porDia = new Map<string, number>()
  rs.forEach(r => {
    if (r.aprovado && r.liberacao && r.liberacao > inicio && r.liquido > 0) {
      porDia.set(r.liberacao, (porDia.get(r.liberacao) || 0) + r.liquido)
    }
  })
  const recebiveis = Array.from(porDia.entries())
    .map(p => ({ data: p[0], valor: p[1] }))
    .sort((a, b) => (a.data < b.data ? -1 : 1))

  let ml: EntradaFluxo['ml'] = { modo: 'historico', mensal: Math.max(0, normML.valorMensal), perfil: perfilDosLancamentos(lanc, meses, filtroML) }
  let relatorio: MetaFluxo['mercadoLivre']['relatorio'] = null
  if (prazo && venda && venda.porDia > 0) {
    ml = { modo: 'recebiveis', vendaDia: venda.porDia, iniciaEm: somarDias(venda.ultimaVenda, 1), prazo }
    const datasRel = rs.map(r => r.compra).sort()
    let prazoMax = 0
    prazo.forEach((w, k) => { if (w > 0) prazoMax = k })
    relatorio = {
      de: datasRel[0], ate: datasRel[datasRel.length - 1],
      transacoes: rs.length, aprovadas: rs.filter(r => r.aprovado).length,
      vendaDiaria: venda.porDia, janelaDe: venda.de, janelaAte: venda.ate, janelaDias: venda.dias,
      prazoMediano: prazoMediano(prazo), prazoMaximo: prazoMax,
      aLiberarAposInicio: recebiveis.reduce((a, r) => a + r.valor, 0),
    }
  }

  const entrada: EntradaFluxo = {
    inicio, saldoBancos,
    recebiveis: ml.modo === 'recebiveis' ? recebiveis : [],
    ml,
    outrosCanais: { mensal: Math.max(0, normOutros.valorMensal), perfil: perfilDosLancamentos(lanc, meses, filtroOutros) },
    saidas,
  }
  const meta: MetaFluxo = {
    inicio, contas, mesesBase: meses, categorias,
    outrosCanais: { serie: serieOutros, normalizacao: normOutros },
    mercadoLivre: { modo: ml.modo, serieDepositos: serieML, normalizacaoDepositos: normML, relatorio },
    aplicacao: estimarAplicacao(lanc),
  }
  return { entrada, meta }
}

// ─── Projeção ────────────────────────────────────────────────────────────────

export interface Parametros {
  ajusteVendas: number                               // 0,1 = vendas 10% acima do ritmo recente
  saldoMercadoPago: number                           // dinheiro liberado e ainda parado no Mercado Pago
  aplicacao: number                                  // reserva aplicada, fora do extrato
  mensal: Partial<Record<CategoriaSaida, number>>    // sobrescreve o valor mensal normalizado
}

export const PARAMETROS_PADRAO: Parametros = { ajusteVendas: 0, saldoMercadoPago: 0, aplicacao: 0, mensal: {} }

export interface DiaFluxo {
  data: string
  mlRecebiveis: number
  mlProjetado: number
  outrosCanais: number
  saidas: Record<CategoriaSaida, number>
  entradas: number
  totalSaidas: number
  caixa: number                                      // ao FIM do dia: bancos + Mercado Pago + acumulado
}

function saidasZeradas(): Record<CategoriaSaida, number> {
  const r = {} as Record<CategoriaSaida, number>
  CATEGORIAS_SAIDA.forEach(c => { r[c.chave] = 0 })
  return r
}

export function caixaInicial(e: EntradaFluxo, p: Parametros): number {
  return e.saldoBancos + (p.saldoMercadoPago || 0)
}

/** Dias do saldo inicial até o fim do `meses`-ésimo mês seguinte (o mês corrente conta à parte). */
export function horizonteAteFimDoMes(inicio: string, meses: number): number {
  const pt = partes(inicio)
  let ano = pt[0], mes = pt[1] + meses
  while (mes > 12) { mes -= 12; ano++ }
  return diasEntre(inicio, `${chaveMes(ano, mes)}-${String(diasNoMes(ano, mes)).padStart(2, '0')}`)
}

export function projetarFluxo(e: EntradaFluxo, p: Parametros, horizonte: number): DiaFluxo[] {
  const fator = 1 + (p.ajusteVendas || 0)
  const idx = new Map<string, number>()
  const dias: DiaFluxo[] = []
  for (let i = 1; i <= horizonte; i++) {
    const data = somarDias(e.inicio, i)
    idx.set(data, i - 1)
    dias.push({ data, mlRecebiveis: 0, mlProjetado: 0, outrosCanais: 0, saidas: saidasZeradas(), entradas: 0, totalSaidas: 0, caixa: 0 })
  }
  if (!dias.length) return dias
  const fim = dias[dias.length - 1].data

  // 1. Vendas já feitas: o dinheiro entra na data exata de liberação.
  e.recebiveis.forEach(r => {
    const i = idx.get(r.data)
    if (i !== undefined) dias[i].mlRecebiveis += r.valor
  })

  // 2. Vendas futuras do Mercado Livre, espalhadas pelos prazos observados.
  //    Começam no dia seguinte à última venda do relatório — o que veio antes já
  //    está em (1). Liberação até a data do saldo inicial já estaria no banco.
  if (e.ml.modo === 'recebiveis') {
    const ml = e.ml
    const vendaDia = ml.vendaDia * fator
    for (let s = ml.iniciaEm; s <= fim; s = somarDias(s, 1)) {
      for (let k = 0; k < ml.prazo.length; k++) {
        const w = ml.prazo[k]
        if (!w) continue
        const i = idx.get(somarDias(s, k))
        if (i !== undefined) dias[i].mlProjetado += vendaDia * w
      }
    }
  }

  dias.forEach(d => {
    const pt = partes(d.data)
    const dia = pt[2]
    const n = diasNoMes(pt[0], pt[1])
    if (e.ml.modo === 'historico') d.mlProjetado = e.ml.mensal * fator * pesoDoDia(e.ml.perfil, dia, n)
    d.outrosCanais = e.outrosCanais.mensal * fator * pesoDoDia(e.outrosCanais.perfil, dia, n)
    e.saidas.forEach(s => {
      // O ajuste de vendas NÃO mexe nas compras: elas vêm do histórico (outro período
      // e outro ritmo de venda) e a decisão de comprar é do cliente — quem quiser
      // simular mais compra altera a premissa de compras à parte.
      const sobrescrito = p.mensal ? p.mensal[s.categoria] : undefined
      const mensal = typeof sobrescrito === 'number' && sobrescrito >= 0 ? sobrescrito : s.mensal
      d.saidas[s.categoria] += mensal * pesoDoDia(s.perfil, dia, n)
    })
  })

  let caixa = caixaInicial(e, p)
  dias.forEach(d => {
    d.entradas = d.mlRecebiveis + d.mlProjetado + d.outrosCanais
    d.totalSaidas = CATEGORIAS_SAIDA.reduce((a, c) => a + d.saidas[c.chave], 0)
    caixa += d.entradas - d.totalSaidas
    d.caixa = caixa
  })
  return dias
}

// ─── Agrupamento e resumo ────────────────────────────────────────────────────

export interface PeriodoFluxo {
  chave: string
  rotulo: string
  de: string
  ate: string
  parcial: boolean
  mlRecebiveis: number
  mlProjetado: number
  outrosCanais: number
  entradas: number
  saidas: Record<CategoriaSaida, number>
  totalSaidas: number
  caixaInicial: number
  caixaFinal: number
  caixaMinimo: number
  dataMinimo: string
}

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`

export function agruparFluxo(dias: DiaFluxo[], modo: 'semana' | 'mes', caixaDeAbertura: number): PeriodoFluxo[] {
  const out: PeriodoFluxo[] = []
  let atual: PeriodoFluxo | null = null
  let anterior = caixaDeAbertura
  for (let i = 0; i < dias.length; i++) {
    const d = dias[i]
    const chave = modo === 'semana' ? `s${Math.floor(i / 7)}` : d.data.slice(0, 7)
    if (!atual || atual.chave !== chave) {
      if (atual) out.push(atual)
      atual = {
        chave, rotulo: '', de: d.data, ate: d.data, parcial: false,
        mlRecebiveis: 0, mlProjetado: 0, outrosCanais: 0, entradas: 0,
        saidas: saidasZeradas(), totalSaidas: 0,
        caixaInicial: anterior, caixaFinal: anterior, caixaMinimo: Infinity, dataMinimo: d.data,
      }
    }
    const a: PeriodoFluxo = atual
    a.ate = d.data
    a.mlRecebiveis += d.mlRecebiveis
    a.mlProjetado += d.mlProjetado
    a.outrosCanais += d.outrosCanais
    a.entradas += d.entradas
    CATEGORIAS_SAIDA.forEach(c => { a.saidas[c.chave] += d.saidas[c.chave] })
    a.totalSaidas += d.totalSaidas
    a.caixaFinal = d.caixa
    if (d.caixa < a.caixaMinimo) { a.caixaMinimo = d.caixa; a.dataMinimo = d.data }
    anterior = d.caixa
  }
  if (atual) out.push(atual)

  out.forEach(p => {
    if (modo === 'semana') {
      p.rotulo = `${ddmm(p.de)}–${ddmm(p.ate)}`
      p.parcial = diasEntre(p.de, p.ate) < 6
    } else {
      const pt = partes(p.de)
      const nome = `${MESES_CURTOS[pt[1] - 1]}/${String(pt[0]).slice(2)}`
      p.parcial = pt[2] !== 1 || partes(p.ate)[2] !== diasNoMes(pt[0], pt[1])
      p.rotulo = p.parcial ? `${nome} (${p.de.slice(8, 10)}–${p.ate.slice(8, 10)})` : nome
    }
  })
  return out
}

export interface ResumoFluxo {
  caixaInicial: number
  caixaFinal: number
  minimo: { valor: number; data: string }
  primeiroNegativo: string | null
  entradas: number
  saidas: number
}

export function resumirFluxo(dias: DiaFluxo[], caixaDeAbertura: number): ResumoFluxo {
  let minimo = { valor: caixaDeAbertura, data: dias.length ? dias[0].data : '' }
  let primeiroNegativo: string | null = null
  let entradas = 0, saidas = 0
  dias.forEach(d => {
    entradas += d.entradas
    saidas += d.totalSaidas
    if (d.caixa < minimo.valor) minimo = { valor: d.caixa, data: d.data }
    if (primeiroNegativo === null && d.caixa < 0) primeiroNegativo = d.data
  })
  return {
    caixaInicial: caixaDeAbertura,
    caixaFinal: dias.length ? dias[dias.length - 1].caixa : caixaDeAbertura,
    minimo, primeiroNegativo, entradas, saidas,
  }
}
