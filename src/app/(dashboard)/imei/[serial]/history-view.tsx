'use client'

import Link from 'next/link'
import {
  ArrowLeft, ShoppingCart, ShoppingBag, Wrench, RotateCcw, AlertTriangle,
  CheckCircle2, Smartphone, TrendingUp, TrendingDown, Calendar,
} from 'lucide-react'
import type { DeviceHistory, TimelineEvent } from '@/actions/product-serials'

const BRL = (c: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((c ?? 0) / 100)

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

const EVENT_CFG: Record<TimelineEvent['type'], { icon: typeof ShoppingCart; color: string; bg: string; ring: string }> = {
  acquired:      { icon: ShoppingCart, color: 'text-blue-400',    bg: 'bg-blue-500/20',    ring: 'ring-blue-500/30' },
  sold:          { icon: ShoppingBag,  color: 'text-emerald-400', bg: 'bg-emerald-500/20', ring: 'ring-emerald-500/30' },
  returned:      { icon: RotateCcw,    color: 'text-amber-400',   bg: 'bg-amber-500/20',   ring: 'ring-amber-500/30' },
  service:       { icon: Wrench,       color: 'text-purple-400',  bg: 'bg-purple-500/20',  ring: 'ring-purple-500/30' },
  status_change: { icon: AlertTriangle, color: 'text-rose-400',   bg: 'bg-rose-500/20',    ring: 'ring-rose-500/30' },
}

const STATUS_LABEL: Record<DeviceHistory['status'], { label: string; color: string }> = {
  available: { label: 'Disponível', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  sold:      { label: 'Vendido',    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  returned:  { label: 'Devolvido',  color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  defective: { label: 'Defeito',    color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' },
}

export function ImeiHistoryView({ history }: { history: DeviceHistory }) {
  const statusCfg = STATUS_LABEL[history.status]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/estoque"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>
      </div>

      {/* Card principal */}
      <div className="rounded-2xl border bg-gradient-to-br from-blue-500/10 to-card p-6 shadow-sm ring-1 ring-blue-500/20">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Smartphone className="h-5 w-5 text-blue-500" />
              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
            </div>
            <Link
              href={`/estoque/${history.productId}`}
              className="text-xl font-bold text-text hover:underline"
            >
              {history.productName}
            </Link>
            <p className="font-mono text-sm font-semibold text-text/90 mt-1">
              IMEI {history.serial}
            </p>
            {history.notes && (
              <p className="mt-2 text-sm text-muted">📝 {history.notes}</p>
            )}
          </div>

          {/* Métricas */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-xl border border-zinc-700/60 bg-card p-3 min-w-[120px]">
              <p className="text-[10px] uppercase tracking-wider text-muted font-semibold">Comprado por</p>
              <p className="text-base font-bold text-text">{BRL(history.acquired.costCents)}</p>
              <p className="text-[10px] text-muted/70">{fmtDateTime(history.acquired.at)}</p>
            </div>

            {history.sold ? (
              <>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 min-w-[120px]">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Vendido por</p>
                  <p className="text-base font-bold text-emerald-400">{BRL(history.sold.priceCents)}</p>
                  <p className="text-[10px] text-emerald-400">{fmtDateTime(history.sold.at)}</p>
                </div>
                {history.profitCents != null && (
                  <div className={`rounded-xl border p-3 min-w-[120px] ${
                    history.profitCents >= 0
                      ? 'border-blue-500/30 bg-blue-500/10'
                      : 'border-rose-500/30 bg-rose-500/10'
                  }`}>
                    <p className={`text-[10px] uppercase tracking-wider font-semibold ${
                      history.profitCents >= 0 ? 'text-blue-400' : 'text-rose-400'
                    }`}>Lucro</p>
                    <p className={`text-base font-bold flex items-center gap-1 ${
                      history.profitCents >= 0 ? 'text-blue-400' : 'text-rose-400'
                    }`}>
                      {history.profitCents >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      {BRL(history.profitCents)}
                    </p>
                    {history.acquired.costCents > 0 && (
                      <p className={`text-[10px] ${history.profitCents >= 0 ? 'text-blue-400' : 'text-rose-400'}`}>
                        {((history.profitCents / history.acquired.costCents) * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-3 min-w-[120px]">
                <p className="text-[10px] uppercase tracking-wider text-muted font-semibold">Status</p>
                <p className="text-sm font-semibold text-text/90">Em estoque</p>
                <p className="text-[10px] text-muted/70">Ainda não vendido</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Linha do tempo */}
      <div className="rounded-2xl border bg-card p-6 shadow-sm ring-1 ring-zinc-800/60">
        <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-text">
          <Calendar className="h-4 w-4 text-blue-500" />
          Linha do tempo
          <span className="text-xs text-muted/70 font-normal ml-1">{history.events.length} evento{history.events.length !== 1 ? 's' : ''}</span>
        </h2>

        {history.events.length === 0 ? (
          <p className="text-sm text-muted py-4">Nenhum evento registrado.</p>
        ) : (
          <ol className="relative border-l-2 border-zinc-700/60 ml-3 space-y-6">
            {history.events.map((ev, idx) => {
              const cfg = EVENT_CFG[ev.type]
              const Icon = cfg.icon
              return (
                <li key={idx} className="ml-6">
                  <span className={`absolute -left-3.5 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-card ${cfg.bg}`}>
                    <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  </span>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-sm font-semibold text-text">{ev.title}</h3>
                      <time className="text-xs text-muted">{fmtDateTime(ev.at)}</time>
                    </div>
                    <p className="text-sm text-muted">{ev.description}</p>
                    {'amountCents' in ev && ev.amountCents != null && ev.amountCents > 0 && (
                      <p className={`text-sm font-bold ${cfg.color}`}>
                        {BRL(ev.amountCents)}
                      </p>
                    )}
                    {'meta' in ev && ev.meta && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {Object.entries(ev.meta)
                          .filter(([, v]) => v != null && v !== '')
                          .map(([k, v]) => (
                            <span key={k} className="text-[11px] text-muted">
                              <span className="font-medium text-text/90">{k}:</span> {v}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}
