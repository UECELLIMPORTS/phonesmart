'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Unlock, Lock, Loader2, X, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  closeCashSession, getCashSessionSummary,
  type CashSession, type CashSessionSummary,
} from '@/actions/cash'

type Props = {
  session: CashSession
}

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro:    'Dinheiro',
  cash:        'Dinheiro',
  pix:         'PIX',
  credito:     'Cartão Crédito',
  credit:      'Cartão Crédito',
  debito:      'Cartão Débito',
  debit:       'Cartão Débito',
  outros:      'Outros',
}

function formatElapsed(from: string): string {
  const diff = Date.now() - new Date(from).getTime()
  const h = Math.floor(diff / 3600_000)
  const m = Math.floor((diff % 3600_000) / 60_000)
  if (h === 0 && m === 0) return 'agora'
  if (h === 0) return `${m}min`
  return `${h}h ${m}min`
}

export function CaixaAbertoHeader({ session }: Props) {
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [elapsed, setElapsed] = useState(() => formatElapsed(session.openedAt))

  // Atualiza tempo decorrido a cada minuto
  useEffect(() => {
    const interval = setInterval(() => setElapsed(formatElapsed(session.openedAt)), 60_000)
    return () => clearInterval(interval)
  }, [session.openedAt])

  return (
    <>
      <div className="rounded-xl border p-3 flex items-center justify-between gap-3 mb-4"
        style={{ background: 'rgba(16,185,129,.06)', borderColor: 'rgba(16,185,129,.3)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0"
            style={{ background: 'rgba(16,185,129,.15)' }}>
            <Unlock className="h-4 w-4" style={{ color: '#10B981' }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold" style={{ color: '#10B981' }}>
              Caixa aberto · há {elapsed}
            </p>
            <p className="text-[10px]" style={{ color: '#CBD5E1' }}>
              Valor inicial: {BRL(session.openingBalanceCents)}
            </p>
          </div>
        </div>

        <button onClick={() => setShowCloseModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
          style={{ borderColor: '#EA580C', color: '#EA580C' }}>
          <Lock className="h-3.5 w-3.5" />
          Fechar caixa
        </button>
      </div>

      {showCloseModal && (
        <FecharCaixaModal session={session} onClose={() => setShowCloseModal(false)} />
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Modal: Fechar caixa
// ──────────────────────────────────────────────────────────────────────────

function FecharCaixaModal({ session, onClose }: {
  session: CashSession; onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [summary, setSummary] = useState<CashSessionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [countedValue, setCountedValue] = useState('0,00')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    let cancelled = false
    getCashSessionSummary(session.id).then(s => {
      if (cancelled) return
      setSummary(s)
      // Pré-preenche com o esperado pra facilitar
      if (s) {
        const expected = (s.expectedCashCents / 100).toFixed(2).replace('.', ',')
        setCountedValue(expected)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [session.id])

  function parseValue(): number {
    const cleaned = countedValue.replace(/\./g, '').replace(',', '.')
    const num = parseFloat(cleaned)
    if (isNaN(num) || num < 0) return 0
    return Math.round(num * 100)
  }

  function handleClose() {
    const cents = parseValue()
    startTransition(async () => {
      const res = await closeCashSession({
        countedCents: cents,
        notes: notes || undefined,
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Caixa fechado!')
      router.refresh()
      onClose()
    })
  }

  const counted = parseValue()
  const expected = summary?.expectedCashCents ?? 0
  const diff = counted - expected

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border max-h-[90vh] overflow-y-auto"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-start justify-between border-b p-5"
          style={{ borderColor: '#2A3650' }}>
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
              <Lock className="h-4 w-4" style={{ color: '#EA580C' }} />
              Fechar caixa
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
              Confira o resumo e informe o valor contado em dinheiro.
            </p>
          </div>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-card"
            style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: '#22C55E' }} />
          </div>
        )}

        {summary && !loading && (
          <div className="p-5 space-y-4">
            {/* Resumo */}
            <div className="space-y-2">
              <SumRow label="Valor inicial" value={BRL(summary.session.openingBalanceCents)} color="#CBD5E1" />
              <SumRow label="Vendas em dinheiro" value={`+ ${BRL(summary.cashSalesCents)}`} color="#10B981" />
              <div className="border-t pt-2" style={{ borderColor: '#2A3650' }}>
                <SumRow label="Esperado em caixa" value={BRL(summary.expectedCashCents)}
                  color="#22C55E" bold />
              </div>
            </div>

            {/* Breakdown total */}
            {summary.breakdown.length > 0 && (
              <div className="rounded-lg border p-3"
                style={{ background: '#1B2638', borderColor: '#2A3650' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                  {summary.salesCount} {summary.salesCount === 1 ? 'venda' : 'vendas'} · Total {BRL(summary.totalSalesCents)}
                </p>
                <div className="space-y-1">
                  {summary.breakdown.map(b => (
                    <div key={b.paymentMethod}
                      className="flex items-center justify-between text-xs">
                      <span style={{ color: '#CBD5E1' }}>
                        {PAYMENT_LABELS[b.paymentMethod] ?? b.paymentMethod}
                      </span>
                      <span className="font-bold" style={{ color: '#F8FAFC' }}>{BRL(b.totalCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Input valor contado */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
                style={{ color: '#CBD5E1' }}>
                💰 Valor contado em dinheiro
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold" style={{ color: '#94A3B8' }}>R$</span>
                <input type="text" value={countedValue}
                  onChange={e => setCountedValue(e.target.value)}
                  className="flex-1 rounded-lg border px-3.5 py-2.5 text-base font-mono outline-none transition-colors focus:border-accent/60"
                  style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }} />
              </div>
              <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                Conte fisicamente o dinheiro na gaveta e digite aqui.
              </p>
            </div>

            {/* Diferença */}
            {countedValue && (
              <div className="rounded-lg border p-3 flex items-start gap-2.5"
                style={{
                  background: diff === 0 ? 'rgba(16,185,129,.06)'
                    : diff > 0 ? 'rgba(34,197,94,.06)'
                    : 'rgba(255,77,109,.06)',
                  borderColor: diff === 0 ? 'rgba(16,185,129,.3)'
                    : diff > 0 ? 'rgba(34,197,94,.3)'
                    : 'rgba(255,77,109,.3)',
                }}>
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5"
                  style={{
                    color: diff === 0 ? '#10B981' : diff > 0 ? '#22C55E' : '#EF4444',
                  }} />
                <p className="text-xs font-bold"
                  style={{
                    color: diff === 0 ? '#10B981' : diff > 0 ? '#22C55E' : '#EF4444',
                  }}>
                  {diff === 0 ? '✓ Caixa bate certinho'
                    : diff > 0 ? `+ ${BRL(diff)} sobrando — confira`
                    : `- ${BRL(Math.abs(diff))} faltando — confira antes de fechar`}
                </p>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
                style={{ color: '#CBD5E1' }}>
                Observação (opcional)
              </label>
              <input type="text" value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="ex: faltou troco no fim do dia"
                className="w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent/60"
                style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }} />
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={onClose} disabled={pending}
                className="flex-1 rounded-lg border px-4 py-2.5 text-sm font-bold transition-colors hover:bg-white/5"
                style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>
                Cancelar
              </button>
              <button onClick={handleClose} disabled={pending}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: '#EA580C', color: '#131C2A' }}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Confirmar fechamento
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SumRow({ label, value, color, bold }: {
  label: string; value: string; color: string; bold?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: '#CBD5E1' }}>{label}</span>
      <span className={bold ? 'text-base font-bold font-mono' : 'text-sm font-mono'}
        style={{ color }}>{value}</span>
    </div>
  )
}
