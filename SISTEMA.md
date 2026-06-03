# Prism — Documentação Completa do Sistema
**Tio Chico Shop · Versão documentada em maio de 2026**

Este documento descreve a arquitetura, funcionalidades, decisões técnicas e plano de contas
do sistema Prism, para que outro Claude (ou desenvolvedor) possa entender e evoluir o sistema.

---

## 1. Visão Geral

Prism é um **sistema de gestão financeira** para a empresa Tio Chico Shop (e-commerce). Ele permite:

- Importar extratos bancários (.OFX) e faturas de cartão de crédito (PDF Sicoob ou CSV genérico)
- Classificar transações em um plano de contas hierárquico
- Gerar DRE (Demonstração do Resultado do Exercício) mensal e anual
- Visualizar indicadores no Dashboard com gráficos de linha
- Controlar clientes, vendas, fornecedores e ordens de compra
- Consultar saldo bancário com snapshots históricos

**Stack:** Next.js 14 App Router · Prisma ORM · Neon PostgreSQL · Vercel (hobby)  
**Repositório:** `github.com/Sav-Coelho/prism-mais-vidas`  
**URL produção:** `https://prism-mais-vidas.vercel.app`  
**Sem autenticação** — acesso público direto.

---

## 2. Estrutura de Pastas

```
src/
  app/
    page.tsx                    → redireciona para /dashboard
    dashboard/page.tsx          → Dashboard com KPIs e gráficos de linha
    dre/page.tsx                → DRE detalhado com coluna AV%
    lancamentos/page.tsx        → Import OFX / Cartão / Lançamento Manual
    plano-de-contas/page.tsx    → CRUD do plano de contas
    clientes/page.tsx           → Cadastro de clientes e vendas
    compras/page.tsx            → Pedidos de compra / fornecedores
    saldo/page.tsx              → Saldo bancário e snapshots
    unidades/page.tsx           → CRUD de unidades e contas bancárias
    api/
      dre/route.ts              → GET ?month&year → DRE + yearData
      transactions/route.ts     → GET (filtros) / POST (manual)
      transactions/[id]/route.ts → PUT (classificar) / DELETE
      ofx/route.ts              → POST (salvar lote OFX/cartão)
      ofx/parse/route.ts        → POST multipart → parse OFX
      pdf/parse/route.ts        → POST multipart → parse PDF Sicoob
      classify/suggest/route.ts → POST → sugestões Jaccard histórico
      accounts/route.ts         → GET / POST plano de contas
      accounts/[id]/route.ts    → PUT / DELETE conta
      accounts/import/route.ts  → POST Excel → importar plano
      units/route.ts            → GET / POST unidades
      units/[id]/route.ts       → PUT / DELETE unidade
      bank-accounts/route.ts    → POST conta bancária
      bank-accounts/[id]/route.ts → PUT / DELETE conta bancária
      clients/route.ts          → GET / POST clientes
      clients/[id]/route.ts     → GET / PUT / DELETE cliente
      sales/route.ts            → GET / POST vendas
      sales/[id]/route.ts       → DELETE venda
      suppliers/route.ts        → GET / POST fornecedores
      suppliers/[id]/route.ts   → PUT / DELETE fornecedor
      purchase-orders/route.ts  → GET / POST ordens de compra
      purchase-orders/[id]/route.ts → GET / PUT / DELETE ordem
      saldo/route.ts            → GET saldo por conta bancária
  lib/
    prisma.ts                   → singleton PrismaClient + seed inicial
    dre.ts                      → calcDRE() + tipos DRELine / DREData
    classifier.ts               → tokenize() + jaccardSimilarity()
    sicoob-pdf-parser.ts        → parseSicoobPDF() → transações do PDF
    csv-parser.ts               → parseCSV() → transações de CSV genérico
  components/
    Shell.tsx                   → layout com sidebar + header
    AccountCombobox.tsx         → combobox com busca para plano de contas
prisma/
  schema.prisma                 → schema do banco
```

---

## 3. Banco de Dados (Prisma + Neon PostgreSQL)

Schema gerenciado com `prisma db push` — **sem arquivos de migration**.  
Qualquer alteração no schema é aplicada direto com `npm run build`.

### Modelos principais

#### Transaction
Campo central do sistema. Toda despesa/receita classificada é uma Transaction.

