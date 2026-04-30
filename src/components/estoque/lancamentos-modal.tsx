'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  X, Plus, Loader2,
  Trash2, AlertTriangle, TrendingUp, TrendingDown, Package,
} from 'lucide-react'
import {
  listMovements, getStockSummary, createMovement, deleteMovement,
  type StockMovementRow, type StockSummary, type MovementType,
} from '@/actions/stock-movements'
import type { ProductRow } from '@/actions/products'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const fmtBRL = (cents: number) => (cents / 100).toFixed(2).replace('.', ',')

const parseBRL = (v: string) => {
  const digits = v.replace(/\D/g, '')
  return parseInt(digits || '0', 10)
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

const INP = 'w-full rounded-lg border bg-transparent px-3 py-2 text-sm text-white placeholder:text-[#94A3B8] focus:outline-none focus:ring-1 focus:ring-[#10B981]'
const INP_S = { borderColor: '#2A3650' }

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  product: ProductRow
  onClose: () => void
  onStockChanged: (productId: string, newQty: number, newCostCents: number, newPurchaseCents: number) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LancamentosModal({ product, onClose, onStockChanged }: Props) {
  const [movements, setMovements] = useState<StockMovementRow[]>([])
  const [summary, setSummary]     = useState<StockSummary | null>(null)
  const [loaded, setLoaded]       = useState(false)
  const [novoOpen, setNovoOpen]   = useState(false)
  const [error, setError]         = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const [saving, startSave]   = useTransition()
  const [deleting, startDel]  = useTransition()
  const [loading, startLoad]  = useTransition()

  // Form state
  const [tipo, setTipo]               = useState<MovementType>('entrada')
  const [quantidade, setQuantidade]   = useState('')
  const [precoCompra, setPrecoCompra] = useState(0)
  const [precoCusto, setPrecoCusto]   = useState(0)
  const [precoVenda, setPrecoVenda]   = useState(product.price_cents)
  const [observacao, setObservacao]   = useState('')

  // Carrega lançamentos ao abrir o modal
  useEffect(() => {
    startLoad(async () => {
      const [movs, sum] = await Promise.all([
        listMovements(product.id),
        getStockSummary(product.id),
      ])
      setMovements(movs)
      setSummary(sum)
      setLoaded(true)
    })
  }, [product.id])

  function resetForm() {
    setTipo('entrada')
    setQuantidade('')
    setPrecoCompra(0)
    setPrecoCusto(0)
    setPrecoVenda(product.price_cents)
    setObservacao('')
    setError('')
  }

  function handleSave() {
    setError('')
    const qty = parseFloat(quantidade.replace(',', '.')) || 0
    if (qty <= 0) { setError('Informe uma quantidade válida.'); return }
    if (tipo === 'entrada' && precoCompra <= 0) { setError('Preço de compra é obrigatório.'); return }

    startSave(async () => {
      try {
        const mov = await createMovement({
          productId:         product.id,
          type:              tipo,
          quantity:          qty,
          purchasePriceCents: precoCompra,
          costPriceCents:    precoCusto,
          salePriceCents:    precoVenda,
          notes:             observacao,
        })
        setMovements(ms => [mov, ...ms])

        // Atualiza resumo e notifica pai
        const newSum = await getStockSummary(product.id)
        setSummary(newSum)

        const delta = tipo === 'entrada' ? qty : -qty
        const newQty = Math.max(0, product.stock_qty + delta)
        onStockChanged(
          product.id,
          newQty,
          tipo === 'entrada' && precoCusto > 0 ? precoCusto : product.cost_cents,
          tipo === 'entrada' && precoCompra > 0 ? precoCompra : product.purchase_price_cents,
        )

        setNovoOpen(false)
        resetForm()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar lançamento.')
      }
    })
  }

  function handleDelete(id: string) {
    startDel(async () => {
      try {
        await deleteMovement(id)
        setMovements(ms => ms.filter(m => m.id !== id))
        const newSum = await getStockSummary(product.id)
        setSummary(newSum)
        setDeleteTarget(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao excluir.')
      }
    })
  }

  function PriceField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
      <div>
        <label className="mb-1 block text-xs font-medium text-[#94A3B8]">{label}</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#94A3B8]">R$</span>
          <input
            type="text"
            inputMode="numeric"
            value={fmtBRL(value)}
            onChange={e => onChange(parseBRL(e.target.value))}
            className={INP}
            style={{ ...INP_S, paddingLeft: '2.25rem' }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="relative w-full max-w-4xl rounded-2xl border my-8" style={{ background: '#131C2A', borderColor: '#2A3650' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <div>
            <h2 className="text-base font-semibold text-white">Lançamentos de Estoque</h2>
            <p className="text-xs text-[#94A3B8] mt-0.5">{product.name} · Unidade: {product.unit}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setNovoOpen(true); resetForm() }}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black"
              style={{ background: '#10B981' }}
            >
              <Plus className="h-4 w-4" />
              Incluir Lançamento
            </button>
            <button onClick={onClose} className="text-[#94A3B8] hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex gap-0">
          {/* Tabela de lançamentos */}
          <div className="flex-1 min-w-0">
            {/* Cabeçalho da tabela */}
            <div
              className="grid gap-3 px-5 py-3 text-xs font-medium uppercase tracking-wider text-[#94A3B8] border-b"
              style={{ borderColor: '#2A3650', gridTemplateColumns: '140px 70px 70px 130px 130px 130px 1fr 40px' }}
            >
              <span>Data</span>
              <span className="text-center">Entrada</span>
              <span className="text-center">Saída</span>
              <span className="text-right">Pr. Venda</span>
              <span className="text-right">Pr. Compra</span>
              <span className="text-right">Pr. Custo</span>
              <span>Observação</span>
              <span />
            </div>

            {/* Linhas */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-[#94A3B8]" />
              </div>
            ) : movements.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16">
                <Package className="h-10 w-10 text-[#2A3650]" />
                <p className="text-sm text-[#94A3B8]">Nenhum lançamento registrado</p>
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto divide-y divide-[#2A3650]">
                {movements.map(m => (
                  <div
                    key={m.id}
                    className="grid gap-3 px-5 py-3 items-center text-sm hover:bg-white/[0.02] transition-colors"
                    style={{ gridTemplateColumns: '140px 70px 70px 130px 130px 130px 1fr 40px' }}
                  >
                    <span className="text-xs text-[#94A3B8]">{fmtDate(m.created_at)}</span>

                    <span className="text-center font-semibold" style={{ color: m.type === 'entrada' ? '#10B981' : 'transparent' }}>
                      {m.type === 'entrada' ? m.quantity.toString().replace('.', ',') : '-'}
                    </span>
                    <span className="text-center font-semibold" style={{ color: m.type === 'saida' ? '#EF4444' : 'transparent' }}>
                      {m.type === 'saida' ? m.quantity.toString().replace('.', ',') : '-'}
                    </span>

                    <span className="text-right text-white">
                      {m.sale_price_cents > 0 ? BRL(m.sale_price_cents) : '-'}
                    </span>
                    <span className="text-right text-[#94A3B8]">
                      {m.purchase_price_cents > 0 ? BRL(m.purchase_price_cents) : '-'}
                    </span>
                    <span className="text-right text-[#94A3B8]">
                      {m.cost_price_cents > 0 ? BRL(m.cost_price_cents) : '-'}
                    </span>

                    <span className="text-xs text-[#94A3B8] truncate">{m.notes ?? ''}</span>

                    <button
                      onClick={() => setDeleteTarget(m.id)}
                      className="flex justify-center text-[#2A3650] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Painel lateral de resumo */}
          <div className="w-56 shrink-0 border-l p-5 space-y-4" style={{ borderColor: '#2A3650' }}>

            {/* Entradas */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4" style={{ color: '#10B981' }} />
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#10B981' }}>Entradas</p>
              </div>
              <p className="text-xl font-bold text-white">
                {summary ? summary.total_entrada.toString().replace('.', ',') : '—'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#10B981' }}>
                {summary && summary.avg_purchase_price_cents > 0
                  ? BRL(Math.round(summary.total_entrada * summary.avg_purchase_price_cents))
                  : 'R$ 0,00'}
              </p>
            </div>

            {/* Saídas */}
            <div className="border-t pt-4" style={{ borderColor: '#2A3650' }}>
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="h-4 w-4 text-red-400" />
                <p className="text-xs font-semibold uppercase tracking-wider text-red-400">Saídas</p>
              </div>
              <p className="text-xl font-bold text-white">
                {summary ? summary.total_saida.toString().replace('.', ',') : '—'}
              </p>
              <p className="text-xs text-red-400 mt-0.5">
                {summary && summary.avg_sale_price_cents > 0
                  ? BRL(Math.round(summary.total_saida * summary.avg_sale_price_cents))
                  : 'R$ 0,00'}
              </p>
            </div>

            {/* Saldo atual */}
            <div className="border-t pt-4" style={{ borderColor: '#2A3650' }}>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">Saldo atual</p>
              <p
                className="text-2xl font-bold"
                style={{ color: product.stock_qty <= 0 ? '#EF4444' : '#10B981' }}
              >
                {product.stock_qty}
              </p>
              <p className="text-xs text-[#94A3B8]">{product.unit}</p>
            </div>

            {/* Saldos por depósito */}
            <div className="border-t pt-4 overflow-x-auto" style={{ borderColor: '#2A3650' }}>
              <p className="text-xs font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Saldos por depósito</p>
              <table className="w-full text-xs min-w-[320px]">
                <thead>
                  <tr className="text-[#CBD5E1]">
                    <th className="text-left font-medium pb-1">Depósito</th>
                    <th className="text-right font-medium pb-1">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="text-[#64748B] py-0.5">
                      {product.location ? product.location : 'Padrão'}
                    </td>
                    <td
                      className="text-right font-semibold py-0.5"
                      style={{ color: product.stock_qty <= 0 ? '#EF4444' : '#10B981' }}
                    >
                      {product.stock_qty}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ── Modal Novo Lançamento ─────────────────────────────────────────── */}
        {novoOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl" style={{ background: 'rgba(0,0,0,0.7)' }}>
            <div className="w-full max-w-md rounded-2xl border p-6 space-y-5" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Novo Lançamento</h3>
                <button onClick={() => setNovoOpen(false)} className="text-[#94A3B8] hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: '#EF444418', color: '#EF4444', border: '1px solid #EF444440' }}>
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              {/* Tipo */}
              <div>
                <label className="mb-1 block text-xs font-medium text-[#94A3B8]">Tipo *</label>
                <div className="relative">
                  <select
                    value={tipo}
                    onChange={e => setTipo(e.target.value as MovementType)}
                    className="w-full appearance-none rounded-lg border bg-[#131C2A] px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-1"
                    style={{
                      borderColor: tipo === 'entrada' ? '#10B981' : '#EF4444',
                      color: tipo === 'entrada' ? '#10B981' : '#EF4444',
                    }}
                  >
                    <option value="entrada" style={{ color: '#10B981', background: '#131C2A' }}>↓ Entrada</option>
                    <option value="saida"   style={{ color: '#EF4444', background: '#131C2A' }}>↑ Saída</option>
                  </select>
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8]">▾</span>
                </div>
              </div>

              {/* Quantidade */}
              <div>
                <label className="mb-1 block text-xs font-medium text-[#94A3B8]">Quantidade *</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={quantidade}
                  onChange={e => setQuantidade(e.target.value)}
                  placeholder="Ex: 1 ou 1,5"
                  className={INP}
                  style={INP_S}
                  autoFocus
                />
              </div>

              {/* Preços conforme o tipo */}
              {tipo === 'entrada' ? (
                <div className="grid grid-cols-2 gap-3">
                  <PriceField label="Preço de Compra *" value={precoCompra} onChange={setPrecoCompra} />
                  <PriceField label="Preço de Custo"    value={precoCusto}  onChange={setPrecoCusto}  />
                </div>
              ) : (
                <PriceField label="Preço de Venda" value={precoVenda} onChange={setPrecoVenda} />
              )}

              {/* Observação */}
              <div>
                <label className="mb-1 block text-xs font-medium text-[#94A3B8]">Observação</label>
                <input
                  type="text"
                  value={observacao}
                  onChange={e => setObservacao(e.target.value)}
                  placeholder="Ex: Felipe que deu entrada"
                  className={INP}
                  style={INP_S}
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setNovoOpen(false)}
                  className="flex-1 rounded-lg border py-2.5 text-sm text-[#94A3B8] hover:text-white transition-colors"
                  style={{ borderColor: '#2A3650' }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-black disabled:opacity-50"
                  style={{ background: '#10B981' }}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? 'Salvando…' : 'Incluir'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Confirmar exclusão ─────────────────────────────────────────────── */}
        {deleteTarget && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl" style={{ background: 'rgba(0,0,0,0.7)' }}>
            <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#EF444418' }}>
                <AlertTriangle className="h-6 w-6 text-red-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Excluir lançamento?</h3>
                <p className="mt-1 text-sm text-[#94A3B8]">O estoque do produto <strong className="text-white">não será revertido</strong> automaticamente. Ajuste manualmente se necessário.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-lg border py-2 text-sm text-[#94A3B8] hover:text-white" style={{ borderColor: '#2A3650' }}>
                  Cancelar
                </button>
                <button
                  onClick={() => handleDelete(deleteTarget)}
                  disabled={deleting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white"
                  style={{ background: '#EF4444' }}
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Excluir
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
