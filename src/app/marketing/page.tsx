'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { SEVERIDADE_META, type Severidade } from '@/lib/radar'
import {
  BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

// ── Radar de Preços — Mercado Livre ─────────────────────────────────────────
// Compara o preço de cada produto do catálogo com o dos concorrentes no Mercado
// Livre, exclui os anúncios da própria loja e destaca quem corta o preço em 20%
// ou mais. A varredura roda sozinha toda segunda-feira e pode ser disparada aqui.

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtInt = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v))
const pct = (v: number) => `${v >= 0 ? '' : ''}${(v * 100).toFixed(1)}%`
const dataHora = (s: string | null) => s ? new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const GRID = '#edf2f4'
const AXIS = '#c3cbd7'
const INK = '#2b2d42'
const INK2 = '#505168'
const SURFACE = '#ffffff'
const SERIES = '#2b3272'
const MUTED = '#b4bccb'

type Filtro = 'todos' | Severidade
type Aba = 'produtos' | 'concorrentes'

interface Oferta {
  id: number; sku: string | null; produto: string; nossoPreco: number
  mlItemId: string; titulo: string; preco: number; vendedor: string
  permalink: string; freteGratis: boolean; vendidos: number
  semelhanca: number; divergencia: number; severidade: Severidade
}

export default function RadarPrecosPage() {
  const [scan, setScan] = useState<any>(null)
  const [ofertas, setOfertas] = useState<Oferta[]>([])
  const [historico, setHistorico] = useState<any[]>([])
  const [indisponivel, setIndisponivel] = useState(false)
  const [carregando, setCarregando] = useState(true)
  const [rodando, setRodando] = useState(false)
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'erro' | 'info'; texto: string } | null>(null)
  const [toast, setToast] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [aba, setAba] = useState<Aba>('produtos')
  const [expandido, setExpandido] = useState<string | null>(null)
  const cancelar = useRef(false)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 5000) }

  const carregar = () =>
    fetch('/api/radar').then(r => r.json()).then(j => {
      setScan(j.scan ?? null)
      setOfertas(Array.isArray(j.ofertas) ? j.ofertas : [])
      setHistorico(Array.isArray(j.historico) ? j.historico : [])
      setIndisponivel(Boolean(j.indisponivel))
    }).catch(() => {}).finally(() => setCarregando(false))

  useEffect(() => { carregar() }, [])

  // A varredura é feita em lotes: o servidor consulta enquanto tem tempo e
  // devolve onde parou; aqui continuamos até concluir.
  const varrer = async () => {
    setRodando(true); setAviso(null); cancelar.current = false
    let scanId: number | undefined, offset = 0, concluido = false, voltas = 0
    try {
      while (!concluido && !cancelar.current && voltas < 30) {
        const res = await fetch('/api/radar/scan', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scanId, offset, origem: 'manual' }),
        })
        const j = await res.json()
        if (!res.ok) {
          setAviso({ tipo: 'erro', texto: j.mensagem || 'Não foi possível executar a varredura.' })
          break
        }
        scanId = j.scanId; offset = j.offset; concluido = j.concluido
        setProgresso({ feitos: j.offset, total: j.total })
        voltas++
      }
      if (concluido) showToast('✓ Varredura concluída')
      else if (cancelar.current) showToast('Varredura interrompida')
    } catch {
      setAviso({ tipo: 'erro', texto: 'Falha de rede durante a varredura.' })
    }
    setRodando(false); setProgresso(null)
    carregar()
  }

  // ── Agregações ────────────────────────────────────────────────────────────
  const porProduto = useMemo(() => {
    const m = new Map<string, { sku: string | null; produto: string; nossoPreco: number; ofertas: Oferta[] }>()
    ofertas.forEach(o => {
      const k = o.sku || o.produto
      const at = m.get(k) ?? { sku: o.sku, produto: o.produto, nossoPreco: o.nossoPreco, ofertas: [] }
      at.ofertas.push(o); m.set(k, at)
    })
    return Array.from(m.values()).map(p => {
      const precos = p.ofertas.map(o => o.preco).sort((a, b) => a - b)
      const criticos = p.ofertas.filter(o => o.severidade === 'critico').length
      const maiorCorte = Math.max(...p.ofertas.map(o => o.divergencia))
      return {
        ...p, menorPreco: precos[0], criticos, maiorCorte,
        posicao: precos.filter(x => x < p.nossoPreco).length + 1,
        total: p.ofertas.length,
        severidade: (criticos > 0 ? 'critico' : maiorCorte > 0.02 ? 'atencao' : maiorCorte >= -0.02 ? 'alinhado' : 'acima') as Severidade,
      }
    }).sort((a, b) => b.maiorCorte - a.maiorCorte)
  }, [ofertas])

  const concorrentes = useMemo(() => {
    const m = new Map<string, { divs: number[]; criticos: number; produtos: Set<string>; link: string }>()
    ofertas.forEach(o => {
      const at = m.get(o.vendedor) ?? { divs: [], criticos: 0, produtos: new Set<string>(), link: o.permalink }
      at.divs.push(o.divergencia)
      if (o.severidade === 'critico') at.criticos++
      at.produtos.add(o.sku || o.produto)
      m.set(o.vendedor, at)
    })
    return Array.from(m.entries()).map(([vendedor, v]) => ({
      vendedor, produtos: v.produtos.size, criticos: v.criticos, link: v.link,
      media: v.divs.reduce((a, b) => a + b, 0) / v.divs.length,
      maior: Math.max(...v.divs),
    })).sort((a, b) => b.criticos - a.criticos || b.media - a.media)
  }, [ofertas])

  const resumo = useMemo(() => {
    const crit = ofertas.filter(o => o.severidade === 'critico')
    const prodCriticos = new Set(crit.map(o => o.sku || o.produto)).size
    const cortes = porProduto.map(p => p.maiorCorte).filter(d => d > 0)
    return {
      produtosMonitorados: porProduto.length,
      concorrentes: concorrentes.length,
      ofertas: ofertas.length,
      criticas: crit.length,
      prodCriticos,
      corteMedio: cortes.length ? cortes.reduce((a, b) => a + b, 0) / cortes.length : 0,
      maisBaratos: porProduto.filter(p => p.posicao === 1).length,
    }
  }, [ofertas, porProduto, concorrentes])

  const listaFiltrada = useMemo(
    () => filtro === 'todos' ? porProduto : porProduto.filter(p => p.severidade === filtro),
    [porProduto, filtro]
  )

  const distribuicao = useMemo(() => (['critico', 'atencao', 'alinhado', 'acima'] as Severidade[]).map(s => ({
    nome: SEVERIDADE_META[s].label, sev: s,
    produtos: porProduto.filter(p => p.severidade === s).length,
  })), [porProduto])

  const dispersao = useMemo(() => porProduto.map(p => ({
    x: p.nossoPreco, y: p.maiorCorte * 100, sev: p.severidade, item: p,
  })), [porProduto])

  const semCredencial = scan?.status === 'sem_credencial' || aviso?.texto?.includes('Mercado Livre')
  const temDados = ofertas.length > 0

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Radar de Preços — Mercado Livre</h1>
          <p className="page-subtitle">
            Compara os preços do catálogo com os dos concorrentes, exclui os anúncios da própria loja e aponta quem corta o preço em 20% ou mais
          </p>
        </div>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          {rodando ? (
            <>
              <span style={{ fontSize: 12, color: 'var(--brave-gray)' }}>
                {progresso ? `${progresso.feitos}/${progresso.total} produtos…` : 'iniciando…'}
              </span>
              <button className="btn btn-sm btn-secondary" onClick={() => { cancelar.current = true }}>Interromper</button>
            </>
          ) : (
            <button className="btn btn-sm" style={{ background: 'var(--brave-yellow)', border: 'none', color: 'var(--brave-dark)', fontWeight: 600 }}
              onClick={varrer}>⟳ Rodar agora</button>
          )}
        </div>
      </div>

      {/* Estado da última varredura */}
      <div className="card mb-6" style={{ padding: '12px 18px' }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 12.5, color: 'var(--brave-gray-mid)' }}>
            {scan ? (
              <>
                Última varredura: <strong>{dataHora(scan.startedAt)}</strong>
                {' · '}{scan.origem === 'semanal' ? 'automática' : 'manual'}
                {' · '}<span style={{ color: scan.status === 'concluido' ? '#1a7a4a' : scan.status === 'rodando' ? '#d59f07' : '#d03b3b' }}>
                  {scan.status === 'concluido' ? 'concluída' : scan.status === 'rodando' ? 'em andamento' : scan.status === 'sem_credencial' ? 'sem credencial' : 'com erro'}
                </span>
                {scan.produtos > 0 && <> · {scan.produtos} produtos consultados{scan.semConcorrente > 0 && `, ${scan.semConcorrente} sem concorrente`}</>}
              </>
            ) : 'Nenhuma varredura executada ainda.'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>
            Agendada automaticamente para <strong>toda segunda-feira, 09h</strong>
          </div>
        </div>
      </div>

      {/* Credencial ausente — o bloqueio real, com o passo a passo */}
      {(semCredencial || indisponivel) && !temDados && (
        <div className="card mb-6" style={{ background: '#fffdf3', border: '1px solid var(--brave-yellow)' }}>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            {indisponivel ? 'Radar ainda não inicializado no banco' : 'Falta conectar o aplicativo do Mercado Livre'}
          </div>
          {indisponivel ? (
            <div style={{ fontSize: 12.5, color: 'var(--brave-gray-mid)', lineHeight: 1.6 }}>
              As tabelas do radar são criadas no próximo deploy com o banco acordado. Se persistir, rode <code>npm run db:push</code>.
            </div>
          ) : (
            <div style={{ fontSize: 12.5, color: 'var(--brave-gray-mid)', lineHeight: 1.65 }}>
              <p style={{ marginBottom: 8 }}>
                Desde 2026 o Mercado Livre <strong>encerrou o acesso anônimo à API</strong> — mesmo uma busca simples responde 403.
                Para consultar preços é preciso um aplicativo próprio, que é <strong>gratuito</strong> e leva poucos minutos:
              </p>
              <ol style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                <li>Entrar em <strong>developers.mercadolivre.com.br</strong> com a conta de vendedor da Tio Chico e criar uma aplicação.</li>
                <li>Anotar o <strong>App ID</strong> e o <strong>Secret Key</strong>, e autorizar a aplicação uma única vez para obter o <strong>refresh token</strong>.</li>
                <li>Na Vercel, em <em>Settings → Environment Variables</em>, cadastrar <code>ML_CLIENT_ID</code>, <code>ML_CLIENT_SECRET</code>, <code>ML_REFRESH_TOKEN</code> e <code>ML_SELLER_NICKS</code> (o apelido da loja no Mercado Livre).</li>
              </ol>
              <p style={{ margin: 0 }}>
                O token de acesso dura 6 horas e é renovado sozinho a cada varredura — o cadastro é feito uma vez só.
                <strong> As credenciais devem ser digitadas direto no painel da Vercel</strong>, nunca compartilhadas por mensagem.
              </p>
            </div>
          )}
        </div>
      )}

      {aviso && (
        <div className="card mb-6" style={{ padding: '10px 16px', background: aviso.tipo === 'erro' ? '#fdf0ee' : 'var(--brave-light)', border: `1px solid ${aviso.tipo === 'erro' ? '#e9b3aa' : 'transparent'}`, fontSize: 12.5, color: 'var(--brave-gray-mid)' }}>
          {aviso.texto}
        </div>
      )}

      {carregando ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando…</div>
      ) : !temDados ? (
        <div className="card" style={{ textAlign: 'center', padding: 54 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>📡</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>Sem resultados de varredura</div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            {semCredencial ? 'Conecte o aplicativo do Mercado Livre acima e rode a primeira varredura.' : 'Clique em “Rodar agora” para a primeira varredura.'}
          </div>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">Produtos monitorados</div>
              <div className="metric-value" style={{ fontSize: 19 }}>{resumo.produtosMonitorados}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{resumo.ofertas} anúncios de concorrentes</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: SEVERIDADE_META.critico.cor }} />
              <div className="metric-label">Produtos em risco</div>
              <div className="metric-value" style={{ fontSize: 19, color: resumo.prodCriticos > 0 ? SEVERIDADE_META.critico.cor : undefined }}>{resumo.prodCriticos}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>com concorrente 20%+ abaixo</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Corte médio</div>
              <div className="metric-value" style={{ fontSize: 19 }}>{resumo.corteMedio > 0 ? pct(resumo.corteMedio) : '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>quanto o mais barato nos corta</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: '#1a7a4a' }} />
              <div className="metric-label">Somos o mais barato</div>
              <div className="metric-value" style={{ fontSize: 19 }}>{resumo.maisBaratos}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>de {resumo.produtosMonitorados} produtos</div>
            </div>
          </div>

          <div className="grid-2 mb-6" style={{ gap: 20, alignItems: 'start' }}>
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Como estamos posicionados</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 10 }}>
                Classificação pelo concorrente mais barato de cada produto. <strong>Crítico</strong> = alguém 20% ou mais abaixo do nosso preço.
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={distribuicao} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 4 }} barCategoryGap="30%">
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="nome" width={74} tick={{ fontSize: 11, fill: INK }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(43,45,66,0.06)' }} content={<DistTip />} />
                  <Bar dataKey="produtos" maxBarSize={22} radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {distribuicao.map((d, i) => <Cell key={i} fill={SEVERIDADE_META[d.sev].cor} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>Onde dói mais</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 10 }}>
                Cada ponto é um produto: à direita, quanto o concorrente mais barato nos corta; acima da linha de 20%, é crítico.
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 4 }}>
                  <CartesianGrid stroke={GRID} />
                  <XAxis type="number" dataKey="x" tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false}
                    tickFormatter={v => `R$${Math.round(v)}`}
                    label={{ value: 'nosso preço', position: 'insideBottom', offset: -12, fontSize: 10, fill: INK2 }} />
                  <YAxis type="number" dataKey="y" tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} width={44}
                    tickFormatter={v => `${v.toFixed(0)}%`} />
                  <ReferenceLine y={0} stroke={AXIS} />
                  <ReferenceLine y={20} stroke={SEVERIDADE_META.critico.cor} strokeDasharray="0"
                    label={{ value: 'crítico', position: 'insideTopRight', fontSize: 10, fill: SEVERIDADE_META.critico.cor }} />
                  <Tooltip cursor={false} content={<DispTip />} />
                  <Scatter data={dispersao} isAnimationActive={false}>
                    {dispersao.map((d, i) => <Cell key={i} fill={SEVERIDADE_META[d.sev].cor} />)}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Abas */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['produtos', 'concorrentes'] as Aba[]).map(a => (
              <button key={a} onClick={() => setAba(a)} style={{
                padding: '8px 18px', border: 'none', borderRadius: 6, cursor: 'pointer',
                fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13,
                background: aba === a ? 'var(--brave-yellow)' : 'var(--brave-light)',
                color: aba === a ? 'var(--brave-dark)' : 'var(--brave-gray)',
              }}>{a === 'produtos' ? '🏷️ Por produto' : '🏪 Concorrentes críticos'}</button>
            ))}
          </div>

          {aba === 'produtos' ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Produtos — {listaFiltrada.length} de {porProduto.length}</span>
                  <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>Clique na linha para ver os anúncios concorrentes.</div>
                </div>
                <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                  {([['todos', 'Todos'], ...(['critico', 'atencao', 'alinhado', 'acima'] as Severidade[]).map(s => [s, `${SEVERIDADE_META[s].icone} ${SEVERIDADE_META[s].label}`])] as [Filtro, string][]).map(([k, label]) => (
                    <button key={k} onClick={() => setFiltro(k)} className="btn btn-sm" style={{
                      background: filtro === k ? 'var(--brave-dark)' : 'var(--brave-light)',
                      color: filtro === k ? '#fff' : 'var(--brave-dark)', border: 'none',
                    }}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="table-wrap">
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 230 }}>Produto</th>
                      <th>Situação</th>
                      <th style={{ textAlign: 'right' }}>Nosso preço</th>
                      <th style={{ textAlign: 'right' }}>Menor concorrente</th>
                      <th style={{ textAlign: 'right' }}>Divergência</th>
                      <th style={{ textAlign: 'center' }}>Posição</th>
                      <th style={{ textAlign: 'center' }}>Concorrentes</th>
                      <th>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaFiltrada.map(p => {
                      const m = SEVERIDADE_META[p.severidade]
                      const k = p.sku || p.produto
                      const aberto = expandido === k
                      return (
                        <>
                          <tr key={k} onClick={() => setExpandido(aberto ? null : k)} style={{ cursor: 'pointer', background: p.severidade === 'critico' ? '#fdf0ee' : undefined }}>
                            <td>
                              <span style={{ color: 'var(--brave-gray)', marginRight: 6 }}>{aberto ? '▾' : '▸'}</span>
                              {p.produto}
                              {p.sku && <div style={{ fontSize: 10, color: 'var(--brave-gray)', marginLeft: 16 }}>{p.sku}</div>}
                            </td>
                            <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, whiteSpace: 'nowrap' }}>
                              <span style={{ color: m.cor }}>{m.icone}</span>{m.label}</span></td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(p.nossoPreco)}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtBRL(p.menorPreco)}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: p.maiorCorte >= 0.2 ? m.cor : INK }}>
                              {p.maiorCorte > 0 ? `−${(p.maiorCorte * 100).toFixed(1)}%` : `+${(-p.maiorCorte * 100).toFixed(1)}%`}
                            </td>
                            <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{p.posicao}º de {p.total + 1}</td>
                            <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{p.total}</td>
                            <td style={{ color: 'var(--brave-gray-mid)' }}>{m.acao}</td>
                          </tr>
                          {aberto && (
                            <tr key={k + '-d'}>
                              <td colSpan={8} style={{ background: 'var(--brave-light)', padding: '10px 20px' }}>
                                <table style={{ fontSize: 11.5, background: SURFACE, borderRadius: 6 }}>
                                  <thead><tr>
                                    <th>Anúncio do concorrente</th><th>Vendedor</th>
                                    <th style={{ textAlign: 'right' }}>Preço</th><th style={{ textAlign: 'right' }}>Divergência</th>
                                    <th style={{ textAlign: 'center' }}>Frete grátis</th><th style={{ textAlign: 'center' }}>Vendidos</th><th></th>
                                  </tr></thead>
                                  <tbody>
                                    {p.ofertas.map(o => (
                                      <tr key={o.id}>
                                        <td>{o.titulo}</td>
                                        <td style={{ fontWeight: 600 }}>{o.vendedor}</td>
                                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(o.preco)}</td>
                                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: SEVERIDADE_META[o.severidade].cor }}>
                                          {o.divergencia > 0 ? `−${(o.divergencia * 100).toFixed(1)}%` : `+${(-o.divergencia * 100).toFixed(1)}%`}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>{o.freteGratis ? 'sim' : '—'}</td>
                                        <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{o.vendidos ? fmtInt(o.vendidos) : '—'}</td>
                                        <td>{o.permalink && <a href={o.permalink} target="_blank" rel="noopener noreferrer" style={{ color: SERIES, fontSize: 11 }}>abrir ↗</a>}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--brave-light)' }}>
                <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13 }}>Concorrentes — {concorrentes.length}</span>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  Ordenados por número de produtos em que cortam nosso preço em 20% ou mais. São estes que merecem resposta.
                </div>
              </div>
              <div className="table-wrap">
                <table style={{ fontSize: 12 }}>
                  <thead><tr>
                    <th>Vendedor</th>
                    <th style={{ textAlign: 'center' }}>Produtos em que concorre</th>
                    <th style={{ textAlign: 'center' }}>Produtos críticos</th>
                    <th style={{ textAlign: 'right' }}>Divergência média</th>
                    <th style={{ textAlign: 'right' }}>Maior corte</th>
                    <th>Leitura</th>
                  </tr></thead>
                  <tbody>
                    {concorrentes.map(c => (
                      <tr key={c.vendedor} style={{ background: c.criticos > 0 ? '#fdf0ee' : undefined }}>
                        <td style={{ fontWeight: 600 }}>{c.vendedor}</td>
                        <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{c.produtos}</td>
                        <td style={{ textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: c.criticos > 0 ? SEVERIDADE_META.critico.cor : 'var(--brave-gray)' }}>{c.criticos || '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: c.media > 0 ? SEVERIDADE_META.critico.cor : INK }}>
                          {c.media > 0 ? `−${(c.media * 100).toFixed(1)}%` : `+${(-c.media * 100).toFixed(1)}%`}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.maior > 0 ? `−${(c.maior * 100).toFixed(1)}%` : '—'}</td>
                        <td style={{ color: 'var(--brave-gray-mid)' }}>
                          {c.criticos >= 3 ? 'Concorrente direto e agressivo — avaliar resposta de preço'
                            : c.criticos > 0 ? 'Corta preço em alguns itens'
                            : c.media > 0 ? 'Levemente abaixo' : 'Pratica preço acima do nosso'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Histórico */}
          {historico.length > 1 && (
            <div className="card mt-4">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Varreduras anteriores</div>
              <div className="table-wrap">
                <table style={{ fontSize: 11.5 }}>
                  <thead><tr>
                    <th>Quando</th><th>Origem</th><th>Situação</th>
                    <th style={{ textAlign: 'center' }}>Produtos</th><th style={{ textAlign: 'center' }}>Ofertas</th><th style={{ textAlign: 'center' }}>Críticas</th>
                  </tr></thead>
                  <tbody>
                    {historico.map(h => (
                      <tr key={h.id} style={{ fontWeight: scan && h.id === scan.id ? 700 : 400 }}>
                        <td>{dataHora(h.startedAt)}</td>
                        <td>{h.origem === 'semanal' ? 'automática' : 'manual'}</td>
                        <td>{h.status === 'concluido' ? 'concluída' : h.status === 'rodando' ? 'em andamento' : h.status === 'sem_credencial' ? 'sem credencial' : 'erro'}</td>
                        <td style={{ textAlign: 'center' }}>{h.produtos}</td>
                        <td style={{ textAlign: 'center' }}>{h.ofertas}</td>
                        <td style={{ textAlign: 'center', color: h.criticos > 0 ? SEVERIDADE_META.critico.cor : undefined, fontWeight: h.criticos > 0 ? 700 : 400 }}>{h.criticos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}

const tipBox: React.CSSProperties = {
  background: SURFACE, border: '1px solid rgba(43,45,66,0.12)', borderRadius: 8, padding: '8px 12px',
  fontSize: 12, color: INK, boxShadow: '0 4px 14px rgba(43,45,66,0.10)', maxWidth: 280,
}

function DistTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return <div style={tipBox}><strong>{d.produtos}</strong> <span style={{ color: 'var(--brave-gray)' }}>produtos em “{d.nome}”</span></div>
}

function DispTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload.item
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{p.produto}</div>
      <div><strong>{fmtBRL(p.nossoPreco)}</strong> <span style={{ color: 'var(--brave-gray)' }}>nosso preço</span></div>
      <div><strong>{fmtBRL(p.menorPreco)}</strong> <span style={{ color: 'var(--brave-gray)' }}>menor concorrente</span></div>
      <div><strong>{p.maiorCorte > 0 ? `−${(p.maiorCorte * 100).toFixed(1)}%` : `+${(-p.maiorCorte * 100).toFixed(1)}%`}</strong> <span style={{ color: 'var(--brave-gray)' }}>de divergência · {p.total} concorrentes</span></div>
    </div>
  )
}
