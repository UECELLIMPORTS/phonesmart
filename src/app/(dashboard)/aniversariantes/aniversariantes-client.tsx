'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  Cake, MessageCircle, Copy, CheckCircle2, RotateCcw, Loader2, Search, Phone, Mail, Gift, Calendar,
} from 'lucide-react'
import {
  markBirthdayContacted, unmarkBirthdayContacted, getBirthdayMessage,
  type BirthdayCustomer, type BirthdayFilter,
} from '@/actions/birthdays'

type Props = {
  initialCustomers: BirthdayCustomer[]
  initialFilter:    BirthdayFilter
  todayCount:       number
  weekCount:        number
  monthCount:       number
  discountPercent:  number
}

const formatPhone = (d: string | null) => {
  if (!d) return ''
  const s = d.replace(/\D/g, '')
  if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return d
}

export function AniversariantesClient({
  initialCustomers, initialFilter, todayCount, weekCount, monthCount, discountPercent,
}: Props) {
  const router = useRouter()
  const sp     = useSearchParams()
  const [pending, startTransition] = useTransition()

  const customers = initialCustomers
  const filter    = initialFilter
  const [search, setSearch] = useState('')

  // Modal de mensagem
  const [msgFor, setMsgFor] = useState<BirthdayCustomer | null>(null)
  const [msgText, setMsgText] = useState('')
  const [loadingMsg, setLoadingMsg] = useState(false)

  function setFilter(f: BirthdayFilter) {
    const params = new URLSearchParams(sp.toString())
    if (f === 'month') params.delete('filter')
    else params.set('filter', f)
    startTransition(() => router.push(`/aniversariantes${params.toString() ? '?' + params.toString() : ''}`))
  }

  async function openMessageModal(c: BirthdayCustomer) {
    setMsgFor(c)
    setLoadingMsg(true)
    setMsgText('')
    try {
      const res = await getBirthdayMessage(c.id)
      if (res.ok) setMsgText(res.data?.message ?? '')
      else toast.error(res.error)
    } finally {
      setLoadingMsg(false)
    }
  }

  function sendWhatsApp(c: BirthdayCustomer) {
    const digits = (c.whatsapp ?? c.phone ?? '').replace(/\D/g, '')
    if (digits.length < 10) {
      toast.error('Cliente sem WhatsApp/telefone cadastrado.')
      return
    }
    const phone = digits.startsWith('55') ? digits : `55${digits}`
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msgText || '')}`
    window.open(url, '_blank', 'noopener,noreferrer')
    toast.success('WhatsApp aberto!')
  }

  async function copyMessage() {
    if (!msgText) return
    try {
      await navigator.clipboard.writeText(msgText)
      toast.success('Mensagem copiada!')
    } catch {
      toast.error('Falha ao copiar — selecione e copie manualmente.')
    }
  }

  async function toggleContacted(c: BirthdayCustomer) {
    const action = c.alreadyContactedThisYear ? unmarkBirthdayContacted : markBirthdayContacted
    const res = await action(c.id)
    if (res.ok) {
      toast.success(c.alreadyContactedThisYear ? 'Marcado como não contactado' : 'Marcado como parabenizado!')
      router.refresh()
    } else {
      toast.error(res.error)
    }
  }

  const filteredCustomers = search.trim()
    ? customers.filter(c => c.fullName.toLowerCase().includes(search.toLowerCase().trim()))
    : customers

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text flex items-center gap-2">
            <Cake className="h-6 w-6" style={{ color: '#E4405F' }} />
            Aniversariantes
          </h1>
          <p className="mt-1 text-sm text-muted">
            Parabenize clientes e envie cupons de aniversário · Desconto padrão: <strong>{discountPercent}%</strong>
          </p>
        </div>
      </div>

      {/* Tabs de período */}
      <div className="flex flex-wrap gap-2">
        <TabButton active={filter === 'today'} onClick={() => setFilter('today')} count={todayCount} color="#EF4444">🎂 Hoje</TabButton>
        <TabButton active={filter === 'week'}  onClick={() => setFilter('week')}  count={weekCount}  color="#F59E0B">📅 Esta semana</TabButton>
        <TabButton active={filter === 'month'} onClick={() => setFilter('month')} count={monthCount} color="#10B981">🎁 Este mês</TabButton>

        <div className="relative ml-auto w-60">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar cliente…"
            className="w-full rounded-lg border bg-transparent py-2 pl-9 pr-3 text-xs text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            style={{ borderColor: '#2A3650' }}
          />
        </div>
      </div>

      {/* Lista de cards */}
      {filteredCustomers.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <Cake className="h-12 w-12 mx-auto mb-3" style={{ color: '#475569' }} />
          <p className="text-sm text-muted">
            {search.trim() ? 'Nenhum cliente encontrado nessa busca.'
             : filter === 'today' ? 'Nenhum aniversariante hoje 🎂'
             : filter === 'week'  ? 'Nenhum aniversariante esta semana.'
             : 'Nenhum aniversariante cadastrado neste mês. Cadastre datas de nascimento na aba Clientes.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredCustomers.map(c => (
            <BirthdayCard
              key={c.id}
              customer={c}
              onMessage={() => openMessageModal(c)}
              onToggleContacted={() => toggleContacted(c)}
            />
          ))}
        </div>
      )}

      {/* Modal de mensagem */}
      {msgFor && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={() => setMsgFor(null)}>
          <div className="w-full max-w-2xl rounded-xl border p-5 max-h-[90vh] overflow-y-auto"
            style={{ background: '#1B2638', borderColor: '#2A3650' }}
            onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <Cake className="h-5 w-5" style={{ color: '#E4405F' }} />
              <h3 className="text-base font-semibold text-text">Mensagem pra {msgFor.fullName}</h3>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg p-2" style={{ background: '#0F172A' }}>
                <p className="text-[10px] uppercase tracking-wider text-muted">Aniversário</p>
                <p className="mt-1 font-bold text-text">{msgFor.dateBR} · {msgFor.whenLabel}</p>
              </div>
              <div className="rounded-lg p-2" style={{ background: '#0F172A' }}>
                <p className="text-[10px] uppercase tracking-wider text-muted">WhatsApp</p>
                <p className="mt-1 font-bold text-text">{msgFor.whatsapp ? formatPhone(msgFor.whatsapp) : '—'}</p>
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-muted">Mensagem (você pode editar antes de enviar)</label>
            {loadingMsg ? (
              <div className="rounded-lg border p-4 flex items-center justify-center gap-2 text-sm text-muted"
                style={{ background: '#0F172A', borderColor: '#2A3650' }}>
                <Loader2 className="h-4 w-4 animate-spin" /> Gerando mensagem…
              </div>
            ) : (
              <textarea
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                rows={12}
                className="w-full rounded-lg border px-3 py-2 text-sm text-text"
                style={{ background: '#0F172A', borderColor: '#2A3650' }}
              />
            )}
            <p className="mt-1 text-[10px] text-muted">
              Editar template padrão em <span className="text-accent">/configuracoes</span> → Aniversários
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setMsgFor(null)}
                className="flex-1 rounded-lg border py-2 text-sm" style={{ borderColor: '#2A3650', color: '#94A3B8' }}>
                Fechar
              </button>
              <button onClick={copyMessage} disabled={loadingMsg || !msgText}
                className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm text-text disabled:opacity-50"
                style={{ borderColor: '#2A3650' }}>
                <Copy className="h-4 w-4" /> Copiar
              </button>
              <button onClick={() => sendWhatsApp(msgFor)} disabled={loadingMsg || !msgText || !(msgFor.whatsapp || msgFor.phone)}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                style={{ background: '#22C55E' }}>
                <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp
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
// Tab button
// ──────────────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, count, color, children }: {
  active: boolean; onClick: () => void; count: number; color: string; children: React.ReactNode
}) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all"
      style={active
        ? { background: `${color}18`, borderColor: color, color }
        : { borderColor: '#2A3650', color: '#94A3B8' }}>
      <span>{children}</span>
      <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
        style={{ background: active ? color : '#2A3650', color: active ? '#0F172A' : '#94A3B8' }}>
        {count}
      </span>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Card de cliente aniversariante
// ──────────────────────────────────────────────────────────────────────────

function BirthdayCard({ customer, onMessage, onToggleContacted }: {
  customer:           BirthdayCustomer
  onMessage:          () => void
  onToggleContacted:  () => void
}) {
  const c = customer
  const initials = c.fullName.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()

  return (
    <div className="rounded-xl border p-4 relative overflow-hidden"
      style={{ background: '#1B2638', borderColor: c.isToday ? '#E4405F' : '#2A3650' }}>
      {c.isToday && (
        <div className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{ background: '#E4405F', color: '#FFFFFF' }}>
          🎂 HOJE!
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold shrink-0"
          style={{ background: 'linear-gradient(135deg, #E4405F, #F59E0B)', color: '#FFFFFF' }}>
          {initials || '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text truncate">{c.fullName}</p>
          <p className="text-[11px] text-muted">
            {c.whenLabel} {c.age != null ? `· ${c.age + 1} anos` : ''}
          </p>
        </div>
      </div>

      <div className="space-y-1.5 mb-3 text-[11px]">
        <div className="flex items-center gap-2">
          <Calendar className="h-3 w-3 shrink-0" style={{ color: '#64748B' }} />
          <span className="text-muted">Aniversário:</span>
          <span className="font-medium text-text">{c.dateBR}</span>
        </div>
        {c.whatsapp && (
          <div className="flex items-center gap-2">
            <Phone className="h-3 w-3 shrink-0" style={{ color: '#22C55E' }} />
            <span className="text-text">{formatPhone(c.whatsapp)}</span>
          </div>
        )}
        {c.email && (
          <div className="flex items-center gap-2">
            <Mail className="h-3 w-3 shrink-0" style={{ color: '#06B6D4' }} />
            <span className="text-text truncate">{c.email}</span>
          </div>
        )}
      </div>

      {c.alreadyContactedThisYear && (
        <div className="mb-2 rounded-md p-1.5 text-center text-[10px] font-medium"
          style={{ background: 'rgba(16,185,129,.10)', color: '#10B981' }}>
          ✅ Já parabenizado este ano
        </div>
      )}

      {c.alreadyUsedCouponThisYear && (
        <div className="mb-2 rounded-md p-1.5 text-center text-[10px] font-medium"
          style={{ background: 'rgba(168,139,250,.10)', color: '#A78BFA' }}>
          <Gift className="inline h-3 w-3 mr-1" /> Cupom já utilizado este ano
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={onMessage}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold text-black"
          style={{ background: '#22C55E' }}>
          <MessageCircle className="h-3.5 w-3.5" />
          Parabenizar
        </button>
        <button onClick={onToggleContacted}
          title={c.alreadyContactedThisYear ? 'Desfazer marcação' : 'Marcar como contactado'}
          className="rounded-lg border px-2 py-2 text-muted hover:text-text"
          style={{ borderColor: '#2A3650' }}>
          {c.alreadyContactedThisYear ? <RotateCcw className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}
