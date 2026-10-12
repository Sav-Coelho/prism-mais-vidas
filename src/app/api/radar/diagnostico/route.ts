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

  // Cadeia do catálogo: é ela que substitui a busca pública. Procura o produto no
  // catálogo, abre a ficha e lista as ofertas — se as três etapas responderem, o
  // radar tem de onde tirar preço de concorrente sem depender de /sites/search.
  let cadeia: any = null
  if (searchParams.get('cadeia') === '1') {
    cadeia = { consulta: q, etapas: [] as any[] }
    try {
      const r = await fetch(`${API}/products/search?site_id=MLB&q=${encodeURIComponent(q)}&limit=3`,
        { headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' } })
      const j = await r.json().catch(() => null)
      const achados = Array.isArray(j?.results) ? j.results : []
      cadeia.etapas.push({
        etapa: '1. buscar no catálogo', status: r.status, quantos: achados.length,
        amostra: achados.slice(0, 3).map((p: any) => ({ id: p.id, nome: p.name, status: p.status })),
      })
      const produtoId = achados[0]?.id
      if (produtoId) {
        const r2 = await fetch(`${API}/products/${produtoId}`,
          { headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' } })
        const p2 = await r2.json().catch(() => null)
        cadeia.etapas.push({
          etapa: '2. ficha do produto', status: r2.status, produtoId,
          nome: p2?.name, campos: p2 ? Object.keys(p2).slice(0, 20) : null,
          // buy_box_winner é o anúncio que está ganhando a página do produto:
          // vendedor e preço do concorrente, que é exatamente o que o radar quer.
          vencedor: p2?.buy_box_winner ? {
            itemId: p2.buy_box_winner.item_id, preco: p2.buy_box_winner.price,
            vendedorId: p2.buy_box_winner.seller_id, moeda: p2.buy_box_winner.currency_id,
          } : null,
        })
        await pausa(150)
        const r3 = await fetch(`${API}/products/${produtoId}/items`,
          { headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' } })
        const t3 = await r3.text().catch(() => '')
        let ofertas: any = t3.slice(0, 300)
        try {
          const j3 = JSON.parse(t3)
          const lista = Array.isArray(j3?.results) ? j3.results : Array.isArray(j3) ? j3 : []
          if (lista.length) ofertas = lista.slice(0, 5).map((o: any) => ({
            itemId: o.item_id || o.id, preco: o.price, vendedorId: o.seller_id,
            frete: o.shipping?.free_shipping ?? null, vendidos: o.sold_quantity ?? null,
          }))
        } catch { /* corpo não-JSON fica como texto */ }
        cadeia.etapas.push({ etapa: '3. ofertas do produto (concorrentes)', status: r3.status, ofertas })
      }
    } catch (e: any) {
      cadeia.erro = String(e?.message || e).slice(0, 200)
    }
  }

  const abertos = sondas.filter(s => s.status >= 200 && s.status < 300).map(s => s.url)
  const fechados = sondas.filter(s => s.status === 401 || s.status === 403).map(s => `${s.url} → ${s.status}`)

  return NextResponse.json({
    origemToken,
    tokenExpiraEm: expiraEm ? new Date(expiraEm).toISOString() : null,
    temRefreshToken: Boolean(refreshEmUso),
    sondas,
    resumo: { abertos, fechados },
    ...(cadeia ? { cadeia } : {}),
  })
}
