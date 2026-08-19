# CONTEXTO — Prism Mais Vidas

Sistema financeiro da **Brave Educação** operando para o cliente **Tio Chico Shop** —
evolução do Prism DRE com módulos de Clientes, Vendas, Fornecedores, Ordens de Compra,
Curva ABC, Margem de Contribuição por produto e Fluxo de Caixa Projetado.

Dono/dev: Savio (savio@braveeducacao.com.br)
Path local: `G:\.shortcut-targets-by-id\...\Tio Chico Shop\prism-mais-vidas\` (Google Drive)
Deploy: Vercel (hobby) — auto-deploy a cada `git push` no main
Banco: PostgreSQL Neon, região `sa-east-1` (São Paulo), free tier (0.5 GB)

---

## Stack

| Camada | Tech |
|--------|------|
| Frontend | Next.js 14 (App Router) + TypeScript strict |
| Backend | API Routes serverless (mesmo projeto) |
| ORM | Prisma 5 |
| DB | PostgreSQL — Neon free (0.5 GB, 5h compute/mês) |
| Gráficos | Recharts |
| Planilhas | xlsx |
| PDF | pdf-parse (extrato de cartão Sicoob) |
| IA | @anthropic-ai/sdk (rota `/api/ai/chat`, modelo Haiku 4.5) |
| Deploy | Vercel — `prisma generate && prisma db push && next build` |

Env vars:
```
DATABASE_URL=       # Neon connection pooling (runtime)
DIRECT_URL=         # Neon direct URL (para prisma db push no build)
ANTHROPIC_API_KEY=  # Claude API — usado por /api/ai/chat
```

Sem autenticação. Sem suite de testes — type-check apenas via `npm run build`.

---

## Estrutura de arquivos

```
prism-mais-vidas/
├── prisma/
│   └── schema.prisma              # 13 modelos
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Title="Prism · Tio Chico Shop"
│   │   ├── page.tsx               # Redirect → /dashboard
│   │   ├── globals.css            # Sistema de design (sem biblioteca UI)
│   │   ├── dashboard/page.tsx     # KPIs + gráfico DRE anual
│   │   ├── dre/page.tsx           # DRE estruturado + gráfico anual
│   │   ├── lancamentos/page.tsx   # Importação OFX/CSV/PDF + classificação (maior página, ~1150 linhas)
│   │   ├── plano-de-contas/       # CRUD de contas do plano
│   │   ├── saldo/page.tsx         # Evolução de saldo por conta bancária
│   │   ├── unidades/              # CRUD dinâmico de unidades e contas bancárias
│   │   ├── clientes/page.tsx      # Cadastro e listagem de clientes + vendas
│   │   ├── compras/page.tsx       # Ordens de compra e fornecedores (~1240 linhas)
│   │   ├── curva-abc/page.tsx     # Curva ABC de Vendas e Estoque (Pareto + giro/GMROI)
│   │   ├── margem-contribuicao/   # Margem de contribuição por produto (rateio via DRE)
│   │   ├── fluxo-projetado/page.tsx # Fluxo de caixa projetado (despesas fixas × receita)
│   │   └── api/
│   │       ├── accounts/route.ts             # GET lista, POST cria
│   │       ├── accounts/[id]/route.ts        # PUT edita, DELETE remove
│   │       ├── accounts/import/route.ts      # POST importação Excel do plano de contas
│   │       ├── classify/suggest/route.ts     # POST sugestões Jaccard
│   │       ├── dre/route.ts                  # GET DRE mensal (month=0 → ano) + yearData
│   │       ├── ofx/route.ts                  # POST salva lançamentos em lote (OFX/CSV/PDF)
│   │       ├── ofx/parse/route.ts            # POST parseia OFX → preview
│   │       ├── pdf/parse/route.ts            # POST parseia extrato de cartão Sicoob (PDF)
│   │       ├── saldo/route.ts                # GET snapshots de saldo
│   │       ├── transactions/route.ts         # GET lista filtrada, POST cria
│   │       ├── transactions/[id]/route.ts    # PUT classifica, DELETE remove
│   │       ├── units/route.ts                # GET unidades com bankAccounts, POST cria
│   │       ├── units/[id]/route.ts           # PUT/DELETE unidade
│   │       ├── units/seed/route.ts           # POST seed das 5 unidades do Tio Chico Shop
│   │       ├── bank-accounts/route.ts        # POST cria conta bancária
│   │       ├── bank-accounts/[id]/route.ts   # PUT/DELETE conta bancária
│   │       ├── clients/route.ts              # GET lista (inclui sales[]), POST cria
│   │       ├── clients/[id]/route.ts         # GET/PUT/DELETE cliente
│   │       ├── sales/route.ts                # GET lista (filtrável por clientId), POST cria
│   │       ├── sales/[id]/route.ts           # DELETE venda
│   │       ├── suppliers/route.ts            # GET lista, POST cria
│   │       ├── suppliers/[id]/route.ts       # PUT/DELETE fornecedor
│   │       ├── purchase-orders/route.ts      # GET lista, POST cria
│   │       ├── purchase-orders/[id]/route.ts # PUT/DELETE ordem de compra
│   │       ├── abc/vendas/route.ts           # GET/POST SalesRecord (Curva ABC de Vendas)
│   │       ├── abc/estoque/route.ts          # GET/POST StockItem (Curva ABC de Estoque)
│   │       ├── abc/inventario/route.ts       # POST inventário com custo → StockItem
│   │       ├── abc/import/route.ts           # POST relatório Bling → SalesRecord (qtd vendida)
│   │       ├── margem/route.ts               # GET/POST MarginProduct (catálogo geral)
│   │       ├── despesas-fixas/route.ts       # GET/POST FixedExpense (contas a pagar futuras)
│   │       └── ai/chat/route.ts              # POST chat IA com contexto da DRE do mês
│   ├── components/
│   │   ├── Shell.tsx              # Layout: topbar "Prism · Tio Chico Shop" + sidebar (11 itens)
│   │   ├── AccountCombobox.tsx    # Combobox buscável por nome/código
│   │   └── AIAssistant.tsx        # Assistente IA — DEFINIDO mas NÃO importado em nenhuma página
│   └── lib/
│       ├── prisma.ts              # Singleton PrismaClient + seed da conta 9.9.01
│       ├── ofx-parser.ts          # Parser OFX (transações, LEDGERBAL, info banco)
│       ├── sicoob-pdf-parser.ts   # Parser do extrato de cartão Sicoob (texto do PDF)
│       ├── csv-parser.ts          # Parser CSV genérico (usado em /lancamentos)
│       ├── spreadsheet.ts         # readSheetMatrix/findCol/parseNumberBR + sinônimos de coluna
│       ├── abc.ts                 # calcABC() + calcStockMetrics() (giro/cobertura/GMROI)
│       ├── dre.ts                 # calcDRE() + DRELineType + MONTH_NAMES
│       └── classifier.ts          # tokenize() + jaccardSimilarity()
├── CLAUDE.md                      # Guia técnico para Claude Code
└── CONTEXTO_PRISM.md              # Este arquivo
```

---

## As três origens de dados

O sistema tem **três fontes independentes** que só se cruzam em runtime (nunca persistem cruzadas):

1. **OFX/CSV/PDF bancário → `Transaction`** — espinha dorsal contábil. Alimenta DRE, saldos e classificação.
2. **Planilhas mensais → `SalesRecord` / `StockItem` / `MarginProduct` / `FixedExpense`** — analítica de varejo (Curva ABC, margem por produto, fluxo projetado).
3. **Cadastro manual → `Client`/`Sale` e `Supplier`/`PurchaseOrder`** — CRM e compras, hoje desacoplados da contabilidade.

---

## Schema do banco (13 modelos)

### Unit
```
id   Int    @id @default(autoincrement())
name String @unique
bankAccounts BankAccount[]   transactions Transaction[]
clients Client[]   sales Sale[]   purchaseOrders PurchaseOrder[]
salesRecords SalesRecord[]   stockItems StockItem[]
marginProducts MarginProduct[]   fixedExpenses FixedExpense[]
```
Sem seed automático no boot. Há um seed hardcoded opcional em `POST /api/units/seed`
(MATRIZ, CICERO, CIPO, NOVA SOURE, FERNANDA + respectivas contas bancárias).

### BankAccount
```
id Int @id · name String · unitId Int · initialBalance Float @default(0)
ofxBankId String? — BANKID ou ORG do <FI> · ofxAcctId String? — ACCTID
transactions Transaction[] · balanceSnapshots BalanceSnapshot[]
```

### Account (Plano de contas)
```
id Int @id · code String @unique (ex: "3.1.1") · name String
type String — RECEITA | DESPESA | ATIVO | PASSIVO | NEUTRO
dreGroup String · active Boolean @default(true) · createdAt DateTime
```
Conta especial `9.9.01 — Transferência entre Contas` (type=NEUTRO) — seeded no boot
(`prisma.ts`), nunca entra nos totais do DRE.

### Transaction
```
id Int @id · date DateTime · description String · amount Float · memo String?
fitid String? @unique — previne duplicatas OFX
accountId Int? — null = não classificado, excluído do DRE
unitId Int? · bankAccountId Int?
transferToUnitId Int? · transferToBankAccountId Int? — saída de transferência
month Int · year Int · createdAt DateTime
```
Contrapartida de entrada criada automaticamente com `fitid = original + '_entrada'`.

### BalanceSnapshot
```
id Int @id · bankAccountId Int · date DateTime · balance Float
@@unique([bankAccountId, date])
```

### Client / Sale
```
Client: id · name · email? · phone? · cpf? · unitId? · active · createdAt · sales[]
Sale:   id · clientId · description · amount · date · unitId? · month · year · createdAt
```
Fluxo independente do OFX — registros manuais de vendas vinculados a clientes.

### Supplier / PurchaseOrder / PurchaseItem
```
Supplier:      id · name · cnpj? · contactName? · email? · phone? · paymentTermDays(30) · notes? · active
PurchaseOrder: id · supplierId · unitId? · status(DRAFT) · expectedDate? · receivedDate?
               totalAmount(0) · notes? · month · year · createdAt · updatedAt · items[]
