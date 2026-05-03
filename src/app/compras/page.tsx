'use client'
import { useEffect, useState, useMemo } from 'react'
import Shell from '@/components/Shell'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts'

// ─── Types ───────────────────────────────────────────────
type Unit = { id: number; name: string }
type Supplier = {
  id: number; name: string; cnpj?: string | null
  contactName?: string | null; email?: string | null; phone?: string | null
  paymentTermDays: number; notes?: string | null; active: boolean; createdAt: string
  purchaseOrders: { id: number; status: string; totalAmount: number; createdAt: string; receivedDate?: string | null; expectedDate?: string | null }[]
}
type PurchaseItem = { id: number; description: string; quantity: number; unitPrice: number; receivedQty: number; notes?: string | null }
type PurchaseOrder = {
  id: number; supplierId: number; supplier: Supplier; unitId?: number | null; unit?: Unit | null
  status: string; expectedDate?: string | null; receivedDate?: string | null
  totalAmount: number; notes?: string | null; month: number; year: number
  createdAt: string; updatedAt: string; items: PurchaseItem[]
}

// ─── Helpers ─────────────────────────────────────────────
const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDate = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'
const today = new Date(); today.setHours(0, 0, 0, 0)
const isLate = (o: PurchaseOrder) =>
  o.expectedDate && !['RECEIVED', 'CANCELLED'].includes(o.status) && new Date(o.expectedDate) < today

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho', OPEN: 'Aberto', PARTIAL: 'Parcial', RECEIVED: 'Recebido', CANCELLED: 'Cancelado',
}
const STATUS_COLOR: Record<string, string> = {
  DRAFT: '#8d99ae', OPEN: '#2b6cb0', PARTIAL: '#d59f07', RECEIVED: '#1a7a4a', CANCELLED: '#c0392b',
}

// ─── Supplier score (A/B/C) ──────────────────────────────
function calcScore(s: Supplier): { label: 'A' | 'B' | 'C'; score: number; leadTime: number; completionRate: number } {
  const completed = s.purchaseOrders.filter(o => o.status === 'RECEIVED')
  const total = s.purchaseOrders.filter(o => o.status !== 'CANCELLED').length
  const completionRate = total > 0 ? (completed.length / total) * 100 : 100

  const leadsMs = completed
    .filter(o => o.receivedDate)
    .map(o => new Date(o.receivedDate!).getTime() - new Date(o.createdAt).getTime())
  const avgLead = leadsMs.length > 0 ? leadsMs.reduce((a, b) => a + b, 0) / leadsMs.length / 86400000 : 0

  // Score: completionRate (60%) + lead time score (40%)
  const leadScore = avgLead === 0 ? 100 : Math.max(0, 100 - avgLead * 3)
  const score = completionRate * 0.6 + leadScore * 0.4

  return {
    score: Math.round(score),
    label: score >= 80 ? 'A' : score >= 55 ? 'B' : 'C',
    leadTime: Math.round(avgLead),
    completionRate: Math.round(completionRate),
  }
}

