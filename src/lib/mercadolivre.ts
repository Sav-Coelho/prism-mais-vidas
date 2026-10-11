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
 * O access_token dura 6 horas e é renovado a cada execução pelo refresh_token.
 * Como o radar roda uma vez por semana, não vale a pena guardar o access_token:
 * ele já teria expirado na execução seguinte.
 */

const API = 'https://api.mercadolibre.com'

export interface MLConfig { clientId: string; clientSecret: string; refreshToken: string; sellerNicks: string[] }

export class SemCredencialML extends Error {
  constructor() {
    super('Credenciais do Mercado Livre não configuradas (ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REFRESH_TOKEN).')
    this.name = 'SemCredencialML'
  }
}

export function lerConfig(): MLConfig | null {
  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  const refreshToken = process.env.ML_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null
  return {
    clientId, clientSecret, refreshToken,
    sellerNicks: String(process.env.ML_SELLER_NICKS || 'tiochicoshop')
      .split(',').map(s => s.trim()).filter(Boolean),
  }
}

/**
 * Troca o refresh_token por um access_token. O Mercado Livre devolve um
 * refresh_token NOVO a cada troca e invalida o anterior — por isso o valor novo
 * é devolvido junto, para ser gravado e usado na semana seguinte.
 */
export async function obterAccessToken(cfg: MLConfig): Promise<{ accessToken: string; novoRefreshToken: string | null }> {
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

/**
 * Busca anúncios ativos no Mercado Livre Brasil. `seller.nickname` nem sempre vem
 * no resultado da busca; quando faltar, usamos o id do vendedor como rótulo para
 * não perder a identificação do concorrente.
 */
export async function buscarOfertas(accessToken: string, consulta: string, limite = 20): Promise<MLItem[]> {
  const url = `${API}/sites/MLB/search?q=${encodeURIComponent(consulta)}&limit=${Math.min(limite, 50)}&condition=new`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' } })
  if (res.status === 401 || res.status === 403) throw new Error(`Mercado Livre recusou a consulta (HTTP ${res.status}) — token inválido ou sem permissão.`)
  if (!res.ok) throw new Error(`Mercado Livre respondeu HTTP ${res.status}`)
  const j = await res.json().catch(() => null)
  const results: any[] = Array.isArray(j?.results) ? j.results : []
  return results.map(r => ({
    mlItemId: String(r.id || ''),
    titulo: String(r.title || ''),
    preco: Number(r.price) || 0,
    vendedor: String(r.seller?.nickname || r.seller?.id || 'desconhecido'),
    vendedorId: r.seller?.id != null ? String(r.seller.id) : null,
    permalink: String(r.permalink || ''),
    freteGratis: Boolean(r.shipping?.free_shipping),
    vendidos: Number(r.sold_quantity) || 0,
  })).filter(i => i.mlItemId && i.titulo)
}

/** Pausa entre consultas — educação com a API e margem contra limite de taxa. */
export const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))
