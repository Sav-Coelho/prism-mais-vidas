'use client'
import { useEffect, useMemo, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, Cell,
} from 'recharts'

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0)
const fmtBRL0 = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v || 0)
const fmtInt = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v || 0))
const now = new Date()

interface Metric {
  id: number
  month: number; year: number; unitId: number | null
  revenueBilled: number; revenueCaptured: number; investment: number
  sessions: number; orders: number; ticket: number
  conversionRate: number; roas: number; cpa: number
  approvalRate: number; paidTrafficPct: number
  notes: string | null
}

// Definição dos indicadores exibidos como cartões (na ordem)
type Fmt = 'brl' | 'int' | 'pct' | 'x'
interface KpiDef { key: keyof Metric; label: string; fmt: Fmt; higherIsBetter: boolean | null }
const KPIS: KpiDef[] = [
  { key: 'revenueBilled',   label: 'Receita Faturada', fmt: 'brl', higherIsBetter: true },
  { key: 'revenueCaptured', label: 'Receita Captada',  fmt: 'brl', higherIsBetter: true },
  { key: 'investment',      label: 'Investimento',     fmt: 'brl', higherIsBetter: null },
  { key: 'roas',            label: 'ROAS',             fmt: 'x',   higherIsBetter: true },
  { key: 'orders',          label: 'Pedidos',          fmt: 'int', higherIsBetter: true },
  { key: 'ticket',          label: 'Ticket Médio',     fmt: 'brl', higherIsBetter: true },
  { key: 'sessions',        label: 'Sessões',          fmt: 'int', higherIsBetter: true },
  { key: 'conversionRate',  label: 'Conversão',        fmt: 'pct', higherIsBetter: true },
  { key: 'cpa',             label: 'CPA',              fmt: 'brl', higherIsBetter: false },
  { key: 'approvalRate',    label: 'Aprovação',        fmt: 'pct', higherIsBetter: true },
  { key: 'paidTrafficPct',  label: 'Tráfego Pago',     fmt: 'pct', higherIsBetter: false },
]

const fmtVal = (v: number, fmt: Fmt) =>
  fmt === 'brl' ? fmtBRL(v) : fmt === 'int' ? fmtInt(v) : fmt === 'x' ? `${(v || 0).toFixed(2)}` : `${(v || 0).toFixed(2)}%`

// Campos do formulário de cadastro (na ordem de exibição)
const FORM_FIELDS: { key: keyof Metric; label: string; hint?: string }[] = [
  { key: 'revenueBilled',   label: 'Receita Faturada (R$)' },
  { key: 'revenueCaptured', label: 'Receita Captada (R$)' },
  { key: 'investment',      label: 'Investimento em mídia (R$)' },
  { key: 'sessions',        label: 'Sessões' },
  { key: 'orders',          label: 'Pedidos' },
  { key: 'ticket',          label: 'Ticket médio (R$)' },
  { key: 'conversionRate',  label: 'Taxa de conversão (%)', hint: 'ex.: 1.16' },
  { key: 'roas',            label: 'ROAS faturado', hint: 'ex.: 7.55' },
  { key: 'cpa',             label: 'CPA (R$)' },
  { key: 'approvalRate',    label: 'Taxa de aprovação (%)' },
  { key: 'paidTrafficPct',  label: '% de tráfego pago' },
]

const emptyForm = (): Record<string, string> =>
  Object.fromEntries(FORM_FIELDS.map(f => [f.key, '']))

