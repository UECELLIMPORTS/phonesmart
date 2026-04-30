'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Pencil, Trash2, Loader2, X,
  ArrowDownCircle, ArrowUpCircle, AlertTriangle, Package,
  CalendarClock, Scale,
} from 'lucide-react'
import {
  createMovement, updateMovement, deleteMovement, reconcileProductSales,
  type StockMovementRow, type MovementType,
} from '@/actions/stock-movements'
import type { ProductRow } from '@/actions/products'

// ── Types ─────────────────────────────────────────────────────────────────────

type MovimentoRow = StockMovementRow & { running_balance: number }

type TipoLancamento = MovementType | 'balanco'

type ModalForm = {
  type:               TipoLancamento
  quantity:           string   // para balanco = novo saldo desejado
  depot:              string
  notes:              string
  movedAt:            string   // datetime-local: "YYYY-MM-DDTHH:MM"
  purchasePriceCents: number
  costPriceCents:     number
  salePriceCents:     number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

function nowLocal(): string {
  const d   = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isoToLocal(iso: string): string {
  const d   = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDatetime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function fmtQty(qty: number, type: MovementType, unit: string): string {
  return `${type === 'entrada' ? '+' : '−'}${qty} ${unit}`
}

// Calcula saldo acumulado ordenado por moved_at ASC, depois inverte para exibição
function computeRunningBalance(rows: StockMovementRow[]): MovimentoRow[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.moved_at).getTime() - new Date(b.moved_at).getTime(),
  )
  let balance = 0
  const withBalance = sorted.map(m => {
    const delta = m.type === 'entrada' ? Number(m.quantity) : -Number(m.quantity)
    balance     = Math.max(0, balance + delta)
    return { ...m, running_balance: balance }
  })
  return withBalance.reverse()   // exibição: mais recente primeiro
}

function defaultDepot(product: ProductRow): string {
  return product.location?.trim() || 'Depósito Padrão'
}

function emptyForm(product: ProductRow): ModalForm {
  return {
    type:               'entrada',
    quantity:           '',
    depot:              defaultDepot(product),
    notes:              '',
    movedAt:            nowLocal(),
    purchasePriceCents: 0,
    costPriceCents:     0,
    salePriceCents:     product.price_cents,
  }
}

function editForm(m: StockMovementRow, product: ProductRow): ModalForm {
  const tipo: TipoLancamento = m.origin === 'balanco' ? 'balanco' : m.type
  return {
    type:               tipo,
    quantity:           String(m.quantity),
    depot:              m.depot || defaultDepot(product),
    notes:              m.notes || '',
    movedAt:            isoToLocal(m.moved_at),
    purchasePriceCents: m.purchase_price_cents,
    costPriceCents:     m.cost_price_cents,
    salePriceCents:     m.sale_price_cents || product.price_cents,
  }
}

// ── Style constants ───────────────────────────────────────────────────────────

const INP   = 'w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent'
const INP_S = { borderColor: '#2A3650' }

// ── Cores por tipo ────────────────────────────────────────────────────────────

const TIPO_COLOR: Record<TipoLancamento, string> = {
  entrada: '#10B981',
  saida:   '#EF4444',
  balanco: '#F59E0B',
}

// ── PriceField helper ─────────────────────────────────────────────────────────

function PriceField({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  const fmt   = (c: number) => (c / 100).toFixed(2).replace('.', ',')
  const parse = (v: string) => parseInt(v.replace(/\D/g, '') || '0', 10)
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span>
        <input
          type="text" inputMode="numeric"
          value={fmt(value)}
          onChange={e => onChange(parse(e.target.value))}
          className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }}
        />
      </div>
    </div>
  )
}

// ── Modal de lançamento (novo ou edição) ──────────────────────────────────────

