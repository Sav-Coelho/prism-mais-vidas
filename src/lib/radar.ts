/**
 * Radar de Preços — comparação dos preços da loja com os dos concorrentes no
 * Mercado Livre.
 *
 * ── Divergência ──────────────────────────────────────────────────────────────
 *   divergência = (nosso preço − preço do concorrente) ÷ nosso preço
 *
 *   POSITIVA  → o concorrente está MAIS BARATO (ele nos corta o preço)
 *   NEGATIVA  → o concorrente está MAIS CARO (temos espaço para subir)
 *
 * "Concorrente crítico" é quem está pelo menos 20% abaixo do nosso preço: nessa
 * faixa a perda de Buy Box e de conversão no marketplace é concreta. O limiar é
 * parâmetro, não constante mágica.
 *
 * ── Casamento de produto ─────────────────────────────────────────────────────
 * A comparação é feita pelo CATÁLOGO do Mercado Livre: a consulta acha a página do
 * produto e as ofertas listadas ali disputam exatamente o mesmo item. Todas as
 * ofertas de um produto carregam o nome da ficha como título.
 *
 * Buscar pelo título inteiro não funciona: os títulos são longos e cheios de
 * código de modelo. A consulta usa os termos mais informativos e, depois, a ficha
 * encontrada é pontuada por semelhança (Jaccard, o mesmo método do classificador
 * de lançamentos). Abaixo do limiar, descarta-se — melhor não comparar do que
 * comparar com outro produto.
 */

import { tokenize, jaccardSimilarity } from './classifier'

export const LIMIAR_CRITICO_PADRAO = 0.20   // 20% abaixo do nosso preço
export const LIMIAR_SEMELHANCA_PADRAO = 0.34

/** Palavras que não ajudam a achar o produto e só poluem a busca. */
const RUIDO = new Set([
  'para', 'com', 'sem', 'por', 'uma', 'uns', 'dos', 'das', 'que', 'mais',
  'até', 'ate', 'ideal', 'original', 'profissional', 'super', 'melhor',
  'novo', 'nova', 'kit', 'unidades', 'unidade', 'real', 'horas', 'hrs',
])

/**
 * Monta a consulta de busca a partir do título do produto: tira ruído, mantém a
 * ordem (os primeiros termos do título são os mais descritivos) e corta em 6
 * palavras — consultas longas demais devolvem zero resultados.
 */
export function montarConsulta(titulo: string, maxTermos = 6): string {
  const termos = String(titulo || '')
    .toLowerCase()
    .replace(/[^0-9a-záéíóúàãõâêôçü\s]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !RUIDO.has(t))
  const vistos = new Set<string>()
  const unicos = termos.filter(t => (vistos.has(t) ? false : (vistos.add(t), true)))
  return unicos.slice(0, maxTermos).join(' ')
}

/** Semelhança entre o nosso título e o do anúncio (0 a 1). */
export function semelhanca(nosso: string, anuncio: string): number {
  return jaccardSimilarity(tokenize(nosso), tokenize(anuncio))
}

/**
 * O anúncio é da própria Tio Chico? Compara o apelido do vendedor de forma
 * tolerante (sem acento, sem espaço, minúsculo) contra os apelidos conhecidos.
 * Sem isso o radar compararia a loja com ela mesma.
 */
export function ehLojaPropria(vendedor: string | null | undefined, apelidos: string[]): boolean {
  const limpa = (s: string | null | undefined) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '')
  const v = limpa(vendedor)
  if (!v) return false
  return apelidos.map(limpa).filter(Boolean).some(a => v === a || v.includes(a) || a.includes(v))
}

export type Severidade = 'critico' | 'atencao' | 'alinhado' | 'acima'

export interface OfertaBruta {
  mlItemId: string
  titulo: string
  preco: number
  vendedor: string
  vendedorId?: string | null
  permalink: string
  freteGratis?: boolean
  vendidos?: number
}

export interface OfertaAvaliada extends OfertaBruta {
  semelhanca: number
  divergencia: number     // positivo = concorrente mais barato
  severidade: Severidade
}

/**
 * Classifica a oferta pela distância até o nosso preço.
 *   critico  → concorrente ≥ limiar abaixo de nós
 *   atencao  → abaixo de nós, porém dentro do limiar
 *   alinhado → até 2% de diferença, para qualquer lado
 *   acima    → concorrente mais caro que nós
 */
export function classificarSeveridade(divergencia: number, limiar = LIMIAR_CRITICO_PADRAO): Severidade {
  if (divergencia >= limiar) return 'critico'
  if (divergencia > 0.02) return 'atencao'
  if (divergencia >= -0.02) return 'alinhado'
  return 'acima'
}

