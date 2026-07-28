'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmt0 = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const pctStr = (v: number) => `${(v * 100).toFixed(1)}%`
const ppStr = (v: number) => `${(v * 100).toFixed(1)} p.p.`
const now = new Date()

type ScenarioKey = 'pessimista' | 'realista' | 'otimista' | 'atual'

const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  pessimista: 'Pessimista (−20%)',
  realista: 'Realista (média 3M)',
  otimista: 'Otimista (+20%)',
  atual: 'Nível atual (último mês)',
}

interface Stat { mean: number; sd: number; min: number; max: number; n: number; w: number }

function describe(values: number[], weights: number[]): Stat {
  const n = values.length
  if (!n) return { mean: 0, sd: 0, min: 0, max: 0, n: 0, w: 0 }
  const mean = values.reduce((a, b) => a + b, 0) / n
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n
  const sumW = weights.reduce((a, b) => a + b, 0)
  const w = sumW > 0 ? values.reduce((a, v, i) => a + v * weights[i], 0) / sumW : mean
  return {
    mean, sd: Math.sqrt(variance), n, w,
    min: values.reduce((a, b) => Math.min(a, b), values[0]),
    max: values.reduce((a, b) => Math.max(a, b), values[0]),
  }
}

function dreGroup(m: any, label: string): number {
  const x = (m?.lines || []).find((z: any) => z.label === label && z.type === 'group')
  return x ? Math.abs(x.value) : 0
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

  // ── Estatística do histórico realizado (DRE) ──
  const hist = useMemo(() => {
    const months = yearData
      .map((d: any, i: number) => ({ month: i + 1, ...d }))
      .filter((d: any) => (d.receitaBruta || 0) > 0)

    const rows = months.map((m: any) => {
      const rb = m.receitaBruta
      return {
        month: m.month, receita: rb,
        cmvPct: dreGroup(m, 'Custo do Produto/Serviço') / rb,
        dvPct: (dreGroup(m, 'Despesa Variável') + dreGroup(m, 'Deduções sobre a Venda')) / rb,
        impPct: dreGroup(m, 'Impostos') / rb,
        fixoReal: m.custosFixos || 0,
      }
    })
    const weights = rows.map(r => r.receita)
    const cmv = describe(rows.map(r => r.cmvPct), weights)
    const dv = describe(rows.map(r => r.dvPct), weights)
    const imp = describe(rows.map(r => r.impPct), weights)
    const totalVar = describe(rows.map(r => r.cmvPct + r.dvPct + r.impPct), weights)

    const last3 = rows.slice(-3)
    const avgRevenue = last3.length ? last3.reduce((a, r) => a + r.receita, 0) / last3.length : 0
    const lastRevenue = last3.length ? last3[last3.length - 1].receita : 0
    const trendPct = last3.length >= 2 ? (last3[last3.length - 1].receita / last3[0].receita) - 1 : 0
    const avgFixoReal = rows.length ? rows.reduce((a, r) => a + r.fixoReal, 0) / rows.length : 0
    const lastFixoReal = rows.length ? rows[rows.length - 1].fixoReal : 0

    return {
      rows, cmv, dv, imp, totalVar, last3, avgRevenue, lastRevenue, trendPct,
      avgFixoReal, lastFixoReal, lastMonth: rows.length ? rows[rows.length - 1].month : 0,
      mcPct: 1 - (cmv.w + dv.w),
      meses: last3.map(r => MONTH_NAMES[r.month]),
      mesesBase: rows.map(r => MONTH_NAMES[r.month]),
    }
  }, [yearData])

  const revenueOf = (s: ScenarioKey) =>
    s === 'pessimista' ? hist.avgRevenue * 0.8
      : s === 'otimista' ? hist.avgRevenue * 1.2
        : s === 'atual' ? hist.lastRevenue
          : hist.avgRevenue

  // ── Projeção mês a mês (fixo da planilha + variáveis estatísticos) ──
  const proj = useMemo(() => {
    const byMonth = new Map<number, number>()
    expenses.forEach((e: any) => byMonth.set(e.month, (byMonth.get(e.month) || 0) + (e.amount || 0)))
    const months = Array.from(byMonth.keys()).sort((a, b) => a - b)
    const receita = revenueOf(scenario)

    const rows = months.map(m => {
      const fixo = byMonth.get(m) || 0
      const cmv = receita * hist.cmv.w
      const dv = receita * hist.dv.w
      const imp = receita * hist.imp.w
      const margem = receita - cmv - dv
      const resultado = margem - fixo - imp
      // faixa (±1σ do total variável): menos custo variável = melhor resultado
      const varBase = receita * hist.totalVar.w
      const varDelta = receita * hist.totalVar.sd
      return {
        month: m, label: MONTH_NAMES[m], receita, fixo, cmv, dv, imp, margem, resultado,
        resMin: receita - (varBase + varDelta) - fixo,
        resMax: receita - Math.max(0, varBase - varDelta) - fixo,
        pctReceita: receita > 0 ? fixo / receita : 0,
        pctMargem: margem > 0 ? fixo / margem : 0,
        faturamentoMinimo: hist.mcPct > 0 ? (fixo + imp) / hist.mcPct : 0,
        passado: m < now.getMonth() + 1 && year === now.getFullYear(),
      }
    })
    const total = rows.reduce((a, r) => a + r.fixo, 0)
    const media = rows.length ? total / rows.length : 0
    const resultadoTotal = rows.reduce((a, r) => a + r.resultado, 0)
    return { rows, months, total, media, resultadoTotal }
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

  // Aferição: a projeção de fixo é compatível com o realizado?
  const cobertura = hist.avgFixoReal > 0 ? proj.media / hist.avgFixoReal : null
  const projIncompleta = cobertura != null && cobertura < 0.8

  const chartData = proj.rows.map(r => ({
    label: r.label,
    CMV: +r.cmv.toFixed(2),
    'Desp. Variável': +r.dv.toFixed(2),
    Impostos: +r.imp.toFixed(2),
    'Despesa Fixa': +r.fixo.toFixed(2),
    Receita: +r.receita.toFixed(2),
  }))

  const varStatRows: { label: string; stat: Stat; nota?: string }[] = [
    { label: 'CMV (custo da mercadoria)', stat: hist.cmv },
    { label: 'Despesa Variável + Deduções', stat: hist.dv },
    { label: 'Impostos', stat: hist.imp, nota: 'pagos com defasagem — oscilam muito entre meses' },
  ]

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Fluxo Projetado</h1>
          <p className="page-subtitle">Despesas fixas contratadas + custos variáveis projetados estatisticamente = resultado esperado até dezembro</p>
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
          Aceita <strong>Despesa · Julho · Agosto · ... · Dezembro</strong> (uma coluna por mês) ou <strong>Mês · Descrição · Valor</strong>.
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
          {/* Aferição da projeção de fixo */}
          {hasHist && cobertura != null && (
            <div className="card mb-4" style={{
              padding: '12px 16px', fontSize: 12,
              background: projIncompleta ? '#fdf0ee' : '#eef7f0',
              border: `1px solid ${projIncompleta ? '#e8a79c' : '#a9d8b8'}`,
              color: projIncompleta ? '#8c2f1d' : '#1a6b3d',
            }}>
              <strong>Aferição da projeção de despesa fixa:</strong>{' '}
              projetado <strong>{fmt(proj.media)}/mês</strong> vs realizado médio na DRE{' '}
              <strong>{fmt(hist.avgFixoReal)}/mês</strong> ({hist.mesesBase.join(', ')}) — cobertura de <strong>{pctStr(cobertura)}</strong>.
              {projIncompleta && (
                <div style={{ marginTop: 6, lineHeight: 1.5 }}>
                  ⚠ A planilha parece <strong>incompleta</strong>: cobre menos de 80% do custo fixo que a empresa realmente gastou.
                  Itens que costumam faltar: <strong>pró-labore/retiradas</strong>, mídia paga, consultorias, softwares e despesas
                  operacionais recorrentes. Enquanto isso, o % comprometido e o resultado abaixo estão <strong>otimistas</strong>.
                </div>
              )}
            </div>
          )}

          {/* Base estatística */}
          {hasHist ? (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#f4f6fa', border: '1px solid #d5dce8', fontSize: 12, color: 'var(--brave-dark)' }}>
              Receita base: média de <strong>{hist.meses.join(', ')}</strong> = <strong>{fmt(hist.avgRevenue)}/mês</strong>
              {' '}· Custos variáveis projetados sobre <strong>{hist.totalVar.n} {hist.totalVar.n === 1 ? 'mês' : 'meses'}</strong> de histórico
              {hist.trendPct < -0.05 && (
                <span style={{ color: '#a35200', fontWeight: 600 }}>
                  {' '}· ⚠ receita variou {pctStr(hist.trendPct)} entre {hist.meses[0]} e {hist.meses[hist.meses.length - 1]} — a média está acima do nível atual
                </span>
              )}
            </div>
          ) : (
            <div className="card mb-4" style={{ padding: '10px 16px', background: '#fffbea', border: '1px solid #f0c040', fontSize: 12, color: '#7a5c00' }}>
              ⚠ Sem histórico de receita em {year} na DRE — mostro as despesas projetadas, mas não é possível projetar variáveis nem o resultado.
            </div>
          )}

          {/* KPIs */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: 'var(--brave-dark)' }} />
              <div className="metric-label">Despesa fixa a pagar ({proj.months.length} {proj.months.length === 1 ? 'mês' : 'meses'})</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{fmt(proj.total)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                {MONTH_NAMES[proj.months[0]]} a {MONTH_NAMES[proj.months[proj.months.length - 1]]}/{year} · média {fmt0(proj.media)}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Custos variáveis projetados</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{hasHist ? pctStr(hist.totalVar.w) : '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                da receita {hasHist && `(± ${ppStr(hist.totalVar.sd)})`}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: proj.media / (hist.avgRevenue || 1) > 0.4 ? '#c0392b' : '#1a7a4a' }} />
              <div className="metric-label">% da receita comprometido</div>
              <div className="metric-value" style={{ fontSize: 18, color: proj.media / (hist.avgRevenue || 1) > 0.4 ? '#c0392b' : '#1a7a4a' }}>
                {hasHist ? pctStr(proj.media / hist.avgRevenue) : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>só com despesas fixas</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: proj.resultadoTotal >= 0 ? '#1a7a4a' : '#c0392b' }} />
              <div className="metric-label">Resultado projetado no período</div>
              <div className="metric-value" style={{ fontSize: 18, color: proj.resultadoTotal >= 0 ? '#1a7a4a' : '#c0392b' }}>
                {hasHist ? fmt(proj.resultadoTotal) : '—'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>cenário {SCENARIO_LABEL[scenario].toLowerCase()}</div>
            </div>
          </div>

          {/* Projeção estatística dos custos variáveis */}
          {hasHist && (
            <div className="card mb-6">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                Projeção estatística dos custos variáveis
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
                Cada componente é medido como % da receita nos meses realizados ({hist.mesesBase.join(', ')}) e aplicado à receita projetada.
                A <strong>média ponderada</strong> pesa os meses pelo faturamento — é a base usada na projeção.
                {hist.totalVar.n < 6 && (
                  <span style={{ color: '#a35200', fontWeight: 600 }}>
                    {' '}⚠ Amostra de apenas {hist.totalVar.n} meses: trate a faixa (desvio padrão) como parte da resposta, não o valor central isolado.
                  </span>
                )}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Componente</th>
                      <th style={{ textAlign: 'right' }}>Média ponderada</th>
                      <th style={{ textAlign: 'right' }}>Média simples</th>
                      <th style={{ textAlign: 'right' }}>Desvio padrão</th>
                      <th style={{ textAlign: 'right' }}>Mín – Máx</th>
                      <th style={{ textAlign: 'right' }}>R$/mês projetado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {varStatRows.map(v => (
                      <tr key={v.label}>
                        <td style={{ fontSize: 13 }}>
                          {v.label}
                          {v.nota && <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{v.nota}</div>}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700 }}>{pctStr(v.stat.w)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{pctStr(v.stat.mean)}</td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: v.stat.sd > 0.04 ? '#a35200' : 'var(--brave-gray)' }}>
                          ± {ppStr(v.stat.sd)}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>
                          {pctStr(v.stat.min)} – {pctStr(v.stat.max)}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(revenueOf(scenario) * v.stat.w)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--brave-light)', fontWeight: 700 }}>
                      <td style={{ fontSize: 13 }}>Total variável</td>
                      <td style={{ textAlign: 'right', fontSize: 13 }}>{pctStr(hist.totalVar.w)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{pctStr(hist.totalVar.mean)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>± {ppStr(hist.totalVar.sd)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{pctStr(hist.totalVar.min)} – {pctStr(hist.totalVar.max)}</td>
                      <td style={{ textAlign: 'right', fontSize: 13 }}>{fmt(revenueOf(scenario) * hist.totalVar.w)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cenários */}
          {hasHist && (
            <div className="card mb-6">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                Comprometimento e resultado por cenário
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
                Despesa fixa média de {fmt(proj.media)}/mês e custos variáveis de {pctStr(hist.totalVar.w)} da receita.
                A coluna <strong>% da margem</strong> mede o compromisso contra o que sobra depois do custo da mercadoria — é a leitura realista.
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cenário</th>
                      <th style={{ textAlign: 'right' }}>Receita/mês</th>
                      <th style={{ textAlign: 'right' }}>Margem contrib.</th>
                      <th style={{ textAlign: 'right' }}>% da receita</th>
                      <th style={{ textAlign: 'right' }}>% da margem</th>
                      <th style={{ textAlign: 'right' }}>Resultado/mês</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map(s => {
                      const rec = revenueOf(s)
                      const margem = rec * hist.mcPct
                      const imp = rec * hist.imp.w
                      const res = margem - proj.media - imp
                      const pctRec = rec > 0 ? proj.media / rec : 0
                      const pctMc = margem > 0 ? proj.media / margem : 0
                      return (
                        <tr key={s} style={{ background: s === scenario ? 'rgba(234,202,45,0.10)' : undefined }}>
                          <td style={{ fontSize: 13, fontWeight: s === scenario ? 700 : 400 }}>
                            {SCENARIO_LABEL[s]}
                            {s === scenario && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--brave-gray)' }}>◀ em uso</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(rec)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12 }}>{fmt(margem)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: pctRec > 0.4 ? '#c0392b' : 'var(--brave-dark)' }}>{pctStr(pctRec)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: pctMc >= 1 ? '#c0392b' : pctMc > 0.8 ? '#d59f07' : '#1a7a4a' }}>{pctStr(pctMc)}</td>
                          <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: res >= 0 ? '#1a7a4a' : '#c0392b' }}>{fmt(res)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Gráfico: estrutura de custo vs receita */}
          <div className="card mb-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14 }}>Estrutura de custo projetada vs receita</div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  Onde a pilha de custos passa a linha da receita, o mês fecha no vermelho
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
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf2f4" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="CMV" stackId="c" fill="#8d99ae" />
                <Bar dataKey="Desp. Variável" stackId="c" fill="#b8c0cc" />
                <Bar dataKey="Impostos" stackId="c" fill="#d59f07" />
                <Bar dataKey="Despesa Fixa" stackId="c" fill="#2b2d42" radius={[3, 3, 0, 0]} />
                {hasHist && <Line type="monotone" dataKey="Receita" stroke="#1a7a4a" strokeWidth={2.5} dot={{ r: 4 }} />}
              </ComposedChart>
            </ResponsiveContainer>

            {/* DRE projetada mês a mês */}
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th style={{ textAlign: 'right' }}>Receita</th>
                    <th style={{ textAlign: 'right' }}>(−) CMV</th>
                    <th style={{ textAlign: 'right' }}>(−) Desp. Var.</th>
                    <th style={{ textAlign: 'right' }}>= Margem</th>
                    <th style={{ textAlign: 'right' }}>(−) Fixo</th>
                    <th style={{ textAlign: 'right' }}>(−) Impostos</th>
                    <th style={{ textAlign: 'right' }}>= Resultado</th>
                    <th style={{ textAlign: 'right' }}>Faixa (±1σ)</th>
                    <th style={{ textAlign: 'right' }}>Fat. mínimo</th>
                  </tr>
                </thead>
                <tbody>
                  {proj.rows.map(r => (
                    <tr key={r.month} style={{ background: hasHist && r.resultado < 0 ? '#fdf0ee' : undefined }}>
                      <td style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                        {r.label}/{year}
                        {r.passado && <div style={{ fontSize: 10, color: 'var(--brave-gray)', fontWeight: 400 }}>realizado</div>}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{hasHist ? fmt0(r.receita) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{hasHist ? fmt0(r.cmv) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{hasHist ? fmt0(r.dv) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{hasHist ? fmt0(r.margem) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{fmt0(r.fixo)}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>{hasHist ? fmt0(r.imp) : '—'}</td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: r.resultado >= 0 ? '#1a7a4a' : '#c0392b' }}>
                        {hasHist ? fmt0(r.resultado) : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--brave-gray)', whiteSpace: 'nowrap' }}>
                        {hasHist ? `${fmt0(r.resMin)} a ${fmt0(r.resMax)}` : '—'}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--brave-gray)' }}>
                        {hasHist ? fmt0(r.faturamentoMinimo) : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--brave-light)', fontWeight: 700 }}>
                    <td style={{ fontFamily: 'var(--font-sub)', fontSize: 13 }}>TOTAL</td>
                    <td colSpan={4}></td>
                    <td style={{ textAlign: 'right', fontSize: 13 }}>{fmt0(proj.total)}</td>
                    <td></td>
                    <td style={{ textAlign: 'right', fontSize: 13, color: proj.resultadoTotal >= 0 ? '#1a7a4a' : '#c0392b' }}>
                      {hasHist ? fmt0(proj.resultadoTotal) : '—'}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 10, color: 'var(--brave-gray)', marginTop: 8, lineHeight: 1.5 }}>
              <strong>Faixa (±1σ):</strong> resultado se os custos variáveis ficarem um desvio padrão acima ou abaixo da média histórica.
              {' '}<strong>Fat. mínimo:</strong> receita necessária no mês para cobrir despesa fixa + impostos (ponto de equilíbrio).
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
