'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import {
  ComposedChart, BarChart, Line, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, ReferenceArea,
} from 'recharts'
import {
  projetarFluxo, agruparFluxo, resumirFluxo, caixaInicial, horizonteAteFimDoMes,
  CATEGORIAS_SAIDA, LIMIAR_MUDANCA_PATAMAR,
  type EntradaFluxo, type MetaFluxo, type Parametros, type CategoriaSaida, type PeriodoFluxo,
} from '@/lib/fluxo-caixa'

// ─── Fluxo de caixa ──────────────────────────────────────────────────────────
// Parte do saldo real dos bancos e projeta dia a dia: o dinheiro das vendas do
// Mercado Livre na data em que o Mercado Pago libera, as compras pelo histórico
// sem meses atípicos e as despesas constantes no dia do mês em que costumam
// vencer. Toda a conta está em src/lib/fluxo-caixa.ts; aqui só se apresenta.

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmt0 = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)
const fmtEixo = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 1000 ? `${Math.round(a / 1000)} mil` : `${Math.round(a)}`
  return v < 0 ? `−${s}` : s
}
const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
const ddmmaa = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (ano: number, mes: number) => `${MESES[mes - 1]}/${String(ano).slice(2)}`

// Paleta validada (scripts/validate_palette.js, superfície branca): a linha em
// destaque e as entradas no azul da marca levado à faixa de luminosidade; saídas
// em laranja; o cinza só como contexto. Vermelho é status — só a zona negativa.
const ACCENT = '#3d4fb0'
const CONTEXT = '#7d889b'
const SAIDA = '#eb6834'
const CRITICAL = '#d03b3b'
const GRID = '#edf2f4'
const AXIS = '#c3cbd7'
const INK = '#2b2d42'
const INK2 = '#505168'

type Visao = 'semana' | 'mes'

interface ParametrosSalvos {
  ajusteVendas: number
  saldoMercadoPago: number
  aplicacao: number | null          // null = usar a estimativa pelos lançamentos
  mensal: Partial<Record<CategoriaSaida, number>>
}

interface Resposta {
  entrada: EntradaFluxo
  meta: MetaFluxo
  parametros: ParametrosSalvos
  avisos: { naoClassificados: { quantidade: number; valor: number }; recebiveisIndisponivel: boolean }
}