| Campo | Tipo | Descrição |
|---|---|---|
| `fitid` | String? unique | ID do OFX / `sicoob_*` / `csv_*` — evita duplicatas |
| `date` | DateTime | Data real da transação |
| `month` | Int | Mês contábil (pode diferir do `date` para faturas de cartão) |
| `year` | Int | Ano contábil |
| `amount` | Float | Valor — negativo = despesa, positivo = receita |
| `description` | String | Texto exibido na tabela |
| `memo` | String? | Texto original do OFX (usado pelo classificador) |
| `accountId` | Int? | null = não classificado, excluído da DRE |
| `unitId` | Int? | Unidade de negócio |
| `bankAccountId` | Int? | Conta bancária de origem |
| `transferToUnitId` | Int? | Destino de transferência (saída) |
| `transferToBankAccountId` | Int? | Conta destino da transferência |

> **⚠️ Regra crítica de cartão de crédito:** transações de cartão usam `month`/`year` do
> **mês da fatura** (ex: compra de outubro na fatura de abril paga em maio → `month=5, year=2026`),
> não da data real da compra. O campo `date` guarda a data real para exibição.

#### Account (Plano de Contas)

| Campo | Tipo | Valores |
|---|---|---|
| `code` | String unique | Ex: `1.1.01`, `3.2.01` |
| `type` | String | `RECEITA` \| `DESPESA` \| `CUSTO` \| `DEDUCAO` \| `IMPOSTO` \| `NEUTRO` |
| `dreGroup` | String | Ver seção 5 — grupos da DRE |

#### BankAccount
Cada unidade pode ter N contas bancárias. Os campos `ofxBankId` e `ofxAcctId` são
preenchidos automaticamente na primeira importação OFX para identificação futura.

---

## 4. Funcionalidades por Página

### 4.1 Dashboard (`/dashboard`)
- **Padrão:** abre em modo **Consolidado Anual** (soma de todos os meses do ano)
- Toggle "Consolidado Anual / Mês Específico" no canto superior direito
- **KPIs:** Receita Bruta, Receita Líquida, Margem de Contribuição, Lucro Operacional, Resultado Líquido (com % da receita)
- **Gráficos (topo):** Barras — Receita x Resultado por mês; Linha — Evolução do Resultado Líquido
- **Gráficos (rodapé):** dois gráficos de linha:
  - *Evolução dos Resultados (R$):* Receita Bruta, Margem Contribuição, Lucro Operacional, Resultado Líquido
  - *Evolução das Margens (%):* Margem Contribuição %, Margem Operacional %, Margem Líquida %
- API: `GET /api/dre?month=0&year=2026` → mês=0 retorna consolidado do ano inteiro

### 4.2 DRE (`/dre`)
- Seletor de unidade + mês + ano
- **Coluna AV%** em todas as linhas: participação percentual sobre Receita Operacional Bruta
- Subtotais em negrito com cor (verde/vermelho)
- Três pontos de equilíbrio: PEO (operacional), PEI (com investimentos), PEF (financeiro)
- Gráfico de barras comparativo anual
- Tabela de histórico mensal com margem líquida %

### 4.3 Lançamentos (`/lancamentos`)
Três abas de importação:

**📂 Extrato OFX**
1. Upload do .ofx → `POST /api/ofx/parse` → extrai transações e identifica banco
2. Classificador inteligente roda em background (`POST /api/classify/suggest`)
3. Painel flutuante mostra sugestões com % de confiança (aceitar/rejeitar individualmente ou em lote)
4. `POST /api/ofx` salva o lote com `createMany({ skipDuplicates: true })`

**💳 Fatura Cartão de Crédito**
- Aceita PDF Sicoob (`parseSicoobPDF`) ou CSV genérico (`parseCSV`)
- Prévia mostra aviso azul: *"Todos os lançamentos serão registrados em [MÊS]/[ANO]"*
- O mês/ano é o **selecionado no topo da página** — a usuária deve selecionar o mês do pagamento da fatura antes de importar
- Ao classificar uma linha, transações com descrição similar (Jaccard ≥ 0.5) aparecem no painel de sugestões para revisão
- Identificadas pelo `fitid`: `sicoob_*` (PDF) ou `csv_*` (CSV genérico)

**✏️ Lançamento Manual**
- Formulário com data, descrição, valor, tipo (receita/despesa), unidade, conta bancária e plano de contas
- Uso: tarifas de plataformas de e-commerce, lançamentos pontuais

