import { prisma } from './prisma'

/**
 * Catálogo da loja ordenado pela relevância de venda.
 *
 * O radar não varre tudo: consulta ao Mercado Livre custa tempo e a execução é
 * serverless. Olhar primeiro o que gira concentra o esforço onde uma diferença de
 * preço vira dinheiro — produto parado pode esperar a próxima semana.
 *
 * Fica aqui, e não dentro da rota, porque a varredura e o diagnóstico de cobertura
 * precisam enxergar exatamente a MESMA lista: se divergirem, o diagnóstico mede um
 * radar que não existe.
 */
export interface ProdutoRadar {
  sku: string | null
  produto: string
  preco: number
  giro: number
}

export async function produtosPrioritarios(limite: number): Promise<ProdutoRadar[]> {
  const [catalogo, vendas] = await Promise.all([
    prisma.marginProduct.findMany({ where: { salePrice: { gt: 0 } } }),
    prisma.salesRecord.findMany({ where: { month: 0, year: 0 } }),
  ])

  const chave = (sku: unknown, produto: unknown) =>
    String(sku || '').trim() || String(produto || '').toLowerCase().trim()

  const vendidas = new Map<string, number>()
  vendas.forEach(v => {
    const k = chave(v.sku, v.product)
    if (k) vendidas.set(k, (vendidas.get(k) || 0) + v.quantity)
  })

  return catalogo
    .map(p => ({
      sku: p.sku,
      produto: p.product,
      preco: p.salePrice,
      giro: vendidas.get(chave(p.sku, p.product)) || 0,
    }))
    .sort((a, b) => b.giro - a.giro || b.preco - a.preco)
    .slice(0, limite)
}
