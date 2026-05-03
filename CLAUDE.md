# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # dev server at http://localhost:3000
npm run build        # production build (runs: prisma generate && prisma db push && next build)
npm run db:studio    # Prisma Studio (visual DB editor)
git push             # triggers Vercel auto-deploy
```

No test suite. Type-check only via `npm run build`.

## Architecture

Full-stack Next.js 14 App Router — pages and API routes in the same project. No auth. Deployed on Vercel (hobby), DB on Neon PostgreSQL free tier (`sa-east-1`).

**Key env vars:**
- `DATABASE_URL` — Neon connection pooling URL (runtime)
- `DIRECT_URL` — Neon direct URL (used by `prisma db push` at build)

Schema is managed with `prisma db push` (no migration files). On cold start, `prisma.ts` only seeds Account `9.9.01 — Transferência entre Contas`.

## Critical TypeScript Constraint

The Vercel build target does **not** support `for...of` on `Map`/`Set` or spread of `Set`. Always use `Array.from()`:

```typescript
// ❌ breaks on Vercel build
const arr = [...set]
for (const [k, v] of map) { }

// ✅ correct
const arr = Array.from(set)
Array.from(map.entries()).forEach(([k, v]) => { })
```

## Data Model Highlights

**Unit / BankAccount** — fully dynamic CRUD via `/unidades`. No hardcoded seed.

**Client** — customer registry. Fields: `name`, `email`, `phone`, `cpf`, `unitId`, `active`.

**Sale** — purchase record linked to a client. Fields: `clientId`, `description`, `amount`, `date`, `unitId`, `month`, `year`. Independent from the OFX/Transaction flow.

**Transaction** — central model for OFX-imported bank entries. Key fields:
- `fitid` (unique) — prevents OFX duplicate imports, scoped to same `bankAccountId`.
- `accountId` null = unclassified, excluded from DRE.
- `transferToUnitId` + `transferToBankAccountId` — transfer outflow fields; counterpart auto-created with `fitid = original + '_entrada'`.

**Account 9.9.01 — Transferência entre Contas** (type=`NEUTRO`) — seeded on boot. Never enters DRE totals. Selecting it in the combobox reveals unit/bank selectors and auto-creates the counterpart. Excluded from Jaccard classifier.

**BalanceSnapshot** — populated from OFX `isBalance` lines and `<LEDGERBAL>`. One per account per day.

## Client & Sales APIs

- `GET/POST /api/clients` — client list (includes `sales[]`) / create client
- `GET/PUT/DELETE /api/clients/[id]` — individual client
- `GET/POST /api/sales` — sale list (filterable by `clientId`) / create sale
- `DELETE /api/sales/[id]` — remove sale

## Unit & BankAccount APIs

- `GET/POST /api/units` — unit list (includes `bankAccounts[]`) / create unit
- `PUT/DELETE /api/units/[id]` — update/delete unit (delete blocked if has transactions or sales)
- `POST /api/bank-accounts` — create bank account (requires `unitId`)
- `PUT/DELETE /api/bank-accounts/[id]` — update/delete bank account (delete blocked if has transactions)

## OFX Import Flow (`/lancamentos`)

1. `POST /api/ofx/parse` — extracts transactions, `<FI><ORG>`, `<BANKACCTFROM>`, `<LEDGERBAL>`. Lines with `TRNTYPE=BALANCE` or memo matching `/^saldo\b/i` are marked `isBalance=true`.
2. `POST /api/classify/suggest` — runs Jaccard classifier in background.
3. `POST /api/ofx` — `createMany({ skipDuplicates: true })` in 1 SQL query. Also saves BalanceSnapshots.

## Intelligent Classifier (`src/lib/classifier.ts`)

Pure Jaccard similarity — no external dependencies.

```
tokenize(memo): lowercase → strip digits → strip non-letters → split → keep tokens > 2 chars
jaccardSimilarity(A, B): |A∩B| / |A∪B|
```

Threshold ≥ 0.35 for suggestions. Real-time propagation at ≥ 0.25. Transfer lines excluded.

## DRE Calculation (`src/lib/dre.ts`)

`calcDRE()` groups transactions by `account.dreGroup`. Output is flat `DRELine[]` with type `'section' | 'group' | 'account' | 'subtotal' | 'breakeven' | 'transfer'`. Three breakeven points: PEO, PEI, PEF.

## UI Patterns

No UI library — inline styles + classes from `globals.css`: `.card`, `.btn`, `.btn-primary`, `.btn-danger`, `.btn-sm`, `.metric-card`, `.form-select`, `.form-input`, `.upload-zone`, `.table-wrap`, `.badge-neutro`, `.toast`, `.page-header`, `.page-title`.

Brand: font **Bricolage Grotesque** (`--font-sub`), yellow `#eaca2d` (`--brave-yellow`), dark `#2b2d42` (`--brave-dark`).
