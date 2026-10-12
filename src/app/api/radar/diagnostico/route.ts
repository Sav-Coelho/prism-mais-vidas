import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { lerConfig, obterAccessToken, pausa } from '@/lib/mercadolivre'

export const runtime = 'nodejs'
export const maxDuration = 60

// Mede o que o token do Mercado Livre REALMENTE consegue acessar.
//
// Contexto: `/sites/MLB/search` passou a devolver 403 mesmo com token válido, e
// não é problema desta aplicação — integrações antigas de outros desenvolvedores
// quebraram junto. Antes de reescrever o radar é preciso saber quais portas ainda
// estão abertas, e esta rota responde isso com evidência em vez de suposição.
//
// Nunca devolve o token: só o status e o começo da resposta de cada endpoint.

const API = 'https://api.mercadolibre.com'

async function sondar(url: string, accessToken: string) {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    })
    const texto = await res.text().catch(() => '')
    let resumo = texto.slice(0, 220)
    // Em resposta boa, o corpo inteiro não interessa — só o sinal de que veio dado.
    try {
      const j = JSON.parse(texto)
      if (res.ok) {
        const n = Array.isArray(j?.results) ? j.results.length
          : Array.isArray(j) ? j.length : null
        resumo = n !== null ? `OK — ${n} resultado(s)` : `OK — ${Object.keys(j || {}).slice(0, 8).join(', ')}`
      }
    } catch { /* corpo não-JSON: fica o texto cru mesmo */ }
    return { url: url.replace(API, ''), status: res.status, resposta: resumo }
  } catch (e: any) {
    return { url: url.replace(API, ''), status: 0, resposta: String(e?.message || e).slice(0, 200) }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') || 'lanterna'
  const nick = searchParams.get('nick') || (process.env.ML_SELLER_NICKS || 'tiochicoshop').split(',')[0].trim()

  const cfg = lerConfig()
  if (!cfg) return NextResponse.json({ erro: 'Sem ML_CLIENT_ID/ML_CLIENT_SECRET na Vercel.' }, { status: 428 })

  const [guardado, accessGuardado, expiraGuardado] = await Promise.all([
    prisma.setting.findUnique({ where: { key: 'ml_refresh_token' } }).catch(() => null),
    prisma.setting.findUnique({ where: { key: 'ml_access_token' } }).catch(() => null),
    prisma.setting.findUnique({ where: { key: 'ml_access_expira' } }).catch(() => null),
  ])
  const expiraEm = Number(expiraGuardado?.value || 0)
  const accessAindaVale = accessGuardado?.value && expiraEm > Date.now() + 60_000 ? accessGuardado.value : null

  let accessToken = accessAindaVale
  let origemToken = 'token de 6h guardado na autorização'
  const refreshEmUso = guardado?.value || cfg.refreshToken
  if (!accessToken && refreshEmUso) {
    try {
      const tok = await obterAccessToken({ ...cfg, refreshToken: refreshEmUso })
      accessToken = tok.accessToken
      origemToken = 'renovado pelo refresh_token'
    } catch (e: any) {
      return NextResponse.json({ erro: 'Não foi possível obter token', detalhe: String(e?.message || e) }, { status: 502 })
    }
  }
  if (!accessToken) {
    return NextResponse.json({
      erro: 'sem_autorizacao',
      mensagem: 'Nenhum token válido. Abra /api/radar/oauth/start para autorizar.',
      expirouEm: expiraEm ? new Date(expiraEm).toISOString() : null,
    }, { status: 428 })
  }

  // 1ª rodada: identidade e endpoints que não dependem de nenhum id.
  const eu = await sondar(`${API}/users/me`, accessToken)
  let meuId: string | null = null
  try {
    const r = await fetch(`${API}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } })
    const j = await r.json().catch(() => null)
    if (j?.id) meuId = String(j.id)
  } catch { /* identidade é opcional para o resto do diagnóstico */ }

  // Alvos escolhidos para separar três hipóteses: (a) a busca pública caiu para
  // todos, (b) o catálogo ainda responde, (c) o caminho do vendedor — listar os
  // próprios anúncios e perguntar quem está ganhando — continua aberto. É (c) que
  // sustenta o radar se (a) estiver mesmo fechada.
  const vendedor = searchParams.get('seller')
  const item = searchParams.get('item')
  const produto = searchParams.get('product')

  const alvos = [
    `${API}/sites/MLB`,
    `${API}/sites/MLB/search?q=${encodeURIComponent(q)}&limit=1`,
    `${API}/sites/MLB/search?nickname=${encodeURIComponent(nick)}&limit=1`,
    `${API}/products/search?site_id=MLB&q=${encodeURIComponent(q)}&limit=1`,
    `${API}/sites/MLB/categories`,
    ...(meuId ? [`${API}/users/${meuId}/items/search?limit=1`] : []),
    ...(vendedor ? [
      `${API}/users/${vendedor}`,
      `${API}/users/${vendedor}/items/search?limit=1`,
      `${API}/sites/MLB/search?seller_id=${vendedor}&limit=1`,
    ] : []),
    ...(item ? [
      `${API}/items/${item}`,
      `${API}/items/${item}/price_to_win?version=v2`,
    ] : []),
    ...(produto ? [
      `${API}/products/${produto}`,
      `${API}/products/${produto}/items`,
    ] : []),
  ]

  const sondas = [eu]
  for (let i = 0; i < alvos.length; i++) {
    sondas.push(await sondar(alvos[i], accessToken))
    if (i < alvos.length - 1) await pausa(150)
  }

  const abertos = sondas.filter(s => s.status >= 200 && s.status < 300).map(s => s.url)
  const fechados = sondas.filter(s => s.status === 401 || s.status === 403).map(s => `${s.url} → ${s.status}`)

  return NextResponse.json({
    origemToken,
    tokenExpiraEm: expiraEm ? new Date(expiraEm).toISOString() : null,
    temRefreshToken: Boolean(refreshEmUso),
    sondas,
    resumo: { abertos, fechados },
  })
}
