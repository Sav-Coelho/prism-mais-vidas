/**
 * Cliente da API do Mercado Livre.
 *
 * ── Por que precisa de credencial ────────────────────────────────────────────
 * O acesso anônimo foi encerrado: em out/2026, `/sites/MLB/search` e até
 * `/sites/MLB` respondem 403 sem token. O caminho suportado é registrar uma
 * aplicação em developers.mercadolivre.com.br e usar OAuth 2.0.
 *
 * Variáveis de ambiente (definidas no painel da Vercel, nunca no código):
 *   ML_CLIENT_ID       — App ID da aplicação
 *   ML_CLIENT_SECRET   — Secret da aplicação
 *   ML_REFRESH_TOKEN   — obtido uma única vez na autorização; vale 6 meses
 *   ML_SELLER_NICKS    — apelidos da própria loja, separados por vírgula,
 *                        para excluir os anúncios dela da comparação
 *
 * O access_token dura 6 horas. Quando o Mercado Livre devolve refresh_token, ele é
 * renovado sozinho a cada varredura; quando não devolve, vale o token de 6 horas
 * guardado na autorização e é preciso repetir o passo de autorizar.
 *
 * ── O que a API ainda permite (medido em out/2026) ───────────────────────────
 * ABERTO : /users/me · /users/{id} · /sites/MLB · /sites/MLB/categories
 *          /products/search · /products/{id} · /products/{id}/items
 * FECHADO: /sites/MLB/search (403 forbidden, para qualquer token)
 *          /items/{id} de terceiro (403 access_denied)
 *          /users/{id}/items/search de terceiro ("Searching another user items
 *          is restricted") e /items/{id}/price_to_win (só do dono do anúncio)
 *
 * Por isso o radar trabalha pelo catálogo, não pela busca.
 */

const API = 'https://api.mercadolibre.com'

/**
 * URL base ESTÁVEL da aplicação, para montar a URL de redirecionamento do OAuth.
 *
 * Não usar `VERCEL_URL`: ela aponta para o deploy específico
 * (tio-chico-shop-1ojp6niiu-....vercel.app) e muda a cada publicação — a URL
 * cadastrada no Mercado Livre deixaria de bater no dia seguinte, e o ML exige que
 * ela seja idêntica na autorização e na troca do código.
 *
 * A ordem usa primeiro o domínio que o navegador realmente acessou, porque é o
 * que a pessoa vê na barra de endereços e vai cadastrar no Mercado Livre.
 */
export function urlBase(req: Request): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (host && !/^localhost|127\.0\.0\.1/.test(host)) {
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${host}`
  }
  const producao = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (producao) return `https://${producao}`
  return new URL(req.url).origin
}

export interface MLConfig { clientId: string; clientSecret: string; refreshToken: string | null; sellerNicks: string[] }

/**
 * Só o App ID e o Secret vêm de variável de ambiente. O refresh_token é obtido na
 * autorização (/api/radar/oauth/start) e guardado no banco, porque é de uso único
 * e muda a cada renovação — não caberia numa env var. `ML_REFRESH_TOKEN` segue
 * aceita como semente, para quem já tiver um token em mãos.
 */
export function lerConfig(): MLConfig | null {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return {
    clientId, clientSecret,
    refreshToken: process.env.ML_REFRESH_TOKEN || null,
    sellerNicks: String(process.env.ML_SELLER_NICKS || 'tiochicoshop')
      .split(',').map(s => s.trim()).filter(Boolean),
  }
}

/**
 * Troca o refresh_token por um access_token. O Mercado Livre devolve um
 * refresh_token NOVO a cada troca e invalida o anterior — por isso o valor novo
 * é devolvido junto, para ser gravado e usado na semana seguinte.
 */
export async function obterAccessToken(cfg: MLConfig & { refreshToken: string }): Promise<{ accessToken: string; novoRefreshToken: string | null }> {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
    }),
  })
  const j = await res.json().catch(() => null)
  if (!res.ok || !j?.access_token) {
    const detalhe = j?.message || j?.error_description || j?.error || `HTTP ${res.status}`
    throw new Error(`Falha ao renovar o token do Mercado Livre: ${detalhe}`)
  }
  return { accessToken: j.access_token, novoRefreshToken: j.refresh_token ?? null }
}

export interface MLItem {
  mlItemId: string
  titulo: string
  preco: number
  vendedor: string
  vendedorId: string | null
  permalink: string
  freteGratis: boolean
  vendidos: number
}

/** Produto do catálogo do Mercado Livre — a "página do produto" que os anúncios disputam. */
export interface MLProdutoCatalogo { id: string; nome: string; permalink: string }

