import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Passo 1 da autorização: manda o usuário ao Mercado Livre para autorizar o
// aplicativo. O ML volta para /api/radar/oauth/callback com um código de uso
// único, que lá é trocado pelos tokens. Assim ninguém precisa montar URL à mão
// nem copiar código entre abas — que é onde essa configuração costuma travar.

export async function GET(req: NextRequest) {
  const clientId = process.env.ML_CLIENT_ID
  const origem = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : new URL(req.url).origin
  const redirectUri = `${origem}/api/radar/oauth/callback`

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

export function pagina(titulo: string, corpo: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo} · Prism</title>
<style>
 body{font-family:'Red Hat Display',Segoe UI,system-ui,sans-serif;background:#edf2f4;color:#2b2d42;margin:0;padding:40px 20px}
 .card{max-width:620px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid rgba(43,45,66,.1);padding:28px 32px}
 h1{font-family:Montserrat,sans-serif;font-size:19px;margin:0 0 14px}
 p{line-height:1.6;font-size:14px;margin:0 0 10px}
 code{background:#edf2f4;padding:2px 6px;border-radius:4px;font-size:13px}
 .url{background:#2b2d42;color:#eaca2d;padding:10px 14px;border-radius:8px;font-size:13px;word-break:break-all;font-family:ui-monospace,monospace}
 .nota{color:#505168;font-size:12.5px}
 .ok{color:#1a7a4a;font-weight:700} .erro{color:#c0392b;font-weight:700}
 a.btn{display:inline-block;margin-top:14px;background:#eaca2d;color:#2b2d42;padding:9px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px}
</style></head><body><div class="card"><h1>${titulo}</h1>${corpo}</div></body></html>`
}