// ─── ABC Analysis ────────────────────────────────────────
function calcABC(suppliers: Supplier[]) {
  const rows = suppliers
    .map(s => ({ id: s.id, name: s.name, total: s.purchaseOrders.reduce((a, o) => a + o.totalAmount, 0) }))
    .sort((a, b) => b.total - a.total)
  const grandTotal = rows.reduce((a, r) => a + r.total, 0)
  let cum = 0
  return rows.map(r => {
    cum += r.total
    const pct = grandTotal > 0 ? (cum / grandTotal) * 100 : 0
    return { ...r, pct: r.total / (grandTotal || 1) * 100, cumPct: pct, class: pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C' }
  })
}

// ─── Main Page ───────────────────────────────────────────
export default function Compras() {
  const [tab, setTab] = useState<'dashboard' | 'pedidos' | 'fornecedores' | 'analise'>('dashboard')
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')

  const load = async () => {
    const [o, s, u] = await Promise.all([
      fetch('/api/purchase-orders').then(r => r.json()),
      fetch('/api/suppliers').then(r => r.json()),
      fetch('/api/units').then(r => r.json()),
    ])
    setOrders(o); setSuppliers(s); setUnits(u); setLoading(false)
  }
  useEffect(() => { load() }, [])
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const tabBtn = (t: typeof tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        padding: '8px 18px', border: 'none', borderRadius: 6, cursor: 'pointer',
        fontFamily: 'var(--font-sub)', fontWeight: 600, fontSize: 13,
        background: tab === t ? 'var(--brave-yellow)' : 'var(--brave-light)',
        color: tab === t ? 'var(--brave-dark)' : 'var(--brave-gray)',
      }}
    >
      {label}
    </button>
  )

  return (
    <Shell>
      <div className="page-header flex-between">
        <div>
          <h1 className="page-title">Compras</h1>
          <p className="page-subtitle">Controle inteligente de pedidos e fornecedores</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {tabBtn('dashboard', '◈ Dashboard')}
        {tabBtn('pedidos', '📋 Pedidos')}
        {tabBtn('fornecedores', '🏭 Fornecedores')}
        {tabBtn('analise', '📊 Análise Inteligente')}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--brave-gray)' }}>Carregando...</div>
      ) : (
        <>
          {tab === 'dashboard' && <TabDashboard orders={orders} suppliers={suppliers} />}
          {tab === 'pedidos' && <TabPedidos orders={orders} suppliers={suppliers} units={units} onRefresh={load} showToast={showToast} />}
          {tab === 'fornecedores' && <TabFornecedores suppliers={suppliers} onRefresh={load} showToast={showToast} />}
          {tab === 'analise' && <TabAnalise orders={orders} suppliers={suppliers} />}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </Shell>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB: DASHBOARD
// ═══════════════════════════════════════════════════════════
function TabDashboard({ orders, suppliers }: { orders: PurchaseOrder[]; suppliers: Supplier[] }) {
  const now = new Date()
  const thisMonth = orders.filter(o => o.month === now.getMonth() + 1 && o.year === now.getFullYear())
  const spentMonth = thisMonth.filter(o => o.status !== 'CANCELLED').reduce((a, o) => a + o.totalAmount, 0)
  const openOrders = orders.filter(o => ['OPEN', 'DRAFT', 'PARTIAL'].includes(o.status))
  const lateOrders = orders.filter(o => isLate(o))

  // Monthly spend last 6 months
  const months: { label: string; total: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const m = d.getMonth() + 1; const y = d.getFullYear()
    const total = orders.filter(o => o.month === m && o.year === y && o.status !== 'CANCELLED').reduce((a, o) => a + o.totalAmount, 0)
    months.push({ label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), total })
  }

  // Top suppliers
  const topSuppliers = suppliers
    .map(s => ({ name: s.name, total: s.purchaseOrders.filter(o => o.status !== 'CANCELLED').reduce((a, o) => a + o.totalAmount, 0) }))
    .sort((a, b) => b.total - a.total).slice(0, 5)

  return (
    <>
      <div className="metrics-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="metric-card">
          <div className="metric-label">Gasto este mês</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{fmt(spentMonth)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pedidos em aberto</div>
          <div className="metric-value">{openOrders.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pedidos atrasados</div>
          <div className="metric-value" style={{ color: lateOrders.length > 0 ? '#c0392b' : '#1a7a4a' }}>
            {lateOrders.length}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Fornecedores ativos</div>
          <div className="metric-value">{suppliers.filter(s => s.active).length}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, marginBottom: 16, fontSize: 14 }}>
            Evolução de Gastos (últimos 6 meses)
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={months}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Line type="monotone" dataKey="total" stroke="var(--brave-yellow)" strokeWidth={2} dot={{ fill: 'var(--brave-yellow)' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, marginBottom: 16, fontSize: 14 }}>
            Top Fornecedores
          </div>
          {topSuppliers.length === 0 ? (
            <div style={{ color: 'var(--brave-gray)', fontSize: 13 }}>Nenhum dado ainda</div>
          ) : topSuppliers.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee', fontSize: 13 }}>
              <span style={{ fontWeight: i === 0 ? 600 : 400 }}>{s.name}</span>
              <span style={{ color: '#1a7a4a', fontWeight: 600 }}>{fmt(s.total)}</span>
            </div>
          ))}
        </div>
      </div>

      {lateOrders.length > 0 && (
        <div className="card" style={{ marginTop: 16, borderLeft: '4px solid #c0392b' }}>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600, color: '#c0392b', marginBottom: 10, fontSize: 14 }}>
            ⚠ Pedidos Atrasados
          </div>
          {lateOrders.map(o => {
            const daysLate = Math.floor((today.getTime() - new Date(o.expectedDate!).getTime()) / 86400000)
            return (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #fde', fontSize: 13 }}>
                <span><strong>PC-{String(o.id).padStart(4, '0')}</strong> — {o.supplier.name}</span>
                <span style={{ color: '#c0392b', fontWeight: 600 }}>{daysLate} dia{daysLate !== 1 ? 's' : ''} de atraso</span>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB: PEDIDOS
// ═══════════════════════════════════════════════════════════
function TabPedidos({ orders, suppliers, units, onRefresh, showToast }: {
  orders: PurchaseOrder[]; suppliers: Supplier[]; units: Unit[]
  onRefresh: () => void; showToast: (m: string) => void
}) {
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [orderModal, setOrderModal] = useState(false)
  const [receiveModal, setReceiveModal] = useState<PurchaseOrder | null>(null)
  const [saving, setSaving] = useState(false)

  // New order form
  const emptyForm = { supplierId: '', unitId: '', expectedDate: '', notes: '' }
  const emptyItem = { description: '', quantity: '1', unitPrice: '' }
  const [form, setForm] = useState(emptyForm)
  const [items, setItems] = useState([{ ...emptyItem }])

  // Receive form
  const [receiveQtys, setReceiveQtys] = useState<Record<number, string>>({})

  const filtered = orders.filter(o => filterStatus === 'ALL' || o.status === filterStatus)
  const total = filtered.reduce((a, o) => a + o.totalAmount, 0)

  const addItem = () => setItems(i => [...i, { ...emptyItem }])
  const removeItem = (idx: number) => setItems(i => i.filter((_, j) => j !== idx))
  const updateItem = (idx: number, field: string, val: string) =>
    setItems(i => i.map((item, j) => j === idx ? { ...item, [field]: val } : item))

  const orderTotal = items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0), 0)

  const saveOrder = async () => {
    if (!form.supplierId) { showToast('Selecione um fornecedor'); return }
    const validItems = items.filter(i => i.description.trim() && parseFloat(i.quantity) > 0 && parseFloat(i.unitPrice) >= 0)
    if (!validItems.length) { showToast('Adicione ao menos um item válido'); return }
    setSaving(true)
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, items: validItems.map(i => ({ description: i.description, quantity: parseFloat(i.quantity), unitPrice: parseFloat(i.unitPrice) })) }),
    })
    setSaving(false)
    if (!res.ok) { const d = await res.json(); showToast(`Erro: ${d.error}`); return }
    setOrderModal(false); setForm(emptyForm); setItems([{ ...emptyItem }])
    await onRefresh(); showToast('✓ Pedido criado')
  }

  const changeStatus = async (id: number, status: string) => {
    await fetch(`/api/purchase-orders/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    await onRefresh(); showToast(`✓ Status atualizado para ${STATUS_LABEL[status]}`)
  }

  const deleteOrder = async (o: PurchaseOrder) => {
    if (!confirm(`Excluir pedido PC-${String(o.id).padStart(4, '0')}?`)) return
    const res = await fetch(`/api/purchase-orders/${o.id}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json(); showToast(`Erro: ${d.error}`); return }
    await onRefresh(); showToast('✓ Pedido excluído')
  }

  const openReceive = (o: PurchaseOrder) => {
    const qtys: Record<number, string> = {}
    o.items.forEach(i => { qtys[i.id] = String(i.quantity - i.receivedQty) })
    setReceiveQtys(qtys); setReceiveModal(o)
  }

  const saveReceive = async () => {
    if (!receiveModal) return
    setSaving(true)
    const receivedItems = receiveModal.items.map(i => ({ itemId: i.id, receivedQty: parseFloat(receiveQtys[i.id] || '0') + i.receivedQty }))
    await fetch(`/api/purchase-orders/${receiveModal.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'receive', receivedItems }) })
    setSaving(false); setReceiveModal(null)
    await onRefresh(); showToast('✓ Recebimento registrado')
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 160 }}>
          <option value="ALL">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span style={{ fontSize: 13, color: 'var(--brave-gray)' }}>{filtered.length} pedido(s) · {fmt(total)}</span>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setOrderModal(true)}>
          + Novo Pedido
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600 }}>Nenhum pedido</div>
          <div style={{ fontSize: 13, color: 'var(--brave-gray)', marginTop: 6, marginBottom: 20 }}>Crie o primeiro pedido de compra.</div>
          <button className="btn btn-primary" onClick={() => setOrderModal(true)}>+ Novo Pedido</button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--brave-light)', borderBottom: '1px solid #ddd' }}>
                {['Nº', 'Fornecedor', 'Criado em', 'Previsão', 'Itens', 'Total', 'Status', 'Ações'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--brave-gray)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, idx) => {
                const late = isLate(o)
                const isExp = expanded === o.id
                return (
                  <>
                    <tr key={o.id} style={{ borderBottom: '1px solid #eee', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13 }}>
                        PC-{String(o.id).padStart(4, '0')}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 13 }}>{o.supplier.name}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--brave-gray)' }}>{fmtDate(o.createdAt)}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12 }}>
                        {o.expectedDate ? (
                          <span style={{ color: late ? '#c0392b' : 'inherit', fontWeight: late ? 700 : 400 }}>
                            {fmtDate(o.expectedDate)}{late ? ' ⚠' : ''}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--brave-gray)' }}>{o.items.length}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, fontSize: 13 }}>{fmt(o.totalAmount)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ background: STATUS_COLOR[o.status] + '22', color: STATUS_COLOR[o.status], borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                          {STATUS_LABEL[o.status]}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={() => setExpanded(isExp ? null : o.id)}>
                            {isExp ? '▲' : '▼'}
                          </button>
                          {o.status === 'DRAFT' && (
                            <button className="btn btn-sm" style={{ fontSize: 11, background: '#2b6cb0', color: '#fff' }} onClick={() => changeStatus(o.id, 'OPEN')}>
                              Enviar
                            </button>
                          )}
                          {['OPEN', 'PARTIAL'].includes(o.status) && (
                            <button className="btn btn-sm" style={{ fontSize: 11, background: '#1a7a4a', color: '#fff' }} onClick={() => openReceive(o)}>
                              Receber
                            </button>
                          )}
                          {o.status === 'DRAFT' && (
                            <button className="btn btn-sm btn-danger" style={{ fontSize: 11 }} onClick={() => deleteOrder(o)}>✕</button>
                          )}
                          {['OPEN', 'PARTIAL'].includes(o.status) && (
                            <button className="btn btn-sm btn-danger" style={{ fontSize: 11 }} onClick={() => changeStatus(o.id, 'CANCELLED')}>✕</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExp && (
                      <tr key={`${o.id}-detail`} style={{ borderBottom: '2px solid var(--brave-yellow)' }}>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <div style={{ background: '#f7f9fc', padding: '12px 20px' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--brave-gray)', marginBottom: 8 }}>ITENS DO PEDIDO</div>
                            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  {['Descrição', 'Qtd.', 'Preço Unit.', 'Total', 'Recebido'].map(h => (
                                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--brave-gray)', fontWeight: 500, fontSize: 11 }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {o.items.map(item => {
                                  const pct = item.quantity > 0 ? (item.receivedQty / item.quantity) * 100 : 0
                                  return (
                                    <tr key={item.id} style={{ borderTop: '1px solid #e8edf2' }}>
                                      <td style={{ padding: '6px 8px' }}>{item.description}</td>
                                      <td style={{ padding: '6px 8px', color: 'var(--brave-gray)' }}>{item.quantity}</td>
                                      <td style={{ padding: '6px 8px' }}>{fmt(item.unitPrice)}</td>
                                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{fmt(item.quantity * item.unitPrice)}</td>
                                      <td style={{ padding: '6px 8px' }}>
                                        <span style={{ color: pct >= 100 ? '#1a7a4a' : pct > 0 ? '#d59f07' : 'var(--brave-gray)', fontWeight: 600 }}>
                                          {item.receivedQty}/{item.quantity} ({Math.round(pct)}%)
                                        </span>
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                            {o.notes && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--brave-gray)' }}>Obs: {o.notes}</div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Order Modal */}
      {orderModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflowY: 'auto', padding: '24px 0' }}>
          <div className="card" style={{ width: 600, padding: 24, margin: 'auto' }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16 }}>Novo Pedido de Compra</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Fornecedor *</label>
                <select className="form-select" style={{ width: '100%' }} value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId: e.target.value }))}>
                  <option value="">— Selecione —</option>
                  {suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Unidade</label>
                <select className="form-select" style={{ width: '100%' }} value={form.unitId} onChange={e => setForm(f => ({ ...f, unitId: e.target.value }))}>
                  <option value="">— Nenhuma —</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Previsão de entrega</label>
                <input className="form-input" style={{ width: '100%' }} type="date" value={form.expectedDate} onChange={e => setForm(f => ({ ...f, expectedDate: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Observações</label>
                <input className="form-input" style={{ width: '100%' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div style={{ marginBottom: 8, borderTop: '1px solid #eee', paddingTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--brave-gray)' }}>ITENS</span>
                <button className="btn btn-sm" style={{ fontSize: 11 }} onClick={addItem}>+ Item</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 28px', gap: 4, marginBottom: 4 }}>
                {['Descrição', 'Qtd.', 'Preço Unit.', ''].map(h => (
                  <div key={h} style={{ fontSize: 10, color: 'var(--brave-gray)', fontWeight: 600 }}>{h}</div>
                ))}
              </div>
              {items.map((item, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 28px', gap: 4, marginBottom: 4 }}>
                  <input className="form-input" style={{ fontSize: 12 }} placeholder="Nome do produto/serviço" value={item.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                  <input className="form-input" style={{ fontSize: 12 }} type="number" min="0.01" step="0.01" placeholder="1" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} />
                  <input className="form-input" style={{ fontSize: 12 }} type="number" min="0" step="0.01" placeholder="0,00" value={item.unitPrice} onChange={e => updateItem(idx, 'unitPrice', e.target.value)} />
                  <button className="btn btn-sm btn-danger" style={{ fontSize: 11, padding: '0 6px' }} onClick={() => removeItem(idx)}>✕</button>
                </div>
              ))}
              <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 14, marginTop: 8, color: '#1a7a4a' }}>
                Total: {fmt(orderTotal)}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn" onClick={() => setOrderModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveOrder} disabled={saving}>
                {saving ? 'Salvando...' : 'Criar Pedido'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Modal */}
      {receiveModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: 500, padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 4 }}>Registrar Recebimento</h3>
            <div style={{ fontSize: 13, color: 'var(--brave-gray)', marginBottom: 16 }}>
              PC-{String(receiveModal.id).padStart(4, '0')} — {receiveModal.supplier.name}
            </div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse', marginBottom: 16 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #eee' }}>
                  <th style={{ textAlign: 'left', padding: '4px 0', color: 'var(--brave-gray)', fontSize: 11, fontWeight: 600 }}>Descrição</th>
                  <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--brave-gray)', fontSize: 11, fontWeight: 600 }}>Pedido</th>
                  <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--brave-gray)', fontSize: 11, fontWeight: 600 }}>Já recebido</th>
                  <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--brave-gray)', fontSize: 11, fontWeight: 600 }}>Receber agora</th>
                </tr>
              </thead>
              <tbody>
                {receiveModal.items.map(item => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: '8px 0' }}>{item.description}</td>
                    <td style={{ textAlign: 'center', padding: '8px' }}>{item.quantity}</td>
                    <td style={{ textAlign: 'center', padding: '8px', color: 'var(--brave-gray)' }}>{item.receivedQty}</td>
                    <td style={{ padding: '8px' }}>
                      <input
                        className="form-input"
                        type="number" min="0" max={item.quantity - item.receivedQty} step="0.01"
                        style={{ width: 80, textAlign: 'center', fontSize: 12 }}
                        value={receiveQtys[item.id] || ''}
                        onChange={e => setReceiveQtys(q => ({ ...q, [item.id]: e.target.value }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setReceiveModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveReceive} disabled={saving}>
                {saving ? 'Salvando...' : 'Confirmar Recebimento'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB: FORNECEDORES
// ═══════════════════════════════════════════════════════════
function TabFornecedores({ suppliers, onRefresh, showToast }: {
  suppliers: Supplier[]; onRefresh: () => void; showToast: (m: string) => void
}) {
  const [modal, setModal] = useState(false)
  const [edit, setEdit] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)
  const emptyForm = { name: '', cnpj: '', contactName: '', email: '', phone: '', paymentTermDays: '30', notes: '' }
  const [form, setForm] = useState(emptyForm)

  const openAdd = () => { setEdit(null); setForm(emptyForm); setModal(true) }
  const openEdit = (s: Supplier) => {
    setEdit(s)
    setForm({ name: s.name, cnpj: s.cnpj || '', contactName: s.contactName || '', email: s.email || '', phone: s.phone || '', paymentTermDays: String(s.paymentTermDays), notes: s.notes || '' })
    setModal(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    const url = edit ? `/api/suppliers/${edit.id}` : '/api/suppliers'
    const method = edit ? 'PUT' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    setSaving(false)
    if (!res.ok) { const d = await res.json(); showToast(`Erro: ${d.error}`); return }
    setModal(false); await onRefresh(); showToast(edit ? '✓ Fornecedor atualizado' : '✓ Fornecedor cadastrado')
  }

  const del = async (s: Supplier) => {
    if (!confirm(`Excluir fornecedor "${s.name}"?`)) return
    const res = await fetch(`/api/suppliers/${s.id}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json(); showToast(`Erro: ${d.error}`); return }
    await onRefresh(); showToast('✓ Fornecedor excluído')
  }

  const SCORE_COLOR = { A: '#1a7a4a', B: '#d59f07', C: '#c0392b' }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={openAdd}>+ Novo Fornecedor</button>
      </div>

      {suppliers.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🏭</div>
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 600 }}>Nenhum fornecedor cadastrado</div>
          <div style={{ fontSize: 13, color: 'var(--brave-gray)', marginTop: 6, marginBottom: 20 }}>Cadastre o primeiro fornecedor.</div>
          <button className="btn btn-primary" onClick={openAdd}>+ Novo Fornecedor</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {suppliers.map(s => {
            const { label, score, leadTime, completionRate } = calcScore(s)
            const totalSpent = s.purchaseOrders.filter(o => o.status !== 'CANCELLED').reduce((a, o) => a + o.totalAmount, 0)
            const orders = s.purchaseOrders.filter(o => o.status !== 'CANCELLED').length
            return (
              <div key={s.id} className="card" style={{ opacity: s.active ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 15 }}>{s.name}</div>
                    {s.cnpj && <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>{s.cnpj}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{
                      background: SCORE_COLOR[label] + '22', color: SCORE_COLOR[label],
                      border: `1px solid ${SCORE_COLOR[label]}`, borderRadius: 4,
                      padding: '2px 8px', fontWeight: 700, fontSize: 13,
                    }}>
                      {label}
                    </span>
                    <button className="btn btn-sm" onClick={() => openEdit(s)}>✏️</button>
                    <button className="btn btn-sm btn-danger" onClick={() => del(s)}>✕</button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginBottom: 10 }}>
                  {s.contactName && <div style={{ color: 'var(--brave-gray)' }}>👤 {s.contactName}</div>}
                  {s.phone && <div style={{ color: 'var(--brave-gray)' }}>📞 {s.phone}</div>}
                  {s.email && <div style={{ color: 'var(--brave-gray)', gridColumn: s.contactName || s.phone ? undefined : '1/-1' }}>✉ {s.email}</div>}
                  <div style={{ color: 'var(--brave-gray)' }}>💳 {s.paymentTermDays}d</div>
                </div>

                <div style={{ borderTop: '1px solid #eee', paddingTop: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>Pedidos</div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{orders}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>Lead Time</div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{leadTime > 0 ? `${leadTime}d` : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--brave-gray)' }}>Completo</div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{completionRate}%</div>
                  </div>
                </div>

                <div style={{ marginTop: 8, textAlign: 'right', fontWeight: 700, color: '#1a7a4a', fontSize: 14 }}>
                  Total: {fmt(totalSpent)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div className="card" style={{ width: 460, padding: 24 }}>
            <h3 style={{ fontFamily: 'var(--font-sub)', marginBottom: 16 }}>{edit ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h3>
            <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Nome *</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 12 }} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>CNPJ</label>
                <input className="form-input" style={{ width: '100%' }} placeholder="00.000.000/0000-00" value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Prazo de pagamento (dias)</label>
                <input className="form-input" style={{ width: '100%' }} type="number" min="0" value={form.paymentTermDays} onChange={e => setForm(f => ({ ...f, paymentTermDays: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Contato</label>
                <input className="form-input" style={{ width: '100%' }} placeholder="Nome do contato" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Telefone</label>
                <input className="form-input" style={{ width: '100%' }} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
            </div>
            <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>E-mail</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 12 }} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <label style={{ fontSize: 12, color: 'var(--brave-gray)', display: 'block', marginBottom: 4 }}>Observações</label>
            <input className="form-input" style={{ width: '100%', marginBottom: 16 }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════
// TAB: ANÁLISE INTELIGENTE
// ═══════════════════════════════════════════════════════════
function TabAnalise({ orders, suppliers }: { orders: PurchaseOrder[]; suppliers: Supplier[] }) {
  const abc = useMemo(() => calcABC(suppliers), [suppliers])
  const CLASS_COLOR = { A: '#1a7a4a', B: '#d59f07', C: '#c0392b' }

  // Lead time per supplier (completed orders only)
  const leadData = useMemo(() => suppliers
    .map(s => {
      const completed = s.purchaseOrders.filter(o => o.status === 'RECEIVED' && o.receivedDate)
      const leads = completed.map(o => (new Date(o.receivedDate!).getTime() - new Date(o.createdAt).getTime()) / 86400000)
      const avg = leads.length > 0 ? leads.reduce((a, b) => a + b, 0) / leads.length : 0
      return { name: s.name, leadTime: Math.round(avg), orders: completed.length }
    })
    .filter(s => s.orders > 0)
    .sort((a, b) => a.leadTime - b.leadTime)
    .slice(0, 10), [suppliers])

  // Price history: group by description → show price over time per supplier
  const priceHistory = useMemo(() => {
    const map: Record<string, { description: string; entries: { date: string; price: number; supplier: string; qty: number }[] }> = {}
    orders.filter(o => o.status !== 'CANCELLED').forEach(o => {
      o.items.forEach(item => {
        const key = item.description.toLowerCase().trim()
        if (!map[key]) map[key] = { description: item.description, entries: [] }
        map[key].entries.push({ date: o.createdAt.slice(0, 10), price: item.unitPrice, supplier: o.supplier.name, qty: item.quantity })
      })
    })
    return Object.values(map)
      .filter(p => p.entries.length >= 2)
      .sort((a, b) => b.entries.length - a.entries.length)
      .slice(0, 10)
  }, [orders])

  // Spend by month (bar)
  const monthlySpend = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      const m = d.getMonth() + 1; const y = d.getFullYear()
      return {
        label: d.toLocaleDateString('pt-BR', { month: 'short' }),
        total: orders.filter(o => o.month === m && o.year === y && o.status !== 'CANCELLED').reduce((a, o) => a + o.totalAmount, 0),
      }
    })
  }, [orders])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Curva ABC */}
      <div className="card">
        <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
          Curva ABC — Fornecedores por Gasto
        </div>
        <div style={{ fontSize: 12, color: 'var(--brave-gray)', marginBottom: 16 }}>
          A = 80% do gasto · B = próximos 15% · C = últimos 5%
        </div>
        {abc.length === 0 ? (
          <div style={{ color: 'var(--brave-gray)', fontSize: 13 }}>Nenhum dado de compras ainda.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #eee' }}>
                {['Classe', 'Fornecedor', 'Gasto Total', '% do Total', '% Acum.'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: 'var(--brave-gray)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {abc.map((row, i) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #f5f5f5', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ background: CLASS_COLOR[row.class as keyof typeof CLASS_COLOR] + '22', color: CLASS_COLOR[row.class as keyof typeof CLASS_COLOR], border: `1px solid ${CLASS_COLOR[row.class as keyof typeof CLASS_COLOR]}`, borderRadius: 4, padding: '1px 8px', fontWeight: 700, fontSize: 12 }}>
                      {row.class}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: row.class === 'A' ? 600 : 400 }}>{row.name}</td>
                  <td style={{ padding: '8px 10px', color: '#1a7a4a', fontWeight: 600 }}>{fmt(row.total)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${row.pct}%`, height: '100%', background: CLASS_COLOR[row.class as keyof typeof CLASS_COLOR], borderRadius: 3 }} />
                      </div>
                      <span>{row.pct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', color: 'var(--brave-gray)' }}>{row.cumPct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Lead Time */}
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            Lead Time por Fornecedor
          </div>
          <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>Dias médios entre pedido e recebimento</div>
          {leadData.length === 0 ? (
            <div style={{ color: 'var(--brave-gray)', fontSize: 13 }}>Nenhum pedido recebido ainda.</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={leadData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} unit="d" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                <Tooltip formatter={(v: number) => [`${v} dias`, 'Lead Time']} />
                <Bar dataKey="leadTime" radius={3}>
                  {leadData.map((entry, i) => (
                    <Cell key={i} fill={entry.leadTime <= 7 ? '#1a7a4a' : entry.leadTime <= 15 ? '#d59f07' : '#c0392b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Monthly Spend Bar */}
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            Gasto Mensal (últimos 6 meses)
          </div>
          <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 12 }}>Total em pedidos não cancelados</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlySpend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="total" fill="var(--brave-yellow)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Price History */}
      {priceHistory.length > 0 && (
        <div className="card">
          <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            Histórico de Preços por Produto
          </div>
          <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
            Produtos que aparecem em 2+ pedidos — detecta variação de preço entre compras
          </div>
          {priceHistory.map(product => {
            const prices = product.entries.map(e => e.price)
            const minP = Math.min(...prices); const maxP = Math.max(...prices)
            const variation = minP > 0 ? ((maxP - minP) / minP) * 100 : 0
            const sorted = [...product.entries].sort((a, b) => a.date.localeCompare(b.date))
            const last = sorted[sorted.length - 1]
            const prev = sorted[sorted.length - 2]
            const trend = prev ? last.price - prev.price : 0
            return (
              <div key={product.description} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #eee' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{product.description}</span>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                    {variation > 10 && (
                      <span style={{ color: '#c0392b', fontWeight: 600 }}>⚠ {variation.toFixed(0)}% variação</span>
                    )}
                    {trend !== 0 && (
                      <span style={{ color: trend > 0 ? '#c0392b' : '#1a7a4a', fontWeight: 600 }}>
                        {trend > 0 ? '↑' : '↓'} {fmt(Math.abs(trend))} na última compra
                      </span>
                    )}
                  </div>
                </div>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Data', 'Fornecedor', 'Qtd.', 'Preço Unit.'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '2px 8px', color: 'var(--brave-gray)', fontSize: 10, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((e, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #f0f0f0', background: i === sorted.length - 1 ? '#fffde7' : 'transparent' }}>
                        <td style={{ padding: '4px 8px', color: 'var(--brave-gray)' }}>{fmtDate(e.date)}</td>
                        <td style={{ padding: '4px 8px' }}>{e.supplier}</td>
                        <td style={{ padding: '4px 8px', color: 'var(--brave-gray)' }}>{e.qty}</td>
                        <td style={{ padding: '4px 8px', fontWeight: i === sorted.length - 1 ? 700 : 400, color: '#1a7a4a' }}>{fmt(e.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {/* Score Summary */}
      <div className="card">
        <div style={{ fontFamily: 'var(--font-sub)', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
          Ranking de Fornecedores
        </div>
        <div style={{ fontSize: 11, color: 'var(--brave-gray)', marginBottom: 16 }}>
          Score = 60% taxa de entrega completa + 40% velocidade de entrega
        </div>
        {suppliers.length === 0 ? (
          <div style={{ color: 'var(--brave-gray)', fontSize: 13 }}>Nenhum fornecedor cadastrado.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #eee' }}>
                {['Score', 'Fornecedor', 'Pedidos', 'Lead Time Médio', 'Taxa de Completude', 'Gasto Total'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', fontSize: 11, color: 'var(--brave-gray)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {suppliers
                .map(s => ({ ...s, ...calcScore(s) }))
                .sort((a, b) => b.score - a.score)
                .map((s, i) => {
                  const totalSpent = s.purchaseOrders.filter(o => o.status !== 'CANCELLED').reduce((a, o) => a + o.totalAmount, 0)
                  const totalOrders = s.purchaseOrders.filter(o => o.status !== 'CANCELLED').length
                  const color = { A: '#1a7a4a', B: '#d59f07', C: '#c0392b' }[s.label]
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f5f5f5', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ background: color + '22', color, border: `1px solid ${color}`, borderRadius: 4, padding: '2px 8px', fontWeight: 700, fontSize: 12 }}>
                          {s.label} · {s.score}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{s.name}</td>
                      <td style={{ padding: '8px 10px', color: 'var(--brave-gray)' }}>{totalOrders}</td>
                      <td style={{ padding: '8px 10px' }}>{s.leadTime > 0 ? `${s.leadTime} dias` : '—'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 60, height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${s.completionRate}%`, height: '100%', background: color, borderRadius: 3 }} />
                          </div>
                          <span>{s.completionRate}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', color: '#1a7a4a', fontWeight: 600 }}>{fmt(totalSpent)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