async function mlGet(accessToken: string, caminho: string): Promise<any> {
  const res = await fetch(`${API}${caminho}`, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Mercado Livre recusou a consulta (HTTP ${res.status}) — token inválido ou sem permissão.`)
  }
  if (res.status === 404) return null          // produto sem oferta ativa não é erro
  if (!res.ok) throw new Error(`Mercado Livre respondeu HTTP ${res.status} em ${caminho}`)
  return res.json().catch(() => null)
}

/**
 * Procura o produto no CATÁLOGO. `status=active` é obrigatório: sem ele voltam
 * fichas desativadas, que não têm nenhuma oferta e fariam o radar concluir que o
 * produto não tem concorrente.
 */
export async function buscarProdutosCatalogo(accessToken: string, consulta: string, limite = 3): Promise<MLProdutoCatalogo[]> {
  const j = await mlGet(accessToken, `/products/search?site_id=MLB&status=active&q=${encodeURIComponent(consulta)}&limit=${Math.min(limite, 10)}`)
  const results: any[] = Array.isArray(j?.results) ? j.results : []
  return results
    .map(p => {
      const id = String(p.id || '')
      // A busca de catálogo não devolve permalink; a página do produto é previsível
      // a partir do id, e é para ela que o radar precisa mandar quem for conferir.
      return { id, nome: String(p.name || ''), permalink: String(p.permalink || '') || (id ? `https://www.mercadolivre.com.br/p/${id}` : '') }
    })
    .filter(p => p.id && p.nome)
}

/**
 * Ofertas (anúncios concorrentes) de um produto do catálogo.
 *
 * Esta resposta é a ÚNICA fonte de dado do concorrente: `/items/{id}` devolve 403
 * para anúncio de terceiro. Por isso o título e o link vêm da ficha do produto —
 * que é o certo, já que todas as ofertas disputam exatamente o mesmo produto.
 */
export async function ofertasDoProduto(accessToken: string, produto: MLProdutoCatalogo): Promise<MLItem[]> {
  const j = await mlGet(accessToken, `/products/${encodeURIComponent(produto.id)}/items`)
  if (!j) return []
  const lista: any[] = Array.isArray(j?.results) ? j.results : Array.isArray(j) ? j : []
  return lista.map(o => ({
    mlItemId: String(o.item_id || o.id || ''),
    titulo: produto.nome,
    preco: Number(o.price) || 0,
    vendedor: String(o.seller_id ?? 'desconhecido'),   // apelido é resolvido depois
    vendedorId: o.seller_id != null ? String(o.seller_id) : null,
    permalink: produto.permalink,
    freteGratis: Boolean(o.shipping?.free_shipping),
    vendidos: 0,                                        // o catálogo não informa
  })).filter(i => i.mlItemId && i.preco > 0)
}

/** Apelido do vendedor a partir do id. O cache evita repetir a chamada na varredura. */
export async function apelidoVendedor(accessToken: string, vendedorId: string, cache: Map<string, string>): Promise<string> {
  const guardado = cache.get(vendedorId)
  if (guardado) return guardado
  try {
    const j = await mlGet(accessToken, `/users/${encodeURIComponent(vendedorId)}`)
    const apelido = String(j?.nickname || vendedorId)
    cache.set(vendedorId, apelido)
    return apelido
  } catch {
    // Falhar o apelido não pode derrubar a comparação de preço, que é o que importa.
    cache.set(vendedorId, vendedorId)
    return vendedorId
  }
}

/**
 * Busca as ofertas concorrentes de um produto nosso.
 *
 * ── Por que pelo catálogo e não pela busca ───────────────────────────────────
 * `/sites/MLB/search` devolve 403 mesmo com token válido — o Mercado Livre fechou
 * a busca pública (verificado em out/2026; integrações antigas de terceiros
 * quebraram junto). O caminho que continua aberto é o catálogo:
 *
 *   /products/search → acha a página do produto
 *   /products/{id}/items → lista quem está vendendo e por quanto
 *
 * Resultado melhor que o anterior, inclusive: compara anúncios do MESMO produto,
 * em vez de adivinhar semelhança entre títulos livres.
 */
export async function buscarOfertas(
  accessToken: string,
  consulta: string,
  limite = 20,
  cacheVendedores?: Map<string, string>,
): Promise<MLItem[]> {
  const produtos = await buscarProdutosCatalogo(accessToken, consulta, 3)
  const cache = cacheVendedores ?? new Map<string, string>()

  const ofertas: MLItem[] = []
  const vistos = new Set<string>()
  for (const p of produtos) {
    if (ofertas.length >= limite) break
    const doProduto = await ofertasDoProduto(accessToken, p)
    for (const o of doProduto) {
      if (vistos.has(o.mlItemId)) continue
      vistos.add(o.mlItemId)
      ofertas.push(o)
    }
    await pausa(120)
  }

  // Resolve o apelido só dos vendedores que realmente apareceram — é o que permite
  // reconhecer e excluir a própria loja da comparação.
  const ids = Array.from(new Set(ofertas.map(o => o.vendedorId).filter(Boolean) as string[]))
  for (const id of ids) {
    const apelido = await apelidoVendedor(accessToken, id, cache)
    ofertas.forEach(o => { if (o.vendedorId === id) o.vendedor = apelido })
    if (!cache.has(id)) await pausa(80)
  }

  return ofertas.slice(0, limite)
}

/** Pausa entre consultas — educação com a API e margem contra limite de taxa. */
export const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))
