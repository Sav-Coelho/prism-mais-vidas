import { NextRequest, NextResponse } from 'next/server'
import { pagina } from '@/lib/pagina-html'
import { urlBase } from '@/lib/mercadolivre'

export const runtime = 'nodejs'

// Passo 1 da autorização: manda o usuário ao Mercado Livre para autorizar o
// aplicativo. O ML volta para /api/radar/oauth/callback com um código de uso
// único, que lá é trocado pelos tokens. Assim ninguém precisa montar URL à mão
// nem copiar código entre abas — que é onde essa configuração costuma travar.

export async function GET(req: NextRequest) {
  const clientId = process.env.ML_CLIENT_ID
  const redirectUri = `${urlBase(req)}/api/radar/oauth/callback`

  if (!clientId) {
    return new NextResponse(pagina(
      'Falta o App ID',
      `<p>Cadastre <code>ML_CLIENT_ID</code> e <code>ML_CLIENT_SECRET</code> nas variáveis de ambiente da Vercel e volte aqui.</p>
       <p class="nota">Ao criar a aplicação no Mercado Livre, informe exatamente esta URL de redirecionamento:</p>
       <p class="url">${redirectUri}</p>`,
    ), { status: 428, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  const auth = new URL('https://auth.mercadolivre.com.br/authorization')
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('client_id', clientId)
  auth.searchParams.set('redirect_uri', redirectUri)
  return NextResponse.redirect(auth.toString())
}
