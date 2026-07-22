'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const pctStr = (v: number) => `${(v * 100).toFixed(1)}%`
const now = new Date()

// Extrai o valor (R$) de um grupo da DRE pelas linhas
function dreGroup(dre: any, label: string): number {
  if (!dre?.lines) return 0
  const l = (dre.lines as any[]).find(x => x.label === label && x.type === 'group')
  return l ? Math.abs(l.value) : 0
}

const OPEX_GROUPS = ['Despesas Administrativas', 'Despesas com Pessoal', 'Despesas com Marketing', 'Despesas Comerciais', 'Despesas Financeiras']

type Override = { price?: number; cost?: number }

export default function MargemContribuicaoPage() {
  const [units, setUnits] = useState<any[]>([])
  const [unitId, setUnitId] = useState('')
  // Mês de referência do rateio (padrão = último mês com dados)
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [products, setProducts] = useState<any[]>([])
  const [dre, setDre] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Simulação: overrides de preço/custo por produto (não persiste)
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
    // padrão: último mês com vendas importadas (define o mês de referência)
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

  // Rateio por MARKUP sobre o custo: fator = despesas operacionais do mês ÷ CMV do mês.
  // Custo cheio = custo × (1 + fator). Item lucra se markup (Preço÷Custo) > (1 + fator).
  const opexTotal = OPEX_GROUPS.reduce((s, g) => s + dreGroup(dre, g), 0)
  const cmv = dreGroup(dre, 'Custo do Produto/Serviço')
  const fator = cmv > 0 ? opexTotal / cmv : 0
  const markupMin = 1 + fator

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
      const rateio = fator * cost              // rateio proporcional ao custo (markup)
      const mcUnit = price - cost - rateio
      const mcPct = price > 0 ? mcUnit / price : 0
      const markup = cost > 0 ? price / cost : null
      return {
        id: p.id, product: p.product, sku: p.sku,
        basePrice, baseCost, price, cost, rateio, mcUnit, mcPct, markup, edited,
      }
    }).sort((a, b) => b.mcPct - a.mcPct)

    const avgMcPct = rows.length ? rows.reduce((a, r) => a + r.mcPct, 0) / rows.length : 0
    const negativos = rows.filter(r => r.mcUnit < 0)
    const piores = [...rows].sort((a, b) => a.mcPct - b.mcPct).slice(0, 15).reverse()
      .map(r => ({ name: r.product.length > 22 ? r.product.slice(0, 21) + '…' : r.product, mcPct: +(r.mcPct * 100).toFixed(1) }))
    return { rows, avgMcPct, negativos, piores }
  }, [products, fator, overrides])

  const hasData = products.length > 0
  const hasRateio = opexTotal > 0 && cmv > 0

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
          <p className="page-subtitle">Análise geral por produto — rateio dos custos fixos por markup: custo cheio = custo × (1 + Custos Fixos ÷ CMV do mês)</p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <select className="form-select" style={{ width: 150 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <span style={{ fontSize: 11, color: 'var(--brave-gray)' }}>Mês do rateio:</span>
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
          <br />O rateio operacional vem da DRE do mês de referência selecionado acima.
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
          {/* Nota / aviso de rateio */}
          {hasRateio ? (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#eef7f0', border: '1px solid #a9d8b8', fontSize: 12, color: '#1a6b3d' }}>
              Rateio por markup: custo cheio = custo × <strong>{markupMin.toFixed(3)}</strong> — Custos Fixos de {MONTH_NAMES[month]}/{year} ({fmt(opexTotal)}) ÷ CMV ({fmt(cmv)}) = {pctStr(fator)} sobre o custo. Item dá lucro se <strong>markup (Preço÷Custo) &gt; {markupMin.toFixed(2)}</strong>.
            </div>
          ) : (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#fffbea', border: '1px solid #f0c040', fontSize: 12, color: '#7a5c00' }}>
              ⚠ Sem Custos Fixos ou CMV na DRE de {MONTH_NAMES[month]}/{year} — a MC está usando só <strong>Preço − Custo de Reposição</strong> (rateio 0%). Classifique custos fixos e CMV na DRE do mês para o rateio.
            </div>
          )}

          {/* KPIs */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: analysis.avgMcPct >= 0 ? '#1a7a4a' : '#c0392b' }} />
              <div className="metric-label">MC% média</div>
              <div className="metric-value" style={{ fontSize: 18, color: analysis.avgMcPct >= 0 ? '#1a7a4a' : '#c0392b' }}>{pctStr(analysis.avgMcPct)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>média simples dos produtos</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Markup mínimo</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{markupMin.toFixed(2)}×</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>Preço÷Custo p/ dar lucro · {MONTH_NAMES[month]}/{year}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Produtos</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{analysis.rows.length}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>no catálogo</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: analysis.negativos.length > 0 ? '#c0392b' : '#1a7a4a' }} />
              <div className="metric-label">Produtos no prejuízo</div>
              <div className="metric-value" style={{ fontSize: 18, color: analysis.negativos.length > 0 ? '#c0392b' : '#1a7a4a' }}>{analysis.negativos.length}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>MC unitária negativa</div>
            </div>
          </div>

          <div className="grid-2 mb-6">
            {/* 15 menores MC% */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>15 menores margens (MC%)</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>Produtos que mais pressionam o resultado</div>
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

            {/* Produtos no prejuízo */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Produtos no Prejuízo (MC negativa)</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>Vendendo abaixo do custo total (reposição + rateio)</div>
              {analysis.negativos.length === 0 ? (
                <div style={{ color: '#1a7a4a', fontSize: 13, padding: 12 }}>✓ Nenhum produto com margem negativa.</div>
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

          {/* Tabela / Simulador */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Simulador de Margem — {analysis.rows.length} produtos</span>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  Edite <strong>Preço</strong> e <strong>Custo</strong> para simular o impacto na margem (não altera o catálogo salvo).
                </div>
              </div>
              {simCount > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={resetOverrides}>
                  ↺ Restaurar valores ({simCount})
                </button>
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
                    <th style={{ textAlign: 'right' }}>Rateio/un</th>
                    <th style={{ textAlign: 'right' }}>MC/un</th>
                    <th style={{ textAlign: 'right' }}>MC%</th>
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
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.markup == null ? 'var(--brave-gray)' : r.markup >= markupMin ? '#1a7a4a' : '#c0392b' }}>
                        {r.markup == null ? '—' : `${r.markup.toFixed(2)}×`}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{fmt(r.rateio)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.mcUnit >= 0 ? '#1a7a4a' : '#c0392b' }}>{fmt(r.mcUnit)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: r.mcPct >= 0 ? '#1a7a4a' : '#c0392b' }}>{pctStr(r.mcPct)}</td>
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