function MovimentoModal({
  form, onChange, onSave, onClose,
  saving, error, isEdit, currentStock, unit, productPriceCents,
}: {
  form:              ModalForm
  onChange:          (patch: Partial<ModalForm>) => void
  onSave:            () => void
  onClose:           () => void
  saving:            boolean
  error:             string
  isEdit:            boolean
  currentStock:      number
  unit:              string
  productPriceCents: number
}) {
  const cor   = TIPO_COLOR[form.type]
  const qty   = parseFloat(form.quantity.replace(',', '.')) || 0

  // Preview do delta para Balanço
  const balancoDelta = form.type === 'balanco' ? qty - currentStock : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl border shadow-2xl"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" style={{ color: cor }} />
            <h3 className="text-sm font-semibold text-text">
              {isEdit ? 'Editar Lançamento' : 'Novo Lançamento'}
            </h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-5">

          {error && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: '#EF444418', color: '#EF4444', border: '1px solid #EF444440' }}>
              <AlertTriangle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          {/* Tipo */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Tipo *</label>
            <div className="relative">
              <select
                value={form.type}
                onChange={e => onChange({ type: e.target.value as TipoLancamento })}
                className="w-full appearance-none rounded-lg border bg-[#131C2A] px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-1"
                style={{ borderColor: cor, color: cor }}
              >
                <option value="entrada" style={{ color: '#10B981', background: '#131C2A' }}>↓ Entrada</option>
                <option value="saida"   style={{ color: '#EF4444', background: '#131C2A' }}>↑ Saída</option>
                <option value="balanco" style={{ color: '#F59E0B', background: '#131C2A' }}>⚖ Balanço</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">▾</span>
            </div>
          </div>

          {/* Quantidade / Novo Saldo */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              {form.type === 'balanco' ? `Novo Saldo (atual: ${currentStock} ${unit}) *` : 'Quantidade *'}
            </label>
            <input
              type="text" inputMode="decimal"
              value={form.quantity}
              onChange={e => onChange({ quantity: e.target.value })}
              placeholder={form.type === 'balanco' ? `Ex: ${currentStock}` : 'Ex: 1 ou 1,5'}
              className={INP} style={INP_S}
              autoFocus
            />
            {/* Preview delta do balanço */}
            {form.type === 'balanco' && qty > 0 && balancoDelta !== 0 && (
              <p className="mt-1 text-xs" style={{ color: balancoDelta > 0 ? '#10B981' : '#EF4444' }}>
                {balancoDelta > 0 ? `+${balancoDelta}` : balancoDelta} {unit} será lançado como {balancoDelta > 0 ? 'Entrada' : 'Saída'}
              </p>
            )}
            {form.type === 'balanco' && qty > 0 && balancoDelta === 0 && (
              <p className="mt-1 text-xs text-muted">Saldo já está em {qty} {unit} — nenhum lançamento necessário.</p>
            )}
          </div>

          {/* Preços — conforme o tipo (mesmo padrão do modal antigo) */}
          {(form.type === 'entrada' || form.type === 'balanco') && (() => {
            const lucro  = productPriceCents - form.costPriceCents
            const margem = productPriceCents > 0 ? (lucro / productPriceCents) * 100 : 0
            const positivo = lucro >= 0
            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PriceField label="Preço de Compra" value={form.purchasePriceCents}
                    onChange={v => onChange({ purchasePriceCents: v })} />
                  <PriceField label="Preço de Custo"  value={form.costPriceCents}
                    onChange={v => onChange({ costPriceCents: v })} />
                </div>
                {form.costPriceCents > 0 && productPriceCents > 0 && (
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                    style={{
                      background: positivo ? '#10B98112' : '#EF444412',
                      border:     `1px solid ${positivo ? '#10B98130' : '#EF444430'}`,
                      color:      positivo ? '#10B981'   : '#EF4444',
                    }}
                  >
                    <span className="font-semibold">Margem: {margem.toFixed(1)}%</span>
                    <span className="text-muted">·</span>
                    <span>Lucro: {BRL(lucro)}</span>
                    <span className="ml-auto text-muted">ref. preço de venda {BRL(productPriceCents)}</span>
                  </div>
                )}
              </>
            )
          })()}
          {form.type === 'saida' && (() => {
            // Margem usa o custo (mais correto) — fallback pro preço de compra se não informado.
            const custoRef = form.costPriceCents > 0 ? form.costPriceCents : form.purchasePriceCents
            const lucro    = form.salePriceCents - custoRef
            const margem   = form.salePriceCents > 0 ? (lucro / form.salePriceCents) * 100 : 0
            const positivo = lucro >= 0
            const custoLabel = form.costPriceCents > 0 ? 'custo' : 'compra'
            return (
              <>
                <PriceField label="Preço de Venda" value={form.salePriceCents}
                  onChange={v => onChange({ salePriceCents: v })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PriceField label="Preço de Compra" value={form.purchasePriceCents}
                    onChange={v => onChange({ purchasePriceCents: v })} />
                  <PriceField label="Preço de Custo" value={form.costPriceCents}
                    onChange={v => onChange({ costPriceCents: v })} />
                </div>
                {form.salePriceCents > 0 && custoRef > 0 && (
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                    style={{
                      background: positivo ? '#10B98112' : '#EF444412',
                      border:     `1px solid ${positivo ? '#10B98130' : '#EF444430'}`,
                      color:      positivo ? '#10B981'   : '#EF4444',
                    }}
                  >
                    <span className="font-semibold">Margem: {margem.toFixed(1)}%</span>
                    <span className="text-muted">·</span>
                    <span>Lucro: {BRL(lucro)}</span>
                    <span className="ml-auto text-muted">ref. {custoLabel}</span>
                  </div>
                )}
              </>
            )
          })()}

          {/* Depósito + Data/Hora */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Depósito</label>
              <input
                value={form.depot}
                onChange={e => onChange({ depot: e.target.value })}
                placeholder="Depósito Padrão"
                className={INP} style={INP_S}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Data / Hora *</label>
              <input
                type="datetime-local"
                value={form.movedAt}
                onChange={e => onChange({ movedAt: e.target.value })}
                className={INP}
                style={{ ...INP_S, colorScheme: 'dark' }}
              />
            </div>
          </div>

          {/* Observação */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Observação</label>
            <input
              type="text"
              value={form.notes}
              onChange={e => onChange({ notes: e.target.value })}
              placeholder="Ex: Compra NF 1234, ajuste de inventário…"
              className={INP} style={INP_S}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 border-t px-5 py-4" style={{ borderColor: '#2A3650' }}>
          <button onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm text-muted hover:text-text transition-colors"
            style={{ borderColor: '#2A3650' }}>
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.quantity || !form.movedAt}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-black disabled:opacity-50"
            style={{ background: cor }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Salvando…' : isEdit ? 'Salvar Alterações' : 'Incluir'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delete confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({
  onConfirm, onClose, deleting,
}: {
  onConfirm: () => void; onClose: () => void; deleting: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4 shadow-2xl"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: '#EF444415' }}>
          <Trash2 className="h-5 w-5" style={{ color: '#EF4444' }} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-text">Excluir lançamento?</h3>
          <p className="mt-1 text-xs text-muted">
            O estoque será recalculado automaticamente. Esta ação não pode ser desfeita.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 rounded-lg border py-2 text-sm text-muted hover:text-text"
            style={{ borderColor: '#2A3650' }}>
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={deleting}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white"
            style={{ background: '#EF4444' }}>
            {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
            Excluir
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function MovimentosClient({
  product: initialProduct,
  initialMovements,
}: {
  product:            ProductRow
  initialMovements:   StockMovementRow[]
}) {
  const router = useRouter()

  const [product, setProduct]         = useState(initialProduct)
  const [movements, setMovements]     = useState<StockMovementRow[]>(initialMovements)
  const [recalcing, startRecalc]      = useTransition()

  const [modalOpen, setModalOpen]     = useState(false)
  const [editTarget, setEditTarget]   = useState<StockMovementRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StockMovementRow | null>(null)

  const [form, setForm]               = useState<ModalForm>(() => emptyForm(product))
  const [saving, startSave]           = useTransition()
  const [deleting, startDel]          = useTransition()
  const [reconciling, setReconciling] = useState(false)
  const [modalError, setModalError]   = useState('')

  // Calcula saldo acumulado — recalculado apenas quando movements muda
  const rows: MovimentoRow[] = useMemo(
    () => computeRunningBalance(movements),
    [movements],
  )

  // Saldo calculado vs. saldo real do produto
  const computedTotal = rows.length > 0 ? rows[0].running_balance : 0
  const diverges      = movements.length > 0 && computedTotal !== product.stock_qty

  // Totais Entradas / Saídas (quantidades e valores R$)
  const totals = useMemo(() => {
    let entradasQty = 0, entradasCents = 0
    let saidasQty   = 0, saidasCents   = 0
    for (const m of movements) {
      if (m.origin === 'balanco') continue
      if (m.type === 'entrada') {
        entradasQty += m.quantity
        const unit = m.purchase_price_cents || m.cost_price_cents || 0
        entradasCents += unit * m.quantity
      } else {
        saidasQty += m.quantity
        const unit = m.sale_price_cents || product.price_cents || 0
        saidasCents += unit * m.quantity
      }
    }
    return { entradasQty, entradasCents, saidasQty, saidasCents }
  }, [movements, product.price_cents])

  // ── Modal helpers ───────────────────────────────────────────────────────

  function openAdd() {
    setEditTarget(null)
    setForm(emptyForm(product))
    setModalError('')
    setModalOpen(true)
  }

  function openEdit(m: StockMovementRow) {
    setEditTarget(m)
    setForm(editForm(m, product))
    setModalError('')
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditTarget(null)
    setModalError('')
  }

  function patchForm(patch: Partial<ModalForm>) {
    setForm(f => ({ ...f, ...patch }))
  }

  // ── Save (create or update) ─────────────────────────────────────────────

  function handleSave() {
    const qty = parseFloat(form.quantity.replace(',', '.'))
    const qtyInvalid = isNaN(qty) || qty < 0 || (form.type !== 'balanco' && qty <= 0)
    if (qtyInvalid) { setModalError('Informe uma quantidade válida.'); return }
    if (!form.movedAt)    { setModalError('Informe a data e hora.'); return }
    setModalError('')

    const movedAtISO = new Date(form.movedAt).toISOString()

    if (editTarget) {
      // ── Editar ──
      startSave(async () => {
        try {
          let movType: MovementType
          let movQty:  number
          let origin:  string

          if (form.type === 'balanco') {
            // Para balanço na edição: calcula stock sem este lançamento
            const stockWithout = computeRunningBalance(
              movements.filter(m => m.id !== editTarget.id)
            )
            const stockBase = stockWithout.length > 0 ? stockWithout[0].running_balance : 0
            const delta = qty - stockBase
            if (delta === 0) { setModalError('Saldo já está nesse valor.'); return }
            movType = delta > 0 ? 'entrada' : 'saida'
            movQty  = Math.abs(delta)
            origin  = 'balanco'
          } else {
            movType = form.type
            movQty  = qty
            origin  = 'manual'
          }

          const { movement, newStockQty } = await updateMovement(editTarget.id, {
            type:               movType,
            quantity:           movQty,
            movedAt:            movedAtISO,
            notes:              form.notes,
            origin,
            purchasePriceCents: form.purchasePriceCents,
            costPriceCents:     form.costPriceCents,
            salePriceCents:     form.salePriceCents,
          })
          startRecalc(() => {
            setMovements(prev => prev.map(m => m.id === movement.id ? movement : m))
            setProduct(p => ({ ...p, stock_qty: newStockQty }))
          })
          closeModal()
        } catch (e) {
          setModalError(e instanceof Error ? e.message : 'Erro ao salvar.')
        }
      })
    } else {
      // ── Criar ──
      startSave(async () => {
        try {
          // Para Balanço: calcula delta e lança como entrada ou saída com origin='balanco'
          let movType: MovementType
          let movQty:  number
          if (form.type === 'balanco') {
            const delta = qty - product.stock_qty
            if (delta === 0) { setModalError('Saldo já está nesse valor.'); return }
            movType = delta > 0 ? 'entrada' : 'saida'
            movQty  = Math.abs(delta)
          } else {
            movType = form.type
            movQty  = qty
          }

          const created = await createMovement({
            productId:          product.id,
            type:               movType,
            quantity:           movQty,
            purchasePriceCents: form.purchasePriceCents,
            costPriceCents:     form.costPriceCents,
            salePriceCents:     form.salePriceCents,
            notes:              form.notes,
            movedAt:            movedAtISO,
            depot:              form.depot || undefined,
            origin:             form.type === 'balanco' ? 'balanco' : 'manual',
          })
          startRecalc(() => {
            setMovements(prev => [created, ...prev])
            const delta = movType === 'entrada' ? movQty : -movQty
            setProduct(p => ({ ...p, stock_qty: Math.max(0, p.stock_qty + delta) }))
          })
          closeModal()
        } catch (e) {
          setModalError(e instanceof Error ? e.message : 'Erro ao salvar.')
        }
      })
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────

  function handleDelete() {
    if (!deleteTarget) return
    startDel(async () => {
      try {
        const { newStockQty } = await deleteMovement(deleteTarget.id)
        startRecalc(() => {
          setMovements(prev => prev.filter(m => m.id !== deleteTarget!.id))
          setProduct(p => ({ ...p, stock_qty: newStockQty }))
        })
        setDeleteTarget(null)
      } catch { /* silencioso — erro raro */ }
    })
  }

  // ── Reconciliar vendas antigas ──────────────────────────────────────────

  async function handleReconcile() {
    setReconciling(true)
    try {
      const { created } = await reconcileProductSales(product.id)
      if (created > 0) {
        // Refresh via server
        router.refresh()
      }
      alert(created > 0
        ? `${created} venda(s) antiga(s) foram sincronizadas no histórico.`
        : 'Nenhuma venda pendente encontrada. A divergência pode ter outra causa — use "Incluir Lançamento" para ajustar manualmente.')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro ao reconciliar')
    } finally {
      setReconciling(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const stockColor = product.stock_qty <= 0
    ? '#EF4444'
    : product.stock_min > 0 && product.stock_qty <= product.stock_min
      ? '#F59E0B'
      : '#10B981'

  return (
    <div className="space-y-5">

      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => router.push('/estoque')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors hover:bg-white/5"
            style={{ borderColor: '#2A3650' }}
            title="Voltar ao Estoque"
          >
            <ArrowLeft className="h-4 w-4 text-muted" />
          </button>

          {/* Imagem + info do produto */}
          <div className="flex items-center gap-3 min-w-0">
            {product.image_urls?.[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={product.image_urls[0]} alt={product.name}
                className="h-12 w-12 shrink-0 rounded-xl object-cover"
                style={{ border: '1px solid #2A3650' }}
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                style={{ background: '#2A3650' }}>
                <Package className="h-5 w-5 text-muted" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-text truncate">{product.name}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                {product.code && (
                  <span className="text-xs font-mono text-muted">{product.code}</span>
                )}
                {product.code && <span className="text-muted text-xs">·</span>}
                <span className="text-xs text-muted">Saldo atual:</span>
                <span className="text-sm font-bold" style={{ color: stockColor }}>
                  {product.stock_qty} {product.unit}
                </span>
                {recalcing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={openAdd}
          className="flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          style={{ background: '#10B981' }}
        >
          <Plus className="h-4 w-4" />
          Incluir Lançamento
        </button>
      </div>

      {/* ── Aviso de divergência ────────────────────────────────────────────── */}
      {diverges && (
        <div
          className="flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-start"
          style={{ background: '#F59E0B12', borderColor: '#F59E0B40', color: '#F59E0B' }}
        >
          <div className="flex items-start gap-2 flex-1">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Saldo calculado pelas movimentações ({computedTotal} {product.unit}) difere do saldo atual
              do produto ({product.stock_qty} {product.unit}). Pode ser venda antiga que não gerou
              registro de saída — clique em <strong>Reconciliar vendas antigas</strong> para criar
              automaticamente os registros faltantes.
            </span>
          </div>
          <button
            onClick={handleReconcile}
            disabled={reconciling}
            className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: '#F59E0B', color: '#000' }}
          >
            {reconciling ? 'Reconciliando…' : 'Reconciliar vendas antigas'}
          </button>
        </div>
      )}

      {/* ── Totalizadores (estilo Bling) ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2 mb-2">
            <ArrowDownCircle className="h-3.5 w-3.5" style={{ color: '#10B981' }} />
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
              Entradas
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color: '#10B981' }}>
              {totals.entradasQty.toFixed(2).replace('.', ',')}
            </span>
            <span className="text-xs text-muted">({BRL(totals.entradasCents)})</span>
          </div>
        </div>

        <div className="rounded-xl border p-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpCircle className="h-3.5 w-3.5" style={{ color: '#EF4444' }} />
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
              Saídas
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color: '#EF4444' }}>
              {totals.saidasQty.toFixed(2).replace('.', ',')}
            </span>
            <span className="text-xs text-muted">({BRL(totals.saidasCents)})</span>
          </div>
        </div>

        <div className="rounded-xl border p-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2 mb-2">
            <Package className="h-3.5 w-3.5" style={{ color: stockColor }} />
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
              Saldo Atual
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums" style={{ color: stockColor }}>
              {product.stock_qty}
            </span>
            <span className="text-xs text-muted">{product.unit}</span>
          </div>
        </div>
      </div>

      {/* ── Tabela ──────────────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ background: '#1B2638', borderColor: '#2A3650' }}
      >
        {/* Título da tabela */}
        <div
          className="flex items-center justify-between border-b px-5 py-3.5"
          style={{ borderColor: '#2A3650' }}
        >
          <h2 className="text-sm font-semibold text-text">Histórico de Movimentações</h2>
          <span className="text-xs text-muted">{rows.length} {rows.length === 1 ? 'lançamento' : 'lançamentos'}</span>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <CalendarClock className="h-10 w-10" style={{ color: '#64748B' }} />
            <p className="text-sm text-muted">Nenhuma movimentação registrada</p>
            <button
              onClick={openAdd}
              className="mt-1 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black"
              style={{ background: '#10B981' }}
            >
              <Plus className="h-4 w-4" /> Incluir primeiro lançamento
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Header */}
            <div
              className="grid items-center gap-3 border-b px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted"
              style={{
                borderColor: '#2A3650',
                gridTemplateColumns: '150px 85px 85px 110px 110px 110px 90px 1fr 110px 72px',
                minWidth: '1200px',
              }}
            >
              <span>Data / Hora</span>
              <span className="text-right">Entrada</span>
              <span className="text-right">Saída</span>
              <span className="text-right">Pr. Venda</span>
              <span className="text-right">Pr. Compra</span>
              <span className="text-right">Pr. Custo</span>
              <span className="text-right">Saldo</span>
              <span>Observação</span>
              <span>Origem</span>
              <span />
            </div>

            {/* Rows */}
            {rows.map(m => {
              const isBalanco = m.origin === 'balanco'
              const isEntrada = m.type === 'entrada'
              const typeColor = isBalanco ? '#F59E0B' : isEntrada ? '#10B981' : '#EF4444'
              const originLabel = (() => {
                const o = m.origin
                if (!o || o === 'manual') return 'Manual'
                if (o === 'balanco')                     return 'Balanço'
                if (o.startsWith('sale:'))               return 'Venda PDV'
                if (o.startsWith('sale-cancel:'))        return 'Venda cancelada'
                if (o.startsWith('sale-reactivate:'))    return 'Venda reativada'
                if (o.startsWith('sale-date-revert:'))   return 'Ajuste de data'
                if (o.startsWith('sale-date-redo:'))     return 'Ajuste de data'
                return o
              })()

              return (
                <div
                  key={m.id}
                  className="grid items-center gap-3 border-b px-5 py-3.5 transition-colors hover:bg-white/[0.025] last:border-0"
                  style={{
                    borderColor: '#2A3650',
                    gridTemplateColumns: '150px 85px 85px 110px 110px 110px 90px 1fr 110px 72px',
                    minWidth: '1200px',
                    borderLeft: `3px solid ${typeColor}20`,
                  }}
                >
                  {/* Data/Hora */}
                  <span className="text-sm text-text font-mono tabular-nums">
                    {fmtDatetime(m.moved_at)}
                  </span>

                  {/* Entrada (qty se for entrada) */}
                  <span className="text-sm font-bold text-right tabular-nums"
                    style={{ color: isEntrada && !isBalanco ? '#10B981' : '#94A3B8' }}>
                    {isEntrada && !isBalanco ? m.quantity : '—'}
                  </span>

                  {/* Saída (qty se for saída) */}
                  <span className="text-sm font-bold text-right tabular-nums"
                    style={{ color: !isEntrada && !isBalanco ? '#EF4444' : isBalanco ? '#F59E0B' : '#94A3B8' }}>
                    {isBalanco ? `${m.quantity} (bal.)` : !isEntrada ? m.quantity : '—'}
                  </span>

                  {/* Pr. Venda (só em saída) */}
                  <span className="text-xs text-right tabular-nums"
                    style={{ color: !isEntrada && m.sale_price_cents ? '#F8FAFC' : '#94A3B8' }}>
                    {!isEntrada && m.sale_price_cents ? BRL(m.sale_price_cents) : '—'}
                  </span>

                  {/* Pr. Compra (só em entrada) */}
                  <span className="text-xs text-right tabular-nums"
                    style={{ color: isEntrada && m.purchase_price_cents ? '#F8FAFC' : '#94A3B8' }}>
                    {isEntrada && m.purchase_price_cents ? BRL(m.purchase_price_cents) : '—'}
                  </span>

                  {/* Pr. Custo (só em entrada) */}
                  <span className="text-xs text-right tabular-nums"
                    style={{ color: isEntrada && m.cost_price_cents ? '#F8FAFC' : '#94A3B8' }}>
                    {isEntrada && m.cost_price_cents ? BRL(m.cost_price_cents) : '—'}
                  </span>

                  {/* Saldo acumulado */}
                  <span className="text-sm font-semibold text-right tabular-nums text-text">
                    {recalcing
                      ? <span className="inline-block h-4 w-10 animate-pulse rounded" style={{ background: '#2A3650' }} />
                      : `${m.running_balance} ${product.unit}`}
                  </span>

                  {/* Observação */}
                  <span className="text-xs text-muted truncate" title={m.notes ?? ''}>
                    {m.notes || <span className="text-muted/40">—</span>}
                  </span>

                  {/* Origem */}
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold text-center truncate"
                    style={{ background: `${typeColor}15`, color: typeColor, border: `1px solid ${typeColor}30` }}
                    title={m.origin ?? 'manual'}
                  >
                    {originLabel}
                  </span>

                  {/* Ações */}
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => openEdit(m)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-white hover:bg-white/10 transition-colors"
                      title="Editar lançamento"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(m)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Excluir lançamento"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal novo/editar ────────────────────────────────────────────────── */}
      {modalOpen && (
        <MovimentoModal
          form={form}
          onChange={patchForm}
          onSave={handleSave}
          onClose={closeModal}
          saving={saving}
          error={modalError}
          isEdit={!!editTarget}
          currentStock={product.stock_qty}
          unit={product.unit}
          productPriceCents={product.price_cents}
        />
      )}

      {/* ── Modal confirmar exclusão ─────────────────────────────────────────── */}
      {deleteTarget && (
        <DeleteConfirm
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}
    </div>
  )
}
