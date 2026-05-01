'use client'

import { useState, useTransition, useMemo } from 'react'
import {
  CalendarClock, AlertTriangle, CheckCircle2, MessageCircle,
  Loader2, X, DollarSign, User as UserIcon, Phone,
} from 'lucide-react'
import { toast } from 'sonner'
import { markInstallmentPaid, setRemindersEnabled, type InstallmentRow } from '@/actions/installments'
import { Bell, BellOff } from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRL = (c: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((c ?? 0) / 100)

function fmtDate(iso: string): string {
  // due_date é YYYY-MM-DD — adiciona T12 pra evitar timezone shift
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(iso + 'T12:00:00'))
}

function daysFromToday(iso: string): number {
  const due = new Date(iso + 'T00:00:00').getTime()
  const today = new Date().setHours(0, 0, 0, 0)
  return Math.floor((due - today) / 86400000)
}

function parseBRLToCents(s: string): number {
  const cleaned = s.replace(/\s/g, '').replace(/[R$]/g, '').trim()
  if (!cleaned) return 0
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  const v = Number(normalized)
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : 0
}

function whatsappLink(whatsapp: string | null, customerName: string, amount: number, dueDate: string, instNum: number): string | null {
  if (!whatsapp) return null
  const digits = whatsapp.replace(/\D/g, '')
  if (digits.length < 10) return null
  const phone = digits.startsWith('55') ? digits : '55' + digits
  const msg = encodeURIComponent(
    `Oi ${customerName.split(' ')[0]}, tudo bem? Passando pra lembrar da parcela ${instNum} no valor de ${BRL(amount)} que vence em ${fmtDate(dueDate)}. Posso enviar a chave PIX?`
  )
  return `https://wa.me/${phone}?text=${msg}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ParcelasClient({
  initialInstallments,
  initialRemindersEnabled,
}: {
  initialInstallments:    InstallmentRow[]
  initialRemindersEnabled: boolean
}) {
  const [items, setItems] = useState<InstallmentRow[]>(initialInstallments)
  const [filter, setFilter] = useState<'late' | 'pending' | 'all'>('all')
  const [remindersEnabled, setRemindersEnabledState] = useState(initialRemindersEnabled)
  const [togglingReminders, setTogglingReminders] = useState(false)

  function toggleReminders() {
    const next = !remindersEnabled
    setRemindersEnabledState(next)
    setTogglingReminders(true)
    setRemindersEnabled(next)
      .then(res => {
        if (!res.ok) {
          toast.error(res.error)
          setRemindersEnabledState(!next)
          return
        }
        toast.success(next
          ? 'Lembretes automáticos ATIVADOS. Cron diário (09h) avisa clientes.'
          : 'Lembretes automáticos DESATIVADOS. Cobrança fica só manual.')
      })
      .finally(() => setTogglingReminders(false))
  }

  // Modal de pagamento
  const [paying, setPaying] = useState<InstallmentRow | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<'cash' | 'pix' | 'card' | 'transfer' | 'mixed'>('pix')
  const [payNotes, setPayNotes] = useState('')

  const [pending, startTransition] = useTransition()

  const counts = useMemo(() => ({
    all:     items.length,
    late:    items.filter(i => i.status === 'late').length,
    pending: items.filter(i => i.status === 'pending').length,
  }), [items])

  const totals = useMemo(() => {
    let lateAmount = 0, pendingAmount = 0
    for (const i of items) {
      if (i.status === 'late') lateAmount += i.amountCents
      else if (i.status === 'pending') pendingAmount += i.amountCents
    }
    return { lateAmount, pendingAmount }
  }, [items])

  const visible = useMemo(() => {
    let list = items
    if (filter === 'late')    list = items.filter(i => i.status === 'late')
    if (filter === 'pending') list = items.filter(i => i.status === 'pending')
    return list
  }, [items, filter])

  function openPay(i: InstallmentRow) {
    setPaying(i)
    setPayAmount((i.amountCents / 100).toFixed(2).replace('.', ','))
    setPayMethod('pix')
    setPayNotes('')
  }

  function submitPay() {
    if (!paying) return
    const amount = parseBRLToCents(payAmount)
    if (amount <= 0) {
      toast.error('Valor inválido.')
      return
    }
    startTransition(async () => {
      const res = await markInstallmentPaid({
        id:              paying.id,
        paidAmountCents: amount,
        paymentMethod:   payMethod,
        notes:           payNotes.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Parcela ${paying.installmentNumber}/${paying.totalInstallments} de ${paying.customerName} marcada como paga!`)
      setItems(prev => prev.filter(x => x.id !== paying.id))
      setPaying(null)
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text">Parcelas a receber</h1>
          <p className="mt-1 text-sm text-muted">
            Crediário interno — parcelas pendentes e atrasadas. Cobre via WhatsApp ou marque como pago.
          </p>
        </div>
        <button
          onClick={toggleReminders}
          disabled={togglingReminders}
          className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-semibold transition ${
            remindersEnabled
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
          }`}
          title={remindersEnabled
            ? 'Cron diário (09h) envia email pra clientes com parcelas em D-7/D-3/D-1/D/D+1/D+3'
            : 'Lembretes automáticos desativados — cobrança fica só manual'}
        >
          {remindersEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          Lembretes automáticos: {remindersEnabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            Atrasadas
          </div>
          <p className="mt-1 text-2xl font-bold text-rose-700">{BRL(totals.lateAmount)}</p>
          <p className="text-xs text-rose-600">{counts.late} parcela{counts.late !== 1 ? 's' : ''}</p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
            <CalendarClock className="h-3.5 w-3.5" />
            A vencer
          </div>
          <p className="mt-1 text-2xl font-bold text-blue-700">{BRL(totals.pendingAmount)}</p>
          <p className="text-xs text-blue-600">{counts.pending} parcela{counts.pending !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'late', 'pending'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              filter === f
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
            }`}
          >
            {f === 'all' ? 'Todas' : f === 'late' ? 'Atrasadas' : 'A vencer'}
            <span className="ml-1.5 text-zinc-400">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Lista */}
      <div className="rounded-2xl border bg-white shadow-sm ring-1 ring-zinc-200 overflow-hidden">
        {visible.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-zinc-500">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-300" />
            Nenhuma parcela {filter !== 'all' ? `${filter === 'late' ? 'atrasada' : 'a vencer'}` : 'pendente'}!
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {visible.map(i => {
              const days = daysFromToday(i.dueDate)
              const wa = whatsappLink(i.customerWhatsapp, i.customerName, i.amountCents, i.dueDate, i.installmentNumber)
              return (
                <li key={i.id} className={`px-5 py-4 transition ${
                  i.status === 'late' ? 'bg-rose-50/40 hover:bg-rose-50' : 'hover:bg-zinc-50'
                }`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-zinc-900">{i.customerName}</p>
                        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700">
                          {i.installmentNumber}/{i.totalInstallments}
                        </span>
                        {i.status === 'late' ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[10px] font-medium text-rose-700">
                            <AlertTriangle className="h-3 w-3" />
                            {Math.abs(days)} dia{Math.abs(days) !== 1 ? 's' : ''} atrasada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                            <CalendarClock className="h-3 w-3" />
                            {days === 0 ? 'Vence hoje' : `Vence em ${days} dia${days !== 1 ? 's' : ''}`}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                        <span>Vencimento: {fmtDate(i.dueDate)}</span>
                        {i.customerWhatsapp && (
                          <span><Phone className="inline h-3 w-3 mr-0.5" />{i.customerWhatsapp}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-lg font-bold ${i.status === 'late' ? 'text-rose-600' : 'text-blue-600'}`}>
                        {BRL(i.amountCents)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {wa && (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        Cobrar via WhatsApp
                      </a>
                    )}
                    <button
                      onClick={() => openPay(i)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600"
                    >
                      <DollarSign className="h-3.5 w-3.5" />
                      Marcar como paga
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Modal pagar */}
      {paying && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={e => { if (e.target === e.currentTarget) setPaying(null) }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
              <h3 className="text-base font-semibold text-zinc-900">
                Marcar parcela como paga
              </h3>
              <button onClick={() => setPaying(null)} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
                <p className="font-semibold text-blue-900">{paying.customerName}</p>
                <p className="text-blue-700">
                  Parcela {paying.installmentNumber}/{paying.totalInstallments} • Vence {fmtDate(paying.dueDate)}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-700">Valor recebido (R$)</label>
                <input
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-700">Forma de pagamento</label>
                <select
                  value={payMethod}
                  onChange={e => setPayMethod(e.target.value as typeof payMethod)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="cash">Dinheiro</option>
                  <option value="pix">PIX</option>
                  <option value="card">Cartão</option>
                  <option value="transfer">Transferência</option>
                  <option value="mixed">Misto</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-700">Observação</label>
                <input
                  value={payNotes}
                  onChange={e => setPayNotes(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3">
              <button
                onClick={() => setPaying(null)}
                disabled={pending}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancelar
              </button>
              <button
                onClick={submitPay}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Confirmar pagamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