**Tabela de lançamentos (parte inferior)**
- Filtros: Total · Sem classificação · Classificados · 💳 Cartão de Crédito
- O filtro Cartão mostra transações do mês/ano selecionado com `fitid` iniciando em `sicoob_` ou `csv_`
- Badge azul "💳 cartão" identifica visualmente cada lançamento de cartão na tabela consolidada

### 4.4 Plano de Contas (`/plano-de-contas`)
- CRUD completo: criar, editar, desativar contas
- Agrupamento por tipo e `dreGroup`
- Import via Excel (`.xlsx`)
- Conta especial `9.9.01 — Transferência entre Contas` (type=`NEUTRO`): seeded automaticamente no boot, nunca entra na DRE

### 4.5 Clientes e Vendas (`/clientes`)
- Cadastro de clientes com CPF, telefone, e-mail, unidade
- Registro de vendas vinculadas ao cliente (independente do fluxo OFX)

### 4.6 Compras (`/compras`)
- Cadastro de fornecedores
- Ordens de compra com itens, status (DRAFT/SENT/RECEIVED), datas esperadas/recebidas

### 4.7 Saldo (`/saldo`)
- Saldo atual por conta bancária (via BalanceSnapshots)
- Histórico de snapshots diários

### 4.8 Unidades (`/unidades`)
- CRUD de unidades de negócio e suas contas bancárias
- Delete bloqueado se houver transações ou vendas associadas

---

## 5. DRE — Grupos e Fluxo de Cálculo

### Grupos válidos para `dreGroup` (exatos — case-sensitive)

| dreGroup | type sugerido | Posição na DRE |
|---|---|---|
| `Receita Operacional` | RECEITA | Receita bruta |
| `Deduções sobre a Venda` | DEDUCAO | (-) Deduções |
| `Custo do Produto/Serviço` | CUSTO | (-) Custos Variáveis |
| `Despesa Variável` | CUSTO | (-) Custos Variáveis |
| `Despesas Administrativas` | DESPESA | (-) Custos Fixos |
| `Despesas Financeiras` | DESPESA | (-) Custos Fixos |
| `Despesas com Pessoal` | DESPESA | (-) Custos Fixos |
| `Despesas com Marketing` | DESPESA | (-) Custos Fixos |
| `Despesas Comerciais` | DESPESA | (-) Custos Fixos |
| `Investimentos` | DESPESA | (-) Investimentos |
| `Receita Não Operacional` | RECEITA | (+/-) Não Operacional |
| `Despesas Não Operacionais` | DESPESA | (+/-) Não Operacional |
| `Impostos` | IMPOSTO | (-) Impostos |
| `Transferência entre Contas` | NEUTRO | Informativo (não soma) |

### Fórmula da DRE

```
Receita Operacional
- Deduções sobre a Venda
= Receita Líquida
- Custo do Produto/Serviço
- Despesa Variável
= Margem de Contribuição   ← PEO (ponto de equilíbrio operacional)
- Despesas Administrativas
- Despesas Financeiras
- Despesas com Pessoal
- Despesas com Marketing
- Despesas Comerciais
= Lucro Operacional (EBIT) ← PEI (ponto de equilíbrio de investimentos)
- Investimentos
= Lucro após Investimentos ← PEF (ponto de equilíbrio financeiro)
+ Receita Não Operacional
- Despesas Não Operacionais
= Lucro antes dos Impostos
- Impostos
= Lucro Líquido
```

---

## 6. Plano de Contas — Tio Chico Shop

Cadastrado via API em maio de 2026. Códigos e grupos:

