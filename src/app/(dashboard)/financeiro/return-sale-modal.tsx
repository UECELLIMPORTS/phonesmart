'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  XCircle, AlertTriangle, Loader2, Smartphone, RefreshCw, Package,
  CalendarClock, X, CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getSaleReturnPreview, processReturn, type SaleReturnPreview,
} from '@/actions/sale-returns'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(iso))
}

export function ReturnSaleModal({
  saleId,
  onClose,
  onSuccess,
}: {
  saleId:    string
  onClose:   () => void
  onSuccess: () => void
}) {
  const [preview, setPreview] = useState<SaleReturnPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const [reason, setReason]   = useState('')
  const [serialAction, setSerialAction] = useState<'available' | 'returned'>('available')
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    setLoading(true)
    getSaleReturnPreview(saleId)
      .then(p => {
        if (!p) setError('Venda não encontrada.')
        else setPreview(p)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Erro ao carregar.'))
      .finally(() => setLoading(false))
  }, [saleId])

  function submit() {
    if (!preview) return
    if (reason.trim().length < 3) {
      toast.error('Informe um motivo (mínimo 3 caracteres).')
      return
    }
    startTransition(async () => {
      const res = await processReturn({
        saleId:       preview.saleId,
        serialAction,
        reason:       reason.trim(),
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Devolução processada com sucesso.')
      onSuccess()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border my-8"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
      >
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: '#2A3650' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: '#EF444418' }}>
              <XCircle className="h-5 w-5" style={{ color: '#EF4444' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Aceitar devolução</h3>
              <p className="text-xs text-muted">Estorna venda + ajusta estoque + cancela parcelas</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:text-coral">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {error}
            </div>
          )}

          {preview && (
            <>
              {/* Resumo da venda */}
              <div className="rounded-lg border p-3" style={{ borderColor: '#2A3650', background: '#0F1626' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-muted">{preview.saleNumber}</p>
                    {preview.customerName && (
                      <p className="text-sm font-semibold text-text mt-0.5">{preview.customerName}</p>
                    )}
                    <p className="text-xs text-muted mt-0.5">Vendida em {fmtDate(preview.createdAt)}</p>
                  </div>
                  <p className="text-base font-bold text-green">{BRL(preview.totalCents)}</p>
                </div>
              </div>

              {preview.status === 'cancelled' && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  ⚠️ Esta venda já está cancelada.
                </div>
              )}

              {/* IMEIs */}
              {preview.serialItems.length > 0 && (
                <div className="rounded-lg border p-3" style={{ borderColor: '#2A3650', background: '#0F1626' }}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                    <Smartphone className="h-3.5 w-3.5" />
                    IMEIs nesta venda ({preview.serialItems.length})
                  </div>
                  <ul className="space-y-1">
                    {preview.serialItems.map(s => (
                      <li key={s.serialId} className="flex items-center justify-between text-xs">
                        <span className="text-text">{s.productName}</span>
                        <span className="font-mono text-muted">{s.serial}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Ação serial */}
                  <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: '#2A3650' }}>
                    <p className="text-xs font-semibold text-text">O que fazer com os IMEIs?</p>
                    <label className="flex items-start gap-2 cursor-pointer rounded-lg border p-2 transition-colors"
                      style={{ borderColor: serialAction === 'available' ? '#22C55E' : '#2A3650', background: serialAction === 'available' ? '#22C55E11' : 'transparent' }}>
                      <input
                        type="radio"
                        checked={serialAction === 'available'}
                        onChange={() => setSerialAction('available')}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-semibold text-text">Devolver pro estoque <span style={{ color: '#22C55E' }}>(disponível pra revenda)</span></p>
                        <p className="text-[11px] text-muted mt-0.5">Aparelho volta como se nunca tivesse sido vendido. Use se está em bom estado.</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer rounded-lg border p-2 transition-colors"
                      style={{ borderColor: serialAction === 'returned' ? '#F59E0B' : '#2A3650', background: serialAction === 'returned' ? '#F59E0B11' : 'transparent' }}>
                      <input
                        type="radio"
                        checked={serialAction === 'returned'}
                        onChange={() => setSerialAction('returned')}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-semibold text-text">Marcar como devolvido <span style={{ color: '#F59E0B' }}>(não vende de novo)</span></p>
                        <p className="text-[11px] text-muted mt-0.5">Pra aparelhos com problema, fica registrado como histórico. Pode mudar depois pelo painel de IMEIs.</p>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Crediário */}
              {preview.installmentPlan && (
                <div className="rounded-lg border p-3" style={{ borderColor: '#2A3650', background: '#0F1626' }}>
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                    <CalendarClock className="h-3.5 w-3.5" />
                    Crediário vinculado
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted">Pagas</p>
                      <p className="font-semibold" style={{ color: '#22C55E' }}>
                        {preview.installmentPlan.paidCount}/{preview.installmentPlan.totalInstallments} • {BRL(preview.installmentPlan.totalPaidCents)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted">Pendentes (serão canceladas)</p>
                      <p className="font-semibold" style={{ color: '#EF4444' }}>
                        {preview.installmentPlan.pendingCount} • {BRL(preview.installmentPlan.totalPendingCents)}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-amber-300">
                    ⚠️ As parcelas pagas ficam como histórico. Reembolso ao cliente é manual (saque/PIX).
                  </p>
                </div>
              )}

              {/* Itens não-IMEI */}
              {preview.itemsCount > preview.serialItems.length && (
                <div className="rounded-lg border p-3 text-xs" style={{ borderColor: '#2A3650', background: '#0F1626' }}>
                  <div className="flex items-center gap-2 text-muted">
                    <Package className="h-3.5 w-3.5" />
                    {preview.itemsCount - preview.serialItems.length} item(ns) sem IMEI — estoque será restaurado normalmente
                  </div>
                </div>
              )}

              {/* Motivo */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                  Motivo da devolução *
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={2}
                  placeholder="Ex: defeito de fábrica, arrependimento, troca por outro modelo..."
                  className="w-full rounded-lg border px-3 py-2 text-sm text-text outline-none focus:border-blue-500/60 placeholder:text-muted"
                  style={{ background: '#1B2638', borderColor: '#2A3650' }}
                />
              </div>

              {/* Aviso final */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Essa ação cancela a venda no financeiro, ajusta o estoque e cancela parcelas pendentes.
                  Vendas canceladas podem ser reativadas pelo botão padrão (mas IMEIs e parcelas <strong>não</strong> voltam automaticamente).
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: '#2A3650' }}>
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border px-4 py-2 text-sm font-medium text-muted hover:bg-card"
            style={{ borderColor: '#2A3650' }}
          >
            Voltar
          </button>
          <button
            onClick={submit}
            disabled={pending || loading || !!error || !preview || preview.status === 'cancelled'}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: '#EF4444' }}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Confirmar devolução
          </button>
        </div>
      </div>
    </div>
  )
}
