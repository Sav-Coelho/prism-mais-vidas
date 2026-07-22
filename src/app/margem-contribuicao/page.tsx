'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtInt = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.ceil(v))
const pctStr = (v: number) => `${(v * 100).toFixed(1)}%`
const now = new Date()

function dreGroup(dre: any, label: string): number {
  if (!dre?.lines) return 0
  const l = (dre.lines as any[]).find(x => x.label === label && x.type === 'group')
  return l ? Math.abs(l.value) : 0
}

type Override = { price?: number; cost?: number }

export default function MargemContribuicaoPage() {
  const [units, setUnits] = useState<any[]>([])
  const [unitId, setUnitId] = useState('')
  // Mês de referência para as taxas variáveis (padrão = último mês com dados)
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [products, setProducts] = useState<any[]>([])
  const [dre, setDre] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [overrides, setOverrides] = useState<Record<number, Override>>({})

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500) }
  const unitParam = unitId ? `&unitId=${unitId}` : ''

  const load = () => {
    setLoading(true)
    Promise.all([
      fetch(`/api/margem?${unitId ? `unitId=${unitId}` : ''}`).then(r => r.json()),
      fetch(`/api/dre?month=${month}&year=${year}${unitParam}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([p, d]) => {
      setProducts(Array.isArray(p) ? p : [])
      setDre(d?.dre ?? null)
      setLoading(false)
    })
  }
  useEffect(() => {
    fetch('/api/units').then(r => r.json()).then(setUnits)
    fetch('/api/abc/vendas').then(r => r.json()).then((all: any[]) => {
      if (Array.isArray(all) && all.length) {
        let best = { k: 0, y: now.getFullYear(), m: now.getMonth() + 1 }
        all.forEach(s => { const k = s.year * 100 + s.month; if (k > best.k) best = { k, y: s.year, m: s.month } })
        if (best.k > 0) { setYear(best.y); setMonth(best.m) }
      }
    }).catch(() => {})
  }, [])
  useEffect(() => { load() }, [month, year, unitId])

  const upload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    if (unitId) fd.append('unitId', unitId)
    try {
      const res = await fetch('/api/margem', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        const warn = data.warnings?.length ? ` · ${data.warnings.length} linha(s) ignorada(s)` : ''
        showToast(`✓ ${data.imported} produtos importados${warn}`)
        setOverrides({})
        load()
      } else {
        showToast(`Erro: ${data.error}`)
      }
    } catch {
      showToast('Erro ao enviar a planilha')
    }
    setUploading(false)
  }

  // Margem de Contribuição = Preço − (Custo de Reposição + Despesas Variáveis).
  // Despesas variáveis (impostos sobre venda, taxa de cartão, comissão) vêm da DRE como
  // % da receita: (Deduções sobre a Venda + Despesa Variável) ÷ Receita Bruta.
  // Custos FIXOS não são rateados — cobrem-se via ponto de equilíbrio (na DRE).
  const receitaBruta = dre?.receitaBruta ?? 0
  const deducoes = dreGroup(dre, 'Deduções sobre a Venda')
  const despVar = dreGroup(dre, 'Despesa Variável')
  const varRate = receitaBruta > 0 ? (deducoes + despVar) / receitaBruta : 0
  const custosFixos = dre?.custosFixos ?? 0

  const setOverride = (id: number, field: 'price' | 'cost', value: string) => {
    const v = value === '' ? 0 : parseFloat(value.replace(',', '.'))
    setOverrides(prev => ({ ...prev, [id]: { ...prev[id], [field]: isNaN(v) ? 0 : v } }))
  }
  const resetOverrides = () => setOverrides({})
  const simCount = Object.keys(overrides).length

  const analysis = useMemo(() => {
    const rows = products.map((p: any) => {
      const basePrice = p.salePrice || 0
      const baseCost = p.replacementCost || 0
      const ov = overrides[p.id] || {}
      const price = ov.price != null ? ov.price : basePrice
      const cost = ov.cost != null ? ov.cost : baseCost
      const edited = ov.price != null || ov.cost != null
      const despVarUnit = varRate * price          // despesas variáveis (% do preço)
      const mcUnit = price - cost - despVarUnit
      const mcPct = price > 0 ? mcUnit / price : 0
      const markup = cost > 0 ? price / cost : null
      // PEO por produto: unidades deste item (sozinho) p/ cobrir todos os custos fixos
      const peoUn = custosFixos > 0 && mcUnit > 0 ? custosFixos / mcUnit : null
      return {
        id: p.id, product: p.product, sku: p.sku,
        basePrice, baseCost, price, cost, despVarUnit, mcUnit, mcPct, markup, peoUn, edited,
      }
    }).sort((a, b) => b.mcPct - a.mcPct)

    const avgMcPct = rows.length ? rows.reduce((a, r) => a + r.mcPct, 0) / rows.length : 0
    const negativos = rows.filter(r => r.mcUnit < 0)
    const piores = [...rows].sort((a, b) => a.mcPct - b.mcPct).slice(0, 15).reverse()
      .map(r => ({ name: r.product.length > 22 ? r.product.slice(0, 21) + '…' : r.product, mcPct: +(r.mcPct * 100).toFixed(1) }))
    return { rows, avgMcPct, negativos, piores }
  }, [products, varRate, custosFixos, overrides])

  const hasData = products.length > 0

  const priceInput = (r: any, field: 'price' | 'cost') => (
    <input
      type="number" step="0.01" min="0"
      value={field === 'price' ? r.price : r.cost}
      onChange={e => setOverride(r.id, field, e.target.value)}
      style={{
        width: 78, textAlign: 'right', fontSize: 12, padding: '3px 6px',
        border: `1px solid ${r.edited ? 'var(--brave-yellow)' : 'var(--brave-light)'}`,
        borderRadius: 4, background: r.edited ? '#fffdf3' : '#fff',
      }}
    />
  )

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Margem de Contribuição</h1>
          <p className="page-subtitle">MC = Preço − (Custo de Reposição + Despesas Variáveis). Custos fixos não são rateados.</p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <select className="form-select" style={{ width: 150 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <span style={{ fontSize: 11, color: 'var(--brave-gray)' }}>Taxas variáveis do mês:</span>
          <select className="form-select" style={{ width: 110 }} value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
          <select className="form-select" style={{ width: 90 }} value={year} onChange={e => setYear(+e.target.value)}>
            {[2023, 2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Upload */}
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
          {uploading ? 'Importando...' : 'Importar catálogo de produtos (preço e custo)'}
        </div>
        <div className="upload-sub">
          Colunas: <strong>Código · Produto · Preço de Venda · Preço de custo</strong>. Catálogo <strong>geral</strong> — cada upload substitui o anterior.
          <br />As despesas variáveis (% da venda) vêm da DRE do mês de referência selecionado acima.
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : !hasData ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>Nenhum produto no catálogo</div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Importe o catálogo de preço/custo acima para calcular a margem de contribuição.
          </div>
        </div>
      ) : (
        <>
          {/* Nota de método */}
          <div className="card mb-4" style={{ padding: '10px 16px', background: '#eef7f0', border: '1px solid #a9d8b8', fontSize: 12, color: '#1a6b3d' }}>
            Despesas variáveis de {MONTH_NAMES[month]}/{year}: <strong>{pctStr(varRate)} do preço</strong> (Deduções {fmt(deducoes)} + Despesa Variável {fmt(despVar)} ÷ Receita {fmt(receitaBruta)}).
            {' '}Os <strong>custos fixos</strong> ({fmt(custosFixos)}) <strong>não</strong> entram na MC — são cobertos pela soma das margens no <strong>ponto de equilíbrio</strong> (veja a DRE).
          </div>

          {/* KPIs */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: analysis.avgMcPct >= 0 ? '#1a7a4a' : '#c0392b' }} />
              <div className="metric-label">MC% média</div>
              <div className="metric-value" style={{ fontSize: 18, color: analysis.avgMcPct >= 0 ? '#1a7a4a' : '#c0392b' }}>{pctStr(analysis.avgMcPct)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>média simples dos produtos</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Despesas variáveis</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{pctStr(varRate)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>do preço · {MONTH_NAMES[month]}/{year}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Produtos</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{analysis.rows.length}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>no catálogo</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: analysis.negativos.length > 0 ? '#c0392b' : '#1a7a4a' }} />
              <div className="metric-label">MC negativa</div>
              <div className="metric-value" style={{ fontSize: 18, color: analysis.negativos.length > 0 ? '#c0392b' : '#1a7a4a' }}>{analysis.negativos.length}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>vendem abaixo do custo variável</div>
            </div>
          </div>

          <div className="grid-2 mb-6">
            {/* 15 menores MC% */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>15 menores margens (MC%)</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>Produtos que menos contribuem para cobrir os custos fixos</div>
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={analysis.piores} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={130} />
                  <Tooltip formatter={(v: number) => [`${v}%`, 'MC%']} />
                  <Bar dataKey="mcPct" radius={[0, 4, 4, 0]} barSize={14}>
                    {analysis.piores.map((e, i) => <Cell key={i} fill={e.mcPct >= 0 ? '#1a7a4a' : '#c0392b'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Produtos com MC negativa */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Produtos com MC negativa</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>Preço não cobre nem o custo variável — cada venda dá prejuízo</div>
              {analysis.negativos.length === 0 ? (
                <div style={{ color: '#1a7a4a', fontSize: 13, padding: 12 }}>✓ Todos os produtos têm margem de contribuição positiva.</div>
              ) : (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {analysis.negativos.map(r => (
                    <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f3f3f3', fontSize: 12, gap: 8 }}>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.product}</span>
                      <span style={{ color: '#c0392b', fontWeight: 600, flexShrink: 0 }}>{pctStr(r.mcPct)}</span>
                      <span style={{ color: '#c0392b', flexShrink: 0, width: 90, textAlign: 'right' }}>{fmt(r.mcUnit)}/un</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Simulador */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Simulador de Margem — {analysis.rows.length} produtos</span>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  Edite <strong>Preço</strong> e <strong>Custo</strong> para simular o impacto na margem (não altera o catálogo salvo).
                  {' '}<strong>PEO (un)</strong> = unidades deste produto (sozinho) para cobrir os custos fixos do mês ({fmt(custosFixos)}).
                </div>
              </div>
              {simCount > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={resetOverrides}>↺ Restaurar valores ({simCount})</button>
              )}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th style={{ textAlign: 'right' }}>Preço (edit.)</th>
                    <th style={{ textAlign: 'right' }}>Custo Rep. (edit.)</th>
                    <th style={{ textAlign: 'right' }}>Markup</th>
                    <th style={{ textAlign: 'right' }}>Desp. Var./un</th>
                    <th style={{ textAlign: 'right' }}>MC/un</th>
                    <th style={{ textAlign: 'right' }}>MC%</th>
                    <th style={{ textAlign: 'right' }}>PEO (un)</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.map(r => (
                    <tr key={r.id} style={{ background: r.mcUnit < 0 ? '#fdf0ee' : r.edited ? '#fffdf3' : undefined }}>
                      <td style={{ fontSize: 13 }}>
                        {r.product}
                        {r.sku && <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{r.sku}{r.edited ? ' · simulado' : ''}</div>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{priceInput(r, 'price')}</td>
                      <td style={{ textAlign: 'right' }}>{priceInput(r, 'cost')}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{r.markup == null ? '—' : `${r.markup.toFixed(2)}×`}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{fmt(r.despVarUnit)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.mcUnit >= 0 ? '#1a7a4a' : '#c0392b' }}>{fmt(r.mcUnit)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: r.mcPct >= 0 ? '#1a7a4a' : '#c0392b' }}>{pctStr(r.mcPct)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{r.peoUn == null ? '—' : `${fmtInt(r.peoUn)} un`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}
