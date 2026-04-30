'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Lock, Unlock, Loader2, AlertTriangle, TrendingUp,
  ShoppingCart, DollarSign, CreditCard,
} from 'lucide-react'
import { toast } from 'sonner'
import { openCashSession, type CashSessionSummary } from '@/actions/cash'

type Props = {
  lastSummary: CashSessionSummary | null
}

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

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

export function CaixaFechado({ lastSummary }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [openingValue, setOpeningValue] = useState('0,00')
  const [notes, setNotes] = useState('')

  function parseValue(): number {
    const cleaned = openingValue.replace(/\./g, '').replace(',', '.')
    const num = parseFloat(cleaned)
    if (isNaN(num) || num < 0) return 0
    return Math.round(num * 100)
  }

  function handleOpen() {
    const cents = parseValue()
    startTransition(async () => {
      const res = await openCashSession({
        openingBalanceCents: cents,
        notes: notes || undefined,
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Caixa aberto!')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
          <Lock className="h-5 w-5" style={{ color: '#F59E0B' }} />
          Caixa fechado
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
          Abra o caixa pra começar a vender. Informe o valor inicial em dinheiro
          (troco pra primeiras vendas).
        </p>
      </div>

      {/* Resultado do dia anterior */}
      {lastSummary && (
        <div className="rounded-2xl border p-5"
          style={{ background: '#131C2A', borderColor: '#2A3650' }}>

          {lastSummary.session.status === 'auto_closed' && (
            <div className="rounded-lg border p-3 mb-4 flex items-start gap-2.5"
              style={{ background: 'rgba(255,107,53,.08)', borderColor: 'rgba(255,107,53,.3)' }}>
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#EA580C' }} />
              <div>
                <p className="text-xs font-bold" style={{ color: '#EA580C' }}>
                  ⚠ Caixa fechou automaticamente às 00:00
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: '#CBD5E1' }}>
                  Você esqueceu de fechar manualmente. O sistema fechou pra preservar
                  o resumo. Pra próxima, lembre de fechar antes das 23:59.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4" style={{ color: '#10B981' }} />
            <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
              Resumo da última sessão
            </h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <KPI label="Vendas" value={String(lastSummary.salesCount)} icon={ShoppingCart} color="#F59E0B" />
            <KPI label="Faturado" value={BRL(lastSummary.totalSalesCents)} icon={DollarSign} color="#10B981" />
            <KPI label="Em dinheiro" value={BRL(lastSummary.cashSalesCents)} icon={DollarSign} color="#22C55E" />
            <KPI label="Esperado no caixa" value={BRL(lastSummary.expectedCashCents)} icon={CreditCard} color="#CBD5E1" />
          </div>

          {lastSummary.differenceCents !== null && (
            <div className="rounded-lg border p-3 mb-4"
              style={{
                background: lastSummary.differenceCents === 0 ? 'rgba(16,185,129,.06)'
                  : lastSummary.differenceCents > 0 ? 'rgba(34,197,94,.06)'
                  : 'rgba(255,77,109,.06)',
                borderColor: lastSummary.differenceCents === 0 ? '#10B981'
                  : lastSummary.differenceCents > 0 ? '#22C55E'
                  : '#EF4444',
              }}>
              <p className="text-[11px] font-bold uppercase tracking-wider"
                style={{
                  color: lastSummary.differenceCents === 0 ? '#10B981'
                    : lastSummary.differenceCents > 0 ? '#22C55E'
                    : '#EF4444',
                }}>
                {lastSummary.differenceCents === 0 ? '✓ Caixa bateu certinho'
                  : lastSummary.differenceCents > 0 ? `+ ${BRL(lastSummary.differenceCents)} sobrou`
                  : `- ${BRL(Math.abs(lastSummary.differenceCents))} faltou`}
              </p>
              <p className="text-[10px] mt-1" style={{ color: '#CBD5E1' }}>
                Esperado: {BRL(lastSummary.expectedCashCents)} ·
                Contado: {BRL(lastSummary.session.closingCountedCents ?? 0)}
              </p>
            </div>
          )}

          {lastSummary.breakdown.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
                Por forma de pagamento
              </p>
              <div className="space-y-1.5">
                {lastSummary.breakdown.map(b => (
                  <div key={b.paymentMethod}
                    className="flex items-center justify-between rounded px-3 py-2 text-xs"
                    style={{ background: '#1B2638' }}>
                    <span style={{ color: '#F8FAFC' }}>
                      {PAYMENT_LABELS[b.paymentMethod] ?? b.paymentMethod}
                      <span style={{ color: '#94A3B8' }}> · {b.count} {b.count === 1 ? 'venda' : 'vendas'}</span>
                    </span>
                    <span className="font-bold" style={{ color: '#10B981' }}>{BRL(b.totalCents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] mt-4" style={{ color: '#94A3B8' }}>
            Aberto em {fmtDateTime(lastSummary.session.openedAt)} ·
            Fechado em {fmtDateTime(lastSummary.session.closedAt)}
          </p>
        </div>
      )}

      {/* Form abrir caixa */}
      <div className="rounded-2xl border p-6"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 mb-4">
          <Unlock className="h-5 w-5" style={{ color: '#10B981' }} />
          <h2 className="text-base font-bold" style={{ color: '#F8FAFC' }}>
            Abrir caixa agora
          </h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
              style={{ color: '#CBD5E1' }}>
              Valor inicial (dinheiro/troco)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: '#94A3B8' }}>R$</span>
              <input type="text" value={openingValue}
                onChange={e => setOpeningValue(e.target.value)}
                placeholder="0,00"
                className="flex-1 rounded-lg border px-3.5 py-2.5 text-base font-mono outline-none transition-colors focus:border-accent/60"
                style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }} />
            </div>
            <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
              Ex: <code>50,00</code> se você tem R$50 em dinheiro pra dar troco. Pode ser <code>0</code>.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5"
              style={{ color: '#CBD5E1' }}>
              Observação (opcional)
            </label>
            <input type="text" value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="ex: turno da manhã, troco do dono"
              className="w-full rounded-lg border px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-accent/60"
              style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }} />
          </div>

          <button onClick={handleOpen} disabled={pending}
            className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
            Abrir caixa
          </button>
        </div>
      </div>
    </div>
  )
}

function KPI({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string
}) {
  return (
    <div className="rounded-lg border p-3"
      style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="h-3 w-3" style={{ color }} />
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
          {label}
        </p>
      </div>
      <p className="text-sm font-bold font-mono" style={{ color }}>{value}</p>
    </div>
  )
}