export const SEVERIDADE_META: Record<Severidade, { label: string; cor: string; icone: string; ordem: number; acao: string }> = {
  critico:  { label: 'Crítico',  cor: '#d03b3b', icone: '▼', ordem: 0, acao: 'Revisar preço ou destacar diferencial' },
  atencao:  { label: 'Atenção',  cor: '#ec835a', icone: '▽', ordem: 1, acao: 'Monitorar' },
  alinhado: { label: 'Alinhado', cor: '#1a7a4a', icone: '●', ordem: 2, acao: 'Manter' },
  acima:    { label: 'Acima',    cor: '#2b3272', icone: '▲', ordem: 3, acao: 'Espaço para subir o preço' },
}

/** Avalia as ofertas de um produto: descarta a loja própria e o que não casa. */
export function avaliarOfertas(
  nossoPreco: number,
  nossoTitulo: string,
  ofertas: OfertaBruta[],
  opts: { limiarCritico?: number; limiarSemelhanca?: number; apelidosProprios: string[] }
): OfertaAvaliada[] {
  const limiar = opts.limiarCritico ?? LIMIAR_CRITICO_PADRAO
  const minSem = opts.limiarSemelhanca ?? LIMIAR_SEMELHANCA_PADRAO
  if (!(nossoPreco > 0)) return []

  return ofertas
    .filter(o => o.preco > 0)
    .filter(o => !ehLojaPropria(o.vendedor, opts.apelidosProprios))
    .map(o => {
      const sem = semelhanca(nossoTitulo, o.titulo)
      const divergencia = (nossoPreco - o.preco) / nossoPreco
      return { ...o, semelhanca: sem, divergencia, severidade: classificarSeveridade(divergencia, limiar) }
    })
    .filter(o => o.semelhanca >= minSem)
    .sort((a, b) => b.divergencia - a.divergencia)   // mais barato primeiro = mais ameaçador
}

export interface ResumoProduto {
  sku: string | null
  produto: string
  nossoPreco: number
  ofertas: OfertaAvaliada[]
  menorPreco: number | null
  precoMediano: number | null
  posicao: number | null        // 1 = somos o mais barato do conjunto
  totalConcorrentes: number
  criticos: number
  divergenciaMaxima: number     // o quanto o concorrente mais barato nos corta
}

export function resumirProduto(sku: string | null, produto: string, nossoPreco: number, ofertas: OfertaAvaliada[]): ResumoProduto {
  const precos = ofertas.map(o => o.preco).sort((a, b) => a - b)
  const mediana = precos.length
    ? (precos.length % 2 ? precos[(precos.length - 1) / 2] : (precos[precos.length / 2 - 1] + precos[precos.length / 2]) / 2)
    : null
  // Posição da loja na lista de preços (nós + concorrentes), do mais barato ao mais caro
  const posicao = precos.length ? precos.filter(p => p < nossoPreco).length + 1 : null
  return {
    sku, produto, nossoPreco, ofertas,
    menorPreco: precos.length ? precos[0] : null,
    precoMediano: mediana,
    posicao,
    totalConcorrentes: ofertas.length,
    criticos: ofertas.filter(o => o.severidade === 'critico').length,
    divergenciaMaxima: ofertas.length ? Math.max(...ofertas.map(o => o.divergencia)) : 0,
  }
}

/** Concorrentes recorrentes: quem mais aparece abaixo do nosso preço, somando produtos. */
export interface ConcorrenteResumo {
  vendedor: string
  produtos: number
  criticos: number
  divergenciaMedia: number
  menorDivergencia: number
  maiorDivergencia: number
}

export function rankingConcorrentes(resumos: ResumoProduto[]): ConcorrenteResumo[] {
  const mapa = new Map<string, { divs: number[]; criticos: number; produtos: Set<string> }>()
  resumos.forEach(r => r.ofertas.forEach(o => {
    const atual = mapa.get(o.vendedor) ?? { divs: [], criticos: 0, produtos: new Set<string>() }
    atual.divs.push(o.divergencia)
    if (o.severidade === 'critico') atual.criticos++
    atual.produtos.add(r.sku || r.produto)
    mapa.set(o.vendedor, atual)
  }))
  return Array.from(mapa.entries())
    .map(([vendedor, v]) => ({
      vendedor,
      produtos: v.produtos.size,
      criticos: v.criticos,
      divergenciaMedia: v.divs.reduce((a, b) => a + b, 0) / v.divs.length,
      menorDivergencia: Math.min(...v.divs),
      maiorDivergencia: Math.max(...v.divs),
    }))
    .sort((a, b) => b.criticos - a.criticos || b.divergenciaMedia - a.divergenciaMedia)
}
