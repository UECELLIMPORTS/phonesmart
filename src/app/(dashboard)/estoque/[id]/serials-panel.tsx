'use client'

import { useState, useTransition, useMemo } from 'react'
import {
  Plus, Pencil, Trash2, Loader2, X, Smartphone, Search,
  CheckCircle2, ShoppingCart, RotateCcw, AlertTriangle, Printer, History,
} from 'lucide-react'
import {
  addSerials, updateSerial, deleteSerial,
  type ProductSerial,
} from '@/actions/product-serials'

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | ProductSerial['status']

type AddForm = {
  serialsText: string
  costStr:     string
  notes:       string
}

type EditForm = {
  id:        string
  serial:    string
  serial2:   string
  status:    ProductSerial['status']
  costStr:   string
  notes:     string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRL = (c: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((c ?? 0) / 100)

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function parseBRLToCents(s: string): number | null {
  const cleaned = s.replace(/\s/g, '').replace(/[R$]/g, '').trim()
  if (!cleaned) return null
  // aceita "1234.56", "1234,56", "1.234,56"
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  const v = Number(normalized)
  if (!Number.isFinite(v) || v < 0) return null
  return Math.round(v * 100)
}

function parseSerialsList(text: string): string[] {
  return text
    .split(/[\n,;\s]+/)
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length >= 4 && s.length <= 50)
}

const STATUS_LABEL: Record<ProductSerial['status'], string> = {
  available: 'Disponível',
  sold:      'Vendido',
  returned:  'Devolvido',
  defective: 'Defeito',
}

const STATUS_BADGE: Record<ProductSerial['status'], string> = {
  available: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  sold:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
  returned:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  defective: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
}

const STATUS_ICON = {
  available: CheckCircle2,
  sold:      ShoppingCart,
  returned:  RotateCcw,
  defective: AlertTriangle,
} as const

// ── Component ─────────────────────────────────────────────────────────────────

export function SerialsPanel({
  productId,
  productName,
  initialSerials,
  defaultCostCents,
}: {
  productId:        string
  productName:      string
  initialSerials:   ProductSerial[]
  defaultCostCents: number
}) {
  const [serials, setSerials] = useState<ProductSerial[]>(initialSerials)
  const [filter, setFilter]   = useState<StatusFilter>('all')
  const [search, setSearch]   = useState('')

  const [addOpen, setAddOpen]   = useState(false)
  const [editing, setEditing]   = useState<EditForm | null>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError]       = useState<string | null>(null)
  const [info, setInfo]         = useState<string | null>(null)

  const counts = useMemo(() => {
    const c = { all: serials.length, available: 0, sold: 0, returned: 0, defective: 0 }
    for (const s of serials) c[s.status]++
    return c
  }, [serials])

  const visible = useMemo(() => {
    const q = search.trim().toUpperCase()
    return serials.filter(s => {
      if (filter !== 'all' && s.status !== filter) return false
      if (q && !s.serial.includes(q) && !(s.serial2 ?? '').includes(q)) return false
      return true
    })
  }, [serials, filter, search])

  // ── Add ──────────────────────────────────────────────────────────────────────

  const [addForm, setAddForm] = useState<AddForm>({
    serialsText: '',
    costStr:     (defaultCostCents / 100).toFixed(2).replace('.', ','),
    notes:       '',
  })

  function openAdd() {
    setAddForm({
      serialsText: '',
      costStr:     (defaultCostCents / 100).toFixed(2).replace('.', ','),
      notes:       '',
    })
    setError(null)
    setInfo(null)
    setAddOpen(true)
  }

  function submitAdd() {
    setError(null)
    setInfo(null)

    const list = parseSerialsList(addForm.serialsText)
    if (list.length === 0) {
      setError('Informe ao menos um IMEI/Serial (mínimo 4 caracteres).')
      return
    }
    if (list.length > 200) {
      setError('Máximo 200 IMEIs por vez.')
      return
    }

    const costCents = addForm.costStr.trim() ? parseBRLToCents(addForm.costStr) : null
    if (addForm.costStr.trim() && costCents === null) {
      setError('Custo inválido.')
      return
    }

    startTransition(async () => {
      const res = await addSerials({
        productId,
        serials:   list,
        costCents,
        notes:     addForm.notes.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      const { added, duplicates } = res.data!
      setInfo(
        duplicates.length > 0
          ? `${added} IMEI(s) adicionado(s). ${duplicates.length} duplicado(s) ignorado(s): ${duplicates.slice(0, 3).join(', ')}${duplicates.length > 3 ? '…' : ''}`
          : `${added} IMEI(s) adicionado(s).`,
      )
      setAddOpen(false)
      // Otimista: recarrega via fetch da action (server) — usa revalidatePath
      window.location.reload()
    })
  }

  // ── Edit ─────────────────────────────────────────────────────────────────────

  function openEdit(s: ProductSerial) {
    setEditing({
      id:      s.id,
      serial:  s.serial,
      serial2: s.serial2 ?? '',
      status:  s.status,
      costStr: s.costCents != null ? (s.costCents / 100).toFixed(2).replace('.', ',') : '',
      notes:   s.notes ?? '',
    })
    setError(null)
    setInfo(null)
  }

  function submitEdit() {
    if (!editing) return
    setError(null)

    const costCents = editing.costStr.trim() ? parseBRLToCents(editing.costStr) : null
    if (editing.costStr.trim() && costCents === null) {
      setError('Custo inválido.')
      return
    }

    startTransition(async () => {
      const res = await updateSerial({
        id:        editing.id,
        serial:    editing.serial.trim(),
        serial2:   editing.serial2.trim() || null,
        status:    editing.status,
        costCents,
        notes:     editing.notes.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEditing(null)
      window.location.reload()
    })
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  function handleDelete(s: ProductSerial) {
    if (s.status === 'sold') {
      setError('Não dá pra apagar IMEI vendido. Mude o status pra "devolvido".')
      return
    }
    const ok = window.confirm(`Apagar IMEI ${s.serial}?`)
    if (!ok) return

    startTransition(async () => {
      const res = await deleteSerial(s.id)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setSerials(prev => prev.filter(x => x.id !== s.id))
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <section className="rounded-2xl bg-card shadow-sm ring-1 ring-zinc-800/60 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-700/60 bg-gradient-to-r from-blue-500/10 to-card px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-500 p-2 text-white">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-text">IMEIs / Seriais</h2>
            <p className="text-xs text-muted">{productName}</p>
          </div>
        </div>
        <button
          onClick={openAdd}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Adicionar IMEIs
        </button>
      </div>

      {/* Feedback */}
      {(error || info) && (
        <div className={`mx-5 mt-4 rounded-lg border px-3 py-2 text-sm ${
          error ? 'border-rose-500/30 bg-rose-500/10 text-rose-400' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
        }`}>
          {error || info}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-700/60 px-5 py-3">
        {(['all', 'available', 'sold', 'returned', 'defective'] as StatusFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              filter === f
                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                : 'border-zinc-700/60 text-muted hover:border-zinc-300'
            }`}
          >
            {f === 'all' ? 'Todos' : STATUS_LABEL[f]}
            <span className="ml-1.5 text-muted/70">{counts[f]}</span>
          </button>
        ))}
        <div className="ml-auto relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted/70" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar IMEI…"
            className="w-56 rounded-lg border border-zinc-700/60 bg-card py-1.5 pl-8 pr-3 text-sm placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted">
          {serials.length === 0
            ? 'Nenhum IMEI cadastrado ainda. Clique em "Adicionar IMEIs" pra começar.'
            : 'Nenhum IMEI corresponde aos filtros.'}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-800/60">
          {visible.map(s => {
            const Icon = STATUS_ICON[s.status]
            return (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-800/40">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-text">{s.serial}</span>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[s.status]}`}>
                      <Icon className="h-3 w-3" />
                      {STATUS_LABEL[s.status]}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                    {s.serial2 && <span>2º: <span className="font-mono">{s.serial2}</span></span>}
                    <span>Custo: {BRL(s.costCents)}</span>
                    {s.soldAt && <span>Vendido em {fmtDate(s.soldAt)}</span>}
                    {s.notes && <span className="truncate max-w-[20rem]">📝 {s.notes}</span>}
                  </div>
                </div>
                <a
                  href={`/imei/${encodeURIComponent(s.serial)}`}
                  className="rounded-lg p-2 text-muted hover:bg-blue-500/150/10 hover:text-blue-400"
                  title="Histórico do IMEI"
                >
                  <History className="h-4 w-4" />
                </a>
                <a
                  href={`/etiquetas/${s.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg p-2 text-muted hover:bg-blue-500/150/10 hover:text-blue-400"
                  title="Imprimir etiqueta"
                >
                  <Printer className="h-4 w-4" />
                </a>
                <button
                  onClick={() => openEdit(s)}
                  disabled={pending}
                  className="rounded-lg p-2 text-muted hover:bg-zinc-800/60 hover:text-text disabled:opacity-50"
                  title="Editar"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDelete(s)}
                  disabled={pending || s.status === 'sold'}
                  className="rounded-lg p-2 text-muted hover:bg-rose-500/150/10 hover:text-rose-400 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                  title={s.status === 'sold' ? 'IMEI vendido — não pode apagar' : 'Apagar'}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Add Modal */}
      {addOpen && (
        <Modal title="Adicionar IMEIs" onClose={() => setAddOpen(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-text/90">
                IMEIs / Seriais <span className="text-muted/70">(um por linha, ou separados por vírgula/espaço)</span>
              </label>
              <textarea
                value={addForm.serialsText}
                onChange={e => setAddForm(f => ({ ...f, serialsText: e.target.value }))}
                rows={8}
                placeholder="356938035643809&#10;356938035643810&#10;356938035643811"
                className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted">
                {parseSerialsList(addForm.serialsText).length} IMEI(s) válido(s) detectado(s).
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-text/90">
                  Custo unitário (R$) <span className="text-muted/70">opcional</span>
                </label>
                <input
                  value={addForm.costStr}
                  onChange={e => setAddForm(f => ({ ...f, costStr: e.target.value }))}
                  placeholder="1500,00"
                  className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-text/90">
                  Observação <span className="text-muted/70">opcional</span>
                </label>
                <input
                  value={addForm.notes}
                  onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Ex: Lote NF 1234"
                  className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setAddOpen(false)}
              disabled={pending}
              className="rounded-lg border border-zinc-700/60 px-4 py-2 text-sm font-medium text-text/90 hover:bg-zinc-800/40 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={submitAdd}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Adicionar
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editing && (
        <Modal title="Editar IMEI" onClose={() => setEditing(null)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-text/90">IMEI / Serial principal</label>
              <input
                value={editing.serial}
                onChange={e => setEditing(s => s ? { ...s, serial: e.target.value } : s)}
                className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-text/90">
                IMEI 2 <span className="text-muted/70">opcional (dual-SIM)</span>
              </label>
              <input
                value={editing.serial2}
                onChange={e => setEditing(s => s ? { ...s, serial2: e.target.value } : s)}
                className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-text/90">Status</label>
                <select
                  value={editing.status}
                  onChange={e => setEditing(s => s ? { ...s, status: e.target.value as ProductSerial['status'] } : s)}
                  className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="available">Disponível</option>
                  <option value="sold">Vendido</option>
                  <option value="returned">Devolvido</option>
                  <option value="defective">Defeito</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-text/90">Custo (R$)</label>
                <input
                  value={editing.costStr}
                  onChange={e => setEditing(s => s ? { ...s, costStr: e.target.value } : s)}
                  placeholder="1500,00"
                  className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-text/90">Observação</label>
              <input
                value={editing.notes}
                onChange={e => setEditing(s => s ? { ...s, notes: e.target.value } : s)}
                className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              disabled={pending}
              className="rounded-lg border border-zinc-700/60 px-4 py-2 text-sm font-medium text-text/90 hover:bg-zinc-800/40 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={submitEdit}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Salvar
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}

// ── Modal helper ──────────────────────────────────────────────────────────────

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-700/60 px-5 py-3">
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-zinc-800/60 hover:text-text">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}
