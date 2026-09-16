'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '@/components/Shell'
import { MONTH_NAMES } from '@/lib/dre'
import { dreVarRate } from '@/lib/margem'
import {
  calcImportacao, calcFluxoImportacao, calcSensibilidadeCambio,
  cambioDeEquilibrio, cambioParidadeNacional, REGIME_INFO,
  type ImportParams, type ImportItem, type Regime, type Modal, type Rateio,
} from '@/lib/importacao'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
const fmtK = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1000) return `${v < 0 ? '-' : ''}${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k`
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v)
}
const fmtInt = (v: number) => new Intl.NumberFormat('pt-BR').format(Math.round(v))
const pctStr = (v: number) => `${(v * 100).toFixed(1)}%`
const fmtCambio = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const GRID = '#edf2f4'
const AXIS = '#c3cbd7'
const INK = '#2b2d42'
const INK2 = '#505168'
const SURFACE = '#ffffff'
const SERIES = '#2b3272'      // azul da marca — série única
const MUTED = '#b4bccb'       // cinza de contexto (padrão de ênfase)
const CRITICAL = '#d03b3b'
const GOOD = '#1a7a4a'

const STORAGE = 'prism.importacao.cenario'

const PARAMS_PADRAO: ImportParams = {
  moeda: 'USD', cambio: 5.50, iofCambioPct: 0.38,
  modal: 'maritimo', freteInternacional: 0, seguroPct: 0.3,
  despachante: 0, armazenagem: 0, freteInterno: 0, taxaSiscomex: 154.23, outrasDespesas: 0,
  regime: 'simples', icmsAliqPct: 18, rateio: 'valor',
  pctAdiantamento: 30, prazoProducao: 35, prazoTransito: 45,
  prazoDesembaraco: 10, prazoInterno: 5, prazoVenda: 90, prazoRecebimento: 20,
}

// ── Exemplo de demonstração ──────────────────────────────────────────────────
// Lote com os campeões de venda do próprio catálogo, para a tela abrir com algo
// reconhecível. Preços FOB são ILUSTRATIVOS — a invoice real substitui tudo.
const EXEMPLO_PARAMS: ImportParams = {
  ...PARAMS_PADRAO,
  cambio: 5.50, freteInternacional: 2200, seguroPct: 0.3,
  despachante: 1800, armazenagem: 2200, freteInterno: 900,
}

const EXEMPLO_ITENS: Omit<ImportItem, 'key'>[] = [
  { produto: 'Lanterna de Cabeça Pilha Ideal para Legendarios 20hrs de Luz', sku: '4019', ncm: '8513.10.10',
    quantidade: 2000, precoFobUnit: 1.85, pesoUnitKg: 0.12, iiAliqPct: 18, ipiAliqPct: 0, precoVenda: 69.50, custoNacionalAtual: 21.72 },
  { produto: 'Lanterna de Cabeça Led V3 Ceramic USB JWS Alcance 1000mts Ws161', sku: '3748', ncm: '8513.10.10',
    quantidade: 600, precoFobUnit: 7.20, pesoUnitKg: 0.18, iiAliqPct: 18, ipiAliqPct: 0, precoVenda: 204.50, custoNacionalAtual: 85.50 },
  { produto: 'Farol Bike Lente Amarela 50w Controle sem Fio Encaixe Gopro WS-5265', sku: '4943', ncm: '8512.10.00',
    quantidade: 300, precoFobUnit: 9.50, pesoUnitKg: 0.32, iiAliqPct: 18, ipiAliqPct: 0, precoVenda: 249.50, custoNacionalAtual: 76.50 },
  { produto: 'Lanterna Traseira Bike Brake Light Usb Sensor Freio 37 Horas JW-5230', sku: '3872', ncm: '8512.20.00',
    quantidade: 500, precoFobUnit: 2.60, pesoUnitKg: 0.06, iiAliqPct: 18, ipiAliqPct: 0, precoVenda: 78.50, custoNacionalAtual: 35.00 },
  { produto: 'Farol Bike 6 Leds Engate Garmin Gopro Power Bank 2800 Lumens', sku: '4953', ncm: '8512.10.00',
    quantidade: 250, precoFobUnit: 5.90, pesoUnitKg: 0.38, iiAliqPct: 18, ipiAliqPct: 0, precoVenda: 259.50, custoNacionalAtual: 72.00 },
  { produto: 'Bateria 26650 3,7v P/ Lanterna tática 8.800mAh JWS Original', sku: '3597', ncm: '8507.60.00',
    quantidade: 1200, precoFobUnit: 1.15, pesoUnitKg: 0.09, iiAliqPct: 18, ipiAliqPct: 0, precoVenda: 39.50, custoNacionalAtual: 15.00 },
  // Produto novo: ainda sem preço de venda — mostra como a tela trata esse caso
  { produto: 'Lampião Solar Camping 2 em 1 (produto novo)', sku: null, ncm: '8513.10.90',
    quantidade: 400, precoFobUnit: 4.30, pesoUnitKg: 0.41, iiAliqPct: 18, ipiAliqPct: 0, precoVenda: 0, custoNacionalAtual: 0 },
]

