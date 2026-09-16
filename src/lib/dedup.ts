/**
 * Deduplicação de lançamentos por CONTEÚDO — rede de proteção além do FITID.
 *
 * Por que o FITID não basta:
 *
 * 1. **O FITID do Sicoob não é estável.** Ele é montado como
 *    `<AAAAMMDD><valor><sequência>` (ex.: `202607165000001` e `202607165000002`
 *    para dois PIX de R$ 5.000 em 16/07). A sequência é atribuída na ordem do
 *    arquivo — reexportar o extrato com outro intervalo renumera os lançamentos.
 *    Quem depende dessa sequência para se distinguir são justamente os itens de
 *    mesmo valor repetido: **parcelas, mensalidades e PIX recorrentes**. Ao subir
 *    o extrato de novo, eles chegam com FITID diferente e entram em duplicidade.
 *
 * 2. **A mesma fatura pode vir em três formatos**, cada um com seu prefixo:
 *    PDF (`sicoob_…`), CSV (`csv_…`) e OFX (`card_…`). São namespaces distintos
 *    para a mesma compra — nada dedupa entre eles.
 *
 * 3. **OFX sem FITID** cai no fallback do parser; antes ele era aleatório, então
 *    cada importação criava linhas novas.
 *
 * A chave de conteúdo é `data | valor | descrição normalizada`. A descrição entra
 * na chave de propósito: é o que distingue a parcela `01/06` da `02/06` de uma
 * mesma compra (mesma data e mesmo valor) — elas são cobranças diferentes e as
 * duas devem entrar.
 *
 * A comparação é por **multiplicidade**, não por existência: se o arquivo traz
 * dois lançamentos iguais e o banco já tem um, entra apenas um. Assim dois PIX
 * legítimos de mesmo valor no mesmo dia continuam sendo importados, e reimportar
 * o mesmo arquivo não insere nada.
 */

/** Hash determinístico (FNV-1a): mesmo conteúdo, mesmo id, em qualquer importação. */
export function stableHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Remove acentos, colapsa espaços e baixa a caixa — o mesmo item vindo de PDF e de OFX converge. */
export function normalizeDesc(s: string | null | undefined): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `AAAA-MM-DD|-1234.56|descricao normalizada`
 *
 * A data é lida como DIA DE CALENDÁRIO. Cuidado necessário: `new Date('2026-03-24')`
 * é interpretado como meia-noite UTC e, no fuso -03, vira 23/03 no horário local —
 * a mesma transação geraria chaves diferentes conforme a origem trouxesse a data com
 * ou sem hora. Por isso a string só-data é lida diretamente, sem passar por Date.
 */
export function contentKey(date: Date | string, amount: number, description: string | null | undefined): string {
  let dk: string
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
    dk = date.trim()
  } else {
    const d = date instanceof Date ? date : new Date(date)
    dk = isNaN(d.getTime())
      ? 'sem-data'
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return `${dk}|${Number(amount).toFixed(2)}|${normalizeDesc(description)}`
}

/** Contagem de ocorrências por chave. */
export function countKeys(keys: string[]): Map<string, number> {
  const m = new Map<string, number>()
  keys.forEach(k => m.set(k, (m.get(k) || 0) + 1))
  return m
}

/**
 * Marca cada item de entrada como duplicata do que já existe, respeitando a
 * multiplicidade: o n-ésimo item de uma chave só é duplicata se já existirem
 * n ocorrências dela. Preserva a ordem da entrada.
 */
export function flagDuplicates<T>(
  incoming: T[],
  keyOf: (t: T) => string,
  existingKeys: string[]
): boolean[] {
  const restante = countKeys(existingKeys)
  return incoming.map(item => {
    const k = keyOf(item)
    const n = restante.get(k) || 0
    if (n > 0) { restante.set(k, n - 1); return true }
    return false
  })
}