| Código | Nome | dreGroup |
|---|---|---|
| 1.1.01 | Vendas Mercado Livre | Receita Operacional |
| 1.1.02 | Vendas Amazon | Receita Operacional |
| 1.1.03 | Vendas TikTok Shop | Receita Operacional |
| 1.1.04 | Vendas Shopee | Receita Operacional |
| 1.1.05 | Vendas Nuvemshop | Receita Operacional |
| 2.1.01 | CMV — Compras de Estoque | Custo do Produto/Serviço |
| 2.2.01 | Logística — Motoboy (Pex) | Despesa Variável |
| 2.2.02 | Logística — Correios | Despesa Variável |
| 2.2.03 | Logística — Process | Despesa Variável |
| 3.1.01 | Aluguel | Despesas Administrativas |
| 3.1.02 | Contabilidade (Roma) | Despesas Administrativas |
| 3.1.03 | Bling ERP | Despesas Administrativas |
| 3.1.04 | Sglobal | Despesas Administrativas |
| 3.1.05 | Telefonia (Vivo) | Despesas Administrativas |
| 3.1.06 | Energia Elétrica (Enel) | Despesas Administrativas |
| 3.1.07 | Tarifas Bancárias | Despesas Administrativas |
| 3.1.08 | Cartão Empresarial | Despesas Administrativas |
| 3.1.09 | Outros Administrativos | Despesas Administrativas |
| 3.2.01 | Folha de Pagamento | Despesas com Pessoal |
| 3.2.02 | Pró-Labore / Retiradas Sócio | Despesas com Pessoal |
| 3.3.01 | Gestor de Tráfego | Despesas com Marketing |
| 3.3.02 | Frenet + Plataformas | Despesas com Marketing |
| 3.4.01 | Parcelas Empréstimo GiroFGI | Despesas Financeiras |
| 4.1.01 | Simples Nacional DAS+GPS | Impostos |
| 5.1.01 | Rendimentos CDB | Receita Não Operacional |
| 9.9.01 | Transferência entre Contas | Transferência entre Contas |

---

## 7. Parser PDF Sicoob (`src/lib/sicoob-pdf-parser.ts`)

O extrato PDF do Sicoob tem formato peculiar quando extraído pelo `pdf-parse`:

- **Sem espaço** entre data e descrição: `06/12AMAZON BR SAO PAULO34,29`
- **Cabeçalho colado:** `Fatura de ABRILVencimento: 03/04/2026`
- **Taxa de câmbio colada ao valor:** `V.DOL 5,138256,52` (exchange rate `5,1382` + valor BRL `56,52`)
- **Data em linha separada** para transações do portador adicional:
  ```
  24/06
  BR1*CHINA*LINK*DO*BR 09/12 SAO
  PAULO
  1.000,00
  ```

**Estratégia do parser:**
1. `TX_HEAD = /^(\d{2})\/(\d{2})/` — detecta início de transação (sem espaço obrigatório)
2. `AMT_TAIL = /(-?\d{1,3}(?:\.\d{3})*,\d{2})$/` — detecta valor BRL no final
3. **State machine:** acumula linhas (`pending`) até encontrar `AMT_TAIL` → flush como transação completa
4. `VDOL_RE = /V\.DOL\s+\d[\d.]*,\d{4}/i` — strip da anotação de câmbio antes de extrair valor
5. **Inferência de ano:** `txMonth > stmtMonth → stmtYear - 1` (compra de dezembro na fatura de janeiro = dezembro do ano anterior)
6. **Sinal invertido:** `amount = -rawAmt` (compras positivas no extrato → negativas no sistema = despesa)
7. **fitid:** `sicoob_{YYYYMMDD}_{valor_cents_padded}_{index}`

---

## 8. Classificador Inteligente (`src/lib/classifier.ts`)

```
tokenize(memo):
  lowercase → remover dígitos → remover não-letras → split → manter tokens > 2 chars

jaccardSimilarity(A, B):
  |A ∩ B| / |A ∪ B|
```

**Dois momentos de classificação:**

1. **Ao carregar o arquivo** (`runClassifier`):
   - Backend compara memos com histórico de transações já classificadas no banco
   - Threshold: ≥ 0.35
   - Resultado exibido no painel flutuante "Classificador inteligente"
   - Usuária aceita/rejeita individualmente ou em lote

2. **Ao classificar uma linha manualmente** (`handlePreviewAccountChange`):
   - Frontend compara com todas as transações do arquivo atual
   - Threshold: ≥ 0.5 (mais restrito para evitar falsos positivos)
   - Sugestões adicionadas ao painel — **nunca auto-aplicadas**
   - Classificação manual afeta somente a linha selecionada

---

## 9. Constraints Técnicas Críticas

### TypeScript / Vercel Build

```typescript
// ❌ quebra no build Vercel
const arr = [...set]
for (const [k, v] of map) { }

// ✅ correto
const arr = Array.from(set)
Array.from(map.entries()).forEach(([k, v]) => { })
```

### pdf-parse (CommonJS em Next.js)

