'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  calcABC, ABC_COLOR, classifyStock, STOCK_STATUS_META, STOCK_STATUS_ORDER,
  type ABCItem, type ABCClass, type StockStatus, type StockStatusItem,
} from '@/lib/abc'
import {
  ComposedChart, BarChart, ScatterChart, Bar, Line, Scatter, XAxis, YAxis, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtInt = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v))
const fmtK = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k` : fmtInt(v)
const fmtDias = (d: number | null) => d == null ? '∞' : d >= X_CAP ? `${X_CAP}+` : `${Math.round(d)}`
const now = new Date()

// Cromo dos gráficos: grade e eixos recessivos, tinta da marca para texto/linha
const GRID = '#edf2f4'
const AXIS = '#c3cbd7'
const INK = '#2b2d42'
const INK2 = '#505168'
const SURFACE = '#ffffff'
const X_CAP = 365 // cobertura acima disso (ou infinita) é plotada em "365+"

type Tab = 'vendas' | 'estoque'
type StatusFilter = 'todos' | StockStatus | 'parados'
type MatrixRow = { key: string; classe: string; n: number; total: number } & Record<string, number | string>

const itemKey = (r: any) => String(r.sku || '').trim() || String(r.product || '').toLowerCase().trim()
const STATUS_PRIO: Record<StockStatus, number> = { quebra: 0, excesso: 1, normal: 2 }
const LIMITES_KEY = 'prism.abc.limitesCobertura'

export default function CurvaABCPage() {
  const [tab, setTab] = useState<Tab>('vendas')
  const [units, setUnits] = useState<any[]>([])
  const [unitId, setUnitId] = useState('')
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())

  const [salesData, setSalesData] = useState<any[]>([])
  const [stockData, setStockData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Faixa de cobertura "normal" (dias) — ajustável; persistida no navegador
  const [minDias, setMinDias] = useState(15)
  const [maxDias, setMaxDias] = useState(120)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos')
  const limitesLidos = useRef(false)
  useEffect(() => {
    try {
      const s = localStorage.getItem(LIMITES_KEY)
      if (s) {
        const j = JSON.parse(s)
        if (j.min > 0) setMinDias(j.min)
        if (j.max > 0) setMaxDias(j.max)
      }
    } catch {}
    limitesLidos.current = true
  }, [])
  useEffect(() => {
    if (!limitesLidos.current) return
    try { localStorage.setItem(LIMITES_KEY, JSON.stringify({ min: minDias, max: maxDias })) } catch {}
  }, [minDias, maxDias])

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500) }
  const unitParam = unitId ? `&unitId=${unitId}` : ''
  const diasMes = new Date(year, month, 0).getDate()

  // Uma resposta de erro (500, corpo vazio) vira lista vazia — a página nunca fica presa em "Carregando..."
  const safeList = (r: Response) => (r.ok ? r.json().catch(() => []) : Promise.resolve([]))

  // Só a resposta da última requisição é aplicada: trocar o mês antes de a anterior
  // voltar não pode deixar a tela com dados de outro período.
  const loadSeq = useRef(0)
  const load = () => {
    const seq = ++loadSeq.current
    setLoading(true)
    Promise.all([
      fetch(`/api/abc/vendas?month=${month}&year=${year}${unitParam}`).then(safeList),
      fetch(`/api/abc/estoque?month=${month}&year=${year}${unitParam}`).then(safeList),
    ]).then(([s, e]) => {
      if (seq !== loadSeq.current) return
      setSalesData(Array.isArray(s) ? s : [])
      setStockData(Array.isArray(e) ? e : [])
    }).catch(() => {
      if (seq !== loadSeq.current) return
      setSalesData([])
      setStockData([])
    }).finally(() => {
      if (seq !== loadSeq.current) return
      setLoading(false)
      setLoaded(true)
    })
  }
  useEffect(() => {
    fetch('/api/units').then(safeList).then(u => setUnits(Array.isArray(u) ? u : [])).catch(() => setUnits([]))
  }, [])
  useEffect(() => { load() }, [month, year, unitId])

  // Link compartilhável: /curva-abc?mes=8&ano=2026&aba=estoque&unidade=1
  // O efeito de escrita só começa a gravar a URL depois que o estado refletir o que
  // foi lido dela — senão o primeiro render (mês corrente) sobrescreveria os parâmetros
  // antes de serem aplicados (o StrictMode do React roda os efeitos de montagem duas vezes).
  const urlLida = useRef(false)
  const urlPendente = useRef<{ mes: number; ano: number; aba: Tab; unidade: string } | null>(null)
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      const m = parseInt(q.get('mes') || '')
      const y = parseInt(q.get('ano') || '')
      const t = q.get('aba')
      const u = q.get('unidade')
      const mes = m >= 1 && m <= 12 ? m : month
      const ano = y >= 2000 && y <= 2100 ? y : year
      const aba: Tab = t === 'estoque' || t === 'vendas' ? t : tab
      const unidade = u && /^\d+$/.test(u) ? u : unitId
      if (mes !== month || ano !== year || aba !== tab || unidade !== unitId) {
        urlPendente.current = { mes, ano, aba, unidade }
        setMonth(mes); setYear(ano); setTab(aba); setUnitId(unidade)
      }
    } catch {}
    urlLida.current = true
  }, [])
  useEffect(() => {
    if (!urlLida.current) return
    const p = urlPendente.current
    if (p && (p.mes !== month || p.ano !== year || p.aba !== tab || p.unidade !== unitId)) return // ainda não aplicado
    urlPendente.current = null
    try {
      const q = new URLSearchParams({ mes: String(month), ano: String(year), aba: tab })
      if (unitId) q.set('unidade', unitId)
      window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
    } catch {}
  }, [month, year, tab, unitId])

  const upload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('month', String(month))
    fd.append('year', String(year))
    if (unitId) fd.append('unitId', unitId)
    const endpoint = tab === 'vendas' ? '/api/abc/import' : '/api/abc/inventario'
    try {
      const res = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        const extra = data.semCusto > 0 ? ` · ${data.semCusto} sem custo` : ''
        showToast(`✓ ${data.imported} ${tab === 'vendas' ? 'produtos vendidos' : 'itens em estoque'} importados${extra}`)
        load()
      } else {
        showToast(`Erro: ${data.error}`)
      }
    } catch {
      showToast('Erro ao enviar a planilha')
    }
    setUploading(false)
  }

  // ── Curva ABC da aba ativa ─────────────────────────────────────────────────
  // Agrega por SKU (sem SKU, por nome). Modo monetário só se a base trouxer valor/custo;
  // nesse modo, item sem custo entra com valor 0 (nunca mistura unidades com R$).
  const abc = useMemo(() => {
    const raw = tab === 'vendas' ? salesData : stockData
    const monetary = tab === 'vendas'
      ? salesData.some((r: any) => (r.revenue || 0) > 0)
      : stockData.some((r: any) => (r.unitCost || 0) > 0)
    const map = new Map<string, ABCItem>()
    raw.forEach((r: any) => {
      const key = itemKey(r)
      if (!key) return
      const qty = r.quantity || 0
      const value = tab === 'vendas'
        ? (monetary ? (r.revenue || 0) : qty)
        : (monetary ? qty * (r.unitCost || 0) : qty)
      const ex = map.get(key)
      if (ex) {
        ex.value += value
        ex.quantity = (ex.quantity || 0) + qty
      } else {
        const sub = [r.sku, r.category].filter(Boolean).join(' · ')
        map.set(key, { key, label: r.product, sublabel: sub || undefined, value, quantity: qty })
      }
    })
    const res = calcABC(Array.from(map.values()))
    // Em modo monetário, item sem valor/custo fica fora da curva — contado para o sublabel
    return { ...res, monetary, semValor: map.size - res.rows.length }
  }, [tab, salesData, stockData])

  const isMonetary = abc.monetary
  const valFmt = (v: number) => isMonetary ? fmtBRL(v) : `${fmtInt(v)} un`
  const valueLabel = tab === 'vendas'
    ? (isMonetary ? 'Faturamento' : 'Qtd. Vendida')
    : (isMonetary ? 'Valor em Estoque' : 'Qtd. em Estoque')

  // ── Situação do estoque (Quebra · Normal · Excesso), SKU a SKU ─────────────
  const situacao = useMemo(
    () => classifyStock(stockData, salesData, { diasMes, minDias, maxDias }),
    [stockData, salesData, diasMes, minDias, maxDias]
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
    const points = items.map(i => ({
      x: i.cobertura == null ? X_CAP : Math.min(i.cobertura, X_CAP),
      y: i.valor,
      status: i.status,
      item: i,
    }))
    const semCusto = items.filter(i => i.estoque > 0 && i.custo <= 0).length
    const cobs = items.filter(i => i.estoque > 0 && i.cobertura != null).map(i => i.cobertura as number).sort((a, b) => a - b)
    const mediana = cobs.length ? cobs[Math.floor(cobs.length / 2)] : null
    const totalSold = salesData.reduce((a: number, r: any) => a + (r.quantity || 0), 0)
    const totalStock = stockData.reduce((a: number, r: any) => a + (r.quantity || 0), 0)
    const giro = totalStock > 0 ? totalSold / totalStock : null
    const cobertura = totalSold > 0 ? totalStock / (totalSold / diasMes) : null
    const parados = items.filter(i => i.parado).length
    return { items, totalValor, byStatus, matrix, points, semCusto, mediana, totalSold, totalStock, giro, cobertura, parados }
  }, [situacao, salesData, stockData, diasMes])

  const tableRows = useMemo(() => {
    let rows = sit.items
    if (statusFilter === 'parados') rows = rows.filter(i => i.parado)
    else if (statusFilter !== 'todos') rows = rows.filter(i => i.status === statusFilter)
    return rows.slice().sort((a, b) => {
      const p = STATUS_PRIO[a.status] - STATUS_PRIO[b.status]
      if (p !== 0) return p
      if (a.status === 'quebra') return (a.cobertura ?? 0) - (b.cobertura ?? 0) // mais urgente primeiro
      return b.valor - a.valor // mais dinheiro parado primeiro
    })
  }, [sit, statusFilter])

  // Pareto em % (um só eixo): barras = participação individual, linha = acumulada
  const chartData = useMemo(
    () => abc.rows.slice(0, 20).map(r => ({
      name: r.label.length > 16 ? r.label.slice(0, 15) + '…' : r.label,
      full: r.label,
      pct: +r.pct.toFixed(2),
      acum: +r.cumPct.toFixed(1),
      valor: r.value,
      class: r.class,
    })),
    [abc]
  )

  const hasData = abc.rows.length > 0
  const hasSituacao = tab === 'estoque' && stockData.length > 0
  const hasVendasMes = salesData.length > 0

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Curva ABC</h1>
          <p className="page-subtitle">Classificação de Pareto e situação do estoque — Vendas e Estoque (relatórios mensais do Bling)</p>
        </div>
        <div className="flex gap-2">
          <select className="form-select" style={{ width: 150 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="form-select" style={{ width: 120 }} value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select className="form-select" style={{ width: 90 }} value={year} onChange={e => setYear(+e.target.value)}>
            {[2023, 2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['vendas', 'estoque'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '8px 18px', border: 'none', borderRadius: 6, cursor: 'pointer',
            fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13,
            background: tab === t ? 'var(--brave-yellow)' : 'var(--brave-light)',
            color: tab === t ? 'var(--brave-dark)' : 'var(--brave-gray)',
          }}>
            {t === 'vendas' ? '🏷️ Vendas' : '📦 Estoque'}
          </button>
        ))}
      </div>

      {/* Upload — específico da aba ativa */}
      <div
        className={`upload-zone mb-6 ${drag ? 'drag' : ''}`}
        onDragOver={e => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) upload(f) }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <div className="upload-icon">{uploading ? '⏳' : '📄'}</div>
        <div className="upload-title">
          {uploading ? 'Importando...' : tab === 'vendas'
            ? `Importar vendas do Bling — ${MONTH_NAMES[month]}/${year}`
            : `Importar Inventário (com custo) — ${MONTH_NAMES[month]}/${year}`}
        </div>
        <div className="upload-sub">
          {tab === 'vendas'
            ? <>Aceita o <strong>Relatório de Saída de Produtos</strong> ou o <strong>export ABC do Bling</strong> (.csv). Colunas: <strong>Código · Produto/Descrição · Quantidade</strong>. Alimenta a ABC de <strong>Vendas</strong> e a situação do estoque.</>
            : <>Colunas: <strong>Código · Produto · Preço de Custo · Qtd. Estoque</strong>. Alimenta a ABC de <strong>Estoque em R$</strong>, o giro e a situação Quebra · Normal · Excesso.</>}
          <br />Reenviar o mesmo mês substitui os dados desta aba.
        </div>
      </div>

      {!loaded ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : !hasData ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>
            Sem dados de {tab === 'vendas' ? 'vendas' : 'estoque'} para {MONTH_NAMES[month]}/{year}
          </div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Importe o relatório do mês acima para gerar a curva ABC.
          </div>
        </div>
      ) : (
        // Ao trocar de mês, o quadro anterior fica visível esmaecido (sem salto de layout)
        <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
          {/* Resumo A/B/C */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">{valueLabel} total</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{valFmt(abc.summary.total)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                {abc.summary.count} produtos{abc.semValor > 0 ? ` · ${abc.semValor} sem ${tab === 'vendas' ? 'valor' : 'custo'} (fora da curva)` : ''} · {MONTH_NAMES[month]}/{year}
              </div>
            </div>
            {(['A', 'B', 'C'] as ABCClass[]).map(c => (
              <div className="metric-card" key={c}>
                <div className="metric-accent" style={{ background: ABC_COLOR[c] }} />
                <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Swatch color={ABC_COLOR[c]} /> Classe {c}
                </div>
                <div className="metric-value" style={{ fontSize: 18 }}>
                  {abc.summary.byClass[c].valuePct.toFixed(0)}%
                </div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  {abc.summary.byClass[c].count} produtos · {valFmt(abc.summary.byClass[c].value)}
                </div>
              </div>
            ))}
          </div>

          {/* Giro (aba Estoque) */}
          {tab === 'estoque' && (sit.totalStock > 0 || sit.totalSold > 0) && (
            <div className="card mb-6">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                Giro de Estoque — {MONTH_NAMES[month]}/{year}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
                Unidades vendidas no mês ÷ unidades em estoque, SKU a SKU ({diasMes} dias).
                Giro, cobertura e GMROI em R$ (com o CMV da DRE) ficam em Compras → Cruzamento DRE.
              </div>
              <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <Metric label="Giro de estoque" value={sit.giro != null ? `${sit.giro.toFixed(2)}×` : '—'} hint="vendido ÷ estoque, no mês" />
                <Metric label="Cobertura agregada" value={sit.cobertura != null ? `${Math.round(sit.cobertura)} dias` : '—'} hint={sit.mediana != null ? `mediana por SKU: ${Math.round(sit.mediana)} dias` : 'autonomia do estoque'} />
                <Metric label="Unidades vendidas" value={fmtInt(sit.totalSold)} hint={`${fmtInt(sit.totalStock)} un em estoque`} />
                <Metric label="Itens parados" value={fmtInt(sit.parados)} hint="em estoque, sem venda no mês" />
              </div>
            </div>
          )}

          {/* Situação do estoque */}
          {hasSituacao && (
            <div className="card mb-6">
              <div className="flex-between" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                    Situação do Estoque — Quebra · Normal · Excesso
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>
                    Cobertura = estoque ÷ venda diária do mês. Quebra abaixo de <strong>{minDias}</strong> dias · Normal entre <strong>{minDias}</strong> e <strong>{maxDias}</strong> · Excesso acima de <strong>{maxDias}</strong> dias ou sem venda.
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

              {!hasVendasMes ? (
                <div style={{ marginTop: 16, padding: 16, background: 'var(--brave-light)', borderRadius: 8, fontSize: 13, color: 'var(--brave-gray-mid)' }}>
                  Importe as <strong>vendas de {MONTH_NAMES[month]}/{year}</strong> na aba Vendas para calcular a cobertura e classificar a situação de cada item.
                </div>
              ) : (
                <>
                  {/* Tiles por situação */}
                  <div className="metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16 }}>
                    {sit.byStatus.map(b => (
                      <StatusTile key={b.status} status={b.status} count={b.count} valor={b.valor}
                        pct={sit.totalValor > 0 ? (b.valor / sit.totalValor) * 100 : 0} parados={b.parados} />
                    ))}
                  </div>

                  {/* Classe × Situação: barras empilhadas + matriz */}
                  <div className="grid-2" style={{ marginTop: 20, gap: 20, alignItems: 'start' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
                        Onde está o dinheiro — valor em estoque por classe e situação
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 8 }}>
                        Classe pela ABC de vendas do mês (quantidade). Passe o mouse para ver itens e valores.
                      </div>
                      <StatusLegend />
                      <ResponsiveContainer width="100%" height={190}>
                        <BarChart data={sit.matrix} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap="35%">
                          <CartesianGrid stroke={GRID} horizontal={false} />
                          <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false} />
                          <YAxis type="category" dataKey="classe" width={82} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{ fill: 'rgba(43,45,66,0.06)' }} content={<StackTip />} />
                          {STOCK_STATUS_ORDER.map(s => (
                            <Bar key={s} dataKey={s} stackId="v" fill={STOCK_STATUS_META[s].color}
                              stroke={SURFACE} strokeWidth={2} maxBarSize={24} isAnimationActive={false} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div>
                      <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
                        Matriz classe × situação
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 8 }}>
                        Itens · valor em estoque. Prioridade: classe A em quebra; classe C ou sem venda em excesso.
                      </div>
                      <div className="table-wrap">
                        <table style={{ fontSize: 12 }}>
                          <thead>
                            <tr>
                              <th></th>
                              {STOCK_STATUS_ORDER.map(s => (
                                <th key={s} style={{ textAlign: 'right' }}>
                                  <span style={{ color: STOCK_STATUS_META[s].color }}>{STOCK_STATUS_META[s].icon}</span> {STOCK_STATUS_META[s].label}
                                </th>
                              ))}
                              <th style={{ textAlign: 'right' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sit.matrix.map(row => (
                              <tr key={row.key}>
                                <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  {row.key !== 'sem' && <Swatch color={ABC_COLOR[row.key as ABCClass]} />} {row.classe}
                                </td>
                                {STOCK_STATUS_ORDER.map(s => (
                                  <td key={s} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (row[`${s}N`] as number) > 0 ? INK : 'var(--brave-gray)' }}>
                                    {(row[`${s}N`] as number) > 0
                                      ? <>{row[`${s}N`]} <span style={{ color: 'var(--brave-gray)' }}>·</span> {fmtBRL(row[s] as number)}</>
                                      : '—'}
                                  </td>
                                ))}
                                <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                  {row.n} <span style={{ color: 'var(--brave-gray)' }}>·</span> {fmtBRL(row.total)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Dispersão: cobertura × valor */}
                  <div style={{ marginTop: 24 }}>
                    <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
                      Cobertura × valor em estoque — cada ponto é um SKU
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 8 }}>
                      Faixa sombreada = normal ({minDias}–{maxDias} dias). À esquerda dela, risco de faltar; à direita, capital parado. Sem venda no mês aparece em “{X_CAP}+”.
                    </div>
                    <StatusLegend shapes />
                    <ResponsiveContainer width="100%" height={300}>
                      <ScatterChart margin={{ top: 12, right: 24, bottom: 28, left: 8 }}>
                        <CartesianGrid stroke={GRID} />
                        <XAxis type="number" dataKey="x" domain={[0, X_CAP]} ticks={[0, 30, 60, 90, 120, 180, 270, X_CAP]}
                          tickFormatter={v => v >= X_CAP ? `${X_CAP}+` : String(v)} tick={{ fontSize: 10, fill: INK2 }}
                          axisLine={{ stroke: AXIS }} tickLine={false}
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

                  {/* Lista por situação */}
                  <div style={{ marginTop: 20 }}>
                    <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                      <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
                        Itens por situação — {tableRows.length} de {sit.items.length}
                      </div>
                      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                        {([
                          { k: 'todos', label: 'Todos' },
                          { k: 'quebra', label: `${STOCK_STATUS_META.quebra.icon} Quebra` },
                          { k: 'normal', label: `${STOCK_STATUS_META.normal.icon} Normal` },
                          { k: 'excesso', label: `${STOCK_STATUS_META.excesso.icon} Excesso` },
                          { k: 'parados', label: '⏸ Sem venda' },
                        ] as { k: StatusFilter; label: string }[]).map(f => (
                          <button key={f.k} onClick={() => setStatusFilter(f.k)} className="btn btn-sm" style={{
                            background: statusFilter === f.k ? 'var(--brave-dark)' : 'var(--brave-light)',
                            color: statusFilter === f.k ? '#fff' : 'var(--brave-dark)', border: 'none',
                          }}>{f.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Situação</th>
                            <th>Produto</th>
                            <th style={{ textAlign: 'center' }}>Classe</th>
                            <th style={{ textAlign: 'right' }}>Estoque</th>
                            <th style={{ textAlign: 'right' }}>Vendas/mês</th>
                            <th style={{ textAlign: 'right' }}>Cobertura</th>
                            <th style={{ textAlign: 'right' }}>Valor</th>
                            <th>Ação sugerida</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableRows.map(i => (
                            <tr key={i.key}>
                              <td><StatusChip status={i.status} parado={i.parado} /></td>
                              <td style={{ fontSize: 13 }}>
                                {i.label}
                                <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{[i.sku, i.category].filter(Boolean).join(' · ')}</div>
                              </td>
                              <td style={{ textAlign: 'center' }}>{i.abcClass ? <ClassBadge c={i.abcClass} /> : <span style={{ color: 'var(--brave-gray)', fontSize: 11 }}>—</span>}</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(i.estoque)} un</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(i.vendas)} un</td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                {i.cobertura == null ? <span title="sem venda no mês">∞</span> : `${fmtDias(i.cobertura)} dias`}
                              </td>
                              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                {i.estoque > 0 && i.custo <= 0 ? <span style={{ color: 'var(--brave-gray)' }} title="sem custo cadastrado">sem custo</span> : fmtBRL(i.valor)}
                              </td>
                              <td style={{ fontSize: 12, color: 'var(--brave-gray-mid)' }}>
                                {i.parado ? 'Liquidar / retirar do mix' : i.estoque === 0 ? 'Repor — vendeu sem estoque' : STOCK_STATUS_META[i.status].action}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 10, lineHeight: 1.5 }}>
                      {sit.semCusto > 0 && <>⚠ <strong>{sit.semCusto}</strong> {sit.semCusto === 1 ? 'item' : 'itens'} em estoque sem custo cadastrado — o valor total está subestimado. </>}
                      Itens vendidos sem estoque no inventário aparecem como Quebra; se o estoque estiver no Mercado Envios Full, ele não consta do inventário do Bling.
                      Kits vendem sem estoque próprio (consomem o componente).
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Pareto */}
          <div className="card mb-6">
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
              Curva de Pareto — Top 20 por {valueLabel}
            </div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 8 }}>
              Barras = participação de cada produto no total · linha = participação acumulada. A = até 80% acumulado · B = até 95% · C = restante.
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--brave-gray-mid)', marginBottom: 6, flexWrap: 'wrap' }}>
              {(['A', 'B', 'C'] as ABCClass[]).map(c => (
                <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Swatch color={ABC_COLOR[c]} /> Classe {c}</span>
              ))}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 16, height: 2, background: INK, display: 'inline-block' }} /> % acumulado
              </span>
            </div>
            <ResponsiveContainer width="100%" height={330}>
              <ComposedChart data={chartData} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} barCategoryGap="30%">
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: INK2 }} angle={-35} textAnchor="end" interval={0} height={76} axisLine={{ stroke: AXIS }} tickLine={false} />
                <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 95, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} width={40} />
                <ReferenceLine y={80} stroke={AXIS} label={{ value: 'A │ B', position: 'insideTopRight', fontSize: 10, fill: INK2 }} />
                <ReferenceLine y={95} stroke={AXIS} label={{ value: 'B │ C', position: 'insideTopRight', fontSize: 10, fill: INK2 }} />
                <Tooltip cursor={{ fill: 'rgba(43,45,66,0.06)' }} content={<ParetoTip valFmt={valFmt} valueLabel={valueLabel} />} />
                <Bar dataKey="pct" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {chartData.map((e, i) => <Cell key={i} fill={ABC_COLOR[e.class]} />)}
                </Bar>
                <Line type="monotone" dataKey="acum" stroke={INK} strokeWidth={2}
                  dot={{ r: 4, fill: INK, stroke: SURFACE, strokeWidth: 2 }} activeDot={{ r: 6, fill: INK, stroke: SURFACE, strokeWidth: 2 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Tabela ABC */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--brave-light)' }}>
              Classificação ABC — {abc.rows.length} produtos
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Classe</th>
                    <th>Produto</th>
                    {abc.rows.some(r => (r.quantity || 0) > 0) && isMonetary && <th style={{ textAlign: 'right' }}>Qtd.</th>}
                    <th style={{ textAlign: 'right' }}>{valueLabel}</th>
                    <th style={{ textAlign: 'right' }}>% Total</th>
                    <th style={{ textAlign: 'right' }}>% Acum.</th>
                  </tr>
                </thead>
                <tbody>
                  {abc.rows.map(r => (
                    <tr key={r.key}>
                      <td style={{ color: 'var(--brave-gray)', fontSize: 12 }}>{r.rank}</td>
                      <td><ClassBadge c={r.class} /></td>
                      <td style={{ fontSize: 13 }}>
                        {r.label}
                        {r.sublabel && <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{r.sublabel}</div>}
                      </td>
                      {abc.rows.some(x => (x.quantity || 0) > 0) && isMonetary && (
                        <td style={{ textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(r.quantity || 0)} un</td>
                      )}
                      <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{valFmt(r.value)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{r.pct.toFixed(1)}%</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)', fontVariantNumeric: 'tabular-nums' }}>{r.cumPct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

// Classe dentro de um preenchimento sólido: texto branco ou tinta conforme a luminância do fundo
function ClassBadge({ c }: { c: ABCClass }) {
  return (
    <span style={{
      display: 'inline-block', minWidth: 22, textAlign: 'center', background: ABC_COLOR[c],
      color: c === 'C' ? INK : '#fff', borderRadius: 4, padding: '1px 7px', fontWeight: 700, fontSize: 12,
    }}>{c}</span>
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
      <div className="metric-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: m.color }}>{m.icon}</span> {m.label}
      </div>
      <div className="metric-value" style={{ fontSize: 22 }}>{count} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--brave-gray)' }}>{count === 1 ? 'item' : 'itens'}</span></div>
      <div style={{ fontSize: 12, color: 'var(--brave-gray-mid)', marginTop: 2 }}>
        {fmtBRL(valor)} <span style={{ color: 'var(--brave-gray)' }}>· {pct.toFixed(1)}% do estoque</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 4 }}>
        {status === 'excesso' && parados > 0 ? <>{parados} sem nenhuma venda no mês · </> : null}{m.hint}
      </div>
    </div>
  )
}

function StatusLegend({ shapes }: { shapes?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--brave-gray-mid)', marginBottom: 4, flexWrap: 'wrap' }}>
      {STOCK_STATUS_ORDER.map(s => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {shapes
            ? <svg width={14} height={14}><StatusDot cx={7} cy={7} status={s} small /></svg>
            : <Swatch color={STOCK_STATUS_META[s].color} />}
          {STOCK_STATUS_META[s].label}
        </span>
      ))}
    </div>
  )
}

// Ponto do scatter: forma por situação (▼ ● ▲) + anel de 2px na cor da superfície +
// área de toque transparente maior que a marca.
function StatusDot({ cx, cy, status, small }: { cx?: number; cy?: number; status: StockStatus; small?: boolean }) {
  if (cx == null || cy == null) return null
  const color = STOCK_STATUS_META[status].color
  const r = small ? 4.5 : 5.5
  const ring = { stroke: SURFACE, strokeWidth: 2 }
  let mark
  if (status === 'normal') mark = <circle cx={cx} cy={cy} r={r} fill={color} {...ring} />
  else if (status === 'quebra') mark = <polygon points={`${cx - r * 1.15},${cy - r * 0.8} ${cx + r * 1.15},${cy - r * 0.8} ${cx},${cy + r * 1.1}`} fill={color} {...ring} strokeLinejoin="round" />
  else mark = <polygon points={`${cx - r * 1.15},${cy + r * 0.8} ${cx + r * 1.15},${cy + r * 0.8} ${cx},${cy - r * 1.1}`} fill={color} {...ring} strokeLinejoin="round" />
  return (
    <g>
      {!small && <circle cx={cx} cy={cy} r={13} fill="transparent" />}
      {mark}
    </g>
  )
}

// ─── Tooltips: valor em destaque, rótulo secundário ──────────────────────────

const tipBox: React.CSSProperties = {
  background: SURFACE, border: '1px solid rgba(43,45,66,0.12)', borderRadius: 8, padding: '8px 12px',
  fontSize: 12, color: INK, boxShadow: '0 4px 14px rgba(43,45,66,0.10)', maxWidth: 280,
}

function ParetoTip({ active, payload, valFmt, valueLabel }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.full}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ClassBadge c={d.class} /><span style={{ color: 'var(--brave-gray)' }}>classe</span></div>
      <div style={{ marginTop: 4 }}><strong>{valFmt(d.valor)}</strong> <span style={{ color: 'var(--brave-gray)' }}>{valueLabel}</span></div>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <StatusChip status={i.status} parado={i.parado} />
        {i.abcClass && <ClassBadge c={i.abcClass} />}
      </div>
      <div><strong>{fmtBRL(i.valor)}</strong> <span style={{ color: 'var(--brave-gray)' }}>em estoque ({fmtInt(i.estoque)} un)</span></div>
      <div><strong>{i.cobertura == null ? '∞' : `${fmtDias(i.cobertura)} dias`}</strong> <span style={{ color: 'var(--brave-gray)' }}>de cobertura · {fmtInt(i.vendas)} un vendidas no mês</span></div>
    </div>
  )
}