export default function FluxoCaixaPage() {
  const [dados, setDados] = useState<Resposta | null>(null)
  const [param, setParam] = useState<ParametrosSalvos>({ ajusteVendas: 0, saldoMercadoPago: 0, aplicacao: null, mensal: {} })
  const [visao, setVisao] = useState<Visao>('semana')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [uploading, setUploading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [toast, setToast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const parametrosDoServidor = useRef(true)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 6000) }

  const carregar = () => {
    setLoading(true)
    fetch('/api/fluxo-caixa')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: Resposta) => {
        parametrosDoServidor.current = true
        setDados(j)
        setParam(j.parametros)
        setErro('')
      })
      .catch(() => setErro('Não foi possível montar o fluxo de caixa agora. Recarregue a página em instantes.'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { carregar() }, [])

  // Premissas são do negócio, não do navegador: vão para o banco, para todo mundo
  // que abrir a aba ver o mesmo fluxo. Grava 0,7 s depois da última alteração.
  useEffect(() => {
    if (parametrosDoServidor.current) { parametrosDoServidor.current = false; return }
    const t = setTimeout(() => {
      fetch('/api/fluxo-caixa', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(param),
      }).catch(() => showToast('Não foi possível salvar as premissas'))
    }, 700)
    return () => clearTimeout(t)
  }, [param])

  const upload = async (file: File) => {
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch('/api/fluxo-caixa/recebiveis', { method: 'POST', body: fd })
      const j = await res.json()
      if (res.ok) {
        showToast(`✓ ${j.importadas} vendas de ${ddmmaa(j.de)} a ${ddmmaa(j.ate)} · ${fmt0(j.aLiberar)} ainda a liberar`)
        carregar()
      } else {
        showToast(`Erro: ${j.error}`)
      }
    } catch {
      showToast('Erro ao enviar o relatório')
    }
    setUploading(false)
  }

  const aplicacaoEstimada = dados?.meta.aplicacao.estimado ?? 0
  const aplicacao = param.aplicacao ?? aplicacaoEstimada

  const calc = useMemo(() => {
    if (!dados) return null
    const e = dados.entrada
    const p: Parametros = {
      ajusteVendas: param.ajusteVendas, saldoMercadoPago: param.saldoMercadoPago,
      aplicacao: param.aplicacao ?? dados.meta.aplicacao.estimado, mensal: param.mensal,
    }
    // A projeção roda sempre em 6 meses: os indicadores não podem mudar só porque
    // a pessoa trocou a visão para semanas. A visão só escolhe o recorte mostrado.
    const horizonte = horizonteAteFimDoMes(e.inicio, 6)
    const todos = projetarFluxo(e, p, horizonte)
    const abertura = caixaInicial(e, p)
    const resumo = resumirFluxo(todos, abertura)
    const dias = visao === 'semana' ? todos.slice(0, 91) : todos
    const periodos = agruparFluxo(dias, visao, abertura)

    // Resultado de um mês "cheio" no ritmo atual — o número que diz se o negócio
    // gera ou consome caixa, sem o efeito das vendas que ainda estão por liberar.
    const fator = 1 + (p.ajusteVendas || 0)
    const mlMes = e.ml.modo === 'recebiveis' ? e.ml.vendaDia * (365 / 12) * fator : e.ml.mensal * fator
    const entradasMes = mlMes + e.outrosCanais.mensal * fator
    const saidasMes = e.saidas.reduce((a, s) => {
      const o = p.mensal[s.categoria]
      return a + (typeof o === 'number' ? o : s.mensal)
    }, 0)

    const serieSaldo = dias.map(d => ({ data: d.data, bancos: d.caixa, comAplicacao: d.caixa + p.aplicacao }))
    const serieFluxo = periodos.map(pr => ({ rotulo: pr.rotulo, entradas: pr.entradas, saidas: -pr.totalSaidas, liquido: pr.entradas - pr.totalSaidas }))
    return { todos, dias, periodos, resumo, abertura, entradasMes, saidasMes, serieSaldo, serieFluxo, fim: todos.length ? todos[todos.length - 1].data : e.inicio, aplicacao: p.aplicacao }
  }, [dados, visao, param])

  const meta = dados?.meta
  const rel = meta?.mercadoLivre.relatorio ?? null
  const contasTexto = meta ? meta.contas.map(c => `${c.nome} ${fmt0(c.saldo)}`).join(' · ') : ''

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Fluxo de Caixa</h1>
          <p className="page-subtitle">
            Saldo real dos bancos + o dinheiro do Mercado Livre na data em que é liberado − compras e despesas no dia em que costumam vencer
          </p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
          <button className="btn btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? 'Importando…' : '⬆ Vendas a receber (Mercado Pago)'}
          </button>
        </div>
      </div>

      {loading && !dados && <div className="card" style={{ textAlign: 'center', padding: 60, color: 'var(--brave-gray)' }}>Montando o fluxo…</div>}
      {erro && !dados && <div className="card" style={{ color: CRITICAL }}>{erro}</div>}

      {dados && meta && calc && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>

          {/* ── De onde o fluxo parte ── */}
          <div className="card" style={{ padding: '12px 18px', fontSize: 12, color: INK2, lineHeight: 1.7 }}>
            <strong style={{ color: INK }}>Ponto de partida: {ddmmaa(meta.inicio)}</strong>, data do último extrato importado — {contasTexto}.
            {' '}
            {rel ? (
              <>Mercado Livre pelo relatório do Mercado Pago com vendas de {ddmmaa(rel.de)} a {ddmmaa(rel.ate)}: <strong style={{ color: INK }}>{fmt0(rel.aLiberarAposInicio)}</strong> ainda a liberar, prazo mediano de {rel.prazoMediano} dias entre venda e dinheiro.</>
            ) : (
              <>Mercado Livre pela média dos depósitos — importe o relatório “Vendas a receber” do Mercado Pago para usar a data real de liberação de cada venda.</>
            )}
          </div>

          {dados.avisos.recebiveisIndisponivel && (
            <div className="card" style={{ padding: '12px 18px', fontSize: 12, borderLeft: `4px solid ${CRITICAL}` }}>
              ▼ O banco de dados ainda não tem a tabela de recebíveis (a atualização do esquema não rodou na publicação). Até isso ser resolvido, o Mercado Livre entra pela média dos depósitos.
            </div>
          )}
          {dados.avisos.naoClassificados.quantidade > 0 && (
            <div className="card" style={{ padding: '12px 18px', fontSize: 12, borderLeft: '4px solid var(--brave-yellow)' }}>
              {dados.avisos.naoClassificados.quantidade} lançamentos sem classificação nos meses-base ({fmt0(dados.avisos.naoClassificados.valor)}) ficam fora das premissas. Classifique em Lançamentos para entrarem no fluxo.
            </div>
          )}

          {/* ── Indicadores ── */}
          <div className="metrics-grid">
            <Indicador rotulo={`Caixa em ${ddmm(meta.inicio)}`} valor={fmt0(calc.abertura)}
              dica={param.saldoMercadoPago > 0 ? `bancos + ${fmt0(param.saldoMercadoPago)} no Mercado Pago` : 'nos bancos'} />
            <Indicador rotulo="Fica negativo em"
              valor={calc.resumo.primeiroNegativo ? ddmmaa(calc.resumo.primeiroNegativo) : 'não fica'}
              cor={calc.resumo.primeiroNegativo ? CRITICAL : undefined}
              icone={calc.resumo.primeiroNegativo ? '▼' : undefined}
              dica={calc.resumo.primeiroNegativo ? 'sem contar a aplicação' : `até ${ddmmaa(calc.fim)}`} />
            <Indicador rotulo={`Pior momento até ${ddmm(calc.fim)}`} valor={fmt0(calc.resumo.minimo.valor)}
              cor={calc.resumo.minimo.valor < 0 ? CRITICAL : undefined}
              dica={`em ${ddmmaa(calc.resumo.minimo.data)} · nos bancos`} />
            <Indicador rotulo="Com a aplicação, no pior momento" valor={fmt0(calc.resumo.minimo.valor + calc.aplicacao)}
              cor={calc.resumo.minimo.valor + calc.aplicacao < 0 ? CRITICAL : undefined}
              icone={calc.resumo.minimo.valor + calc.aplicacao < 0 ? '▼' : undefined}
              dica={`aplicação de ${fmt0(calc.aplicacao)}${param.aplicacao === null ? ' (estimada)' : ''}`} />
            <Indicador rotulo="Resultado de caixa por mês" valor={fmt0(calc.entradasMes - calc.saidasMes)}
              cor={calc.entradasMes - calc.saidasMes < 0 ? CRITICAL : undefined}
              dica={`entram ${fmt0(calc.entradasMes)} · saem ${fmt0(calc.saidasMes)}`} />
          </div>

          {/* ── Premissas que mudam o fluxo inteiro (uma linha, acima dos gráficos) ── */}
          <div className="card" style={{ padding: '12px 18px', display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 4 }}>Visão</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {([['semana', '13 semanas'], ['mes', '6 meses']] as [Visao, string][]).map(([k, l]) => (
                  <button key={k} className="btn btn-sm" onClick={() => setVisao(k)} style={{
                    background: visao === k ? 'var(--brave-dark)' : 'var(--brave-light)',
                    color: visao === k ? '#fff' : 'var(--brave-dark)', border: 'none',
                  }}>{l}</button>
                ))}
              </div>
            </div>
            <Campo rotulo="Vendas vs. ritmo atual" sufixo="%" largura={90}
              valor={Math.round(param.ajusteVendas * 100)}
              onChange={v => setParam(p => ({ ...p, ajusteVendas: (v ?? 0) / 100 }))}
              dica="não mexe nas compras" />
            <Campo rotulo="Parado no Mercado Pago" prefixo="R$" largura={120}
              valor={param.saldoMercadoPago || 0}
              onChange={v => setParam(p => ({ ...p, saldoMercadoPago: Math.max(0, v ?? 0) }))}
              dica="liberado e não sacado" />
            <Campo rotulo="Aplicação financeira" prefixo="R$" largura={130}
              valor={Math.round(aplicacao)}
              onChange={v => setParam(p => ({ ...p, aplicacao: v === null ? null : Math.max(0, v) }))}
              dica={param.aplicacao === null ? 'estimada pelos lançamentos' : 'informada'}
              acao={param.aplicacao !== null ? { rotulo: 'usar estimativa', onClick: () => setParam(p => ({ ...p, aplicacao: null })) } : undefined} />
          </div>

          {/* ── Saldo projetado ── */}
          <div className="card">
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14 }}>Caixa projetado, dia a dia</div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', margin: '2px 0 10px' }}>
              <Traco cor={ACCENT} /> nos bancos{param.saldoMercadoPago > 0 ? ' (+ Mercado Pago)' : ''}
              <span style={{ marginLeft: 14 }}><Traco cor={CONTEXT} /> somando a aplicação de {fmt0(calc.aplicacao)}</span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={calc.serieSaldo} margin={{ top: 10, right: 112, left: 8, bottom: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                {calc.serieSaldo.some(s => s.bancos < 0) && (
                  <ReferenceArea y1={Math.min(0, ...calc.serieSaldo.map(s => s.bancos))} y2={0}
                    fill={CRITICAL} fillOpacity={0.05} stroke="none" ifOverflow="extendDomain"
                    label={{ value: '▼ abaixo de zero', position: 'insideBottomLeft', fontSize: 10, fill: INK2 }} />
                )}
                <XAxis dataKey="data" tickFormatter={ddmm} tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false}
                  interval={visao === 'semana' ? 13 : 30} minTickGap={8} />
                <YAxis tickFormatter={fmtEixo} tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} width={56} />
                <ReferenceLine y={0} stroke={CRITICAL} strokeWidth={1} />
                <Tooltip content={<DicaSaldo />} cursor={{ stroke: AXIS, strokeWidth: 1 }} />
                <Line type="monotone" dataKey="comAplicacao" stroke={CONTEXT} strokeWidth={2} dot={false} isAnimationActive={false}
                  label={<RotuloFinal total={calc.serieSaldo.length} texto="+ aplicação" />} />
                <Line type="monotone" dataKey="bancos" stroke={ACCENT} strokeWidth={2} dot={false} isAnimationActive={false}
                  label={<RotuloFinal total={calc.serieSaldo.length} texto="bancos" />} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* ── Entradas e saídas por período ── */}
          <div className="card">
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14 }}>
              Entradas e saídas por {visao === 'semana' ? 'semana' : 'mês'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', margin: '2px 0 10px' }}>
              <Quadrado cor={ACCENT} /> entradas <span style={{ marginLeft: 14 }}><Quadrado cor={SAIDA} /> saídas</span>
              <span style={{ marginLeft: 14 }}>— passe o mouse para ver o resultado do período</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={calc.serieFluxo} margin={{ top: 4, right: 12, left: 8, bottom: 4 }} barGap={2} stackOffset="sign">
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false} interval={0}
                  angle={visao === 'semana' ? -30 : 0} textAnchor={visao === 'semana' ? 'end' : 'middle'} height={visao === 'semana' ? 48 : 24} />
                <YAxis tickFormatter={fmtEixo} tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} width={56} />
                <ReferenceLine y={0} stroke={AXIS} />
                <Tooltip content={<DicaFluxo />} cursor={{ fill: 'rgba(43,45,66,0.05)' }} />
                {/* Ponta arredondada só na extremidade do dado; a base, no zero, fica reta. */}
                <Bar dataKey="entradas" stackId="f" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false} />
                <Bar dataKey="saidas" stackId="f" fill={SAIDA} radius={[0, 0, 4, 4]} maxBarSize={34} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── Demonstrativo ── */}
          <Demonstrativo periodos={calc.periodos} aplicacao={calc.aplicacao} temRelatorio={!!rel} />

          {/* ── Premissas ── */}
          <Premissas meta={meta} entrada={dados.entrada} param={param}
            onMensal={(cat, v) => setParam(p => {
              const mensal = { ...p.mensal }
              if (v === null) delete mensal[cat]; else mensal[cat] = Math.max(0, v)
              return { ...p, mensal }
            })} />
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}