```javascript
// next.config.js — NECESSÁRIO para pdf-parse funcionar
experimental: { serverComponentsExternalPackages: ['@prisma/client', 'prisma', 'pdf-parse'] },
webpack: (config) => {
  config.resolve.alias = { ...config.resolve.alias, canvas: false }
  return config
},
```

### DRE API — mês 0 = consolidado anual

```
GET /api/dre?month=0&year=2026   → soma todos os meses do ano
GET /api/dre?month=5&year=2026   → apenas maio/2026
```

### Imports de cartão — mês contábil vs. data da compra

A API `POST /api/ofx` aceita `invoiceMonth` e `invoiceYear` opcionais no body.
Quando presentes, sobrescrevem `month`/`year` de todas as transações do lote.
Para cartão, o frontend sempre envia o mês/ano selecionado na página.

---

## 10. Deploy

```bash
git push origin HEAD:main   # dispara auto-deploy no Vercel
```

Build script (package.json): `prisma generate && prisma db push && next build`

**Variáveis de ambiente no Vercel:**
- `DATABASE_URL` — Neon pooling URL
- `DIRECT_URL` — Neon direct URL (usado pelo `prisma db push` no build)

**Sem test suite.** Validação de tipos via `npm run build`.

---

## 11. Como Atualizar um Prism Mais Antigo

Para aplicar as funcionalidades deste sistema (Tio Chico Shop) em uma versão anterior do Prism,
as principais adições a implementar são, por ordem de impacto:

### A. Importação de Fatura de Cartão de Crédito
1. Instalar `pdf-parse`: `npm install pdf-parse`
2. Atualizar `next.config.js` com `serverComponentsExternalPackages` e `canvas: false`
3. Criar `src/lib/sicoob-pdf-parser.ts` (parser regex do PDF Sicoob)
4. Criar `src/lib/csv-parser.ts` (parser CSV genérico)
5. Criar `src/app/api/pdf/parse/route.ts`
6. Na página de lançamentos, adicionar aba "💳 Fatura Cartão de Crédito"
7. Em `POST /api/ofx`, adicionar suporte a `invoiceMonth`/`invoiceYear` no body

### B. DRE Consolidado Anual no Dashboard
1. Em `GET /api/dre`, permitir `month=0` (remover a validação `!month`)
2. No Dashboard, adicionar toggle "Consolidado Anual / Mês Específico"
3. Substituir tabela DRE por 2 gráficos de linha (resultados R$ + margens %)

### C. Coluna AV% na DRE
1. Em `src/app/dre/page.tsx`, adicionar coluna de percentual ao lado de cada valor
2. Fórmula: `(|valor| / receitaBruta) * 100`

### D. Grupos de Plano de Contas Adicionais
1. Em `src/lib/dre.ts`, adicionar `despCom = g('Despesas Comerciais')` no cálculo de `custosFixos`
2. Adicionar linha `Despesas Comerciais` no array `lines`
3. Em `src/app/plano-de-contas/page.tsx`, adicionar `'Despesas Comerciais'` no `DRE_GROUPS.DESPESA`

### E. Filtro de Cartão de Crédito na Tabela de Lançamentos
1. Adicionar filtro `'cartao'` que filtra por `t.fitid?.startsWith('sicoob_') || t.fitid?.startsWith('csv_')`
2. Adicionar card de métrica "💳 Cartão de Crédito" na grade de KPIs
3. Badge azul na coluna de descrição para transações de cartão

---

## 12. Decisões de Design Importantes

| Decisão | Razão |
|---|---|
| `month`/`year` separados do `date` | Permite que faturas de cartão sejam contabilizadas no mês do pagamento, não da compra |
| `fitid` único global | Previne reimportação duplicada — OFX usa o FITID nativo; cartão usa padrão `sicoob_`/`csv_` |
| `prisma db push` sem migrations | Simplicidade para projeto solo — sem histórico de migrações, schema é fonte da verdade |
| Sem autenticação | Projeto interno, acesso restrito por URL — simplifica desenvolvimento |
| Jaccard sem IA | Sem custo de API, funciona offline, determinístico, suficiente para memos bancários curtos |
| `previewSource = 'csv'` para PDF e CSV | PDF Sicoob e CSV genérico têm o mesmo fluxo de preview/save — unificados no mesmo state |
| `month=0` na API DRE para consolidado | Evita nova rota — reusa a mesma endpoint com filtro de mês opcional |
