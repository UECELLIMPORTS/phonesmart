'use client'

import { useState, useTransition } from 'react'
import {
  TrendingUp, TrendingDown, Smartphone, ShoppingBag, Package,
  Wrench, CalendarClock, AlertTriangle, ShoppingCart, Award,
  Loader2, Building2,
} from 'lucide-react'
import { getCelularKpis, type CelularKpis } from '@/actions/dashboard-celular'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

function pct(v: number): string {
  return `${v.toFixed(1).replace('.', ',')}%`
}

const PERIODS = [
  { key: '7d',  label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
] as const

export function CelularDashboardClient({
  initialKpis,
  initialPeriod,
}: {
  initialKpis:    CelularKpis | null
  initialPeriod:  '7d' | '30d' | '90d'
}) {
  const [kpis, setKpis]     = useState<CelularKpis | null>(initialKpis)
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>(initialPeriod)
  const [pending, startTransition] = useTransition()

  function changePeriod(p: '7d' | '30d' | '90d') {
    setPeriod(p)
    startTransition(async () => {
      const next = await getCelularKpis(p)
      setKpis(next)
    })
  }

  if (!kpis) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    )
  }

  const profitColor = kpis.totalProfitCents >= 0 ? 'text-emerald-400' : 'text-rose-400'
  const profitBg    = kpis.totalProfitCents >= 0 ? 'from-emerald-500/10' : 'from-rose-500/10'
  const cancelColor =
    kpis.cancellationRate < 3   ? 'text-emerald-400'
  : kpis.cancellationRate < 10  ? 'text-amber-400'
  :                                'text-rose-400'

  const totalAvailable =
    kpis.aging.bucket0_30.count + kpis.aging.bucket31_60.count
  + kpis.aging.bucket61_90.count + kpis.aging.bucket90Plus.count
  const totalAvailableValue =
    kpis.aging.bucket0_30.valueCents + kpis.aging.bucket31_60.valueCents
  + kpis.aging.bucket61_90.valueCents + kpis.aging.bucket90Plus.valueCents

  return (
    <div className="space-y-6">
      {/* Header + period selector */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text">Painel da Loja</h1>
          <p className="mt-1 text-sm text-muted">
            Indicadores específicos pra loja de celular nos últimos {PERIODS.find(p => p.key === period)?.label}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
          <div className="flex gap-1 rounded-lg border border-zinc-700/60 bg-card p-0.5">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => changePeriod(p.key)}
                disabled={pending}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  period === p.key
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-muted hover:bg-zinc-800/40'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPIs principais ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Lucro total */}
        <div className={`rounded-2xl border bg-gradient-to-br ${profitBg} to-card p-4 shadow-sm`}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
            {kpis.totalProfitCents >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            Lucro do período
          </div>
          <p className={`mt-1 text-2xl font-bold ${profitColor}`}>{BRL(kpis.totalProfitCents)}</p>
          <p className="text-xs text-muted">Margem: {pct(kpis.averageMarginPct)}</p>
        </div>

        {/* Receita */}
        <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
            <ShoppingBag className="h-3.5 w-3.5" />
            Receita IMEI
          </div>
          <p className="mt-1 text-2xl font-bold text-blue-400">{BRL(kpis.grossRevenueCents)}</p>
          <p className="text-xs text-blue-400">{kpis.imeisSoldCount} aparelho{kpis.imeisSoldCount !== 1 ? 's' : ''} vendido{kpis.imeisSoldCount !== 1 ? 's' : ''}</p>
        </div>

        {/* Ticket médio */}
        <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-400">
            <ShoppingCart className="h-3.5 w-3.5" />
            Ticket médio
          </div>
          <p className="mt-1 text-2xl font-bold text-purple-400">{BRL(kpis.averageTicketCents)}</p>
          <p className="text-xs text-purple-600">{kpis.totalSalesCount} venda{kpis.totalSalesCount !== 1 ? 's' : ''} totais</p>
        </div>

        {/* Lucro médio por IMEI */}
        <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-card p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
            <Award className="h-3.5 w-3.5" />
            Lucro médio/IMEI
          </div>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{BRL(kpis.averageProfitCents)}</p>
          <p className="text-xs text-emerald-400">Custo total: {BRL(kpis.totalCostCents)}</p>
        </div>
      </div>

      {/* ── KPIs operacionais ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`rounded-2xl border p-4 ${
          kpis.cancellationRate >= 10 ? 'border-rose-500/30 bg-rose-500/10' :
          kpis.cancellationRate >= 3  ? 'border-amber-500/30 bg-amber-500/10' :
                                        'border-zinc-700/60 bg-card'
        }`}>
          <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${cancelColor}`}>
            <AlertTriangle className="h-3.5 w-3.5" />
            Taxa de devolução
          </div>
          <p className={`mt-1 text-2xl font-bold ${cancelColor}`}>{pct(kpis.cancellationRate)}</p>
          <p className="text-xs text-muted">{kpis.cancelledCount} cancelada{kpis.cancelledCount !== 1 ? 's' : ''}</p>
        </div>

        <div className="rounded-2xl border border-zinc-700/60 bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text/90">
            <Wrench className="h-3.5 w-3.5" />
            OS abertas
          </div>
          <p className="mt-1 text-2xl font-bold text-text">{kpis.serviceOrdersOpen}</p>
          <p className="text-xs text-muted">aberta, em conserto ou pronta</p>
        </div>

        <div className={`rounded-2xl border p-4 ${kpis.installmentsLate.count > 0 ? 'border-rose-500/30 bg-rose-500/10' : 'border-zinc-700/60 bg-card'}`}>
          <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${kpis.installmentsLate.count > 0 ? 'text-rose-400' : 'text-text/90'}`}>
            <CalendarClock className="h-3.5 w-3.5" />
            Parcelas atrasadas
          </div>
          <p className={`mt-1 text-2xl font-bold ${kpis.installmentsLate.count > 0 ? 'text-rose-400' : 'text-text'}`}>
            {kpis.installmentsLate.count}
          </p>
          <p className="text-xs text-muted">{BRL(kpis.installmentsLate.totalCents)} a receber</p>
        </div>

        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400">
            <CalendarClock className="h-3.5 w-3.5" />
            Parcelas a vencer
          </div>
          <p className="mt-1 text-2xl font-bold text-blue-400">{kpis.installmentsPending.count}</p>
          <p className="text-xs text-blue-400">{BRL(kpis.installmentsPending.totalCents)}</p>
        </div>
      </div>

      {/* ── Aging de estoque ── */}
      <div className="rounded-2xl border bg-card p-5 shadow-sm ring-1 ring-zinc-800/60">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-text">
              <Package className="h-4 w-4 text-blue-500" />
              Aging de estoque (IMEIs disponíveis)
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Há quanto tempo cada aparelho tá parado. IMEIs com 60+ dias merecem atenção.
            </p>
          </div>
          <div className="text-right text-xs text-muted">
            <p>Total: <span className="font-semibold text-text">{totalAvailable}</span> aparelho{totalAvailable !== 1 ? 's' : ''}</p>
            <p>Capital parado: <span className="font-semibold text-text">{BRL(totalAvailableValue)}</span></p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Até 30 dias', data: kpis.aging.bucket0_30,   color: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
            { label: '31-60 dias',  data: kpis.aging.bucket31_60,  color: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
            { label: '61-90 dias',  data: kpis.aging.bucket61_90,  color: 'border-amber-500/30 bg-amber-500/10 text-amber-400' },
            { label: '90+ dias',    data: kpis.aging.bucket90Plus, color: 'border-rose-500/30 bg-rose-500/10 text-rose-400' },
          ].map((b, i) => (
            <div key={i} className={`rounded-lg border p-3 ${b.color}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{b.label}</p>
              <p className="mt-1 text-xl font-bold">{b.data.count}</p>
              <p className="text-[11px] opacity-70">{BRL(b.data.valueCents)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Compras + Top fornecedores + Top modelos ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Compras do período */}
        <div className="rounded-2xl border bg-card p-5 shadow-sm ring-1 ring-zinc-800/60">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-text">
            <Smartphone className="h-4 w-4 text-amber-500" />
            Compras de aparelhos
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Quantidade</p>
              <p className="mt-1 text-2xl font-bold text-amber-400">{kpis.acquisitionsCount}</p>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Investido</p>
              <p className="mt-1 text-2xl font-bold text-amber-400">{BRL(kpis.acquisitionsTotalCents)}</p>
            </div>
          </div>

          {kpis.topSuppliers.length > 0 ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                <Building2 className="h-3 w-3" />
                Top fornecedores
              </p>
              <ul className="space-y-1.5">
                {kpis.topSuppliers.map((s, idx) => (
                  <li key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-text/90 truncate flex-1">
                      <span className="font-mono text-muted/70 mr-1.5">{idx + 1}.</span>
                      {s.name}
                    </span>
                    <span className="text-muted">{s.count} apr · {BRL(s.totalCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-muted">Nenhuma compra de fornecedor no período.</p>
          )}
        </div>

        {/* Top modelos */}
        <div className="rounded-2xl border bg-card p-5 shadow-sm ring-1 ring-zinc-800/60">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-text">
            <Award className="h-4 w-4 text-emerald-500" />
            Top modelos vendidos
          </h2>

          {kpis.topModels.length > 0 ? (
            <ul className="space-y-2">
              {kpis.topModels.map((m, idx) => (
                <li key={idx} className="rounded-lg border border-zinc-800/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-text truncate flex-1">
                      <span className="font-mono text-muted/70 mr-1.5">{idx + 1}.</span>
                      {m.name}
                    </p>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      {m.count} vendido{m.count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-400 mt-0.5">
                    Lucro: {BRL(m.profitCents)}
                    {m.count > 0 && (
                      <span className="text-muted/70 ml-1">(média {BRL(Math.round(m.profitCents / m.count))}/un)</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">Nenhum aparelho vendido com IMEI no período.</p>
          )}
        </div>
      </div>
    </div>
  )
}