export default function MarketingPage() {
  const [units, setUnits] = useState<any[]>([])
  const [unitId, setUnitId] = useState('')
  const [year, setYear] = useState(now.getFullYear())
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [refMonth, setRefMonth] = useState(0) // 0 = último mês com dados

  // Formulário
  const [showForm, setShowForm] = useState(false)
  const [formMonth, setFormMonth] = useState(now.getMonth() + 1)
  const [form, setForm] = useState<Record<string, string>>(emptyForm())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  const load = () => {
    setLoading(true)
    const unitParam = unitId ? `&unitId=${unitId}` : ''
    fetch(`/api/marketing?year=${year}${unitParam}`)
      .then(r => r.json())
      .then((rows: Metric[]) => {
        setMetrics(Array.isArray(rows) ? rows : [])
        setLoading(false)
      })
      .catch(() => { setMetrics([]); setLoading(false) })
  }
  useEffect(() => { fetch('/api/units').then(r => r.json()).then(setUnits).catch(() => {}) }, [])
  useEffect(() => { load() }, [year, unitId])

  const byMonth = useMemo(() => {
    const m: Record<number, Metric> = {}
    metrics.forEach(x => { m[x.month] = x })
    return m
  }, [metrics])

  // Mês de referência para os cartões: escolhido ou o último com dados
  const lastMonthWithData = metrics.length
    ? Math.max.apply(null, metrics.map(x => x.month))
    : 0
  const currentMonth = refMonth || lastMonthWithData
  const cur = byMonth[currentMonth] || null
  const prev = currentMonth > 1 ? byMonth[currentMonth - 1] || null : null

  const delta = (key: keyof Metric) => {
    if (!cur || !prev) return null
    const a = Number(cur[key]) || 0
    const b = Number(prev[key]) || 0
    if (b === 0) return null
    return ((a - b) / Math.abs(b)) * 100
  }

  // Série mês-a-mês para o gráfico
  const chartData = useMemo(() =>
    Array.from({ length: 12 }, (_, i) => {
      const mo = i + 1
      const d = byMonth[mo]
      return {
        mes: MONTH_NAMES[mo],
        receita: d ? d.revenueBilled : null,
        investimento: d ? d.investment : null,
        roas: d ? d.roas : null,
      }
    }), [byMonth])

  const totalRevenue = metrics.reduce((a, m) => a + (m.revenueBilled || 0), 0)
  const totalInvest = metrics.reduce((a, m) => a + (m.investment || 0), 0)
  const totalOrders = metrics.reduce((a, m) => a + (m.orders || 0), 0)
  const roasAcum = totalInvest > 0 ? totalRevenue / totalInvest : 0

  // ── Formulário ──
  const openNew = () => {
    setEditingId(null)
    setFormMonth(currentMonth || now.getMonth() + 1)
    setForm(emptyForm())
    setShowForm(true)
  }
  const openEdit = (m: Metric) => {
    setEditingId(m.id)
    setFormMonth(m.month)
    setForm(Object.fromEntries(FORM_FIELDS.map(f => [f.key, String(m[f.key] ?? '')])))
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const setField = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  const save = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = { month: formMonth, year, unitId: unitId || null }
    FORM_FIELDS.forEach(f => { payload[f.key] = form[f.key] })
    const res = await fetch('/api/marketing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      showToast(`✓ ${MONTH_NAMES[formMonth]}/${year} salvo`)
      setShowForm(false)
      setEditingId(null)
      load()
    } else {
      const d = await res.json().catch(() => ({}))
      showToast(`Erro: ${d.error || 'não foi possível salvar'}`)
    }
    setSaving(false)
  }

  const remove = async (m: Metric) => {
    if (typeof window !== 'undefined' && !window.confirm(`Excluir os indicadores de ${MONTH_NAMES[m.month]}/${m.year}?`)) return
    await fetch(`/api/marketing/${m.id}`, { method: 'DELETE' })
    showToast('Indicadores removidos')
    load()
  }

  const unitName = unitId ? units.find((u: any) => String(u.id) === unitId)?.name : 'Consolidado'

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Indicadores de Marketing</h1>
          <p className="page-subtitle">Performance de mídia e e-commerce, mês a mês</p>
        </div>
        <div className="flex gap-2">
          <select className="form-select" style={{ width: 160 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="form-select" style={{ width: 90 }} value={year} onChange={e => setYear(+e.target.value)}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
          </select>
          <button className="btn btn-primary" onClick={openNew}>+ Novo mês</button>
        </div>
      </div>

      {/* Formulário de cadastro/edição */}
      {showForm && (
        <div className="card mb-6" style={{ padding: '24px 28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 15 }}>
              {editingId ? 'Editar' : 'Cadastrar'} indicadores — {unitName} · {year}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setShowForm(false); setEditingId(null) }}>Fechar</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Mês *</label>
              <select className="form-select" style={{ width: '100%' }} value={formMonth} onChange={e => setFormMonth(+e.target.value)}>
                {MONTH_NAMES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
            </div>
            {FORM_FIELDS.map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input
                  type="text" inputMode="decimal" className="form-input" style={{ width: '100%' }}
                  placeholder={f.hint || '0'}
                  value={form[f.key] ?? ''}
                  onChange={e => setField(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Salvar mês'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setForm(emptyForm())}>Limpar campos</button>
          </div>
          <div style={{ marginTop: 14, padding: '10px 14px', background: '#f4f6fa', borderRadius: 8, fontSize: 12, color: 'var(--brave-gray)' }}>
            <strong>Dica:</strong> preencha com os números do fechamento mensal. Cadastrar o mesmo mês novamente substitui os dados anteriores.
          </div>
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : metrics.length === 0 ? (
        <div className="card" style={{ padding: 60, textAlign: 'center', color: 'var(--brave-gray)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📣</div>
          Nenhum indicador de marketing em {year}.<br />
          <span style={{ fontSize: 12 }}>Clique em <strong>+ Novo mês</strong> para cadastrar o fechamento.</span>
        </div>
      ) : (
        <>
          {/* Resumo do ano */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">Receita faturada · {year}</div>
              <div className="metric-value">{fmtBRL0(totalRevenue)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Investimento · {year}</div>
              <div className="metric-value">{fmtBRL0(totalInvest)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">ROAS acumulado</div>
              <div className="metric-value" style={{ color: '#1a7a4a' }}>{roasAcum.toFixed(2)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Pedidos · {year}</div>
              <div className="metric-value">{fmtInt(totalOrders)}</div>
            </div>
          </div>

          {/* Cartões do mês de referência */}
          <div className="card mb-6" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 14 }}>
                Retrato do mês — variação vs. mês anterior
              </div>
              <select className="form-select" style={{ width: 120, fontSize: 12 }} value={currentMonth}
                onChange={e => setRefMonth(+e.target.value)}>
                {metrics.map(m => <option key={m.month} value={m.month}>{MONTH_NAMES[m.month]}/{year}</option>)}
              </select>
            </div>
            {cur && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                {KPIS.map(k => {
                  const d = delta(k.key)
                  const better = k.higherIsBetter
                  const color = d == null || better == null ? 'var(--brave-gray)'
                    : (d >= 0) === better ? '#1a7a4a' : '#d59f07'
                  return (
                    <div key={k.key} style={{ background: '#fff', border: '1px solid #e3e8ec', borderRadius: 12, padding: '14px 16px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--brave-gray)', marginBottom: 8 }}>{k.label}</div>
                      <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 22, lineHeight: 1 }}>
                        {fmtVal(Number(cur[k.key]) || 0, k.fmt)}
                      </div>
                      {d != null && (
                        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color }}>
                          {d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}%
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Gráfico mês a mês */}
          <div className="card mb-6" style={{ padding: '20px 24px' }}>
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 14, marginBottom: 14 }}>
              Receita faturada e ROAS — {year}
            </div>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#eef1f3" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fontFamily: 'var(--font-sub)' }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `R$ ${Math.round(v / 1000)}k`} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: any, name: string) =>
                      name === 'ROAS' ? [Number(v).toFixed(2), 'ROAS'] : [fmtBRL(Number(v)), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-sub)' }} />
                  <Bar yAxisId="l" dataKey="receita" name="Receita faturada" fill="#2b2d42" radius={[4, 4, 0, 0]} maxBarSize={38}>
                    {chartData.map((_, i) => <Cell key={i} fill="#2b2d42" />)}
                  </Bar>
                  <Line yAxisId="r" dataKey="roas" name="ROAS" stroke="#d59f07" strokeWidth={3} dot={{ r: 3 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela mês a mês */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)', fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
              {unitName} — {year} — {metrics.length} {metrics.length === 1 ? 'mês' : 'meses'}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th style={{ textAlign: 'right' }}>Rec. Faturada</th>
                    <th style={{ textAlign: 'right' }}>Investimento</th>
                    <th style={{ textAlign: 'right' }}>ROAS</th>
                    <th style={{ textAlign: 'right' }}>Pedidos</th>
                    <th style={{ textAlign: 'right' }}>Ticket</th>
                    <th style={{ textAlign: 'right' }}>Conv.</th>
                    <th style={{ textAlign: 'right' }}>Sessões</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map(m => (
                    <tr key={m.id} style={{ background: m.month === currentMonth ? '#fef9e7' : undefined }}>
                      <td style={{ fontWeight: 600 }}>{MONTH_NAMES[m.month]}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(m.revenueBilled)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(m.investment)}</td>
                      <td style={{ textAlign: 'right', color: '#1a7a4a', fontWeight: 600 }}>{(m.roas || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(m.orders)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(m.ticket)}</td>
                      <td style={{ textAlign: 'right' }}>{(m.conversionRate || 0).toFixed(2)}%</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(m.sessions)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(m)}>Editar</button>{' '}
                        <button className="btn btn-danger btn-sm" onClick={() => remove(m)}>✕</button>
                      </td>
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
