'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  calcABC, ABC_COLOR, classifyStock, STOCK_STATUS_META, STOCK_STATUS_ORDER,
  type ABCItem, type ABCClass, type StockStatus, type StockStatusItem,
} from '@/lib/abc'
import { calcMargem, dreVarRate, type MargemOverride } from '@/lib/margem'
import {
  ComposedChart, BarChart, ScatterChart, Bar, Line, Scatter, XAxis, YAxis, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

// ─── Relatório único de produtos ─────────────────────────────────────────────
// Três bases GERAIS (cada envio substitui o anterior; nada é por mês):
//   vendas (Bling) · inventário com custo · catálogo de preço e custo
// Cruzadas por SKU num só relatório: Curva ABC, situação do estoque e margem.
// A única referência mensal é a DRE mais recente, de onde saem as despesas
// variáveis (% do preço) e os custos fixos (só para o PEO por produto).

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtInt = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v))
const fmtUp = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.ceil(v))
const fmtK = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k` : fmtInt(v)
const pctStr = (v: number) => `${(v * 100).toFixed(1)}%`
const fmtDias = (d: number | null) => d == null ? '∞' : d >= X_CAP ? `${X_CAP}+` : `${Math.round(d)}`

const GRID = '#edf2f4'
const AXIS = '#c3cbd7'
const INK = '#2b2d42'
const INK2 = '#505168'
const SURFACE = '#ffffff'
const SERIES = '#2b3272'      // cor de série única (azul da marca)
const CRITICAL = '#d03b3b'    // status crítico (MC negativa)
const X_CAP = 365

const PERIODO_KEY = 'prism.produtos.periodoVendasDias'
const LIMITES_KEY = 'prism.abc.limitesCobertura'

type Fonte = 'vendas' | 'estoque' | 'catalogo'
type Filtro = 'todos' | StockStatus | 'parados' | 'mcNeg' | 'classeA' | 'semCatalogo'
type Ordem = 'vendas' | 'valorEst' | 'mcPct' | 'cobertura' | 'mcPeriodo'
type MatrixRow = { key: string; classe: string; n: number; total: number } & Record<string, number | string>

interface Row {
  key: string; label: string; sku: string | null; category: string | null
  vendas: number; abcClass: ABCClass | null; pctVendas: number | null
  estoque: number; valorEst: number; custoEst: number; cobertura: number | null
  status: StockStatus | null; parado: boolean
  inCatalog: boolean; basePrice: number; baseCost: number; price: number; cost: number; edited: boolean
  despVarUnit: number; mcUnit: number | null; mcPct: number | null; markup: number | null; peoUn: number | null
  mcPeriodo: number | null
}

const joinKey = (r: any) => String(r.sku || '').trim() || String(r.product || '').toLowerCase().trim()
const STATUS_PRIO: Record<StockStatus, number> = { quebra: 0, excesso: 1, normal: 2 }

const FONTES: Record<Fonte, { icon: string; title: string; endpoint: string; cols: string; hint: string }> = {
  vendas:   { icon: '🏷️', title: 'Vendas (Bling)', endpoint: '/api/abc/import', cols: 'Código · Produto/Descrição · Quantidade', hint: 'Relatório de Saída de Produtos ou export ABC (.csv)' },
  estoque:  { icon: '📦', title: 'Inventário (com custo)', endpoint: '/api/abc/inventario', cols: 'Código · Produto · Preço de Custo · Qtd. Estoque', hint: 'posição atual do estoque' },
  catalogo: { icon: '🎯', title: 'Preço e custo', endpoint: '/api/margem', cols: 'Código · Produto · Preço de Venda · Preço de custo', hint: 'catálogo para a margem de contribuição' },
}

// Só a resposta OK vira lista; erro → lista vazia (a página nunca trava em "Carregando...")
const safeList = (r: Response) => (r.ok ? r.json().catch(() => []) : Promise.resolve([]))

// DRE mais recente com receita: referência para despesas variáveis e custos fixos
async function fetchLatestDre(unitParam: string): Promise<any | null> {
  const y0 = new Date().getFullYear()
  for (const y of [y0, y0 - 1]) {
    try {
      const r = await fetch(`/api/dre?month=1&year=${y}${unitParam}`)
      if (!r.ok) continue
      const j = await r.json()
      const months = ((j?.yearData || []) as any[])
        .filter(m => (m?.receitaBruta || 0) > 0)
        .sort((a, b) => a.month - b.month)
      if (months.length) {
        const last = months[months.length - 1]
        if (Array.isArray(last.lines)) return last
        const rr = await fetch(`/api/dre?month=${last.month}&year=${last.year}${unitParam}`)
        if (rr.ok) { const jj = await rr.json(); return jj?.dre ?? null }
      }
    } catch {}
  }
  return null
}

export default function ProdutosPage() {
  const [units, setUnits] = useState<any[]>([])
  const [unitId, setUnitId] = useState('')
  const [sales, setSales] = useState<any[]>([])
  const [stock, setStock] = useState<any[]>([])
  const [catalog, setCatalog] = useState<any[]>([])
  const [dre, setDre] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState<Fonte | null>(null)
  const [drag, setDrag] = useState<Fonte | null>(null)
  const [toast, setToast] = useState('')
  const fileRefs = { vendas: useRef<HTMLInputElement>(null), estoque: useRef<HTMLInputElement>(null), catalogo: useRef<HTMLInputElement>(null) }

  // Parâmetros do relatório (persistidos no navegador)
  const [periodoDias, setPeriodoDias] = useState(30)
  const [minDias, setMinDias] = useState(15)
  const [maxDias, setMaxDias] = useState(120)
  const prefsLidas = useRef(false)
  useEffect(() => {
    try {
      const p = parseInt(localStorage.getItem(PERIODO_KEY) || '')
      if (p >= 1 && p <= 366) setPeriodoDias(p)
      const s = localStorage.getItem(LIMITES_KEY)
      if (s) { const j = JSON.parse(s); if (j.min > 0) setMinDias(j.min); if (j.max > 0) setMaxDias(j.max) }
    } catch {}
    prefsLidas.current = true
  }, [])
  useEffect(() => {
    if (!prefsLidas.current) return
    try {
      localStorage.setItem(PERIODO_KEY, String(periodoDias))
      localStorage.setItem(LIMITES_KEY, JSON.stringify({ min: minDias, max: maxDias }))
    } catch {}
  }, [periodoDias, minDias, maxDias])

  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [ordem, setOrdem] = useState<Ordem>('vendas')
  const [overrides, setOverrides] = useState<Record<string, MargemOverride>>({})

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500) }
  const unitQ = unitId ? `?unitId=${unitId}` : ''
  const unitAmp = unitId ? `&unitId=${unitId}` : ''

  const loadSeq = useRef(0)
  const load = () => {
    const seq = ++loadSeq.current
    setLoading(true)
    Promise.all([
      fetch(`/api/abc/vendas${unitQ}`).then(safeList),
      fetch(`/api/abc/estoque${unitQ}`).then(safeList),
      fetch(`/api/margem${unitQ}`).then(safeList),
      fetchLatestDre(unitAmp),
    ]).then(([s, e, c, d]) => {
      if (seq !== loadSeq.current) return
      setSales(Array.isArray(s) ? s : [])
      setStock(Array.isArray(e) ? e : [])
      setCatalog(Array.isArray(c) ? c : [])
      setDre(d)
    }).catch(() => {
      if (seq !== loadSeq.current) return
      setSales([]); setStock([]); setCatalog([]); setDre(null)
    }).finally(() => {
      if (seq !== loadSeq.current) return
      setLoading(false)
      setLoaded(true)
    })
  }
  useEffect(() => {
    fetch('/api/units').then(safeList).then(u => setUnits(Array.isArray(u) ? u : [])).catch(() => setUnits([]))
  }, [])
  useEffect(() => { load() }, [unitId])

  const upload = async (fonte: Fonte, file: File) => {
    setUploading(fonte)
    const fd = new FormData()
    fd.append('file', file)
    if (unitId) fd.append('unitId', unitId)
    try {
      const res = await fetch(FONTES[fonte].endpoint, { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        const extra = data.semCusto > 0 ? ` · ${data.semCusto} sem custo` : data.warnings?.length ? ` · ${data.warnings.length} linha(s) ignorada(s)` : ''
        showToast(`✓ ${FONTES[fonte].title}: ${data.imported} registros importados${extra}`)
        if (fonte === 'catalogo') setOverrides({})
        load()
      } else {
        showToast(`Erro: ${data.error}`)
      }
    } catch {
      showToast('Erro ao enviar a planilha')
    }
    setUploading(null)
  }

  // ── Curva ABC de vendas (por quantidade), agregada por SKU ────────────────
  const abcVendas = useMemo(() => {
    const map = new Map<string, ABCItem>()
    sales.forEach((r: any) => {
      const key = joinKey(r)
      if (!key) return
      const qty = r.quantity || 0
      const ex = map.get(key)
      if (ex) { ex.value += qty; ex.quantity = (ex.quantity || 0) + qty }
      else map.set(key, { key, label: r.product, sublabel: [r.sku, r.category].filter(Boolean).join(' · ') || undefined, value: qty, quantity: qty })
    })
    return calcABC(Array.from(map.values()))
  }, [sales])

  // ── Situação do estoque (Quebra · Normal · Excesso) ───────────────────────
  const situacao = useMemo(
    () => classifyStock(stock, sales, { diasMes: periodoDias, minDias, maxDias }),
    [stock, sales, periodoDias, minDias, maxDias]
  )
  const sit = useMemo(() => {
    const items = situacao
    const totalValor = items.reduce((a, i) => a + i.valor, 0)
    const byStatus = STOCK_STATUS_ORDER.map(s => {
      const g = items.filter(i => i.status === s)
      return { status: s, count: g.length, valor: g.reduce((a, i) => a + i.valor, 0), parados: g.filter(i => i.parado).length }
    })
    const classes: (ABCClass | 'sem')[] = ['A', 'B', 'C', 'sem']
    const matrix: MatrixRow[] = classes.map(c => {
      const g = items.filter(i => (i.abcClass ?? 'sem') === c)
      const row: MatrixRow = { key: c, classe: c === 'sem' ? 'Sem venda' : `Classe ${c}`, n: g.length, total: g.reduce((a, i) => a + i.valor, 0) }
      STOCK_STATUS_ORDER.forEach(s => {
        const h = g.filter(i => i.status === s)
        row[s] = h.reduce((a, i) => a + i.valor, 0)
        row[`${s}N`] = h.length
      })
      return row
    })
    const points = items.map(i => ({ x: i.cobertura == null ? X_CAP : Math.min(i.cobertura, X_CAP), y: i.valor, status: i.status, item: i }))
    const semCusto = items.filter(i => i.estoque > 0 && i.custo <= 0).length
    const cobs = items.filter(i => i.estoque > 0 && i.cobertura != null).map(i => i.cobertura as number).sort((a, b) => a - b)
    const mediana = cobs.length ? cobs[Math.floor(cobs.length / 2)] : null
    const totalSold = sales.reduce((a: number, r: any) => a + (r.quantity || 0), 0)
    const totalStock = stock.reduce((a: number, r: any) => a + (r.quantity || 0), 0)
    return {
      items, totalValor, byStatus, matrix, points, semCusto, mediana, totalSold, totalStock,
      giro: totalStock > 0 ? totalSold / totalStock : null,
      cobertura: totalSold > 0 ? totalStock / (totalSold / periodoDias) : null,
      parados: items.filter(i => i.parado).length,
    }
  }, [situacao, sales, stock, periodoDias])

  // ── Margem de contribuição (catálogo geral + DRE de referência) ───────────
  const ref = useMemo(() => dreVarRate(dre), [dre])
  const margem = useMemo(
    () => calcMargem(
      catalog.map((p: any) => ({ key: joinKey(p), product: p.product, sku: p.sku || null, salePrice: p.salePrice || 0, replacementCost: p.replacementCost || 0 })),
      overrides, ref.varRate, ref.custosFixos
    ),
    [catalog, overrides, ref]
  )
  const setOverride = (key: string, field: 'price' | 'cost', value: string) => {
    const v = value === '' ? 0 : parseFloat(value.replace(',', '.'))
    setOverrides(prev => ({ ...prev, [key]: { ...prev[key], [field]: isNaN(v) ? 0 : v } }))
  }
  const simCount = Object.keys(overrides).length

  // ── Linhas do relatório único: união de vendas ∪ estoque ∪ catálogo ────────
  const rows = useMemo(() => {
    const pctBy = new Map<string, number>()
    abcVendas.rows.forEach(r => pctBy.set(r.key, r.pct))
    const map = new Map<string, Row>()
    situacao.forEach(i => map.set(i.key, {
      key: i.key, label: i.label, sku: i.sku, category: i.category,
      vendas: i.vendas, abcClass: i.abcClass, pctVendas: pctBy.get(i.key) ?? null,
      estoque: i.estoque, valorEst: i.valor, custoEst: i.custo, cobertura: i.cobertura, status: i.status, parado: i.parado,
      inCatalog: false, basePrice: 0, baseCost: 0, price: 0, cost: 0, edited: false,
      despVarUnit: 0, mcUnit: null, mcPct: null, markup: null, peoUn: null, mcPeriodo: null,
    }))
    margem.forEach(m => {
      const ex = map.get(m.key)
      const base: Row = ex ?? {
        key: m.key, label: m.product, sku: m.sku, category: null,
        vendas: 0, abcClass: null, pctVendas: null,
        estoque: 0, valorEst: 0, custoEst: 0, cobertura: null, status: null, parado: false,
        inCatalog: false, basePrice: 0, baseCost: 0, price: 0, cost: 0, edited: false,
        despVarUnit: 0, mcUnit: null, mcPct: null, markup: null, peoUn: null, mcPeriodo: null,
      }
      map.set(m.key, {
        ...base, inCatalog: true,
        basePrice: m.basePrice, baseCost: m.baseCost, price: m.price, cost: m.cost, edited: m.edited,
        despVarUnit: m.despVarUnit, mcUnit: m.mcUnit, mcPct: m.mcPct, markup: m.markup, peoUn: m.peoUn,
        mcPeriodo: base.vendas > 0 ? m.mcUnit * base.vendas : null,
      })
    })
    return Array.from(map.values())
  }, [situacao, margem, abcVendas])

  const resumo = useMemo(() => {
    const vendidos = rows.filter(r => r.vendas > 0).length
    const emEstoque = rows.filter(r => r.estoque > 0).length
    const comMargem = rows.filter(r => r.inCatalog)
    const mcMedia = comMargem.length ? comMargem.reduce((a, r) => a + (r.mcPct || 0), 0) / comMargem.length : 0
    const negativos = comMargem.filter(r => (r.mcUnit ?? 0) < 0).length
    const mcGerada = rows.reduce((a, r) => a + (r.mcPeriodo || 0), 0)
    const semCatalogo = rows.filter(r => !r.inCatalog && (r.vendas > 0 || r.estoque > 0)).length
    const piores = comMargem.slice().sort((a, b) => (a.mcPct || 0) - (b.mcPct || 0)).slice(0, 15).reverse()
      .map(r => ({ name: r.label.length > 24 ? r.label.slice(0, 23) + '…' : r.label, full: r.label, mcPct: +((r.mcPct || 0) * 100).toFixed(1), mcUnit: r.mcUnit || 0 }))
    return { vendidos, emEstoque, mcMedia, negativos, mcGerada, semCatalogo, piores }
  }, [rows])

  const tableRows = useMemo(() => {
    let list = rows
    if (filtro === 'parados') list = list.filter(r => r.parado)
    else if (filtro === 'mcNeg') list = list.filter(r => (r.mcUnit ?? 0) < 0 && r.inCatalog)
    else if (filtro === 'classeA') list = list.filter(r => r.abcClass === 'A')
    else if (filtro === 'semCatalogo') list = list.filter(r => !r.inCatalog)
    else if (filtro !== 'todos') list = list.filter(r => r.status === filtro)
    const cmp: Record<Ordem, (a: Row, b: Row) => number> = {
      vendas: (a, b) => b.vendas - a.vendas,
      valorEst: (a, b) => b.valorEst - a.valorEst,
      mcPct: (a, b) => (a.mcPct ?? Infinity) - (b.mcPct ?? Infinity),
      cobertura: (a, b) => (a.cobertura ?? Infinity) - (b.cobertura ?? Infinity),
      mcPeriodo: (a, b) => (b.mcPeriodo ?? -Infinity) - (a.mcPeriodo ?? -Infinity),
    }
    const byStatusThen = (a: Row, b: Row) => {
      if (filtro === 'todos' && a.status && b.status && a.status !== b.status) return STATUS_PRIO[a.status] - STATUS_PRIO[b.status]
      return cmp[ordem](a, b)
    }
    return list.slice().sort(ordem === 'vendas' && filtro === 'todos' ? cmp.vendas : byStatusThen)
  }, [rows, filtro, ordem])

  const chartData = useMemo(
    () => abcVendas.rows.slice(0, 20).map(r => ({
      name: r.label.length > 16 ? r.label.slice(0, 15) + '…' : r.label, full: r.label,
      pct: +r.pct.toFixed(2), acum: +r.cumPct.toFixed(1), valor: r.value, class: r.class,
    })),
    [abcVendas]
  )

  const hasSales = sales.length > 0
  const hasStock = stock.length > 0
  const hasCatalog = catalog.length > 0
  const hasAny = hasSales || hasStock || hasCatalog
  const dreLabel = dre ? `${MONTH_NAMES[dre.month]}/${dre.year}` : null
  const semCustoTotal = rows.filter(r => r.estoque > 0 && r.custoEst <= 0).length

  const priceInput = (r: Row, field: 'price' | 'cost') => (
    <input
      type="number" step="0.01" min="0"
      value={field === 'price' ? r.price : r.cost}
      onChange={e => setOverride(r.key, field, e.target.value)}
      style={{
        width: 76, textAlign: 'right', fontSize: 12, padding: '3px 6px',
        border: `1px solid ${r.edited ? 'var(--brave-yellow)' : 'var(--brave-light)'}`,
        borderRadius: 4, background: r.edited ? '#fffdf3' : '#fff',
      }}
    />
  )

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Produtos</h1>
          <p className="page-subtitle">Curva ABC · situação do estoque · margem de contribuição — relatório único por SKU; cada envio substitui o anterior</p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="form-select" style={{ width: 150 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label style={{ fontSize: 11, color: 'var(--brave-gray)', display: 'flex', alignItems: 'center', gap: 6 }}>
            Vendas cobrem
            <input className="form-input" type="number" min={1} max={366} value={periodoDias} style={{ width: 62, padding: '4px 8px' }}
              onChange={e => { const v = parseInt(e.target.value); if (v >= 1 && v <= 366) setPeriodoDias(v) }} />
            dias
          </label>
        </div>
      </div>

      {/* Fontes — três envios, todos gerais */}
      <div className="grid-3 mb-6" style={{ gap: 12 }}>
        {(Object.keys(FONTES) as Fonte[]).map(f => {
          const meta = FONTES[f]
          const n = f === 'vendas' ? sales.length : f === 'estoque' ? stock.length : catalog.length
          const last = (f === 'vendas' ? sales : f === 'estoque' ? stock : catalog)
            .reduce((m: string | null, r: any) => (r.createdAt && (!m || r.createdAt > m) ? r.createdAt : m), null)
          return (
            <div key={f}
              className={`upload-zone ${drag === f ? 'drag' : ''}`}
              style={{ padding: '14px 16px', marginBottom: 0 }}
              onDragOver={e => { e.preventDefault(); setDrag(f) }}
              onDragLeave={() => setDrag(null)}
              onDrop={e => { e.preventDefault(); setDrag(null); const file = e.dataTransfer.files?.[0]; if (file) upload(f, file) }}
              onClick={() => fileRefs[f].current?.click()}
            >
              <input ref={fileRefs[f]} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
                onChange={e => { const file = e.target.files?.[0]; if (file) upload(f, file); e.target.value = '' }} />
              <div className="upload-title" style={{ fontSize: 13 }}>{uploading === f ? '⏳ Importando…' : `${meta.icon} ${meta.title}`}</div>
              <div className="upload-sub" style={{ fontSize: 11, marginTop: 4 }}>
                <strong>{meta.cols}</strong><br />{meta.hint}
              </div>
              <div style={{ fontSize: 11, marginTop: 8, color: n > 0 ? 'var(--brave-gray-mid)' : 'var(--brave-gray)', fontWeight: n > 0 ? 600 : 400 }}>
                {n > 0 ? `${fmtInt(n)} registros${last ? ` · atualizado em ${new Date(last).toLocaleDateString('pt-BR')}` : ''}` : 'Nenhum dado — clique ou arraste a planilha'}
              </div>
            </div>
          )
        })}
      </div>

      {!loaded ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : !hasAny ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>Nenhuma base importada</div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Envie as vendas, o inventário e o catálogo de preço/custo acima para montar o relatório.
          </div>
        </div>
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
          {/* Resumo */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">Produtos no relatório</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{fmtInt(rows.length)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{resumo.vendidos} vendidos · {resumo.emEstoque} em estoque · {catalog.length} no catálogo</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Unidades vendidas</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{hasSales ? fmtInt(sit.totalSold) : '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                {hasSales ? <>em {periodoDias} dias · classe A: {abcVendas.summary.byClass.A.count} produtos = {abcVendas.summary.byClass.A.valuePct.toFixed(0)}%</> : 'importe as vendas'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Estoque a custo</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{hasStock ? fmtBRL(sit.totalValor) : '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                {hasStock ? <>{fmtInt(sit.totalStock)} un · {sit.parados} parados{semCustoTotal > 0 ? ` · ${semCustoTotal} sem custo` : ''}</> : 'importe o inventário'}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Margem de contribuição</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{hasCatalog && dre ? pctStr(resumo.mcMedia) : '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                {hasCatalog && dre
                  ? <>MC% média · {resumo.negativos} com MC negativa{hasSales ? ` · gerada no período: ${fmtBRL(resumo.mcGerada)}` : ''}</>
                  : hasCatalog ? 'sem DRE de referência' : 'importe preço e custo'}
              </div>
            </div>
          </div>

          {/* ── Curva ABC de vendas ── */}
          {hasSales && (
            <div className="card mb-6">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Curva ABC de Vendas</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>
                Por quantidade vendida no período importado. Barras = participação de cada produto · linha = participação acumulada. A = até 80% · B = até 95% · C = restante.
              </div>
              <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 12 }}>
                {(['A', 'B', 'C'] as ABCClass[]).map(c => (
                  <div className="metric-card" key={c}>
                    <div className="metric-accent" style={{ background: ABC_COLOR[c] }} />
                    <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Swatch color={ABC_COLOR[c]} /> Classe {c}</div>
                    <div className="metric-value" style={{ fontSize: 18 }}>{abcVendas.summary.byClass[c].valuePct.toFixed(0)}%</div>
                    <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{abcVendas.summary.byClass[c].count} produtos · {fmtInt(abcVendas.summary.byClass[c].value)} un</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--brave-gray-mid)', marginBottom: 6, flexWrap: 'wrap' }}>
                {(['A', 'B', 'C'] as ABCClass[]).map(c => <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Swatch color={ABC_COLOR[c]} /> Classe {c}</span>)}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 16, height: 2, background: INK, display: 'inline-block' }} /> % acumulado</span>
              </div>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: INK2 }} angle={-35} textAnchor="end" interval={0} height={76} axisLine={{ stroke: AXIS }} tickLine={false} />
                  <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 95, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} width={40} />
                  <ReferenceLine y={80} stroke={AXIS} label={{ value: 'A │ B', position: 'insideTopRight', fontSize: 10, fill: INK2 }} />
                  <ReferenceLine y={95} stroke={AXIS} label={{ value: 'B │ C', position: 'insideTopRight', fontSize: 10, fill: INK2 }} />
                  <Tooltip cursor={{ fill: 'rgba(43,45,66,0.06)' }} content={<ParetoTip />} />
                  <Bar dataKey="pct" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {chartData.map((e, i) => <Cell key={i} fill={ABC_COLOR[e.class]} />)}
                  </Bar>
                  <Line type="monotone" dataKey="acum" stroke={INK} strokeWidth={2}
                    dot={{ r: 4, fill: INK, stroke: SURFACE, strokeWidth: 2 }} activeDot={{ r: 6, fill: INK, stroke: SURFACE, strokeWidth: 2 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Estoque: giro e situação ── */}
          {hasStock && (
            <div className="card mb-6">
              <div className="flex-between" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Situação do Estoque — Quebra · Normal · Excesso</div>
                  <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>
                    Cobertura = estoque ÷ venda diária ({periodoDias} dias de vendas). Quebra abaixo de <strong>{minDias}</strong> dias · Normal entre <strong>{minDias}</strong> e <strong>{maxDias}</strong> · Excesso acima de <strong>{maxDias}</strong> dias ou sem venda.
                  </div>
                </div>
                <div className="flex gap-3" style={{ alignItems: 'center' }}>
                  <label style={{ fontSize: 11, color: 'var(--brave-gray)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Mínimo (dias)
                    <input className="form-input" type="number" min={1} max={maxDias - 1} value={minDias} style={{ width: 68, padding: '4px 8px' }}
                      onChange={e => { const v = parseInt(e.target.value); if (v >= 1 && v < maxDias) setMinDias(v) }} />
                  </label>
                  <label style={{ fontSize: 11, color: 'var(--brave-gray)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    Máximo (dias)
                    <input className="form-input" type="number" min={minDias + 1} value={maxDias} style={{ width: 68, padding: '4px 8px' }}
                      onChange={e => { const v = parseInt(e.target.value); if (v > minDias) setMaxDias(v) }} />
                  </label>
                </div>
              </div>

              <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginTop: 14 }}>
                <Metric label="Giro de estoque" value={sit.giro != null ? `${sit.giro.toFixed(2)}×` : '—'} hint="vendido ÷ estoque, no período" />
                <Metric label="Cobertura agregada" value={sit.cobertura != null ? `${Math.round(sit.cobertura)} dias` : '—'} hint={sit.mediana != null ? `mediana por SKU: ${Math.round(sit.mediana)} dias` : 'autonomia do estoque'} />
                <Metric label="Unidades em estoque" value={fmtInt(sit.totalStock)} hint={`${fmtInt(sit.items.filter(i => i.estoque > 0).length)} itens`} />
                <Metric label="Itens parados" value={fmtInt(sit.parados)} hint="em estoque, sem venda no período" />
              </div>

              {!hasSales ? (
                <div style={{ marginTop: 16, padding: 16, background: 'var(--brave-light)', borderRadius: 8, fontSize: 13, color: 'var(--brave-gray-mid)' }}>
                  Importe as <strong>vendas</strong> para calcular a cobertura e classificar a situação de cada item.
                </div>
              ) : (
                <>
                  <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16 }}>
                    {sit.byStatus.map(b => (
                      <StatusTile key={b.status} status={b.status} count={b.count} valor={b.valor}
                        pct={sit.totalValor > 0 ? (b.valor / sit.totalValor) * 100 : 0} parados={b.parados} />
                    ))}
                  </div>

                  <div className="grid-2" style={{ marginTop: 20, gap: 20, alignItems: 'start' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>Onde está o dinheiro — valor em estoque por classe e situação</div>
                      <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 8 }}>Classe pela ABC de vendas (quantidade). Passe o mouse para ver itens e valores.</div>
                      <StatusLegend />
                      <ResponsiveContainer width="100%" height={190}>
                        <BarChart data={sit.matrix} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap="35%">
                          <CartesianGrid stroke={GRID} horizontal={false} />
                          <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false} />
                          <YAxis type="category" dataKey="classe" width={82} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{ fill: 'rgba(43,45,66,0.06)' }} content={<StackTip />} />
                          {STOCK_STATUS_ORDER.map(s => (
                            <Bar key={s} dataKey={s} stackId="v" fill={STOCK_STATUS_META[s].color} stroke={SURFACE} strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>Matriz classe × situação</div>
                      <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 8 }}>Itens · valor em estoque. Prioridade: classe A em quebra; classe C ou sem venda em excesso.</div>
                      <div className="table-wrap">
                        <table style={{ fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th></th>
                              {STOCK_STATUS_ORDER.map(s => <th key={s} style={{ textAlign: 'right' }}><span style={{ color: STOCK_STATUS_META[s].color }}>{STOCK_STATUS_META[s].icon}</span> {STOCK_STATUS_META[s].label}</th>)}
                              <th style={{ textAlign: 'right' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sit.matrix.map(row => (
                              <tr key={row.key}>
                                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{row.key !== 'sem' && <Swatch color={ABC_COLOR[row.key as ABCClass]} />} {row.classe}</td>
                                {STOCK_STATUS_ORDER.map(s => (
                                  <td key={s} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (row[`${s}N`] as number) > 0 ? INK : 'var(--brave-gray)' }}>
                                    {(row[`${s}N`] as number) > 0 ? <>{row[`${s}N`]} <span style={{ color: 'var(--brave-gray)' }}>·</span> {fmtBRL(row[s] as number)}</> : '—'}
                                  </td>
                                ))}
                                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{row.n} <span style={{ color: 'var(--brave-gray)' }}>·</span> {fmtBRL(row.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 24 }}>
                    <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>Cobertura × valor em estoque — cada ponto é um SKU</div>
                    <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 8 }}>
                      Faixa sombreada = normal ({minDias}–{maxDias} dias). À esquerda dela, risco de faltar; à direita, capital parado. Sem venda aparece em “{X_CAP}+”.
                    </div>
                    <StatusLegend shapes />
                    <ResponsiveContainer width="100%" height={300}>
                      <ScatterChart margin={{ top: 12, right: 24, bottom: 28, left: 8 }}>
                        <CartesianGrid stroke={GRID} />
                        <XAxis type="number" dataKey="x" domain={[0, X_CAP]} ticks={[0, 30, 60, 90, 120, 180, 270, X_CAP]}
                          tickFormatter={v => v >= X_CAP ? `${X_CAP}+` : String(v)} tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false}
                          label={{ value: 'Cobertura (dias de venda)', position: 'insideBottom', offset: -18, fontSize: 11, fill: INK2 }} />
                        <YAxis type="number" dataKey="y" tickFormatter={fmtK} tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} width={48}
                          label={{ value: 'Valor em estoque (R$)', angle: -90, position: 'insideLeft', offset: 12, fontSize: 11, fill: INK2 }} />
                        <ReferenceArea x1={minDias} x2={Math.min(maxDias, X_CAP)} fill={STOCK_STATUS_META.normal.color} fillOpacity={0.07} />
                        <ReferenceLine x={minDias} stroke={AXIS} />
                        <ReferenceLine x={Math.min(maxDias, X_CAP)} stroke={AXIS} />
                        <Tooltip cursor={false} content={<ScatterTip />} />
                        {STOCK_STATUS_ORDER.map(s => (
                          <Scatter key={s} name={STOCK_STATUS_META[s].label} data={sit.points.filter(p => p.status === s)}
                            fill={STOCK_STATUS_META[s].color} shape={(p: any) => <StatusDot {...p} status={s} />} isAnimationActive={false} />
                        ))}
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Margem de contribuição ── */}
          {hasCatalog && (
            <div className="card mb-6">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Margem de Contribuição</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>
                MC = Preço − (Custo de Reposição + Despesas Variáveis). Custos fixos não são rateados — são cobertos pelo ponto de equilíbrio.
              </div>
              {dre ? (
                <div style={{ padding: '10px 16px', background: '#eef7f0', border: '1px solid #a9d8b8', borderRadius: 8, fontSize: 12, color: '#1a6b3d', marginBottom: 14 }}>
                  Referência: <strong>DRE de {dreLabel}</strong> (mês mais recente com receita). Despesas variáveis: <strong>{pctStr(ref.varRate)} do preço</strong>
                  {' '}(Deduções {fmtBRL(ref.deducoes)} + Despesa Variável {fmtBRL(ref.despVar)} ÷ Receita {fmtBRL(ref.receitaBruta)}).
                  {' '}Custos fixos do mês ({fmtBRL(ref.custosFixos)}) só entram no <strong>PEO por produto</strong>.
                </div>
              ) : (
                <div style={{ padding: '10px 16px', background: 'var(--brave-light)', borderRadius: 8, fontSize: 12, color: 'var(--brave-gray-mid)', marginBottom: 14 }}>
                  Nenhuma DRE com receita encontrada — a margem está sem as despesas variáveis. Importe e classifique os extratos do mês na aba Lançamentos.
                </div>
              )}
              <div className="grid-2" style={{ gap: 20, alignItems: 'start' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>15 menores margens (MC%)</div>
                  <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 6 }}>Produtos que menos contribuem para cobrir os custos fixos.</div>
                  <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--brave-gray-mid)', marginBottom: 4 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Swatch color={SERIES} /> MC positiva</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Swatch color={CRITICAL} /> MC negativa</span>
                  </div>
                  <ResponsiveContainer width="100%" height={360}>
                    <BarChart data={resumo.piores} layout="vertical" margin={{ left: 4, right: 24, top: 4, bottom: 4 }} barCategoryGap="30%">
                      <CartesianGrid stroke={GRID} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: INK2 }} tickFormatter={v => `${v}%`} axisLine={{ stroke: AXIS }} tickLine={false} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: INK }} width={150} axisLine={false} tickLine={false} />
                      <ReferenceLine x={0} stroke={AXIS} />
                      <Tooltip cursor={{ fill: 'rgba(43,45,66,0.06)' }} content={<MargemTip />} />
                      <Bar dataKey="mcPct" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                        {resumo.piores.map((e, i) => <Cell key={i} fill={e.mcPct >= 0 ? SERIES : CRITICAL} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', alignContent: 'start' }}>
                  <Metric label="MC% média" value={dre ? pctStr(resumo.mcMedia) : '—'} hint="média simples do catálogo" />
                  <Metric label="Despesas variáveis" value={dre ? pctStr(ref.varRate) : '—'} hint={dreLabel ? `do preço · DRE ${dreLabel}` : 'sem referência'} />
                  <Metric label="MC negativa" value={String(resumo.negativos)} hint="vendem abaixo do custo variável" color={resumo.negativos > 0 ? CRITICAL : undefined} />
                  <Metric label="MC gerada no período" value={hasSales && dre ? fmtBRL(resumo.mcGerada) : '—'} hint={hasSales ? `MC unitária × vendas em ${periodoDias} dias` : 'importe as vendas'} />
                  {resumo.semCatalogo > 0 && (
                    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--brave-gray)', padding: '4px 2px' }}>
                      ⚠ {resumo.semCatalogo} {resumo.semCatalogo === 1 ? 'produto vendido/em estoque não está' : 'produtos vendidos/em estoque não estão'} no catálogo de preço e custo — sem margem calculada (filtro “Sem catálogo”).
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Tabela única ── */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Relatório por produto — {tableRows.length} de {rows.length}</span>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  Vendas, estoque e margem cruzados por SKU. <strong>Preço</strong> e <strong>Custo</strong> são editáveis para simular (não alteram o catálogo).
                  {' '}<strong>PEO (un)</strong> = unidades para cobrir a fatia de custo fixo rateada ao produto.
                </div>
              </div>
              <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                {simCount > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setOverrides({})}>↺ Restaurar ({simCount})</button>}
                <select className="form-select" style={{ width: 190, fontSize: 12 }} value={ordem} onChange={e => setOrdem(e.target.value as Ordem)}>
                  <option value="vendas">Ordenar: mais vendidos</option>
                  <option value="valorEst">Ordenar: maior valor em estoque</option>
                  <option value="cobertura">Ordenar: menor cobertura</option>
                  <option value="mcPct">Ordenar: menor MC%</option>
                  <option value="mcPeriodo">Ordenar: maior MC gerada</option>
                </select>
              </div>
            </div>
            <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--brave-light)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                { k: 'todos', label: 'Todos' },
                { k: 'classeA', label: 'Classe A' },
                { k: 'quebra', label: `${STOCK_STATUS_META.quebra.icon} Quebra` },
                { k: 'normal', label: `${STOCK_STATUS_META.normal.icon} Normal` },
                { k: 'excesso', label: `${STOCK_STATUS_META.excesso.icon} Excesso` },
                { k: 'parados', label: '⏸ Sem venda' },
                { k: 'mcNeg', label: '− MC negativa' },
                { k: 'semCatalogo', label: 'Sem catálogo' },
              ] as { k: Filtro; label: string }[]).map(f => (
                <button key={f.k} onClick={() => setFiltro(f.k)} className="btn btn-sm" style={{
                  background: filtro === f.k ? 'var(--brave-dark)' : 'var(--brave-light)',
                  color: filtro === f.k ? '#fff' : 'var(--brave-dark)', border: 'none',
                }}>{f.label}</button>
              ))}
            </div>
            <div className="table-wrap">
              <table style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th style={{ textAlign: 'center' }}>Classe</th>
                    <th style={{ textAlign: 'right' }}>Vendas</th>
                    <th style={{ textAlign: 'right' }}>Estoque</th>
                    <th style={{ textAlign: 'right' }}>Cobertura</th>
                    <th>Situação</th>
                    <th style={{ textAlign: 'right' }}>Preço</th>
                    <th style={{ textAlign: 'right' }}>Custo rep.</th>
                    <th style={{ textAlign: 'right' }}>MC/un</th>
                    <th style={{ textAlign: 'right' }}>MC%</th>
                    <th style={{ textAlign: 'right' }}>MC período</th>
                    <th style={{ textAlign: 'right' }}>PEO (un)</th>
                    <th>Ação sugerida</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(r => {
                    const neg = r.inCatalog && (r.mcUnit ?? 0) < 0
                    const acao = r.parado ? 'Liquidar / retirar do mix'
                      : r.estoque === 0 && r.vendas > 0 ? 'Repor — vendeu sem estoque'
                      : r.status ? STOCK_STATUS_META[r.status].action
                      : r.inCatalog ? 'Sem venda e sem estoque' : '—'
                    return (
                      <tr key={r.key} style={{ background: neg ? '#fdf0ee' : r.edited ? '#fffdf3' : undefined }}>
                        <td style={{ fontSize: 13, minWidth: 220 }}>
                          {r.label}
                          <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{[r.sku, r.category, r.edited ? 'simulado' : null].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td style={{ textAlign: 'center' }}>{r.abcClass ? <ClassBadge c={r.abcClass} /> : <span style={{ color: 'var(--brave-gray)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.vendas > 0 ? `${fmtInt(r.vendas)} un` : <span style={{ color: 'var(--brave-gray)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {r.estoque > 0 ? <>{fmtInt(r.estoque)} un<div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{r.custoEst > 0 ? fmtBRL(r.valorEst) : 'sem custo'}</div></> : <span style={{ color: 'var(--brave-gray)' }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {r.status == null ? <span style={{ color: 'var(--brave-gray)', fontWeight: 400 }}>—</span> : r.cobertura == null ? <span title="sem venda">∞</span> : `${fmtDias(r.cobertura)} d`}
                        </td>
                        <td>{r.status ? <StatusChip status={r.status} parado={r.parado} /> : <span style={{ color: 'var(--brave-gray)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right' }}>{r.inCatalog ? priceInput(r, 'price') : <span style={{ color: 'var(--brave-gray)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right' }}>{r.inCatalog ? priceInput(r, 'cost') : <span style={{ color: 'var(--brave-gray)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: neg ? CRITICAL : INK }}>{r.mcUnit == null ? '—' : fmtBRL(r.mcUnit)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: neg ? CRITICAL : INK }}>{r.mcPct == null ? '—' : pctStr(r.mcPct)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (r.mcPeriodo ?? 0) < 0 ? CRITICAL : INK }}>{r.mcPeriodo == null ? '—' : fmtBRL(r.mcPeriodo)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--brave-gray)' }}>{r.peoUn == null ? '—' : `${fmtUp(r.peoUn)} un`}</td>
                        <td style={{ color: 'var(--brave-gray-mid)', minWidth: 150 }}>{acao}{neg ? <div style={{ color: CRITICAL, fontSize: 11 }}>rever preço — MC negativa</div> : null}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', padding: '10px 20px', lineHeight: 1.5 }}>
              Itens vendidos sem estoque no inventário aparecem como Quebra — se o estoque estiver no Mercado Envios Full, ele não consta do inventário do Bling. Kits vendem sem estoque próprio (consomem o componente).
              {semCustoTotal > 0 && <> ⚠ {semCustoTotal} {semCustoTotal === 1 ? 'item' : 'itens'} em estoque sem custo cadastrado — valor total subestimado.</>}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}

// ─── Componentes ─────────────────────────────────────────────────────────────

function Metric({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ fontSize: 18, color }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

function Swatch({ color }: { color: string }) {
  return <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color, verticalAlign: 'middle' }} />
}

function ClassBadge({ c }: { c: ABCClass }) {
  return (
    <span style={{ display: 'inline-block', minWidth: 22, textAlign: 'center', background: ABC_COLOR[c], color: c === 'C' ? INK : '#fff', borderRadius: 4, padding: '1px 7px', fontWeight: 700, fontSize: 12 }}>{c}</span>
  )
}

function StatusChip({ status, parado }: { status: StockStatus; parado?: boolean }) {
  const m = STOCK_STATUS_META[status]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>
      <span style={{ color: m.color, fontSize: 11 }}>{m.icon}</span>
      {m.label}{parado && <span style={{ fontWeight: 400, color: 'var(--brave-gray)' }}>· sem venda</span>}
    </span>
  )
}

function StatusTile({ status, count, valor, pct, parados }: { status: StockStatus; count: number; valor: number; pct: number; parados: number }) {
  const m = STOCK_STATUS_META[status]
  return (
    <div className="metric-card" style={{ borderTop: `3px solid ${m.color}` }}>
      <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ color: m.color }}>{m.icon}</span> {m.label}</div>
      <div className="metric-value" style={{ fontSize: 22 }}>{count} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--brave-gray)' }}>{count === 1 ? 'item' : 'itens'}</span></div>
      <div style={{ fontSize: 12, color: 'var(--brave-gray-mid)', marginTop: 2 }}>{fmtBRL(valor)} <span style={{ color: 'var(--brave-gray)' }}>· {pct.toFixed(1)}% do estoque</span></div>
      <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 4 }}>{status === 'excesso' && parados > 0 ? <>{parados} sem nenhuma venda · </> : null}{m.hint}</div>
    </div>
  )
}

function StatusLegend({ shapes }: { shapes?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--brave-gray-mid)', marginBottom: 4, flexWrap: 'wrap' }}>
      {STOCK_STATUS_ORDER.map(s => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {shapes ? <svg width={14} height={14}><StatusDot cx={7} cy={7} status={s} small /></svg> : <Swatch color={STOCK_STATUS_META[s].color} />}
          {STOCK_STATUS_META[s].label}
        </span>
      ))}
    </div>
  )
}

// Ponto do scatter: forma por situação (▼ ● ▲), anel de 2px na cor da superfície e área de toque maior que a marca
function StatusDot({ cx, cy, status, small }: { cx?: number; cy?: number; status: StockStatus; small?: boolean }) {
  if (cx == null || cy == null) return null
  const color = STOCK_STATUS_META[status].color
  const r = small ? 4.5 : 5.5
  const ring = { stroke: SURFACE, strokeWidth: 2 }
  let mark
  if (status === 'normal') mark = <circle cx={cx} cy={cy} r={r} fill={color} {...ring} />
  else if (status === 'quebra') mark = <polygon points={`${cx - r * 1.15},${cy - r * 0.8} ${cx + r * 1.15},${cy - r * 0.8} ${cx},${cy + r * 1.1}`} fill={color} {...ring} strokeLinejoin="round" />
  else mark = <polygon points={`${cx - r * 1.15},${cy + r * 0.8} ${cx + r * 1.15},${cy + r * 0.8} ${cx},${cy - r * 1.1}`} fill={color} {...ring} strokeLinejoin="round" />
  return <g>{!small && <circle cx={cx} cy={cy} r={13} fill="transparent" />}{mark}</g>
}

const tipBox: React.CSSProperties = {
  background: SURFACE, border: '1px solid rgba(43,45,66,0.12)', borderRadius: 8, padding: '8px 12px',
  fontSize: 12, color: INK, boxShadow: '0 4px 14px rgba(43,45,66,0.10)', maxWidth: 280,
}

function ParetoTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.full}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ClassBadge c={d.class} /><span style={{ color: 'var(--brave-gray)' }}>classe</span></div>
      <div style={{ marginTop: 4 }}><strong>{fmtInt(d.valor)} un</strong> <span style={{ color: 'var(--brave-gray)' }}>vendidas</span></div>
      <div><strong>{d.pct.toFixed(1)}%</strong> <span style={{ color: 'var(--brave-gray)' }}>do total</span> · <strong>{d.acum}%</strong> <span style={{ color: 'var(--brave-gray)' }}>acumulado</span></div>
    </div>
  )
}

function StackTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as MatrixRow
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label} · {row.n} {row.n === 1 ? 'item' : 'itens'}</div>
      {STOCK_STATUS_ORDER.map(s => (
        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 2, background: STOCK_STATUS_META[s].color, display: 'inline-block' }} />
          <strong>{fmtBRL(row[s] as number)}</strong>
          <span style={{ color: 'var(--brave-gray)' }}>{STOCK_STATUS_META[s].label} · {row[`${s}N`]} {row[`${s}N`] === 1 ? 'item' : 'itens'}</span>
        </div>
      ))}
    </div>
  )
}

function ScatterTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const i = payload[0].payload.item as StockStatusItem
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{i.label}</div>
      <div style={{ color: 'var(--brave-gray)', fontSize: 11, marginBottom: 6 }}>{[i.sku, i.category].filter(Boolean).join(' · ')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><StatusChip status={i.status} parado={i.parado} />{i.abcClass && <ClassBadge c={i.abcClass} />}</div>
      <div><strong>{fmtBRL(i.valor)}</strong> <span style={{ color: 'var(--brave-gray)' }}>em estoque ({fmtInt(i.estoque)} un)</span></div>
      <div><strong>{i.cobertura == null ? '∞' : `${fmtDias(i.cobertura)} dias`}</strong> <span style={{ color: 'var(--brave-gray)' }}>de cobertura · {fmtInt(i.vendas)} un vendidas</span></div>
    </div>
  )
}

function MargemTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.full}</div>
      <div><strong>{d.mcPct}%</strong> <span style={{ color: 'var(--brave-gray)' }}>de margem de contribuição</span></div>
      <div><strong>{fmtBRL(d.mcUnit)}</strong> <span style={{ color: 'var(--brave-gray)' }}>por unidade</span></div>
    </div>
  )
}
