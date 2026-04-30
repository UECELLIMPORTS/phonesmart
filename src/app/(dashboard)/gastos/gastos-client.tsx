'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  Wallet, Plus, X, Loader2, Search, Calendar, Trash2, Pencil, Download,
  TrendingDown, Tags, CalendarDays, Receipt,
} from 'lucide-react'
import {
  createVariableExpense, updateVariableExpense, deleteVariableExpense,
  exportVariableExpensesCsv,
  type VariableExpense, type ExpenseAnalytics,
} from '@/actions/variable-expenses'
import {
  VARIABLE_EXPENSE_CATEGORIES, groupedCategories, categoryLabel, categoryColor,
} from '@/lib/variable-expense-categories'

type Period = '7d' | '30d' | '90d' | 'all'

type Props = {
  initialExpenses:  VariableExpense[]
  initialAnalytics: ExpenseAnalytics
  initialPeriod:    Period
  initialCategory:  string
  initialSearch:    string
}

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const parseCents = (v: string) => {
  const n = parseFloat(v.replace(/[^\d,]/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : Math.round(n * 100)
}
const fmtBRL = (c: number) => (c / 100).toFixed(2).replace('.', ',')

const PERIODS: { key: Period; label: string }[] = [
  { key: '7d',  label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: 'all', label: 'Tudo' },
]

const PM_OPTIONS = [
  { value: '',     label: 'Não informar' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'pix',  label: 'PIX' },
  { value: 'card', label: 'Cartão' },
]

const PM_LABEL: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', card: 'Cartão',
}

const INP   = 'w-full rounded-lg border bg-transparent px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent'
const INP_S = { borderColor: '#2A3650' }

// ──────────────────────────────────────────────────────────────────────────
// Página principal
// ──────────────────────────────────────────────────────────────────────────

export function GastosClient({ initialExpenses, initialAnalytics, initialPeriod, initialCategory, initialSearch }: Props) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const [expenses]    = useState(initialExpenses)
  const analytics     = initialAnalytics
  const period        = initialPeriod
  const category      = initialCategory
  const [searchInput, setSearchInput] = useState(initialSearch)

  // Modal de criar/editar
  const [editing, setEditing] = useState<VariableExpense | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  // Modal confirmar exclusão
  const [confirmDelete, setConfirmDelete] = useState<VariableExpense | null>(null)
  const [deleting, startDelete] = useTransition()

  function pushFilters(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v && v !== 'all') params.set(k, v)
      else params.delete(k)
    }
    startTransition(() => router.push(`/gastos${params.toString() ? '?' + params.toString() : ''}`))
  }

  function setPeriod(p: Period)        { pushFilters({ period: p === '30d' ? undefined : p }) }
  function setCategory(c: string)      { pushFilters({ category: c === 'all' ? undefined : c }) }
  function applySearch()               { pushFilters({ search: searchInput.trim() || undefined }) }

  function openNew()                          { setEditing(null);     setFormOpen(true) }
  function openEdit(e: VariableExpense)       { setEditing(e);        setFormOpen(true) }

  async function handleExport() {
    const res = await exportVariableExpensesCsv({
      startISO: getRangeFromPeriod(period).startISO,
      endISO:   getRangeFromPeriod(period).endISO,
      category: category === 'all' ? undefined : category,
      search:   searchInput.trim() || undefined,
    })
    if (res.ok) {
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `gastos-${period}-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('CSV exportado!')
    }
  }

  function handleDelete(exp: VariableExpense) {
    startDelete(async () => {
      const res = await deleteVariableExpense(exp.id)
      if (res.ok) {
        toast.success('Gasto removido.')
        setConfirmDelete(null)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text flex items-center gap-2">
            <Wallet className="h-6 w-6" style={{ color: '#06B6D4' }} />
            Gastos Variáveis
          </h1>
          <p className="mt-1 text-sm text-muted">Despesas pontuais — moto boy, limpeza, brindes, prejuízo, etc.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport}
            className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm text-text"
            style={{ borderColor: '#2A3650' }}>
            <Download className="h-4 w-4" /> Exportar CSV
          </button>
          <button onClick={openNew}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black"
            style={{ background: '#06B6D4' }}>
            <Plus className="h-4 w-4" /> Novo Gasto
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total no período" value={BRL(analytics.totalCents)} icon={TrendingDown} color="#EF4444" subtitle={`${analytics.count} ${analytics.count === 1 ? 'gasto' : 'gastos'}`} />
        <KpiCard label="Média por dia" value={BRL(analytics.avgPerDayCents)} icon={CalendarDays} color="#06B6D4" />
        <KpiCard label="Categoria líder" value={analytics.topCategory?.label ?? '—'} icon={Tags} color="#A78BFA" subtitle={analytics.topCategory ? BRL(analytics.topCategory.cents) : ''} />
        <KpiCard label="Dia que mais gasta" value={analytics.topWeekday?.label ?? '—'} icon={Receipt} color="#F59E0B" subtitle={analytics.topWeekday ? BRL(analytics.topWeekday.cents) : ''} />
      </div>

      {/* Filtros */}
      <div className="rounded-xl border p-4 space-y-3" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-all"
              style={period === p.key
                ? { background: '#06B6D418', borderColor: '#06B6D4', color: '#06B6D4' }
                : { borderColor: '#2A3650', color: '#94A3B8' }}>
              {p.label}
            </button>
          ))}
          <div className="relative ml-auto w-60">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applySearch()}
              onBlur={applySearch}
              placeholder="Buscar descrição…"
              className={INP} style={{ ...INP_S, paddingLeft: '2rem', paddingTop: '0.375rem', paddingBottom: '0.375rem', fontSize: '0.75rem' }}
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); pushFilters({ search: undefined }) }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Chips de categoria */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted mr-1">Categoria:</span>
          <button onClick={() => setCategory('all')}
            className="rounded-full border px-2.5 py-1 text-[11px] font-medium"
            style={category === 'all'
              ? { background: '#94A3B818', borderColor: '#94A3B8', color: '#94A3B8' }
              : { borderColor: '#2A3650', color: '#64748B' }}>
            Todas
          </button>
          {VARIABLE_EXPENSE_CATEGORIES.map(c => {
            const active = category === c.value
            return (
              <button key={c.value} onClick={() => setCategory(c.value)}
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all flex items-center gap-1"
                style={active
                  ? { background: `${c.color}22`, borderColor: c.color, color: c.color }
                  : { borderColor: '#2A3650', color: '#94A3B8' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.color }} />
                {c.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Gráfico: gastos por categoria (barras horizontais) + dia da semana */}
      {analytics.byCategory.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ChartCategorias data={analytics.byCategory} total={analytics.totalCents} />
          <ChartWeekday   data={analytics.byWeekday} />
        </div>
      )}

      {/* Gráfico: evolução diária (linha simples) */}
      {analytics.daily.length > 1 && <ChartDaily daily={analytics.daily} />}

      {/* Tabela */}
      <div className="rounded-xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="border-b px-5 py-4" style={{ borderColor: '#2A3650' }}>
          <h2 className="text-sm font-semibold text-text">Histórico de gastos</h2>
        </div>
        {expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16">
            <Wallet className="h-10 w-10" style={{ color: '#64748B' }} />
            <p className="text-sm text-muted">Nenhum gasto no período</p>
            <button onClick={openNew}
              className="mt-2 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black"
              style={{ background: '#06B6D4' }}>
              <Plus className="h-4 w-4" /> Registrar primeiro gasto
            </button>
          </div>
        ) : (
          <>
            <div className="hidden md:grid gap-4 px-5 py-3 border-b text-xs font-medium uppercase tracking-wider text-muted"
              style={{ borderColor: '#2A3650', gridTemplateColumns: '110px 180px 1fr 120px 120px 80px' }}>
              <span>Data</span><span>Categoria</span><span>Descrição</span>
              <span>Pagamento</span><span className="text-right">Valor</span><span />
            </div>
            {expenses.map(e => {
              const dateBR = new Date(e.occurredAt + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
              const color  = categoryColor(e.category)
              return (
                <div key={e.id} className="border-b last:border-0" style={{ borderColor: '#2A3650' }}>
                  {/* Desktop */}
                  <div className="hidden md:grid gap-4 px-5 py-3 items-center"
                    style={{ gridTemplateColumns: '110px 180px 1fr 120px 120px 80px' }}>
                    <p className="text-xs text-muted">{dateBR}</p>
                    <span className="inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{ background: `${color}1A`, color }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      {e.categoryLabel}
                    </span>
                    <p className="text-sm text-text truncate">{e.description || '—'}</p>
                    <p className="text-xs text-muted">{e.paymentMethod ? PM_LABEL[e.paymentMethod] : '—'}</p>
                    <p className="text-sm font-bold text-right" style={{ color: '#EF4444' }}>{BRL(e.amountCents)}</p>
                    <div className="flex justify-end gap-1">
                      <button onClick={() => openEdit(e)}
                        className="rounded p-1.5 text-muted hover:text-text transition-colors hover:bg-white/5">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setConfirmDelete(e)}
                        className="rounded p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {/* Mobile */}
                  <div className="md:hidden px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold mb-1"
                          style={{ background: `${color}1A`, color }}>
                          <span className="h-1 w-1 rounded-full" style={{ background: color }} />
                          {e.categoryLabel}
                        </span>
                        <p className="text-sm text-text truncate">{e.description || '—'}</p>
                        <p className="text-[11px] text-muted mt-0.5">{dateBR} {e.paymentMethod ? `· ${PM_LABEL[e.paymentMethod]}` : ''}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <p className="text-sm font-bold" style={{ color: '#EF4444' }}>{BRL(e.amountCents)}</p>
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(e)} className="rounded p-1 text-muted hover:text-text">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setConfirmDelete(e)} className="rounded p-1 text-muted hover:text-red-400">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* ── Modal: criar/editar gasto ── */}
      {formOpen && (
        <ExpenseFormModal
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); router.refresh() }}
        />
      )}

      {/* ── Modal: confirmar exclusão ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="w-full max-w-md rounded-xl border p-5" style={{ background: '#1B2638', borderColor: '#2A3650' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-text mb-2">Excluir gasto?</h3>
            <p className="text-sm text-muted mb-4">
              <strong className="text-text">{confirmDelete.categoryLabel}</strong> · {BRL(confirmDelete.amountCents)}
              {confirmDelete.description ? ` — ${confirmDelete.description}` : ''}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}
                className="flex-1 rounded-lg border py-2 text-sm" style={{ borderColor: '#2A3650', color: '#94A3B8' }}>
                Cancelar
              </button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white"
                style={{ background: '#EF4444' }}>
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                {deleting ? 'Excluindo…' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          style={{ background: '#1B2638', borderColor: '#2A3650', color: '#94A3B8' }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Atualizando…
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Modal de formulário (novo/editar)
// ──────────────────────────────────────────────────────────────────────────

function ExpenseFormModal({ initial, onClose, onSaved }: {
  initial:  VariableExpense | null
  onClose:  () => void
  onSaved:  () => void
}) {
  const [date, setDate] = useState(initial?.occurredAt ?? new Date().toISOString().slice(0, 10))
  const [category, setCategory] = useState(initial?.category ?? VARIABLE_EXPENSE_CATEGORIES[0].value)
  const [amountStr, setAmountStr] = useState(initial ? fmtBRL(initial.amountCents) : '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [paymentMethod, setPaymentMethod] = useState(initial?.paymentMethod ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const amountCents = parseCents(amountStr)
    if (amountCents <= 0) { toast.error('Informe um valor válido'); return }
    if (!category) { toast.error('Selecione uma categoria'); return }

    setSaving(true)
    const payload = {
      occurredAt:    date,
      amountCents,
      category,
      description:   description.trim() || null,
      paymentMethod: paymentMethod || null,
    }
    const res = initial
      ? await updateVariableExpense(initial.id, payload)
      : await createVariableExpense(payload)

    if (res.ok) {
      toast.success(initial ? 'Gasto atualizado' : 'Gasto registrado')
      onSaved()
    } else {
      toast.error(res.error)
    }
    setSaving(false)
  }

  const groups = useMemo(() => groupedCategories(), [])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-lg rounded-xl border p-5 max-h-[90vh] overflow-y-auto" style={{ background: '#1B2638', borderColor: '#2A3650' }} onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2">
          <Wallet className="h-5 w-5" style={{ color: '#06B6D4' }} />
          <h3 className="text-base font-semibold text-text">{initial ? 'Editar gasto' : 'Novo gasto'}</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Data *</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Valor (R$) *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span>
              <input type="text" inputMode="numeric" value={amountStr}
                onChange={e => setAmountStr(e.target.value)} placeholder="0,00"
                className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }} />
            </div>
          </div>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-muted">Categoria *</label>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className={INP} style={{ ...INP_S, appearance: 'none' }}>
            {groups.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-muted">Forma de pagamento</label>
          <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
            className={INP} style={{ ...INP_S, appearance: 'none' }}>
            {PM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted">Descrição (opcional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value.slice(0, 500))}
            placeholder="Ex: Entrega Marylia, bairro Atalaia"
            rows={3}
            className={INP} style={INP_S}
          />
          <p className="mt-1 text-right text-[10px] text-muted">{description.length}/500</p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving}
            className="flex-1 rounded-lg border py-2 text-sm" style={{ borderColor: '#2A3650', color: '#94A3B8' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-black"
            style={{ background: '#06B6D4' }}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Salvando…' : initial ? 'Salvar alterações' : 'Registrar gasto'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// KPI Card
// ──────────────────────────────────────────────────────────────────────────

function KpiCard({ label, value, icon: Icon, color, subtitle }: {
  label: string; value: string; icon: React.ElementType; color: string; subtitle?: string
}) {
  return (
    <div className="rounded-xl border p-5" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}18` }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
      </div>
      <p className="text-xl font-bold text-text truncate">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Gráfico de barras horizontais — gastos por categoria
// ──────────────────────────────────────────────────────────────────────────

function ChartCategorias({ data, total }: { data: ExpenseAnalytics['byCategory']; total: number }) {
  const max = Math.max(...data.map(d => d.cents), 1)
  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <h2 className="text-base font-semibold text-text">Gastos por categoria</h2>
        <p className="mt-1 text-xs text-muted">Total: {BRL(total)} · {data.length} {data.length === 1 ? 'categoria' : 'categorias'}</p>
      </div>
      <div className="p-5 space-y-3">
        {data.slice(0, 8).map(c => {
          const pctOfMax = (c.cents / max) * 100
          const color = categoryColor(c.key)
          return (
            <div key={c.key}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-sm text-text truncate">{c.label}</span>
                  <span className="text-[10px] text-muted shrink-0">{c.count}x</span>
                </div>
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-sm font-bold text-text">{BRL(c.cents)}</span>
                  <span className="text-[10px] text-muted">{(c.pct * 100).toFixed(0)}%</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#0F172A' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pctOfMax}%`, background: color }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Gráfico de barras — gastos por dia da semana
// ──────────────────────────────────────────────────────────────────────────

function ChartWeekday({ data }: { data: ExpenseAnalytics['byWeekday'] }) {
  const max = Math.max(...data.map(d => d.cents), 1)
  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <h2 className="text-base font-semibold text-text">Por dia da semana</h2>
        <p className="mt-1 text-xs text-muted">Total acumulado em cada dia da semana no período</p>
      </div>
      <div className="p-5">
        <div className="flex items-end justify-between gap-2 h-40">
          {data.map(d => {
            const h = (d.cents / max) * 100
            return (
              <div key={d.dayIndex} className="flex flex-col items-center gap-1 flex-1">
                <div className="w-full flex flex-col justify-end" style={{ height: '100%' }}>
                  <div className="w-full rounded-t transition-all"
                    style={{ height: `${h}%`, background: 'linear-gradient(180deg, #06B6D4, #0EA5E9)', minHeight: d.cents > 0 ? '4px' : '0' }}
                    title={`${d.label}: ${BRL(d.cents)}`} />
                </div>
                <span className="text-[10px] text-muted">{d.label.slice(0, 3)}</span>
                <span className="text-[10px] font-semibold text-text">{d.cents > 0 ? BRL(d.cents) : '—'}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Gráfico de linha — evolução diária
// ──────────────────────────────────────────────────────────────────────────

function ChartDaily({ daily }: { daily: ExpenseAnalytics['daily'] }) {
  const max = Math.max(...daily.map(d => d.cents), 1)
  const W = 800, H = 160, P = 20
  const xStep = (W - P * 2) / Math.max(daily.length - 1, 1)
  const points = daily.map((d, i) => ({
    x: P + i * xStep,
    y: H - P - (d.cents / max) * (H - P * 2),
    cents: d.cents,
    date: d.date,
  }))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <h2 className="text-base font-semibold text-text">Evolução diária</h2>
        <p className="mt-1 text-xs text-muted">Gasto acumulado a cada dia do período</p>
      </div>
      <div className="p-5 overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40 min-w-[600px]">
          <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="#2A3650" strokeWidth={1} />
          <path d={pathD} stroke="#06B6D4" strokeWidth={2} fill="none" />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={3} fill="#06B6D4">
              <title>{new Date(p.date + 'T12:00:00').toLocaleDateString('pt-BR')} — {BRL(p.cents)}</title>
            </circle>
          ))}
        </svg>
      </div>
    </div>
  )
}

// Helper de range usado no export
function getRangeFromPeriod(period: Period): { startISO?: string; endISO?: string } {
  if (period === 'all') return {}
  const days = period === '7d' ? 6 : period === '30d' ? 29 : 89
  const end   = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)
  return { startISO: start.toISOString().slice(0, 10), endISO: end.toISOString().slice(0, 10) }
}