PurchaseItem:  id · orderId · description · quantity · unitPrice · receivedQty(0) · notes?
```

### SalesRecord  — Curva ABC de Vendas
```
id · product · sku? · category? · quantity(0) · revenue(0) · cost(0)
unitId? · month · year · createdAt · @@index([month, year])
```
Uma linha por produto por mês/ano/unidade. Re-upload do mesmo período substitui.

### StockItem — Curva ABC de Estoque + indicadores
```
id · product · sku? · category? · quantity(0) · unitCost(0)
unitId? · month · year · createdAt · @@index([month, year])
```
Valor do estoque = quantity × unitCost. Cruzado com o CMV da DRE para giro/cobertura/GMROI.

### MarginProduct — Análise de Margem de Contribuição
```
id · product · sku? · category? · salePrice(0) · replacementCost(0) · quantity(0)
unitId? · month · year · createdAt · @@index([month, year])
```
Catálogo GERAL (não é por período): armazenado com `month=0, year=0`.
Re-upload substitui todo o catálogo (opcionalmente escopado por unidade).
O rateio de despesas é calculado em runtime a partir da DRE — não é armazenado.

### FixedExpense — Fluxo de Caixa Projetado
```
id · description · category? · amount(0)
unitId? · month · year · createdAt · @@index([month, year])
```
Despesas fixas projetadas (contas a pagar futuras). Uma linha por despesa por mês/ano/unidade.
Re-upload substitui apenas os períodos presentes no arquivo (não apaga os demais).

---

## Fluxo de Importação Bancária (`/lancamentos`)

Aceita três formatos de entrada: **OFX** (banco), **CSV** e **PDF** (extrato de cartão Sicoob).

**OFX:**
1. `POST /api/ofx/parse` — parseia: detecta conta por `ofxBankId+ofxAcctId`, verifica duplicatas
   de `fitid` escopadas à conta, marca `isBalance=true` se `TRNTYPE=BALANCE` ou memo `/^saldo\b/i`.
   Retorna preview + `matchedBankAccount` + `ledgerBalance`.
2. `POST /api/classify/suggest` — roda classificador Jaccard em background.
3. UI: painel flutuante arrastável com sugestões (aceitar/negar por linha ou em lote).
4. `POST /api/ofx` — salva em lote com `createMany({ skipDuplicates: true })`; cria contrapartidas
   de transferência (`fitid + '_entrada'`); salva BalanceSnapshots; grava `ofxBankId/ofxAcctId` na
   primeira vez.

**PDF de cartão Sicoob** (`/api/pdf/parse` → `sicoob-pdf-parser.ts`):
- Extrai texto via `pdf-parse/lib/pdf-parse.js` (evita bug do index.js na Vercel).
- Lida com data+descrição colados, transações multi-linha, moeda estrangeira (`V.DOL`),
  seções "GASTOS DE [NOME]" ignoradas. Sinal invertido (positivo no extrato → despesa).
- Devolve `invoiceMonth/invoiceYear` — no `POST /api/ofx` esses campos forçam a competência
  no **mês da fatura**, não na data da compra.

---

## Classificador Inteligente (`src/lib/classifier.ts`)

```
tokenize(memo): lowercase → remove dígitos → remove não-letras → split → filtra tokens > 2 chars
jaccardSimilarity(A, B): |A∩B| / |A∪B|
```
- Threshold ≥ 0.35 para sugestões · propagação em tempo real ≥ 0.25.
- Transferências excluídas do histórico e da propagação.
- Usa `Array.from()` (nunca spread de Set) por causa do build da Vercel.

---

## DRE (`src/lib/dre.ts`)

```
type DRELineType = 'section' | 'group' | 'account' | 'subtotal' | 'breakeven' | 'transfer'
```

`calcDRE()` agrupa transações por `account.dreGroup`, usa `Math.abs()` e infere o sinal pelo grupo.

```
Receita Operacional
(-) Deduções sobre a Venda
= Receita Líquida

