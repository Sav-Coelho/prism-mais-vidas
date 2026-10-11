import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { lerConfig, obterAccessToken, buscarOfertas, pausa } from '@/lib/mercadolivre'
import { montarConsulta, avaliarOfertas, LIMIAR_CRITICO_PADRAO, LIMIAR_SEMELHANCA_PADRAO } from '@/lib/radar'

export const runtime = 'nodejs'
export const maxDuration = 60

// Executa a varredura em LOTES. Cada chamada consulta o Mercado Livre enquanto
// houver orçamento de tempo e devolve o ponto onde parou; quem chamou (a tela ou
// o agendador) repete até concluir. Serverless tem teto de tempo, e consultar
// dezenas de produtos de uma vez estouraria esse teto.

const ORCAMENTO_MS = 45_000        // folga sobre o maxDuration de 60s
const PAUSA_ENTRE_CONSULTAS = 250  // educação com a API do Mercado Livre

/** Ordena o catálogo pela relevância de venda: o radar olha primeiro o que gira. */
async function produtosPrioritarios(limite: number) {
  const [catalogo, vendas] = await Promise.all([
    prisma.marginProduct.findMany({ where: { salePrice: { gt: 0 } } }),
    prisma.salesRecord.findMany({ where: { month: 0, year: 0 } }),
  ])
  const vendidas = new Map<string, number>()
  vendas.forEach(v => {
    const k = String(v.sku || '').trim() || String(v.product || '').toLowerCase().trim()
    if (k) vendidas.set(k, (vendidas.get(k) || 0) + v.quantity)
  })
  return catalogo
    .map(p => ({
      sku: p.sku,
      produto: p.product,
      preco: p.salePrice,
      giro: vendidas.get(String(p.sku || '').trim() || String(p.product).toLowerCase().trim()) || 0,
    }))
    .sort((a, b) => b.giro - a.giro || b.preco - a.preco)
    .slice(0, limite)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    scanId?: number; offset?: number; limiteProdutos?: number
    limiarCritico?: number; origem?: string
  }
  const limiteProdutos = Math.min(Math.max(body.limiteProdutos ?? 40, 1), 200)
  const limiarCritico = body.limiarCritico ?? LIMIAR_CRITICO_PADRAO
  const offset = Math.max(body.offset ?? 0, 0)

  const cfg = lerConfig()
  if (!cfg) {
    // Sem credencial não há varredura possível — registra o motivo de forma
    // explícita para a tela orientar em vez de só mostrar "erro".
    if (!body.scanId) {
      await prisma.radarScan.create({
        data: { status: 'sem_credencial', origem: body.origem ?? 'manual', finishedAt: new Date(),
          erro: 'Configure ML_CLIENT_ID e ML_CLIENT_SECRET nas variáveis de ambiente da Vercel.' },
      }).catch(() => {})
    }
    return NextResponse.json({
      erro: 'sem_credencial',
      mensagem: 'O radar precisa de um aplicativo do Mercado Livre. Crie em developers.mercadolivre.com.br e informe ML_CLIENT_ID e ML_CLIENT_SECRET na Vercel.',
    }, { status: 428 })
  }

  const produtos = await produtosPrioritarios(limiteProdutos)
  if (produtos.length === 0) {
    return NextResponse.json({ erro: 'sem_catalogo', mensagem: 'Nenhum produto com preço de venda no catálogo. Importe a lista em Produtos.' }, { status: 422 })
  }

  // Cria a varredura na primeira chamada; as seguintes continuam a mesma.
  let scanId = body.scanId
  if (!scanId) {
    const scan = await prisma.radarScan.create({ data: { status: 'rodando', origem: body.origem ?? 'manual' } })
    scanId = scan.id
  }

  // O refresh_token do Mercado Livre é de uso único. O valor em uso fica no
  // Setting (gravado na renovação anterior); a env var é só a semente inicial.
  const guardado = await prisma.setting.findUnique({ where: { key: 'ml_refresh_token' } }).catch(() => null)
  const refreshEmUso = guardado?.value || cfg.refreshToken
  if (!refreshEmUso) {
    // App cadastrado, mas ainda não autorizado: falta o clique de uma vez só.
    if (!body.scanId) {
      await prisma.radarScan.create({
        data: { status: 'sem_credencial', origem: body.origem ?? 'manual', finishedAt: new Date(),
          erro: 'Aplicativo ainda não autorizado. Abra /api/radar/oauth/start uma única vez.' },
      }).catch(() => {})
    }
    return NextResponse.json({
      erro: 'sem_autorizacao',
      mensagem: 'O aplicativo está cadastrado mas ainda não foi autorizado. Abra /api/radar/oauth/start uma única vez para conectar.',
    }, { status: 428 })
  }

  let accessToken: string
  try {
    const tok = await obterAccessToken({ ...cfg, refreshToken: refreshEmUso })
    accessToken = tok.accessToken
    if (tok.novoRefreshToken && tok.novoRefreshToken !== refreshEmUso) {
      await prisma.setting.upsert({
        where: { key: 'ml_refresh_token' },
        update: { value: tok.novoRefreshToken },
        create: { key: 'ml_refresh_token', value: tok.novoRefreshToken },
      }).catch(() => {})
    }
  } catch (e: any) {
    await prisma.radarScan.update({
      where: { id: scanId },
      data: { status: 'erro', finishedAt: new Date(), erro: String(e?.message || e).slice(0, 400) },
    }).catch(() => {})
    return NextResponse.json({ erro: 'token', mensagem: String(e?.message || e) }, { status: 502 })
  }

  const inicio = Date.now()
  let i = offset
  let consultados = 0, semConcorrente = 0, criadas = 0, criticos = 0
  const falhas: string[] = []

  while (i < produtos.length && Date.now() - inicio < ORCAMENTO_MS) {
    const p = produtos[i]
    try {
      const consulta = montarConsulta(p.produto)
      const brutas = await buscarOfertas(accessToken, consulta, 25)
      const avaliadas = avaliarOfertas(p.preco, p.produto, brutas, {
        limiarCritico, limiarSemelhanca: LIMIAR_SEMELHANCA_PADRAO, apelidosProprios: cfg.sellerNicks,
      })
      if (avaliadas.length === 0) semConcorrente++
      else {
        await prisma.radarOffer.createMany({
          data: avaliadas.map(o => ({
            scanId: scanId!, sku: p.sku, produto: p.produto, nossoPreco: p.preco,
            mlItemId: o.mlItemId, titulo: o.titulo, preco: o.preco,
            vendedor: o.vendedor, vendedorId: o.vendedorId ?? null, permalink: o.permalink,
            freteGratis: !!o.freteGratis, vendidos: o.vendidos ?? 0,
            semelhanca: o.semelhanca, divergencia: o.divergencia, severidade: o.severidade,
          })),
        })
        criadas += avaliadas.length
        criticos += avaliadas.filter(o => o.severidade === 'critico').length
      }
      consultados++
    } catch (e: any) {
      falhas.push(`${p.sku || p.produto}: ${String(e?.message || e).slice(0, 120)}`)
      // Erro de autorização derruba a varredura inteira — não adianta insistir
      if (/401|403/.test(String(e?.message || ''))) { i++; break }
    }
    i++
    if (i < produtos.length) await pausa(PAUSA_ENTRE_CONSULTAS)
  }

  const concluido = i >= produtos.length
  const agregado = await prisma.radarOffer.aggregate({ where: { scanId }, _count: true })
  const criticosTotais = await prisma.radarOffer.count({ where: { scanId, severidade: 'critico' } })

  await prisma.radarScan.update({
    where: { id: scanId },
    data: {
      produtos: { increment: consultados },
      semConcorrente: { increment: semConcorrente },
      ofertas: agregado._count,
      criticos: criticosTotais,
      ...(concluido ? { status: falhas.length && agregado._count === 0 ? 'erro' : 'concluido', finishedAt: new Date() } : {}),
      ...(falhas.length ? { erro: falhas.slice(0, 5).join(' · ').slice(0, 400) } : {}),
    },
  }).catch(() => {})

  return NextResponse.json({
    scanId, offset: i, total: produtos.length, concluido,
    nesteLote: { consultados, semConcorrente, ofertas: criadas, criticos },
    acumulado: { ofertas: agregado._count, criticos: criticosTotais },
    falhas,
  })
}
