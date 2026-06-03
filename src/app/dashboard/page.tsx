'use client'
import { useEffect, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, Cell
} from 'recharts'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

const fmtPct = (v: number, base: number) =>
  base > 0 ? `${((v / base) * 100).toFixed(1)}%` : '—'

const now = new Date()

export default function Dashboard() {
  // consolidated = true: soma do ano inteiro | false: mês específico
  const [consolidated, setConsolidated] = useState(true)
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // month=0 → API retorna DRE consolidado do ano
    const m = consolidated ? 0 : month
    fetch(`/api/dre?month=${m}&year=${year}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [consolidated, month, year])

  const dre = data?.dre
  const yearData = (data?.yearData || []).map((d: any, i: number) => ({
    mes: MONTH_NAMES[i + 1],
    mesIdx: i + 1,
    'Receita Bruta': d.receitaBruta,
    'Margem Contribuição': d.margemContribuicao,
    'Lucro Operacional': d.resultadoOperacional,
    'Resultado Líquido': d.resultadoLiquido,
    // Margens % (0 quando sem receita)
    'Margem Contrib. %': d.receitaBruta > 0 ? +((d.margemContribuicao / d.receitaBruta) * 100).toFixed(1) : null,
    'Margem Operacional %': d.receitaBruta > 0 ? +((d.resultadoOperacional / d.receitaBruta) * 100).toFixed(1) : null,
    'Margem Líquida %': d.receitaBruta > 0 ? +((d.resultadoLiquido / d.receitaBruta) * 100).toFixed(1) : null,
  }))

  const margem = dre?.receitaBruta > 0
    ? ((dre.resultadoLiquido / dre.receitaBruta) * 100).toFixed(1)
    : '0.0'

  const periodoLabel = consolidated
    ? `Consolidado ${year}`
    : `${MONTH_NAMES[month]}/${year}`

  const TOGGLE: React.CSSProperties = {
    display: 'flex', borderRadius: 8, overflow: 'hidden',
    border: '1px solid var(--brave-light)', background: 'var(--brave-light)',
  }
  const TBTN = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
    fontFamily: 'var(--font-sub)', fontWeight: active ? 700 : 500,
    background: active ? 'var(--brave-dark)' : 'transparent',
    color: active ? '#fff' : 'var(--brave-gray)',
    transition: 'all 0.15s',
  })

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Dashboard — {periodoLabel}</h1>
          <p className="page-subtitle">Visão geral do resultado financeiro</p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          {/* Toggle Consolidado / Mensal */}
          <div style={TOGGLE}>
            <button style={TBTN(consolidated)} onClick={() => setConsolidated(true)}>
              Consolidado Anual
            </button>
            <button style={TBTN(!consolidated)} onClick={() => setConsolidated(false)}>
              Mês Específico
            </button>
          </div>

          {/* Seletor de mês — só aparece no modo mensal */}
          {!consolidated && (
            <select className="form-select" style={{ width: 120 }} value={month} onChange={e => setMonth(+e.target.value)}>
              {MONTH_NAMES.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          )}

          <select className="form-select" style={{ width: 90 }} value={year} onChange={e => setYear(+e.target.value)}>
            {[2023, 2024, 2025, 2026].map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : !dre || dre.receitaBruta === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>
            Sem dados para {periodoLabel}
          </div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            Importe e classifique lançamentos para gerar o Dashboard
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="metrics-grid mb-6">
            {[
              { label: 'Receita Bruta', value: dre.receitaBruta },
              { label: 'Receita Líquida', value: dre.receitaLiquida, pct: fmtPct(dre.receitaLiquida, dre.receitaBruta) },
              { label: 'Margem de Contribuição', value: dre.margemContribuicao, pct: fmtPct(dre.margemContribuicao, dre.receitaBruta) },
              { label: 'Lucro Operacional', value: dre.resultadoOperacional, pct: fmtPct(dre.resultadoOperacional, dre.receitaBruta) },
              { label: 'Resultado Líquido', value: dre.resultadoLiquido, pct: `${margem}%` },
            ].map(m => (
              <div className="metric-card" key={m.label}>
                <div className="metric-accent" style={{ background: (m.value ?? 0) < 0 ? '#c0392b' : 'var(--brave-yellow)' }} />
                <div className="metric-label">{m.label}</div>
                <div className={`metric-value ${(m.value ?? 0) < 0 ? 'negative' : ''}`} style={{ fontSize: 17 }}>
                  {fmt(m.value ?? 0)}
                </div>
                {m.pct && <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{m.pct} da receita</div>}
              </div>
            ))}
          </div>

          <div className="grid-2 mb-6">
            {/* Gráfico de barras */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 16 }}>
                Receita x Resultado — {year}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={yearData} barSize={14}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Receita Bruta" radius={[3, 3, 0, 0]}>
                    {yearData.map((entry: any) => (
                      <Cell
                        key={entry.mes}
                        fill={!consolidated && entry.mesIdx === month ? 'var(--brave-yellow)' : '#2b2d42'}
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="Resultado Líquido" radius={[3, 3, 0, 0]}>
                    {yearData.map((entry: any) => (
                      <Cell
                        key={entry.mes}
                        fill={entry['Resultado Líquido'] >= 0 ? '#1a7a4a' : '#c0392b'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Linha de evolução */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 16 }}>
                Evolução do Resultado Líquido — {year}
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={yearData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Line type="monotone" dataKey="Resultado Líquido" stroke="#eaca2d" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gráficos de indicadores financeiros */}
          <div className="grid-2 mb-6">
            {/* Linha 1: Evolução dos resultados em R$ */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Evolução dos Resultados — {year}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>Valores em R$</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={yearData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Receita Bruta" stroke="#2b2d42" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="Margem Contribuição" stroke="#8d99ae" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="Lucro Operacional" stroke="#eaca2d" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="Resultado Líquido" stroke="#1a7a4a" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Linha 2: Evolução das margens % */}
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                Evolução das Margens — {year}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>% sobre Receita Bruta</div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={yearData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                  <Tooltip formatter={(v: number | null) => v != null ? `${v.toFixed(1)}%` : '—'} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Margem Contrib. %" stroke="#8d99ae" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="Margem Operacional %" stroke="#eaca2d" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="Margem Líquida %" stroke="#1a7a4a" strokeWidth={2.5} dot={{ r: 4 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </Shell>
  )
}