const novoItem = (): ImportItem => ({
  key: `i${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
  produto: '', sku: null, ncm: '', quantidade: 0, precoFobUnit: 0, pesoUnitKg: 0,
  iiAliqPct: 18, ipiAliqPct: 0, precoVenda: 0, custoNacionalAtual: 0,
})

async function fetchLatestDre(unitParam: string): Promise<any | null> {
  const y0 = new Date().getFullYear()
  for (const y of [y0, y0 - 1]) {
    try {
      const r = await fetch(`/api/dre?month=1&year=${y}${unitParam}`)
      if (!r.ok) continue
      const j = await r.json()
      const meses = ((j?.yearData || []) as any[]).filter(m => (m?.receitaBruta || 0) > 0).sort((a, b) => a.month - b.month)
      if (meses.length) {
        const last = meses[meses.length - 1]
        if (Array.isArray(last.lines)) return last
        const rr = await fetch(`/api/dre?month=${last.month}&year=${last.year}${unitParam}`)
        if (rr.ok) { const jj = await rr.json(); return jj?.dre ?? null }
      }
    } catch {}
  }
  return null
}

export default function ImportacaoPage() {
  const [params, setParams] = useState<ImportParams>(PARAMS_PADRAO)
  const [itens, setItens] = useState<ImportItem[]>([novoItem()])
  const [catalogo, setCatalogo] = useState<any[]>([])
  const [dre, setDre] = useState<any>(null)
  const [toast, setToast] = useState('')
  const [ajuda, setAjuda] = useState(true)
  const [importando, setImportando] = useState(false)
  const [exemplo, setExemplo] = useState(false)
  const [dragPlanilha, setDragPlanilha] = useState(false)
  const planilhaRef = useRef<HTMLInputElement>(null)
  const carregado = useRef(false)

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000) }

  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE)
      if (s) {
        const j = JSON.parse(s)
        if (j.params) setParams({ ...PARAMS_PADRAO, ...j.params })
        if (Array.isArray(j.itens) && j.itens.length) setItens(j.itens)
      }
    } catch {}
    carregado.current = true
    fetch('/api/margem').then(r => r.ok ? r.json() : []).then(c => setCatalogo(Array.isArray(c) ? c : [])).catch(() => {})
    fetchLatestDre('').then(setDre)
  }, [])

  useEffect(() => {
    if (!carregado.current) return
    try { localStorage.setItem(STORAGE, JSON.stringify({ params, itens })) } catch {}
  }, [params, itens])

  const ref = useMemo(() => dreVarRate(dre), [dre])
  const varRatePct = ref.varRate * 100
  const dreLabel = dre ? `${MONTH_NAMES[dre.month]}/${dre.year}` : null

  const itensValidos = useMemo(() => itens.filter(i => i.quantidade > 0 && i.precoFobUnit > 0), [itens])
  const temDados = itensValidos.length > 0
  // Há base para comparar com o mercado interno? Distingue "não preenchido" de
  // "preenchido, mas importar já saiu mais caro" — situações bem diferentes.
  const temComparacao = itensValidos.some(i => (i.custoNacionalAtual || 0) > 0)

  const r = useMemo(() => calcImportacao(params, itensValidos, varRatePct), [params, itensValidos, varRatePct])
  const fluxo = useMemo(() => calcFluxoImportacao(params, r), [params, r])
  const sens = useMemo(() => calcSensibilidadeCambio(params, itensValidos, varRatePct), [params, itensValidos, varRatePct])
  const cEquil = useMemo(() => cambioDeEquilibrio(params, itensValidos, varRatePct), [params, itensValidos, varRatePct])
  const cParid = useMemo(() => cambioParidadeNacional(params, itensValidos, varRatePct), [params, itensValidos, varRatePct])

  const setP = <K extends keyof ImportParams>(k: K, v: ImportParams[K]) => setParams(p => ({ ...p, [k]: v }))
  const setI = (key: string, campo: keyof ImportItem, v: any) =>
    setItens(list => list.map(i => (i.key === key ? { ...i, [campo]: v } : i)))
  const num = (v: string) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n }

  // ── Importar a proforma invoice / lista de itens ──────────────────────────
  // Substitui a lista inteira: a planilha é a fonte da verdade do pedido. O que a
  // planilha não traz (preço de venda, custo nacional, alíquotas) é completado com
  // o catálogo de vocês, casando por SKU e, na falta dele, pelo nome do produto.
  const importarPlanilha = async (file: File) => {
    setImportando(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/importacao/parse', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { showToast(`Erro: ${data.error}`); setImportando(false); return }

      const porSku = new Map<string, any>()
      const porNome = new Map<string, any>()
      catalogo.forEach((c: any) => {
        if (c.sku) porSku.set(String(c.sku).trim().toLowerCase(), c)
        if (c.product) porNome.set(String(c.product).trim().toLowerCase(), c)
      })

      let casados = 0
      const novos: ImportItem[] = (data.itens as any[]).map((it, k) => {
        const cat = (it.sku && porSku.get(String(it.sku).trim().toLowerCase()))
          || porNome.get(String(it.produto).trim().toLowerCase())
        if (cat && (!it.precoVenda || !it.custoNacionalAtual)) casados++
        return {
          key: `p${Date.now()}${k}`,
          produto: it.produto,
          sku: it.sku ?? (cat ? cat.sku : null),
          ncm: it.ncm || '',
          quantidade: it.quantidade,
          precoFobUnit: it.precoFobUnit,
          pesoUnitKg: it.pesoUnitKg || 0,
          iiAliqPct: it.iiAliqPct ?? 18,
          ipiAliqPct: it.ipiAliqPct ?? 0,
          precoVenda: it.precoVenda || (cat?.salePrice ?? 0),
          custoNacionalAtual: it.custoNacionalAtual || (cat?.replacementCost ?? 0),
        }
      })

      setItens(novos)
      const semNcm = novos.filter(i => !i.ncm).length
      const partes = [`✓ ${novos.length} ${novos.length === 1 ? 'item importado' : 'itens importados'}`]
      if (casados > 0) partes.push(`${casados} completados pelo catálogo`)
      if (semNcm > 0) partes.push(`${semNcm} sem NCM — confira as alíquotas`)
      if (data.avisos?.length) partes.push(`${data.avisos.length} ${data.avisos.length === 1 ? 'linha ignorada' : 'linhas ignoradas'}`)
      showToast(partes.join(' · '))
    } catch {
      showToast('Erro ao ler a planilha')
    }
    setImportando(false)
  }

  const carregarExemplo = () => {
    setParams(EXEMPLO_PARAMS)
    setItens(EXEMPLO_ITENS.map((i, k) => ({ ...i, key: `ex${Date.now()}${k}` })))
    setExemplo(true)
    showToast('✓ Exemplo carregado — preços FOB ilustrativos; substitua pela invoice real')
  }

  // Modelo em CSV, gerado no próprio navegador
  const baixarModelo = () => {
    const linhas = [
      'Produto;SKU;NCM;Quantidade;Preço Unitário FOB;Peso Unitário;II %;IPI %;Preço de Venda;Custo Nacional',
      'Lanterna de Cabeça Led V3 Ceramic;3748;8513.10.10;1500;7,20;0,18;18;0;204,50;85,50',
      'Farol Bike Lente Amarela 50w;4943;8512.10.00;600;12,80;0,32;18;0;249,50;76,50',
    ].join('\r\n')
    const blob = new Blob(['﻿' + linhas], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'modelo-itens-importacao.csv'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const addDoCatalogo = (sku: string) => {
    const p = catalogo.find((c: any) => String(c.sku) === sku)
    if (!p) return
    setItens(list => [...list.filter(i => i.produto || i.quantidade > 0), {
      ...novoItem(), produto: p.product, sku: p.sku, quantidade: 0, precoFobUnit: 0,
      precoVenda: p.salePrice || 0, custoNacionalAtual: p.replacementCost || 0,
    }])
    showToast(`✓ ${p.product} adicionado — informe quantidade e preço FOB`)
  }

  // Cascata do custo: cada degrau soma sobre o anterior
  const cascata = [
    { rotulo: 'Mercadoria (FOB)', valor: r.fobBRL, nota: `${params.moeda} × câmbio ${params.cambio.toFixed(2)}` },
    { rotulo: 'Frete internacional', valor: r.freteBRL, nota: params.modal === 'maritimo' ? 'marítimo' : 'aéreo' },
    { rotulo: 'Seguro internacional', valor: r.seguroBRL, nota: `${params.seguroPct}% sobre FOB + frete` },
    { rotulo: '= Valor Aduaneiro', valor: r.valorAduaneiro, destaque: true, nota: 'é sobre isto que a Receita cobra' },
    { rotulo: 'II — Imposto de Importação', valor: r.ii, nota: 'alíquota do NCM, sobre o Valor Aduaneiro' },
    { rotulo: 'IPI', valor: r.ipi, nota: 'sobre Valor Aduaneiro + II' },
    { rotulo: 'PIS-Importação', valor: r.pis, nota: '2,10% do Valor Aduaneiro' },
    { rotulo: 'COFINS-Importação', valor: r.cofins, nota: '9,65% do Valor Aduaneiro' },
    { rotulo: 'ICMS-Importação', valor: r.icms, nota: `${params.icmsAliqPct}% "por dentro" — entra na própria base` },
    { rotulo: 'Despesas no Brasil', valor: r.despesasBrasil, nota: 'despachante, porto, frete interno, Siscomex, AFRMM' },
    { rotulo: 'IOF sobre o câmbio', valor: r.iof, nota: `${params.iofCambioPct}% da remessa` },
    ...(r.creditos > 0 ? [{ rotulo: '(−) Créditos recuperáveis', valor: -r.creditos, nota: REGIME_INFO[params.regime].label, credito: true }] : []),
  ]

  const serieFluxo = useMemo(() => fluxo.serie.filter((_, i) => i % 2 === 0 || i === fluxo.serie.length - 1), [fluxo])
  const sensData = sens.map(s => ({ ...s, label: `${s.cambio.toFixed(2)}`, atual: s.variacaoPct === 0 }))

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Simulador de Importação</h1>
          <p className="page-subtitle">Custo desembarcado, margem, viabilidade e descasamento de caixa — da China ao estoque</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" style={{ background: 'var(--brave-yellow)', border: 'none', color: 'var(--brave-dark)', fontWeight: 600 }}
            onClick={carregarExemplo}>▷ Carregar exemplo</button>
          <button className="btn btn-sm" style={{ background: 'var(--brave-light)', border: 'none', color: 'var(--brave-dark)' }}
            onClick={() => setAjuda(a => !a)}>{ajuda ? '▲ Ocultar explicações' : '▼ Mostrar explicações'}</button>
        </div>
      </div>

      {exemplo && (
        <div className="card mb-6" style={{ padding: '10px 16px', background: '#fffdf3', border: '1px solid var(--brave-yellow)', fontSize: 12.5, color: 'var(--brave-gray-mid)' }}>
          <strong>Você está vendo um exemplo.</strong> Os produtos, preços de venda e custos nacionais são reais, do catálogo de vocês —
          mas os <strong>preços FOB e o frete são ilustrativos</strong>, só para mostrar como a tela funciona. Substitua pelos números da
          sua invoice (ou arraste a proforma abaixo) para uma decisão de verdade. As alíquotas de II e IPI devem ser confirmadas com o despachante.
        </div>
      )}

      {ajuda && (
        <div className="card mb-6" style={{ background: '#fffdf3', border: '1px solid var(--brave-yellow)' }}>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Como ler esta tela — o essencial da importação</div>
          <div style={{ fontSize: 12.5, color: 'var(--brave-gray-mid)', lineHeight: 1.65 }}>
            <p style={{ marginBottom: 6 }}>
              <strong>1. O que você paga ao chinês não é o seu custo.</strong> A Receita não tributa o preço do fornecedor: tributa o
              <strong> Valor Aduaneiro</strong> = mercadoria + frete + seguro, já em reais. Sobre ele vêm II, IPI, PIS, COFINS e ICMS,
              cada um entrando na base do seguinte. Some as despesas de porto e despachante e você chega ao <strong>custo desembarcado</strong> —
              o número que importa. Costuma ficar entre <strong>1,6× e 2,0× o valor da mercadoria</strong>.
            </p>
            <p style={{ marginBottom: 6 }}>
              <strong>2. O ICMS é “por dentro”.</strong> Ele entra na própria base de cálculo. Com alíquota de 18%, cada R$ 100 viram
              R$ 121,95 de base e o imposto é R$ 21,95 — não R$ 18,00. É o erro que mais estraga simulação de importador iniciante.
            </p>
            <p style={{ marginBottom: 6 }}>
              <strong>3. O regime tributário muda tudo.</strong> No <strong>Simples Nacional</strong> — o caso de vocês — nenhum imposto
              da importação é recuperável: tudo vira custo do produto. No Lucro Real, PIS, COFINS e ICMS voltam como crédito.
              A mesma importação pode custar ~25% mais no Simples. Troque o regime abaixo e veja a diferença.
            </p>
            <p style={{ margin: 0 }}>
              <strong>4. O risco não é o custo, é o tempo.</strong> Você paga o fornecedor hoje, os impostos uns 90 dias depois, e só
              recebe do cliente depois de vender e o marketplace repassar. Esse buraco é o <strong>descasamento de caixa</strong> —
              a seção mais importante desta tela, porque é dele que vem o aperto, não da margem.
            </p>
          </div>
        </div>
      )}

      {/* ── Parâmetros ────────────────────────────────────────────────── */}
      <div className="card mb-6">
        <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 12 }}>1. Parâmetros da operação</div>
        <div className="grid-3" style={{ gap: 18, alignItems: 'start' }}>
          <Bloco titulo="Câmbio" dica="O câmbio é o maior risco da operação: ele multiplica mercadoria, frete e todos os impostos de uma vez.">
            <Campo label="Moeda"><input className="form-input" value={params.moeda} onChange={e => setP('moeda', e.target.value.toUpperCase().slice(0, 4))} style={inp} /></Campo>
            <Campo label="Câmbio (R$)" dica="Use o câmbio do dia do fechamento, não o do pedido."><input className="form-input" type="number" step="0.01" value={params.cambio} onChange={e => setP('cambio', num(e.target.value))} style={inp} /></Campo>
            <Campo label="IOF sobre remessa (%)" dica="0,38% na maioria das remessas de importação."><input className="form-input" type="number" step="0.01" value={params.iofCambioPct} onChange={e => setP('iofCambioPct', num(e.target.value))} style={inp} /></Campo>
          </Bloco>

          <Bloco titulo="Frete e seguro" dica="Frete e seguro entram na base dos impostos — encarecem mais do que o valor deles.">
            <Campo label="Modal">
              <select className="form-select" value={params.modal} onChange={e => setP('modal', e.target.value as Modal)} style={inp}>
                <option value="maritimo">Marítimo (paga AFRMM 8%)</option>
                <option value="aereo">Aéreo / courier (sem AFRMM)</option>
              </select>
            </Campo>
            <Campo label={`Frete internacional (${params.moeda})`}><input className="form-input" type="number" step="0.01" value={params.freteInternacional} onChange={e => setP('freteInternacional', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Seguro (% do FOB+frete)" dica="Se não contratar, deixe 0 — mas a aduana pode arbitrar."><input className="form-input" type="number" step="0.01" value={params.seguroPct} onChange={e => setP('seguroPct', num(e.target.value))} style={inp} /></Campo>
          </Bloco>

          <Bloco titulo="Despesas no Brasil (R$)" dica="Armazenagem e Siscomex entram na base do ICMS; despachante e frete interno são custo puro.">
            <Campo label="Despachante"><input className="form-input" type="number" step="0.01" value={params.despachante} onChange={e => setP('despachante', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Armazenagem / capatazia"><input className="form-input" type="number" step="0.01" value={params.armazenagem} onChange={e => setP('armazenagem', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Frete interno até vocês"><input className="form-input" type="number" step="0.01" value={params.freteInterno} onChange={e => setP('freteInterno', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Taxa Siscomex"><input className="form-input" type="number" step="0.01" value={params.taxaSiscomex} onChange={e => setP('taxaSiscomex', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Outras despesas"><input className="form-input" type="number" step="0.01" value={params.outrasDespesas} onChange={e => setP('outrasDespesas', num(e.target.value))} style={inp} /></Campo>
          </Bloco>

          <Bloco titulo="Tributação" dica={REGIME_INFO[params.regime].nota}>
            <Campo label="Regime">
              <select className="form-select" value={params.regime} onChange={e => setP('regime', e.target.value as Regime)} style={inp}>
                {(Object.keys(REGIME_INFO) as Regime[]).map(k => <option key={k} value={k}>{REGIME_INFO[k].label}</option>)}
              </select>
            </Campo>
            <Campo label="ICMS na importação (%)" dica="18% na maioria dos estados. É cobrado 'por dentro'."><input className="form-input" type="number" step="0.01" value={params.icmsAliqPct} onChange={e => setP('icmsAliqPct', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Rateio de frete e despesas">
              <select className="form-select" value={params.rateio} onChange={e => setP('rateio', e.target.value as Rateio)} style={inp}>
                <option value="valor">Por valor (padrão da aduana)</option>
                <option value="peso">Por peso</option>
              </select>
            </Campo>
          </Bloco>

          <Bloco titulo="Prazos (dias)" dica="É aqui que nasce o descasamento de caixa. Some tudo: costuma dar de 120 a 200 dias entre pagar e receber.">
            <Campo label="Adiantamento ao fornecedor (%)" dica="Quanto você paga no pedido; o resto sai no embarque."><input className="form-input" type="number" value={params.pctAdiantamento} onChange={e => setP('pctAdiantamento', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Produção até o embarque"><input className="form-input" type="number" value={params.prazoProducao} onChange={e => setP('prazoProducao', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Trânsito (navio/avião)" dica="China → Brasil por mar: 40 a 60 dias."><input className="form-input" type="number" value={params.prazoTransito} onChange={e => setP('prazoTransito', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Desembaraço aduaneiro"><input className="form-input" type="number" value={params.prazoDesembaraco} onChange={e => setP('prazoDesembaraco', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Porto até o estoque"><input className="form-input" type="number" value={params.prazoInterno} onChange={e => setP('prazoInterno', num(e.target.value))} style={inp} /></Campo>
          </Bloco>

          <Bloco titulo="Venda" dica="Quanto tempo o lote leva para ser vendido e quando o dinheiro entra de fato.">
            <Campo label="Dias para vender o lote" dica="Use a cobertura de estoque da aba Produtos como referência."><input className="form-input" type="number" value={params.prazoVenda} onChange={e => setP('prazoVenda', num(e.target.value))} style={inp} /></Campo>
            <Campo label="Prazo de recebimento" dica="Dias entre a venda e o repasse do marketplace."><input className="form-input" type="number" value={params.prazoRecebimento} onChange={e => setP('prazoRecebimento', num(e.target.value))} style={inp} /></Campo>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 8, lineHeight: 1.5 }}>
              Despesas variáveis sobre a venda: <strong>{varRatePct.toFixed(2)}%</strong>
              {dreLabel ? <> (da DRE de {dreLabel})</> : ' — sem DRE de referência'}
            </div>
          </Bloco>
        </div>
      </div>

      {/* ── Importar a lista de itens ─────────────────────────────────── */}
      <div
        className={`upload-zone mb-6 ${dragPlanilha ? 'drag' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragPlanilha(true) }}
        onDragLeave={() => setDragPlanilha(false)}
        onDrop={e => { e.preventDefault(); setDragPlanilha(false); const f = e.dataTransfer.files?.[0]; if (f) importarPlanilha(f) }}
        onClick={() => planilhaRef.current?.click()}
      >
        <input ref={planilhaRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) importarPlanilha(f); e.target.value = '' }} />
        <div className="upload-icon">{importando ? '⏳' : '📄'}</div>
        <div className="upload-title">
          {importando ? 'Lendo a planilha…' : 'Importar a lista de itens — proforma invoice do fornecedor'}
        </div>
        <div className="upload-sub">
          Aceita <strong>.xlsx</strong> e <strong>.csv</strong>, em português ou inglês. Reconhece
          <strong> Produto/Description · SKU/Item No · NCM/HS Code · Qtd/Qty · Preço Unitário/Unit Price · Peso/Weight</strong>
          {' '}— e, se houver, II%, IPI%, preço de venda e custo nacional.
          <br />Linhas de título e de total são ignoradas; sem preço unitário, ele é deduzido do valor total ÷ quantidade.
          <strong> Preço de venda e custo nacional que faltarem são completados pelo catálogo de vocês.</strong>
          <br /><span style={{ color: 'var(--brave-gray)' }}>Atenção: a planilha substitui a lista atual de itens.</span>
        </div>
        <button className="btn btn-sm btn-secondary" style={{ marginTop: 10 }}
          onClick={e => { e.stopPropagation(); baixarModelo() }}>⤓ Baixar modelo de planilha</button>
      </div>

      {/* ── Produtos ──────────────────────────────────────────────────── */}
      <div className="card mb-6" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--brave-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14 }}>2. Produtos do lote</span>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
              <strong>FOB</strong> = preço por unidade que o fornecedor cobra, na moeda, sem frete. <strong>II/IPI</strong> vêm da NCM do produto.
              <strong> Custo nacional</strong> = o que vocês pagam hoje comprando de importador brasileiro — é a comparação que diz se vale importar.
            </div>
          </div>
          <div className="flex gap-2" style={{ alignItems: 'center' }}>
            {catalogo.length > 0 && (
              <select className="form-select" style={{ width: 230, fontSize: 12 }} value="" onChange={e => { if (e.target.value) addDoCatalogo(e.target.value) }}>
                <option value="">+ Adicionar do catálogo…</option>
                {catalogo.slice().sort((a: any, b: any) => String(a.product).localeCompare(String(b.product))).map((c: any) => (
                  <option key={c.id} value={c.sku}>{String(c.product).slice(0, 44)}</option>
                ))}
              </select>
            )}
            <button className="btn btn-sm btn-secondary" onClick={() => setItens(l => [...l, novoItem()])}>+ Linha em branco</button>
          </div>
        </div>
        <div className="table-wrap">
          <table style={{ fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 190 }}>Produto</th>
                <th style={{ width: 84 }}>NCM</th>
                <th style={{ textAlign: 'right', width: 78 }}>Qtd.</th>
                <th style={{ textAlign: 'right', width: 92 }}>FOB un. ({params.moeda})</th>
                <th style={{ textAlign: 'right', width: 78 }}>Peso un. (kg)</th>
                <th style={{ textAlign: 'right', width: 64 }}>II %</th>
                <th style={{ textAlign: 'right', width: 64 }}>IPI %</th>
                <th style={{ textAlign: 'right', width: 92 }}>Preço venda</th>
                <th style={{ textAlign: 'right', width: 100 }}>Custo nacional</th>
                <th style={{ width: 34 }}></th>
              </tr>
            </thead>
            <tbody>
              {itens.map(i => (
                <tr key={i.key}>
                  <td><input className="form-input" value={i.produto} placeholder="nome do produto" onChange={e => setI(i.key, 'produto', e.target.value)} style={{ ...inp, width: '100%', textAlign: 'left' }} /></td>
                  <td><input className="form-input" value={i.ncm || ''} placeholder="0000.00.00" onChange={e => setI(i.key, 'ncm', e.target.value)} style={{ ...inp, width: '100%' }} /></td>
                  <td><input className="form-input" type="number" value={i.quantidade || ''} onChange={e => setI(i.key, 'quantidade', num(e.target.value))} style={inp} /></td>
                  <td><input className="form-input" type="number" step="0.01" value={i.precoFobUnit || ''} onChange={e => setI(i.key, 'precoFobUnit', num(e.target.value))} style={inp} /></td>
                  <td><input className="form-input" type="number" step="0.001" value={i.pesoUnitKg || ''} onChange={e => setI(i.key, 'pesoUnitKg', num(e.target.value))} style={inp} /></td>
                  <td><input className="form-input" type="number" step="0.01" value={i.iiAliqPct} onChange={e => setI(i.key, 'iiAliqPct', num(e.target.value))} style={inp} /></td>
                  <td><input className="form-input" type="number" step="0.01" value={i.ipiAliqPct} onChange={e => setI(i.key, 'ipiAliqPct', num(e.target.value))} style={inp} /></td>
                  <td><input className="form-input" type="number" step="0.01" value={i.precoVenda || ''} onChange={e => setI(i.key, 'precoVenda', num(e.target.value))} style={inp} /></td>
                  <td><input className="form-input" type="number" step="0.01" value={i.custoNacionalAtual || ''} onChange={e => setI(i.key, 'custoNacionalAtual', num(e.target.value))} style={inp} /></td>
                  <td style={{ textAlign: 'center' }}>
                    <button onClick={() => setItens(l => (l.length > 1 ? l.filter(x => x.key !== i.key) : l))}
                      title="Remover" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--brave-gray)', fontSize: 15 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!temDados ? (
        <div className="card" style={{ textAlign: 'center', padding: 50 }}>
          <div style={{ fontSize: 34, marginBottom: 10 }}>🚢</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 15 }}>Informe ao menos um produto com quantidade e preço FOB</div>
          <div style={{ color: 'var(--brave-gray)', fontSize: 13, marginTop: 6 }}>
            O cálculo aparece aqui assim que houver um item válido. Tudo fica salvo neste navegador.
          </div>
        </div>
      ) : (
        <>
          {/* ── Resultado ─────────────────────────────────────────────── */}
          <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="metric-card">
              <div className="metric-label">Investimento total</div>
              <div className="metric-value" style={{ fontSize: 19 }}>{fmtBRL(r.investimentoTotal)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>tudo que sai do caixa</div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: SERIES }} />
              <div className="metric-label">Custo desembarcado</div>
              <div className="metric-value" style={{ fontSize: 19 }}>{fmtBRL(r.custoDesembarcado)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                <strong>{r.fatorLandedCost.toFixed(2)}×</strong> o valor da mercadoria
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-accent" style={{ background: r.mcPctMedia >= 0 ? GOOD : CRITICAL }} />
              <div className="metric-label">Margem de contribuição</div>
              <div className="metric-value" style={{ fontSize: 19, color: r.mcPctMedia >= 0 ? undefined : CRITICAL }}>{r.receitaPotencial > 0 ? pctStr(r.mcPctMedia) : '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                {r.receitaPotencial > 0 ? `${fmtBRL(r.mcTotal)} no lote` : 'defina o preço de venda dos itens'}
                {r.semPrecoVenda > 0 && r.receitaPotencial > 0 && <> · {r.semPrecoVenda} sem preço</>}
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Retorno sobre o investido</div>
              <div className="metric-value" style={{ fontSize: 19 }}>{r.roi == null ? '—' : pctStr(r.roi)}</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                {r.economiaVsNacional != null
                  ? <>vs comprar no Brasil: <strong style={{ color: r.economiaVsNacional >= 0 ? GOOD : CRITICAL }}>{r.economiaVsNacional >= 0 ? 'economia ' : 'custo maior '}{fmtBRL(Math.abs(r.economiaVsNacional))}</strong></>
                  : 'preencha o custo nacional para comparar'}
              </div>
            </div>
          </div>

          <div className="grid-2 mb-6" style={{ gap: 20, alignItems: 'start' }}>
            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>3. Como o preço vira custo</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 10 }}>
                Cada degrau soma sobre o anterior até o custo desembarcado.
              </div>
              <table style={{ fontSize: 12 }}>
                <tbody>
                  {cascata.map((c, k) => (
                    <tr key={k} style={{ background: (c as any).destaque ? 'var(--brave-light)' : undefined }}>
                      <td style={{ fontWeight: (c as any).destaque ? 700 : 400 }}>
                        {c.rotulo}
                        <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>{c.nota}</div>
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: (c as any).destaque ? 700 : 600, color: (c as any).credito ? GOOD : INK, whiteSpace: 'nowrap' }}>
                        {fmtBRL(c.valor)}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--brave-gray)', width: 54 }}>
                        {r.fobBRL > 0 ? `${((c.valor / r.fobBRL) * 100).toFixed(0)}%` : ''}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--brave-dark)', color: '#fff' }}>
                    <td style={{ fontWeight: 700, color: '#fff' }}>= Custo desembarcado</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#fff' }}>{fmtBRL(r.custoDesembarcado)}</td>
                    <td style={{ textAlign: 'right', fontSize: 11, color: '#eaca2d' }}>{r.fatorLandedCost.toFixed(2)}×</td>
                  </tr>
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 8, lineHeight: 1.5 }}>
                Percentuais sobre o valor da mercadoria (FOB). {REGIME_INFO[params.regime].nota}
              </div>
            </div>

            <div className="card">
              <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>4. Vale a pena? — produto a produto</div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 10 }}>
                Custo unitário já desembarcado, comparado ao que vocês pagam hoje no mercado interno.
              </div>
              <div className="table-wrap">
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th style={{ textAlign: 'right' }}>Custo un.</th>
                      <th style={{ textAlign: 'right' }}>vs nacional</th>
                      <th style={{ textAlign: 'right' }}>MC/un</th>
                      <th style={{ textAlign: 'right' }}>MC%</th>
                      <th style={{ textAlign: 'right' }}>Markup</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.itens.map(it => (
                      <tr key={it.key} style={{ background: (it.mcUnit ?? 0) < 0 ? '#fdf0ee' : undefined }}>
                        <td>{it.produto || <span style={{ color: 'var(--brave-gray)' }}>(sem nome)</span>}
                          <div style={{ fontSize: 10, color: 'var(--brave-gray)' }}>
                            {fmtInt(it.quantidade)} un{it.ncm ? ` · NCM ${it.ncm}` : ''}
                            {it.mcUnit == null && <span style={{ color: '#d59f07' }}> · falta o preço de venda</span>}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(it.custoUnitario)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: it.custoNacionalAtual > 0 ? (it.economiaUnit >= 0 ? GOOD : CRITICAL) : 'var(--brave-gray)' }}>
                          {it.custoNacionalAtual > 0 ? `${it.economiaUnit >= 0 ? '−' : '+'}${Math.abs(it.economiaPct * 100).toFixed(0)}%` : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (it.mcUnit ?? 0) < 0 ? CRITICAL : INK }}>{it.mcUnit == null ? '—' : fmtBRL(it.mcUnit)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: (it.mcPct ?? 0) < 0 ? CRITICAL : INK }}>{it.mcPct == null ? '—' : pctStr(it.mcPct)}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--brave-gray)' }}>{it.markup == null ? '—' : `${it.markup.toFixed(2)}×`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 8, lineHeight: 1.5 }}>
                “vs nacional” negativo = importar sai <strong>mais barato</strong>. MC já desconta {varRatePct.toFixed(2)}% de despesas variáveis sobre a venda.
                {r.semPrecoVenda > 0 && (
                  <> <strong style={{ color: '#d59f07' }}>{r.semPrecoVenda} {r.semPrecoVenda === 1 ? 'item está' : 'itens estão'} sem preço de venda</strong> — o custo desembarcado
                  deles já está calculado, mas ficam de fora da margem e da receita até você definir o preço. É o caso normal de produto novo.</>
                )}
              </div>
            </div>
          </div>

          {/* ── Fluxo de caixa ────────────────────────────────────────── */}
          <div className="card mb-6">
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>5. Descasamento de caixa — o buraco entre pagar e receber</div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>
              Saldo acumulado da operação, dia a dia, a partir do pedido. Ele afunda enquanto você paga fornecedor,
              frete e impostos, e só volta à tona conforme as vendas são recebidas.
            </div>
            <div className="metrics-grid mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              <Metric label="Capital de giro necessário" value={fmtBRL(Math.abs(fluxo.piorSaldo))} hint={`pior momento: dia ${fluxo.diaPiorSaldo}`} color={CRITICAL} />
              <Metric label="Mercadoria disponível" value={`dia ${fluxo.diasEstoqueParado}`} hint="do pedido até poder vender" />
              <Metric label="Caixa volta a zero" value={fluxo.diaPayback == null ? 'não volta' : `dia ${fluxo.diaPayback}`} hint="quando o lote se paga" color={fluxo.diaPayback == null ? CRITICAL : undefined} />
              <Metric label="Ciclo completo" value={`${fluxo.cicloTotal} dias`} hint="pedido até o último recebimento" />
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={serieFluxo} margin={{ top: 10, right: 20, bottom: 24, left: 8 }}>
                <defs>
                  <linearGradient id="gCaixa" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={SERIES} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false}
                  label={{ value: 'dias desde o pedido', position: 'insideBottom', offset: -14, fontSize: 11, fill: INK2 }} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} width={54} />
                <ReferenceLine y={0} stroke={AXIS} />
                <ReferenceLine x={fluxo.diasEstoqueParado} stroke={AXIS} label={{ value: 'estoque', position: 'top', fontSize: 10, fill: INK2 }} />
                {fluxo.diaPayback != null && <ReferenceLine x={fluxo.diaPayback} stroke={GOOD} label={{ value: 'payback', position: 'top', fontSize: 10, fill: GOOD }} />}
                <Tooltip content={<CaixaTip />} />
                <Area type="monotone" dataKey="saldo" stroke={SERIES} strokeWidth={2} fill="url(#gCaixa)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table style={{ fontSize: 12 }}>
                <thead><tr><th style={{ width: 70 }}>Dia</th><th>Evento</th><th style={{ textAlign: 'right' }}>Valor</th></tr></thead>
                <tbody>
                  {fluxo.eventos.filter(e => e.tipo === 'saida' || e.rotulo.includes('Créditos')).map((e, k) => (
                    <tr key={k}>
                      <td style={{ color: 'var(--brave-gray)' }}>D+{e.dia}</td>
                      <td>{e.rotulo}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: e.valor < 0 ? CRITICAL : GOOD }}>{fmtBRL(e.valor)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--brave-light)' }}>
                    <td style={{ fontWeight: 700 }}>D+{fluxo.diasEstoqueParado}</td>
                    <td style={{ fontWeight: 700 }}>Mercadoria no estoque — começa a vender</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(r.receitaPotencial)} a receber</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Sensibilidade ─────────────────────────────────────────── */}
          <div className="card">
            <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 2 }}>6. E se o dólar subir? — sensibilidade ao câmbio</div>
            <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 10 }}>
              Entre o pedido e o fechamento do câmbio passam-se semanas. Esta é a margem do lote em cada cenário —
              a barra destacada é o câmbio que você informou.
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={sensData} margin={{ top: 10, right: 16, bottom: 22, left: 4 }} barCategoryGap="28%">
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: INK2 }} axisLine={{ stroke: AXIS }} tickLine={false}
                  label={{ value: `câmbio (R$ por ${params.moeda})`, position: 'insideBottom', offset: -12, fontSize: 11, fill: INK2 }} />
                <YAxis tickFormatter={v => `${(v * 100).toFixed(0)}%`} tick={{ fontSize: 10, fill: INK2 }} axisLine={false} tickLine={false} width={46} />
                <ReferenceLine y={0} stroke={AXIS} />
                <Tooltip cursor={{ fill: 'rgba(43,45,66,0.06)' }} content={<SensTip moeda={params.moeda} />} />
                <Bar dataKey="mcPct" maxBarSize={30} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {sensData.map((s, i) => <Cell key={i} fill={s.mcPct < 0 ? CRITICAL : s.atual ? SERIES : MUTED} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="grid-2" style={{ gap: 16, marginTop: 8 }}>
              <div style={{ padding: '10px 14px', background: 'var(--brave-light)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--brave-gray-mid)', fontWeight: 600, marginBottom: 2 }}>Câmbio de equilíbrio</div>
                <div style={{ fontSize: 17, fontFamily: 'var(--font-sub)', fontWeight: 700 }}>{cEquil == null ? '—' : fmtCambio(cEquil)}</div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  {cEquil == null
                    ? (r.mcTotal <= 0 ? 'a margem do lote já está negativa no câmbio atual' : 'a operação não empata dentro da faixa simulada')
                    : <>acima disso a margem do lote zera — é {((cEquil / params.cambio - 1) * 100).toFixed(0)}% acima do câmbio atual</>}
                </div>
              </div>
              <div style={{ padding: '10px 14px', background: 'var(--brave-light)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--brave-gray-mid)', fontWeight: 600, marginBottom: 2 }}>Paridade com o importador nacional</div>
                <div style={{ fontSize: 17, fontFamily: 'var(--font-sub)', fontWeight: 700, color: temComparacao && cParid == null ? CRITICAL : undefined }}>
                  {cParid != null ? fmtCambio(cParid) : temComparacao ? 'já não compensa' : '—'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>
                  {cParid != null
                    ? <>acima disso é melhor comprar de importador brasileiro do que trazer da China</>
                    : temComparacao
                      ? <>no câmbio atual o lote sai <strong>{fmtBRL(Math.abs(r.economiaVsNacional || 0))}</strong> mais caro do que comprar no Brasil — veja na tabela quais itens ainda compensam</>
                      : 'preencha o custo nacional dos itens para calcular'}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}

const inp: React.CSSProperties = { width: '100%', fontSize: 12, padding: '5px 8px', textAlign: 'right' }

function Bloco({ titulo, dica, children }: { titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 12.5, marginBottom: 2 }}>{titulo}</div>
      {dica && <div style={{ fontSize: 10.5, color: 'var(--brave-gray)', marginBottom: 8, lineHeight: 1.45 }}>{dica}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{children}</div>
    </div>
  )
}

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '1fr 104px', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--brave-gray-mid)' }} title={dica}>{label}{dica && <span style={{ color: 'var(--brave-gray)' }}> ⓘ</span>}</span>
      {children}
    </label>
  )
}

