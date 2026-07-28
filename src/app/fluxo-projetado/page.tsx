'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, Legend,
} from 'recharts'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmt0 = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const pctStr = (v: number) => `${(v * 100).toFixed(1)}%`
const now = new Date()

type ScenarioKey = 'pessimista' | 'realista' | 'otimista' | 'atual'

const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  pessimista: 'Pessimista (−20%)',
  realista: 'Realista (média 3M)',
  otimista: 'Otimista (+20%)',
  atual: 'Nível atual (último mês)',
}

export default function FluxoProjetadoPage() {
  const [units, setUnits] = useState<any[]>([])
  const [unitId, setUnitId] = useState('')
  const [year, setYear] = useState(now.getFullYear())
  const [expenses, setExpenses] = useState<any[]>([])
  const [yearData, setYearData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [drag, setDrag] = useState(false)
  const [scenario, setScenario] = useState<ScenarioKey>('realista')
  const fileRef = useRef<HTMLInputElement>(null)
  const loadSeq = useRef(0)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 5000) }
  const unitParam = unitId ? `&unitId=${unitId}` : ''

  const load = () => {
    const seq = ++loadSeq.current
    setLoading(true)
    Promise.all([
      fetch(`/api/despesas-fixas?year=${year}${unitParam}`).then(r => r.json()).catch(() => []),
      fetch(`/api/dre?month=12&year=${year}${unitParam}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([e, d]) => {
      if (seq !== loadSeq.current) return
      setExpenses(Array.isArray(e) ? e : [])
      setYearData(Array.isArray(d?.yearData) ? d.yearData : [])
      setLoading(false)
    })
  }
  useEffect(() => { fetch('/api/units').then(r => r.json()).then(setUnits) }, [])
  useEffect(() => { load() }, [year, unitId])

  const upload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('year', String(year))
    if (unitId) fd.append('unitId', unitId)
    try {
      const res = await fetch('/api/despesas-fixas', { method: 'POST', body: fd })
      const data = await res.json()
      if (res.ok) {
        const meses = (data.periodos || []).map((p: any) => `${MONTH_NAMES[p.month]}/${p.year}`).join(', ')
        showToast(`✓ ${data.imported} lançamentos · ${fmt0(data.total)} · ${meses}`)
        load()
      } else {
        showToast(`Erro: ${data.error}`)
      }
    } catch {
      showToast('Erro ao enviar a planilha')
    }
    setUploading(false)
  }

  // ── Histórico: média dos últimos 3 meses com receita e MC% ponderada ──
  const hist = useMemo(() => {
    const withRev = yearData
      .map((d: any, i: number) => ({ month: i + 1, ...d }))
      .filter((d: any) => (d.receitaBruta || 0) > 0)
    const last3 = withRev.slice(-3)
    const avgRevenue = last3.length ? last3.reduce((a, d) => a + d.receitaBruta, 0) / last3.length : 0
    const sumRev = last3.reduce((a, d) => a + d.receitaBruta, 0)
    const sumMC = last3.reduce((a, d) => a + (d.margemContribuicao || 0), 0)
    const mcPct = sumRev > 0 ? sumMC / sumRev : 0
    const lastRevenue = last3.length ? last3[last3.length - 1].receitaBruta : 0
    const trendPct = last3.length >= 2
      ? (last3[last3.length - 1].receitaBruta / last3[0].receitaBruta) - 1
      : 0
    return { last3, avgRevenue, mcPct, lastRevenue, trendPct, meses: last3.map(d => MONTH_NAMES[d.month]) }
  }, [yearData])

  const revenueOf = (s: ScenarioKey) =>
    s === 'pessimista' ? hist.avgRevenue * 0.8
      : s === 'otimista' ? hist.avgRevenue * 1.2
        : s === 'atual' ? hist.lastRevenue
          : hist.avgRevenue

  // ── Projeção mês a mês ──
  const proj = useMemo(() => {
    const byMonth = new Map<number, number>()
    expenses.forEach((e: any) => {
      byMonth.set(e.month, (byMonth.get(e.month) || 0) + (e.amount || 0))
    })
    const months = Array.from(byMonth.keys()).sort((a, b) => a - b)
    const receita = revenueOf(scenario)
    const rows = months.map(m => {
      const fixo = byMonth.get(m) || 0
      const mcGerada = receita * hist.mcPct
      return {
        month: m, label: MONTH_NAMES[m], fixo, receita,
        pctReceita: receita > 0 ? fixo / receita : 0,
        mcGerada,
        sobra: mcGerada - fixo,
        pctMC: mcGerada > 0 ? fixo / mcGerada : 0,
        faturamentoMinimo: hist.mcPct > 0 ? fixo / hist.mcPct : 0,
        passado: m < now.getMonth() + 1 && year === now.getFullYear(),
      }
    })
    const total = rows.reduce((a, r) => a + r.fixo, 0)
    const media = rows.length ? total / rows.length : 0
    return { rows, months, total, media }
  }, [expenses, scenario, hist])

  // ── Detalhe: matriz despesa × mês ──
  const detail = useMemo(() => {
    const map = new Map<string, { description: string; category: string | null; byMonth: Map<number, number>; total: number }>()
    expenses.forEach((e: any) => {
      const key = String(e.description || '').toLowerCase().trim()
      if (!map.has(key)) map.set(key, { description: e.description, category: e.category || null, byMonth: new Map(), total: 0 })
      const row = map.get(key)!
      row.byMonth.set(e.month, (row.byMonth.get(e.month) || 0) + (e.amount || 0))
      row.total += e.amount || 0
    })
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [expenses])

  const hasData = expenses.length > 0
  const hasHist = hist.avgRevenue > 0
  const scenarios: ScenarioKey[] = ['pessimista', 'realista', 'otimista', 'atual']

  const chartData = proj.rows.map(r => ({
    label: r.label,
    'Despesa Fixa': +r.fixo.toFixed(2),
    'Margem gerada': +r.mcGerada.toFixed(2),
  }))

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Fluxo Projetado</h1>
          <p className="page-subtitle">Despesas fixas a pagar até o fim do ano e quanto da receita já está comprometida</p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          <select className="form-select" style={{ width: 150 }} value={unitId} onChange={e => setUnitId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {units.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select className="form-select" style={{ width: 90 }} value={year} onChange={e => setYear(+e.target.value)}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y}>{y}</option>)}
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
        <div className="upload-icon">{uploading ? '⏳' : '📅'}</div>
        <div className="upload-title">
          {uploading ? 'Importando...' : `Importar despesas fixas projetadas — ${year}`}
        </div>
        <div className="upload-sub">
          Aceita dois formatos: <strong>Descrição · Ago · Set · Out · Nov · Dez</strong> (uma coluna por mês)
          {' '}ou <strong>Mês · Descrição · Valor</strong> (uma linha por lançamento).
          <br />Reenviar substitui apenas os meses presentes no arquivo.
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : !hasData ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>
            Nenhuma despesa fixa projetada para {year}
          </div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Importe a planilha de despesas fixas acima para montar a projeção.
          </div>
        </div>
      ) : (
        <>
          {/* Base de cálculo */}
          {hasHist ? (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#eef7f0', border: '1px solid #a9d8b8', fontSize: 12, color: '#1a6b3d' }}>
              Base de receita: média de <strong>{hist.meses.join(', ')}</strong> = <strong>{fmt(hist.avgRevenue)}/mês</strong>
              {' '}· Margem de contribuição realizada: <strong>{pctStr(hist.mcPct)}</strong> da receita
              {hist.trendPct < -0.05 && (
                <span style={{ color: '#a35200', fontWeight: 600 }}>
                  {' '}· ⚠ Atenção: a receita variou {pctStr(hist.trendPct)} entre {hist.meses[0]} e {hist.meses[hist.meses.length - 1]} — a média está acima do nível atual.
                </span>
              )}
            </div>
          ) : (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#fffbea', border: '1px solid #f0c040', fontSize: 12, color: '#7a5c00' }}>
              ⚠ Sem histórico de receita em {year} na DRE — mostro as despesas projetadas, mas não é possível calcular o % comprometido. Classifique lançamentos na DRE para habilitar.
            </div>
          )}

          {/* KPIs */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: 'var(--brave-dark)' }} />
              <div className="metric-label">Total a pagar ({proj.months.length} {proj.months.length === 1 ? 'mês' : 'meses'})</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{fmt(proj.total)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                {MONTH_NAMES[proj.months[0]]} a {MONTH_NAMES[proj.months[proj.months.length - 1]]}/{year}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Média mensal</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{fmt(proj.media)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>despesa fixa por mês</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Receita média (3 meses)</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{hasHist ? fmt(hist.avgRevenue) : '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{hist.meses.join(' · ') || 'sem histórico'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: proj.media / (hist.avgRevenue || 1) > 0.4 ? '#c0392b' : '#1a7a4a' }} />
              <div className="metric-label">% da receita comprometido</div>
              <div className="metric-value" style={{ fontSize: 18, color: proj.media / (hist.avgRevenue || 1) > 0.4 ? '#c0392b' : '#1a7a4a' }}>
                {hasHist ? pctStr(proj.media / hist.avgRevenue) : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>só com despesas fixas</div>
            </div>
          </div>

          {/* Cenários */}
          {hasHist && (
            <div className="card mb-6">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                Comprometimento por cenário de faturamento
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
                Compara a despesa fixa média ({fmt(proj.media)}/mês) com diferentes níveis de receita.
                A coluna <strong>% da margem</strong> é a mais realista: mede o compromisso contra o que de fato sobra depois do custo da mercadoria.
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cenário</th>
                      <th style={{ textAlign: 'right' }}>Receita/mês</th>
                      <th style={{ textAlign: 'right' }}>% da receita</th>
                      <th style={{ textAlign: 'right' }}>Margem gerada</th>
                      <th style={{ textAlign: 'right' }}>% da margem</th>
                      <th style={{ textAlign: 'right' }}>Sobra após fixo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map(s => {
                      const rec = revenueOf(s)
                      const mc = rec * hist.mcPct
                      const sobra = mc - proj.media
                      const pctRec = rec > 0 ? proj.media / rec : 0
                      const pctMc = mc > 0 ? proj.media / mc : 0
                      return (
                        <tr key={s} style={{ background: s === scenario ? 'rgba(234,202,45,0.10)' : undefined }}>
                          <td style={{ fontSize: 13, fontWeight: s === scenario ? 700 : 400 }}>
                            {SCENARIO_LABEL[s]}
                            {s === scenario && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--brave-gray)' }}>◀ em uso</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(rec)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: pctRec > 0.4 ? '#c0392b' : 'var(--brave-dark)' }}>{pctStr(pctRec)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(mc)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: pctMc >= 1 ? '#c0392b' : pctMc > 0.8 ? '#d59f07' : '#1a7a4a' }}>{pctStr(pctMc)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: sobra >= 0 ? '#1a7a4a' : '#c0392b' }}>{fmt(sobra)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Seletor de cenário + gráfico */}
          <div className="card mb-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14 }}>Despesa fixa vs margem gerada — mês a mês</div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  Onde a linha (margem) fica abaixo da barra (despesa fixa), o mês fecha no vermelho
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {scenarios.map(s => (
                  <button key={s} onClick={() => setScenario(s)} style={{
                    padding: '5px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
                    fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 11,
                    background: scenario === s ? 'var(--brave-yellow)' : 'var(--brave-light)',
                    color: scenario === s ? 'var(--brave-dark)' : 'var(--brave-gray)',
                  }}>{SCENARIO_LABEL[s]}</button>
                ))}
              </div>
            </div>
            {hasHist ? (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Despesa Fixa" radius={[3, 3, 0, 0]} barSize={28}>
                    {chartData.map((e, i) => (
                      <Cell key={i} fill={e['Margem gerada'] >= e['Despesa Fixa'] ? '#8d99ae' : '#c0392b'} />
                    ))}
                  </Bar>
                  <Line type="monotone" dataKey="Margem gerada" stroke="#1a7a4a" strokeWidth={2.5} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="Despesa Fixa" fill="#8d99ae" radius={[3, 3, 0, 0]} barSize={28} />
                </ComposedChart>
              </ResponsiveContainer>
            )}

            {/* Tabela mês a mês */}
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th style={{ textAlign: 'right' }}>Despesa Fixa</th>
                    <th style={{ textAlign: 'right' }}>% da Receita</th>
                    <th style={{ textAlign: 'right' }}>Margem gerada</th>
                    <th style={{ textAlign: 'right' }}>Sobra após fixo</th>
                    <th style={{ textAlign: 'right' }}>Faturamento mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {proj.rows.map(r => (
                    <tr key={r.month} style={{ background: hasHist && r.sobra < 0 ? '#fdf0ee' : undefined }}>
                      <td style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
                        {r.label}/{year}
                        {r.passado && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--brave-gray)' }}>(realizado)</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{fmt(r.fixo)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: r.pctReceita > 0.4 ? '#c0392b' : 'var(--brave-dark)' }}>
                        {hasHist ? pctStr(r.pctReceita) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{hasHist ? fmt(r.mcGerada) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: r.sobra >= 0 ? '#1a7a4a' : '#c0392b' }}>
                        {hasHist ? fmt(r.sobra) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>
                        {hasHist ? fmt(r.faturamentoMinimo) : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--brave-light)', fontWeight: 700 }}>
                    <td style={{ fontFamily: 'var(--font-sub)', fontSize: 13 }}>TOTAL</td>
                    <td style={{ textAlign: 'right', fontSize: 13 }}>{fmt(proj.total)}</td>
                    <td colSpan={4}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Detalhe por despesa */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--brave-light)' }}>
              <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>
                Detalhe das despesas fixas — {detail.length} itens
              </span>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                Ordenado por peso no período — os primeiros itens são onde a negociação tem mais impacto
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Despesa</th>
                    {proj.months.map(m => <th key={m} style={{ textAlign: 'right' }}>{MONTH_NAMES[m]}</th>)}
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>% do fixo</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.map((d, i) => (
                    <tr key={i}>
                      <td style={{ fontSize: 13 }}>
                        {d.description}
                        {d.category && <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{d.category}</div>}
                      </td>
                      {proj.months.map(m => (
                        <td key={m} style={{ textAlign: 'right', fontSize: 12, color: d.byMonth.get(m) ? 'var(--brave-dark)' : 'var(--brave-light)' }}>
                          {d.byMonth.get(m) ? fmt0(d.byMonth.get(m)!) : '—'}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{fmt(d.total)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>
                        {proj.total > 0 ? pctStr(d.total / proj.total) : '—'}
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
