import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { pagina } from '@/lib/pagina-html'
import { urlBase } from '@/lib/mercadolivre'

export const runtime = 'nodejs'

// Passo 2: o Mercado Livre devolve um código de uso único. Aqui ele é trocado
// pelos tokens e o refresh_token é GRAVADO no banco — ele é de uso único e muda
// a cada renovação, então não pode viver numa variável de ambiente.
//
// O refresh_token nunca é exibido nesta página: quem precisa dele é o servidor.

const html = (corpo: string, status = 200) =>
  new NextResponse(corpo, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const erroML = searchParams.get('error')

  if (erroML) {
    return html(pagina('Autorização recusada', `
      <p class="erro">O Mercado Livre recusou a autorização: ${erroML}</p>
      <p>Confira se a URL de redirecionamento cadastrada na aplicação é exatamente a mesma usada aqui.</p>
      <a class="btn" href="/api/radar/oauth/start">Tentar de novo</a>`), 400)
  }
  if (!code) {
    return html(pagina('Código ausente', `
      <p>Esta página só funciona como retorno da autorização do Mercado Livre.</p>
      <a class="btn" href="/api/radar/oauth/start">Começar a autorização</a>`), 400)
  }

  const clientId = process.env.ML_CLIENT_ID
  const clientSecret = process.env.ML_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return html(pagina('Falta credencial', `
      <p class="erro">Cadastre <code>ML_CLIENT_ID</code> e <code>ML_CLIENT_SECRET</code> na Vercel antes de autorizar.</p>`), 428)
  }

  const redirectUri = `${urlBase(req)}/api/radar/oauth/callback`

  try {
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId, client_secret: clientSecret,
        code, redirect_uri: redirectUri,
      }),
    })
    const j = await res.json().catch(() => null)

    // O access_token é guardado sempre que vier, mesmo sem refresh_token: vale 6
    // horas e permite rodar a primeira varredura enquanto o offline_access é
    // ajustado no DevCenter. Melhor entregar valor hoje do que travar tudo.
    if (j?.access_token) {
      const expira = Date.now() + (Number(j.expires_in) || 21600) * 1000
      await prisma.setting.upsert({
        where: { key: 'ml_access_token' }, update: { value: j.access_token },
        create: { key: 'ml_access_token', value: j.access_token },
      }).catch(() => {})
      await prisma.setting.upsert({
        where: { key: 'ml_access_expira' }, update: { value: String(expira) },
        create: { key: 'ml_access_expira', value: String(expira) },
      }).catch(() => {})
    }

    // Caso específico e silencioso: o Mercado Livre aceitou tudo (HTTP 200, veio
    // access_token) mas não devolveu refresh_token. É falta do escopo
    // offline_access na APLICAÇÃO — a URL de autorização não controla isso.
    if (res.ok && j?.access_token && !j?.refresh_token) {
      const concedidos = String(j.scope || '(não informado)')
      return html(pagina('Falta o escopo offline_access', `
        <p class="erro">A autorização funcionou, mas o Mercado Livre não devolveu <code>refresh_token</code>.</p>
        <p>Escopos concedidos nesta autorização: <code>${concedidos}</code></p>
        <p>O <code>offline_access</code> é um escopo <strong>da aplicação</strong> e precisa estar marcado no
        DevCenter — não dá para pedi-lo pela URL. Vá em <em>Minhas aplicações → sua aplicação → Editar</em>,
        marque <strong>offline_access</strong> junto com <strong>read</strong>, salve e autorize de novo.</p>
        <p class="ok">O token de 6 horas foi guardado: já dá para rodar a primeira varredura agora, enquanto
        você ajusta o escopo.</p>
        <a class="btn" href="/marketing">Ir para o Radar e rodar agora</a>
        <a class="btn" style="background:#edf2f4" href="/api/radar/oauth/start">Autorizar de novo</a>`), 502)
    }

    if (!res.ok || !j?.refresh_token) {
      const detalhe = j?.message || j?.error_description || j?.error || `HTTP ${res.status}`
      return html(pagina('Não foi possível obter o token', `
        <p class="erro">${String(detalhe).slice(0, 300)}</p>
        <p class="nota">As duas causas mais comuns:</p>
        <p class="nota"><strong>1.</strong> A URL de redirecionamento cadastrada na aplicação não é exatamente esta:</p>
        <p class="url">${redirectUri}</p>
        <p class="nota"><strong>2.</strong> A opção <strong>PKCE</strong> está ligada na aplicação. Ela é opcional no
        Mercado Livre e esta integração não a utiliza — desligue-a no DevCenter e tente de novo.</p>
        <a class="btn" href="/api/radar/oauth/start">Tentar de novo</a>`), 502)
    }

    await prisma.setting.upsert({
      where: { key: 'ml_refresh_token' },
      update: { value: j.refresh_token },
      create: { key: 'ml_refresh_token', value: j.refresh_token },
    })
    await prisma.setting.upsert({
      where: { key: 'ml_autorizado_em' },
      update: { value: new Date().toISOString() },
      create: { key: 'ml_autorizado_em', value: new Date().toISOString() },
    }).catch(() => {})

    return html(pagina('Mercado Livre conectado', `
      <p class="ok">Autorização concluída.</p>
      <p>O token de acesso é renovado sozinho a cada varredura — não é preciso repetir este passo,
      a menos que a aplicação fique 6 meses sem uso.</p>
      <p class="nota">Confirme também a variável <code>ML_SELLER_NICKS</code> com o apelido da loja no
      Mercado Livre, para que os anúncios da própria Tio Chico fiquem fora da comparação.</p>
      <a class="btn" href="/marketing">Ir para o Radar de Preços</a>`))
  } catch (e: any) {
    return html(pagina('Erro ao conectar', `<p class="erro">${String(e?.message || e).slice(0, 300)}</p>`), 500)
  }
}