function Metric({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={{ fontSize: 18, color }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

const tipBox: React.CSSProperties = {
  background: SURFACE, border: '1px solid rgba(43,45,66,0.12)', borderRadius: 8, padding: '8px 12px',
  fontSize: 12, color: INK, boxShadow: '0 4px 14px rgba(43,45,66,0.10)',
}

function CaixaTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const v = payload[0].value as number
  return (
    <div style={tipBox}>
      <div style={{ color: 'var(--brave-gray)', fontSize: 11 }}>dia {label}</div>
      <div><strong style={{ color: v < 0 ? CRITICAL : GOOD }}>{fmtBRL(v)}</strong> <span style={{ color: 'var(--brave-gray)' }}>de saldo acumulado</span></div>
    </div>
  )
}

function SensTip({ active, payload, moeda }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={tipBox}>
      <div style={{ fontWeight: 600, marginBottom: 3 }}>Câmbio R$ {d.cambio.toFixed(2)} / {moeda}{d.atual ? ' (atual)' : ''}</div>
      <div><strong>{pctStr(d.mcPct)}</strong> <span style={{ color: 'var(--brave-gray)' }}>de margem</span></div>
      <div><strong>{fmtBRL(d.mcTotal)}</strong> <span style={{ color: 'var(--brave-gray)' }}>de MC no lote</span></div>
      <div><strong>{fmtBRL(d.custoDesembarcado)}</strong> <span style={{ color: 'var(--brave-gray)' }}>de custo desembarcado</span></div>
    </div>
  )
}