// ─── Componentes ─────────────────────────────────────────────────────────────

function Indicador({ rotulo, valor, dica, cor, icone }: { rotulo: string; valor: string; dica?: string; cor?: string; icone?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{rotulo}</div>
      <div className="metric-value" style={{ fontSize: 19, color: cor }}>{icone ? `${icone} ` : ''}{valor}</div>
      {dica && <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{dica}</div>}
    </div>
  )
}

function Campo({ rotulo, valor, onChange, prefixo, sufixo, largura, dica, acao }: {
  rotulo: string; valor: number; onChange: (v: number | null) => void
  prefixo?: string; sufixo?: string; largura: number; dica?: string
  acao?: { rotulo: string; onClick: () => void }
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 4 }}>{rotulo}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {prefixo && <span style={{ fontSize: 12, color: INK2 }}>{prefixo}</span>}
        <NumeroBR valor={valor} onChange={onChange} largura={largura} />
        {sufixo && <span style={{ fontSize: 12, color: INK2 }}>{sufixo}</span>}
      </div>
      <div style={{ fontSize: 10, color: 'var(--brave-gray)', marginTop: 3 }}>
        {dica}
        {acao && <> · <button onClick={acao.onClick} style={{ background: 'none', border: 'none', padding: 0, color: ACCENT, fontSize: 10, textDecoration: 'underline' }}>{acao.rotulo}</button></>}
      </div>
    </div>
  )
}

