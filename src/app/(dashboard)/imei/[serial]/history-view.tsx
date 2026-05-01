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
  acquired:      { icon: ShoppingCart, color: 'text-blue-700',    bg: 'bg-blue-100',    ring: 'ring-blue-200' },
  sold:          { icon: ShoppingBag,  color: 'text-emerald-700', bg: 'bg-emerald-100', ring: 'ring-emerald-200' },
  returned:      { icon: RotateCcw,    color: 'text-amber-700',   bg: 'bg-amber-100',   ring: 'ring-amber-200' },
  service:       { icon: Wrench,       color: 'text-purple-700',  bg: 'bg-purple-100',  ring: 'ring-purple-200' },
  status_change: { icon: AlertTriangle, color: 'text-rose-700',   bg: 'bg-rose-100',    ring: 'ring-rose-200' },
}

const STATUS_LABEL: Record<DeviceHistory['status'], { label: string; color: string }> = {
  available: { label: 'Disponível', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  sold:      { label: 'Vendido',    color: 'bg-blue-100 text-blue-700 border-blue-200' },
  returned:  { label: 'Devolvido',  color: 'bg-amber-100 text-amber-700 border-amber-200' },
  defective: { label: 'Defeito',    color: 'bg-rose-100 text-rose-700 border-rose-200' },
}

export function ImeiHistoryView({ history }: { history: DeviceHistory }) {
  const statusCfg = STATUS_LABEL[history.status]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/estoque"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>
      </div>

      {/* Card principal */}
      <div className="rounded-2xl border bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm ring-1 ring-blue-100">
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
              className="text-xl font-bold text-zinc-900 hover:underline"
            >
              {history.productName}
            </Link>
            <p className="font-mono text-sm font-semibold text-zinc-700 mt-1">
              IMEI {history.serial}
            </p>
            {history.notes && (
              <p className="mt-2 text-sm text-zinc-600">📝 {history.notes}</p>
            )}
          </div>

          {/* Métricas */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-3 min-w-[120px]">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Comprado por</p>
              <p className="text-base font-bold text-zinc-900">{BRL(history.acquired.costCents)}</p>
              <p className="text-[10px] text-zinc-400">{fmtDateTime(history.acquired.at)}</p>
            </div>

            {history.sold ? (
              <>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 min-w-[120px]">
                  <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Vendido por</p>
                  <p className="text-base font-bold text-emerald-700">{BRL(history.sold.priceCents)}</p>
                  <p className="text-[10px] text-emerald-600">{fmtDateTime(history.sold.at)}</p>
                </div>
                {history.profitCents != null && (
                  <div className={`rounded-xl border p-3 min-w-[120px] ${
                    history.profitCents >= 0
                      ? 'border-blue-200 bg-blue-50'
                      : 'border-rose-200 bg-rose-50'
                  }`}>
                    <p className={`text-[10px] uppercase tracking-wider font-semibold ${
                      history.profitCents >= 0 ? 'text-blue-700' : 'text-rose-700'
                    }`}>Lucro</p>
                    <p className={`text-base font-bold flex items-center gap-1 ${
                      history.profitCents >= 0 ? 'text-blue-700' : 'text-rose-700'
                    }`}>
                      {history.profitCents >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      {BRL(history.profitCents)}
                    </p>
                    {history.acquired.costCents > 0 && (
                      <p className={`text-[10px] ${history.profitCents >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                        {((history.profitCents / history.acquired.costCents) * 100).toFixed(1)}%
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 min-w-[120px]">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Status</p>
                <p className="text-sm font-semibold text-zinc-700">Em estoque</p>
                <p className="text-[10px] text-zinc-400">Ainda não vendido</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Linha do tempo */}
      <div className="rounded-2xl border bg-white p-6 shadow-sm ring-1 ring-zinc-200">
        <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-zinc-900">
          <Calendar className="h-4 w-4 text-blue-500" />
          Linha do tempo
          <span className="text-xs text-zinc-400 font-normal ml-1">{history.events.length} evento{history.events.length !== 1 ? 's' : ''}</span>
        </h2>

        {history.events.length === 0 ? (
          <p className="text-sm text-zinc-500 py-4">Nenhum evento registrado.</p>
        ) : (
          <ol className="relative border-l-2 border-zinc-200 ml-3 space-y-6">
            {history.events.map((ev, idx) => {
              const cfg = EVENT_CFG[ev.type]
              const Icon = cfg.icon
              return (
                <li key={idx} className="ml-6">
                  <span className={`absolute -left-3.5 flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white ${cfg.bg}`}>
                    <Icon className={`h-3.5 w-3.5 ${cfg.color}`} />
                  </span>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3 className="text-sm font-semibold text-zinc-900">{ev.title}</h3>
                      <time className="text-xs text-zinc-500">{fmtDateTime(ev.at)}</time>
                    </div>
                    <p className="text-sm text-zinc-600">{ev.description}</p>
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
                            <span key={k} className="text-[11px] text-zinc-500">
                              <span className="font-medium text-zinc-700">{k}:</span> {v}
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
