'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtInt = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v))
const pctStr = (v: number) => `${(v * 100).toFixed(1)}%`
const now = new Date()

// Extrai o valor (R$) de um grupo da DRE pelas linhas
function dreGroup(dre: any, label: string): number {
  if (!dre?.lines) return 0
  const l = (dre.lines as any[]).find(x => x.label === label && x.type === 'group')
  return l ? Math.abs(l.value) : 0
}

export default function MargemContribuicaoPage() {
  const [units, setUnits] = useState<any[]>([])
  const [unitId, setUnitId] = useState('')
  // Mês de referência p/ rateio e volume (padrão = último mês com vendas)
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [products, setProducts] = useState<any[]>([])
  const [salesData, setSalesData] = useState<any[]>([])
  const [dre, setDre] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500) }
  const unitParam = unitId ? `&unitId=${unitId}` : ''

  const load = () => {
    setLoading(true)
    Promise.all([
      // catálogo GERAL (sem período); DRE do MÊS de referência p/ rateio; vendas do mês p/ volume
      fetch(`/api/margem?${unitId ? `unitId=${unitId}` : ''}`).then(r => r.json()),
      fetch(`/api/dre?month=${month}&year=${year}${unitParam}`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/abc/vendas?month=${month}&year=${year}${unitParam}`).then(r => r.json()).catch(() => []),
    ]).then(([p, d, s]) => {
      setProducts(Array.isArray(p) ? p : [])
      setDre(d?.dre ?? null)
      setSalesData(Array.isArray(s) ? s : [])
      setLoading(false)
    })
  }
  useEffect(() => {
    fetch('/api/units').then(r => r.json()).then(setUnits)
    // padrão: último mês com vendas importadas
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
        load()
      } else {
        showToast(`Erro: ${data.error}`)
      }
    } catch {
      showToast('Erro ao enviar a planilha')
    }
    setUploading(false)
  }

  // Rateio a partir da DRE: admin% e financeiro% sobre a Receita Operacional Bruta.
  // Custo Rateado = TODAS as despesas operacionais da DRE do MÊS de referência,
  // distribuídas como valor FIXO por unidade vendida no mês (opex do mês ÷ unidades do mês).
  const OPEX_GROUPS = ['Despesas Administrativas', 'Despesas com Pessoal', 'Despesas com Marketing', 'Despesas Comerciais', 'Despesas Financeiras']
  const opexTotal = OPEX_GROUPS.reduce((s, g) => s + dreGroup(dre, g), 0)

  const analysis = useMemo(() => {
    // Quantidade vendida vem do relatório de Saída (Bling) já importado, casada por Código/nome
    const qtyMap = new Map<string, number>()
    salesData.forEach((s: any) => {
      const sku = String(s.sku || '').toLowerCase().trim()
      const name = String(s.product || '').toLowerCase().trim()
      if (sku) qtyMap.set('s:' + sku, (qtyMap.get('s:' + sku) || 0) + (s.quantity || 0))
      if (name) qtyMap.set('n:' + name, (qtyMap.get('n:' + name) || 0) + (s.quantity || 0))
    })
    const lookupQty = (p: any): number => {
      const sku = String(p.sku || '').toLowerCase().trim()
      const name = String(p.product || '').toLowerCase().trim()
      if (sku && qtyMap.has('s:' + sku)) return qtyMap.get('s:' + sku)!
      if (name && qtyMap.has('n:' + name)) return qtyMap.get('n:' + name)!
      return p.quantity || 0
    }

    // Rateio fixo por unidade = opex total ÷ total de unidades vendidas
    const totalUnits = salesData.reduce((a: number, s: any) => a + (s.quantity || 0), 0)
    const rateioUnit = totalUnits > 0 ? opexTotal / totalUnits : 0

    const rows = products.map((p: any) => {
      const price = p.salePrice || 0
      const cost = p.replacementCost || 0
      const qty = lookupQty(p)
      const mcUnit = price - (cost + rateioUnit)
      const mcPct = price > 0 ? mcUnit / price : 0
      const mcTotal = mcUnit * qty
      const revenue = price * qty
      return {
        id: p.id, product: p.product, sku: p.sku, category: p.category || 'Sem categoria',
        price, cost, qty, rateio: rateioUnit, mcUnit, mcPct, mcTotal, revenue,
      }
    })

    const anyQty = rows.some(r => r.qty > 0)
    rows.sort((a, b) => anyQty ? b.mcTotal - a.mcTotal : b.mcPct - a.mcPct)

    const totalRevenue = rows.reduce((a, r) => a + r.revenue, 0)
    const totalMC = rows.reduce((a, r) => a + r.mcTotal, 0)
    const avgMcPct = totalRevenue > 0
      ? totalMC / totalRevenue
      : (rows.length > 0 ? rows.reduce((a, r) => a + r.mcPct, 0) / rows.length : 0)
    const negativos = rows.filter(r => r.mcUnit < 0)

    // Por categoria (MC% ponderada quando há qtd; senão média simples)
    const catMap: Record<string, { revenue: number; mc: number; pctSum: number; n: number }> = {}
    rows.forEach(r => {
      if (!catMap[r.category]) catMap[r.category] = { revenue: 0, mc: 0, pctSum: 0, n: 0 }
      catMap[r.category].revenue += r.revenue
      catMap[r.category].mc += r.mcTotal
      catMap[r.category].pctSum += r.mcPct
      catMap[r.category].n += 1
    })
    const byCategory = Object.keys(catMap).map(c => ({
      category: c,
      mc: catMap[c].mc,
      mcPct: catMap[c].revenue > 0 ? catMap[c].mc / catMap[c].revenue : (catMap[c].n > 0 ? catMap[c].pctSum / catMap[c].n : 0),
    })).sort((a, b) => b.mcPct - a.mcPct)

    return { rows, totalRevenue, totalMC, avgMcPct, negativos, byCategory, anyQty, rateioUnit, totalUnits }
  }, [products, salesData, opexTotal])

  const hasData = products.length > 0
  const hasQty = analysis.anyQty
  const hasRateio = opexTotal > 0 && analysis.totalUnits > 0

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Margem de Contribuição</h1>
          <p className="page-subtitle">Análise geral por produto — MC = (Preço − (Custo de Reposição + Rateio operacional/un)) ÷ Preço</p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <select className="form-select" style={{ width: 150 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <span style={{ fontSize: 11, color: 'var(--brave-gray)' }}>Mês de referência (rateio/volume):</span>
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
          <br />O rateio (despesas operacionais) e o volume vendido vêm do mês de referência selecionado acima.
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : !hasData ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>
            Nenhum produto no catálogo
          </div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Importe o catálogo de preço/custo acima para calcular a margem de contribuição.
          </div>
        </div>
      ) : (
        <>
          {/* Avisos de rateio */}
          {hasRateio ? (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#eef7f0', border: '1px solid #a9d8b8', fontSize: 12, color: '#1a6b3d' }}>
              Rateio operacional: <strong>{fmt(analysis.rateioUnit)}/unidade</strong> — despesas operacionais de {MONTH_NAMES[month]}/{year} ({fmt(opexTotal)}) ÷ {fmtInt(analysis.totalUnits)} unidades vendidas no mês. Aplicado igualmente a cada produto.
            </div>
          ) : (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#fffbea', border: '1px solid #f0c040', fontSize: 12, color: '#7a5c00' }}>
              ⚠ Rateio não aplicado: falta despesa operacional na DRE de {MONTH_NAMES[month]}/{year} ({fmt(opexTotal)}) ou volume de vendas ({fmtInt(analysis.totalUnits)} un). A MC está usando só <strong>Preço − Custo de Reposição</strong>. Classifique as despesas na DRE e importe as vendas (Curva ABC) do mês para o cálculo completo.
            </div>
          )}
          {!hasQty && (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#eef4fb', border: '1px solid #a9c7e8', fontSize: 12, color: '#2b5a8c' }}>
              ℹ Sem quantidade vendida em {MONTH_NAMES[month]}/{year} — importe o Relatório de Saída de Produtos (Bling) do mês na aba <strong>Curva ABC</strong> para casar o volume por Código (necessário para o rateio/un e a MC total).
            </div>
          )}

          {/* KPIs */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: analysis.avgMcPct >= 0 ? '#1a7a4a' : '#c0392b' }} />
              <div className="metric-label">MC% média (ponderada)</div>
              <div className="metric-value" style={{ fontSize: 18, color: analysis.avgMcPct >= 0 ? '#1a7a4a' : '#c0392b' }}>{pctStr(analysis.avgMcPct)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>sobre a receita total</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">MC total no período</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{fmt(analysis.totalMC)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>MC/un × qtd</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Produtos analisados</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{analysis.rows.length}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{analysis.byCategory.length} categorias</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: analysis.negativos.length > 0 ? '#c0392b' : '#1a7a4a' }} />
              <div className="metric-label">Produtos no prejuízo</div>
              <div className="metric-value" style={{ fontSize: 18, color: analysis.negativos.length > 0 ? '#c0392b' : '#1a7a4a' }}>{analysis.negativos.length}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>MC unitária negativa</div>
            </div>
          </div>

          <div className="grid-2 mb-6">
            {/* MC por categoria */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Margem de Contribuição por Categoria
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>MC% por categoria — verde positivo, vermelho negativo</div>
              <ResponsiveContainer width="100%" height={Math.max(180, analysis.byCategory.length * 34)}>
                <BarChart data={analysis.byCategory} layout="vertical" margin={{ left: 10, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 10 }} width={110} />
                  <Tooltip formatter={(v: number, _n: string, item: any) => [`${pctStr(v)}${item?.payload?.mc ? ` · ${fmt(item.payload.mc)}` : ''}`, 'MC']} />
                  <Bar dataKey="mcPct" radius={[0, 4, 4, 0]} barSize={20}>
                    {analysis.byCategory.map((c, i) => <Cell key={i} fill={c.mcPct >= 0 ? '#1a7a4a' : '#c0392b'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Produtos no prejuízo */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Produtos no Prejuízo (MC negativa)
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>
                Vendendo abaixo do custo total (reposição + rateio)
              </div>
              {analysis.negativos.length === 0 ? (
                <div style={{ color: '#1a7a4a', fontSize: 13, padding: 12 }}>✓ Nenhum produto com margem negativa.</div>
              ) : (
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
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

          {/* Tabela de ranking */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, borderBottom: '1px solid var(--brave-light)' }}>
              Ranking por Contribuição — {analysis.rows.length} produtos
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th style={{ textAlign: 'right' }}>Preço</th>
                    <th style={{ textAlign: 'right' }}>Custo Rep.</th>
                    <th style={{ textAlign: 'right' }}>Rateio/un</th>
                    <th style={{ textAlign: 'right' }}>MC/un</th>
                    <th style={{ textAlign: 'right' }}>MC%</th>
                    <th style={{ textAlign: 'right' }}>Qtd</th>
                    <th style={{ textAlign: 'right' }}>MC Total</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.map(r => (
                    <tr key={r.id} style={{ background: r.mcUnit < 0 ? '#fdf0ee' : undefined }}>
                      <td style={{ fontSize: 13 }}>
                        {r.product}
                        <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{r.category}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(r.price)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(r.cost)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{fmt(r.rateio)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.mcUnit >= 0 ? '#1a7a4a' : '#c0392b' }}>{fmt(r.mcUnit)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: r.mcPct >= 0 ? '#1a7a4a' : '#c0392b' }}>{pctStr(r.mcPct)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{r.qty ? fmtInt(r.qty) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.mcTotal >= 0 ? 'var(--brave-dark)' : '#c0392b' }}>{fmt(r.mcTotal)}</td>
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