/** "1.500", "1500" e "1.500,50" valem o mesmo. Vírgula é decimal; ponto seguido de 3 dígitos é milhar. */
function lerNumeroBR(t: string): number | null {
  const s = t.replace(/\s/g, '').replace(/^r\$/i, '')
  if (s === '' || s === '-' || s === ',') return null
  const n = s.indexOf(',') >= 0 ? s.replace(/\./g, '').replace(',', '.')
    : /\.\d{3}$/.test(s) ? s.replace(/\./g, '') : s
  const v = Number(n)
  return isFinite(v) ? v : null
}

/**
 * Campo numérico em texto. `type="number"` controlado apaga o "−" no meio da
 * digitação (o navegador entrega '' até o número ficar válido) e não aceita
 * vírgula — e aqui se digita "-20" e "1.500,00" o tempo todo.
 */
function NumeroBR({ valor, onChange, largura, placeholder, negrito }: {
  valor: number | null; onChange: (v: number | null) => void
  largura: number; placeholder?: string; negrito?: boolean
}) {
  const formatar = (v: number | null) => (v === null || !isFinite(v) ? '' : String(Math.round(v * 100) / 100).replace('.', ','))
  const [texto, setTexto] = useState(formatar(valor))
  const editando = useRef(false)
  useEffect(() => { if (!editando.current) setTexto(formatar(valor)) }, [valor])
  return (
    <input type="text" inputMode="decimal" className="form-input" placeholder={placeholder}
      style={{ width: largura, padding: '5px 8px', fontSize: 12, textAlign: 'right', fontWeight: negrito ? 700 : 400 }}
      value={texto}
      onFocus={() => { editando.current = true }}
      onBlur={() => { editando.current = false; setTexto(formatar(valor)) }}
      onChange={e => {
        setTexto(e.target.value)
        if (e.target.value.trim() === '') { onChange(null); return }
        const v = lerNumeroBR(e.target.value)
        if (v !== null) onChange(v)
      }} />
  )
}