(-) Custos Variáveis (Custo do Produto/Serviço + Despesa Variável)
= Margem de Contribuição
= PEO (Ponto de Equilíbrio Operacional)

(-) Custos Fixos (Administrativas + Financeiras + Pessoal + Marketing + Comerciais)
= Lucro Operacional (EBIT)
= PEI (Ponto de Equilíbrio de Investimentos)

(-) Investimentos
= Lucro após Investimentos
= PEF (Ponto de Equilíbrio Financeiro)

(+/-) Receitas/Despesas Não Operacionais
= Lucro antes dos Impostos

(-) Impostos
= Lucro Líquido

--- Transferências entre Contas (informativo, type='transfer', não contabiliza) ---
```

Pontos de equilíbrio (`mcPct = margem / receitaOp`):
- `PEO = custosFixos / mcPct`
- `PEI = (custosFixos + invest) / mcPct`
- `PEF = (custosFixos + invest + max(0, despNaoOp − recNaoOp)) / mcPct`

Rota `GET /api/dre`: `month=0` → DRE consolidada do ano; sempre devolve também `yearData` (12 meses).

---

## Curva ABC e Indicadores de Estoque (`src/lib/abc.ts`)

`calcABC(items)`: ordena por valor decrescente, classifica pela % acumulada
(**A** ≤ 80% · **B** ≤ 95% · **C** restante). Cores: A verde, B amarelo, C vermelho.

`calcStockMetrics(estoqueValor, cmv, margemBruta, diasPeriodo=30)` — cruza estoque das planilhas
com CMV/margem da DRE:
```
Giro      = CMV / Estoque médio (a custo)            → vezes no período
Cobertura = Estoque médio / (CMV / dias do período)  → dias
GMROI     = Margem Bruta / Estoque médio (a custo)   → R$ de margem por R$ investido
```

**Importadores de planilha** (`/curva-abc`, via `spreadsheet.ts` com detecção de coluna por sinônimos):
- `/api/abc/vendas` — SalesRecord com faturamento/qtd/custo.
- `/api/abc/estoque` — StockItem com qtd × custo unitário.
- `/api/abc/inventario` — inventário com "Preço de Custo · Qtd. Estoque"; cabeçalhos de categoria em texto.
- `/api/abc/import` — "Relatório de Saída de Produtos" do Bling (só "Quantidade Total" → Vendas).

---

## Margem de Contribuição por produto (`/margem-contribuicao`)

Planilha traz Produto · Preço de Venda · Custo de Reposição · Qtd (opc. SKU/Categoria) → `MarginProduct`.

Cálculo em runtime no cliente, cruzando com a DRE do mês de referência:
```
Margem de Contribuição = Preço − (Custo de Reposição + Despesas Variáveis)
Taxa variável (% da receita) = (Deduções sobre a Venda + Despesa Variável) ÷ Receita Bruta
```
Custos **fixos não são rateados na margem** — cobrem-se via ponto de equilíbrio. O rateio para PEO
por produto usa a participação de cada item no **preço de venda** (assim todo produto ganha um PEO).
Suporta *overrides* de preço/custo para simulação (não persistidos).

---

## Fluxo de Caixa Projetado (`/fluxo-projetado`)

Planilha de despesas fixas futuras (`FixedExpense`) em dois layouts:
- **LARGO**: `Descrição | Categoria | Ago | Set | Out | ...` (uma coluna por mês).
- **LONGO**: `Mês | Descrição | Valor` (uma linha por mês/despesa).

Cruza as despesas fixas projetadas com a receita/DRE do ano para medir **comprometimento da receita**.
Projeção estatística dos custos variáveis com cenários: Pessimista (−20%), Realista (média 3M),
Otimista (+20%) e Nível atual (último mês). Aferição do custo fixo real contra o projetado.

---

## Assistente IA (`/api/ai/chat`)

`POST` recebe `{ messages }`, monta um system prompt com o contexto da DRE do mês corrente
(receita, resultados, plano de contas) e chama `claude-haiku-4-5-20251001` (máx 1024 tokens).
O componente `AIAssistant.tsx` existe mas **não está montado em nenhuma página** — a rota é funcional,
a UI ainda não foi conectada.

---

## Decisões técnicas importantes

**TypeScript no Vercel** — o compilador alvo não suporta `for...of` em `Map`/`Set` nem spread `[...set]`:
```typescript
// ❌ quebra no build
const arr = [...set]
for (const [k, v] of map) { }
// ✅ correto
const arr = Array.from(set)
Array.from(map.entries()).forEach(([k, v]) => { })
```

**Race condition de fetch** — páginas com auto-seleção de mês (margem, fluxo projetado) usam um
ref `loadSeq` para descartar respostas obsoletas: o auto-default troca o mês logo após a montagem,
e o fetch do mês antigo pode chegar depois do novo, sobrescrevendo a DRE com o mês errado.

**Schema sem migrations** — usa `prisma db push` (schema-first, sem arquivos de migration versionados).

**Idempotência de import**:
- OFX: `fitid @unique` + `skipDuplicates`.
- Planilhas ABC/inventário/vendas: `deleteMany({ month, year, unitId })` + `createMany` transacional.
- Margem: substitui todo o catálogo (`month=0, year=0`, escopado por unidade).
- Despesas fixas: substitui apenas os períodos presentes no arquivo.

**Seed mínimo no boot** — `prisma.ts` faz upsert apenas da conta `9.9.01`. Unidades e bancos são
criados pelo usuário via UI (ou via `POST /api/units/seed` para carregar as 5 unidades do Tio Chico Shop).

**Delete bloqueado** — unidade não pode ser deletada se tiver transactions ou sales; conta bancária
não pode ser deletada se tiver transactions.

---

## Identidade visual

- Fonte: **Bricolage Grotesque** (`--font-sub`)
- Amarelo: `#eaca2d` (`--brave-yellow`) · Escuro: `#2b2d42` (`--brave-dark`)
- Sem biblioteca de UI — CSS inline + classes em `globals.css`:
  `.card` `.btn` `.btn-primary` `.btn-danger` `.btn-sm` `.metric-card` `.form-select`
  `.form-input` `.upload-zone` `.table-wrap` `.badge-neutro` `.toast` `.page-header` `.page-title`
- Rodapé: "Desenvolvido por Delfos Research LTDA — Uso Restrito"

---

## Comandos

```bash
npm run dev       # servidor local em http://localhost:3000
npm run build     # build de produção (prisma generate && prisma db push && next build)
npm run db:studio # Prisma Studio (editor visual do banco)
git push          # Vercel auto-deploya
```