const Traco = ({ cor }: { cor: string }) => <span style={{ display: 'inline-block', width: 14, height: 2, background: cor, verticalAlign: 'middle', marginRight: 4 }} />
const Quadrado = ({ cor }: { cor: string }) => <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: cor, verticalAlign: 'middle', marginRight: 4 }} />

/** Rótulo direto só no fim da linha — nunca um número em cada ponto. */
function RotuloFinal(props: any) {
  const { x, y, index, value, total, texto } = props
  if (index !== total - 1 || x == null || y == null) return null
  return (
    <text x={x + 6} y={y} dy={4} fontSize={10} fill={INK2}>
      <tspan fontWeight={700} fill={INK}>{fmtEixo(value)}</tspan> {texto}
    </text>
  )
}

function DicaSaldo({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const bancos = payload.find((p: any) => p.dataKey === 'bancos')?.value ?? 0
  const com = payload.find((p: any) => p.dataKey === 'comAplicacao')?.value ?? 0
  return (
    <div style={{ background: '#fff', border: `1px solid ${AXIS}`, borderRadius: 6, padding: '8px 10px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{ddmmaa(String(label))}</div>
      <div><Traco cor={ACCENT} />nos bancos: <strong style={{ color: bancos < 0 ? CRITICAL : INK }}>{fmtBRL(bancos)}</strong></div>
      <div><Traco cor={CONTEXT} />com a aplicação: <strong>{fmtBRL(com)}</strong></div>
    </div>
  )
}

function DicaFluxo({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background: '#fff', border: `1px solid ${AXIS}`, borderRadius: 6, padding: '8px 10px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      <div><Quadrado cor={ACCENT} />entradas: <strong>{fmtBRL(d.entradas)}</strong></div>
      <div><Quadrado cor={SAIDA} />saídas: <strong>{fmtBRL(-d.saidas)}</strong></div>
      <div style={{ marginTop: 4, borderTop: `1px solid ${GRID}`, paddingTop: 4 }}>
        resultado: <strong style={{ color: d.liquido < 0 ? CRITICAL : INK }}>{fmtBRL(d.liquido)}</strong>
      </div>
    </div>
  )
}

/** A tabela é a versão completa dos gráficos: todo valor pode ser lido sem o mouse. */
function Demonstrativo({ periodos, aplicacao, temRelatorio }: { periodos: PeriodoFluxo[]; aplicacao: number; temRelatorio: boolean }) {
  type Linha = { rotulo: string; valor: (p: PeriodoFluxo) => number; tipo: 'saldo' | 'entrada' | 'saida' | 'total' | 'resultado'; nota?: string }
  const linhas: Linha[] = [
    { rotulo: 'Caixa no início', valor: p => p.caixaInicial, tipo: 'saldo' },
    ...(temRelatorio ? [{ rotulo: 'Mercado Livre — vendas já feitas', valor: (p: PeriodoFluxo) => p.mlRecebiveis, tipo: 'entrada' as const, nota: 'data real de liberação' }] : []),
    { rotulo: temRelatorio ? 'Mercado Livre — vendas futuras' : 'Mercado Livre', valor: p => p.mlProjetado, tipo: 'entrada', nota: 'ritmo recente' },
    { rotulo: 'Outros canais', valor: p => p.outrosCanais, tipo: 'entrada' },
    { rotulo: 'Entradas', valor: p => p.entradas, tipo: 'total' },
    ...CATEGORIAS_SAIDA.map(c => ({ rotulo: c.rotulo, valor: (p: PeriodoFluxo) => -p.saidas[c.chave], tipo: 'saida' as const })),
    { rotulo: 'Saídas', valor: p => -p.totalSaidas, tipo: 'total' },
    { rotulo: 'Resultado do período', valor: p => p.entradas - p.totalSaidas, tipo: 'resultado' },
    { rotulo: 'Caixa no fim', valor: p => p.caixaFinal, tipo: 'saldo' },
    { rotulo: 'Menor caixa no período', valor: p => p.caixaMinimo, tipo: 'saldo' },
    { rotulo: 'Caixa no fim + aplicação', valor: p => p.caixaFinal + aplicacao, tipo: 'saldo' },
  ]
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brave-light)' }}>
        <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Demonstrativo do fluxo de caixa</span>
        <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>Saídas com sinal negativo. Período parcial marcado com *.</div>
      </div>
      <div className="table-wrap">
        <table style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 210, position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}></th>
              {periodos.map(p => <th key={p.chave} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{p.rotulo}{p.parcial ? '*' : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => {
              const destaque = l.tipo === 'total' || l.tipo === 'resultado' || l.rotulo === 'Caixa no fim'
              return (
                <tr key={l.rotulo} style={{ background: l.tipo === 'resultado' ? '#f7f8fb' : undefined }}>
                  <td style={{ position: 'sticky', left: 0, background: l.tipo === 'resultado' ? '#f7f8fb' : '#fff', zIndex: 1, fontWeight: destaque ? 700 : 400, paddingLeft: l.tipo === 'entrada' || l.tipo === 'saida' ? 22 : undefined, color: l.tipo === 'saldo' && !destaque ? INK2 : INK }}>
                    {l.rotulo}
                    {l.nota && <span style={{ fontSize: 10, color: 'var(--brave-gray)', fontWeight: 400 }}> · {l.nota}</span>}
                  </td>
                  {periodos.map(p => {
                    const v = l.valor(p)
                    const negativo = v < -0.5 && (l.tipo === 'saldo' || l.tipo === 'resultado')
                    return (
                      <td key={p.chave} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: destaque ? 700 : 400, color: negativo ? CRITICAL : l.tipo === 'saida' ? INK2 : INK }}>
                        {Math.abs(v) < 0.5 ? '—' : fmt0(v)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** De onde sai cada número do fluxo — e o lugar de corrigir o que a média não sabe. */
function Premissas({ meta, entrada, param, onMensal }: {
  meta: MetaFluxo; entrada: EntradaFluxo; param: ParametrosSalvos
  onMensal: (c: CategoriaSaida, v: number | null) => void
}) {
  const meses = meta.mesesBase
  const rel = meta.mercadoLivre.relatorio
  const fator = 1 + (param.ajusteVendas || 0)
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brave-light)' }}>
        <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Premissas</span>
        <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2, lineHeight: 1.5 }}>
          Base: meses em que os extratos cobrem o mês inteiro ({meses.map(m => rotuloMes(m.ano, m.mes)).join(', ') || 'nenhum'}).
          Compras: média sem os meses atípicos (menos da metade ou mais do dobro da mediana). Despesas: média dos 3 últimos meses, mantida constante.
          Digite um valor na coluna “Usar” para substituir a média.
        </div>
      </div>
      <div className="table-wrap">
        <table style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th>Saída</th>
              {meses.map(m => <th key={`${m.ano}-${m.mes}`} style={{ textAlign: 'right' }}>{rotuloMes(m.ano, m.mes)}</th>)}
              <th style={{ textAlign: 'right' }}>Média</th>
              <th style={{ textAlign: 'right' }}>Usar</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {meta.categorias.map(c => {
              const excl = new Set(c.normalizacao.excluidos.map(x => `${x.ano}-${x.mes}`))
              const usados = new Set(c.normalizacao.usados.map(x => `${x.ano}-${x.mes}`))
              const sobrescrito = param.mensal[c.categoria]
              const mudouPatamar = c.variacaoUltimoMes !== null && Math.abs(c.variacaoUltimoMes) >= LIMIAR_MUDANCA_PATAMAR
              const obs = c.normalizacao.excluidos.length
                ? `fora: ${c.normalizacao.excluidos.map(x => `${rotuloMes(x.ano, x.mes)} (${x.motivo})`).join(', ')}`
                : mudouPatamar
                  ? `último mês ${c.variacaoUltimoMes! > 0 ? '+' : ''}${Math.round(c.variacaoUltimoMes! * 100)}% sobre a média — mudou de patamar?`
                  : ''
              return (
                <tr key={c.categoria}>
                  <td style={{ fontWeight: 600 }}>{c.rotulo}</td>
                  {c.serie.map(p => {
                    const k = `${p.ano}-${p.mes}`
                    return (
                      <td key={k} style={{
                        textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                        color: excl.has(k) ? CRITICAL : usados.has(k) ? INK : 'var(--brave-gray)',
                        textDecoration: excl.has(k) ? 'line-through' : undefined,
                      }}>{fmt0(p.valor)}</td>
                    )
                  })}
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, whiteSpace: 'nowrap', color: typeof sobrescrito === 'number' ? 'var(--brave-gray)' : INK }}>
                    {fmt0(c.normalizacao.valorMensal)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <NumeroBR valor={typeof sobrescrito === 'number' ? sobrescrito : null} placeholder="média"
                      largura={100} negrito={typeof sobrescrito === 'number'}
                      onChange={v => onMensal(c.categoria, v)} />
                  </td>
                  <td style={{ fontSize: 11, color: mudouPatamar && !excl.size ? '#9a6400' : 'var(--brave-gray)', minWidth: 200 }}>{obs}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '12px 20px', borderTop: '1px solid var(--brave-light)', fontSize: 12, lineHeight: 1.7, color: INK2 }}>
        <div><strong style={{ color: INK }}>Mercado Livre:</strong>{' '}
          {rel
            ? <>venda líquida de {fmt0(rel.vendaDiaria * fator)}/dia ({fmt0(rel.vendaDiaria * fator * 365 / 12)}/mês), medida de {ddmmaa(rel.janelaDe)} a {ddmmaa(rel.janelaAte)} já sem tarifas, frete e parcelamento. O dinheiro de cada venda futura entra pelos prazos observados: mediana de {rel.prazoMediano} dias, até {rel.prazoMaximo}.</>
            : <>média dos depósitos ({fmt0(meta.mercadoLivre.normalizacaoDepositos.valorMensal)}/mês nos 3 últimos meses).</>}
          {entrada.ml.modo === 'recebiveis' && <> Depósitos nos meses-base, para comparar: {meta.mercadoLivre.serieDepositos.map(p => `${rotuloMes(p.ano, p.mes)} ${fmt0(p.valor)}`).join(' · ')}.</>}
        </div>
        <div><strong style={{ color: INK }}>Outros canais</strong> (Nuvemshop, Shopee, TikTok, Amazon, B2B): {fmt0(meta.outrosCanais.normalizacao.valorMensal * fator)}/mês, média dos 3 últimos meses.</div>
        <div><strong style={{ color: INK }}>Aplicação financeira:</strong> estimada em {fmt0(meta.aplicacao.estimado)} pelos lançamentos — aplicado {fmt0(meta.aplicacao.aplicado)}, resgatado {fmt0(meta.aplicacao.resgatado)}{meta.aplicacao.saldoAnterior > 0 ? `, e pelo menos ${fmt0(meta.aplicacao.saldoAnterior)} já aplicados antes do histórico` : ''}. É um piso: confirme no extrato da aplicação e digite o valor real acima.</div>
        <div><strong style={{ color: INK }}>Fica de fora:</strong> transferência entre contas, aplicações e resgates, entrada de empréstimo e parcela de empréstimo que ainda não apareceu no extrato (empréstimo em carência). Despesa paga no cartão entra pelo mês da fatura.</div>
      </div>
    </div>
  )
}
