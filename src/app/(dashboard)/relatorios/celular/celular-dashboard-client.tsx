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

  const profitColor = kpis.totalProfitCents >= 0 ? 'text-emerald-700' : 'text-rose-700'
  const profitBg    = kpis.totalProfitCents >= 0 ? 'from-emerald-50' : 'from-rose-50'
  const cancelColor =
    kpis.cancellationRate < 3   ? 'text-emerald-700'
  : kpis.cancellationRate < 10  ? 'text-amber-700'
  :                                'text-rose-700'

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
          <div className="flex gap-1 rounded-lg border border-zinc-200 bg-white p-0.5">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => changePeriod(p.key)}
                disabled={pending}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  period === p.key
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-zinc-600 hover:bg-zinc-50'
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
        <div className={`rounded-2xl border bg-gradient-to-br ${profitBg} to-white p-4 shadow-sm`}>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-600">
            {kpis.totalProfitCents >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            Lucro do período
          </div>
          <p className={`mt-1 text-2xl font-bold ${profitColor}`}>{BRL(kpis.totalProfitCents)}</p>
          <p className="text-xs text-zinc-500">Margem: {pct(kpis.averageMarginPct)}</p>
        </div>

        {/* Receita */}
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
            <ShoppingBag className="h-3.5 w-3.5" />
            Receita IMEI
          </div>
          <p className="mt-1 text-2xl font-bold text-blue-700">{BRL(kpis.grossRevenueCents)}</p>
          <p className="text-xs text-blue-600">{kpis.imeisSoldCount} aparelho{kpis.imeisSoldCount !== 1 ? 's' : ''} vendido{kpis.imeisSoldCount !== 1 ? 's' : ''}</p>
        </div>

        {/* Ticket médio */}
        <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-700">
            <ShoppingCart className="h-3.5 w-3.5" />
            Ticket médio
          </div>
          <p className="mt-1 text-2xl font-bold text-purple-700">{BRL(kpis.averageTicketCents)}</p>
          <p className="text-xs text-purple-600">{kpis.totalSalesCount} venda{kpis.totalSalesCount !== 1 ? 's' : ''} totais</p>
        </div>

        {/* Lucro médio por IMEI */}
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
            <Award className="h-3.5 w-3.5" />
            Lucro médio/IMEI
          </div>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{BRL(kpis.averageProfitCents)}</p>
          <p className="text-xs text-emerald-600">Custo total: {BRL(kpis.totalCostCents)}</p>
        </div>
      </div>

      {/* ── KPIs operacionais ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`rounded-2xl border p-4 ${
          kpis.cancellationRate >= 10 ? 'border-rose-200 bg-rose-50' :
          kpis.cancellationRate >= 3  ? 'border-amber-200 bg-amber-50' :
                                        'border-zinc-200 bg-white'
        }`}>
          <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${cancelColor}`}>
            <AlertTriangle className="h-3.5 w-3.5" />
            Taxa de devolução
          </div>
          <p className={`mt-1 text-2xl font-bold ${cancelColor}`}>{pct(kpis.cancellationRate)}</p>
          <p className="text-xs text-zinc-500">{kpis.cancelledCount} cancelada{kpis.cancelledCount !== 1 ? 's' : ''}</p>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-700">
            <Wrench className="h-3.5 w-3.5" />
            OS abertas
          </div>
          <p className="mt-1 text-2xl font-bold text-zinc-900">{kpis.serviceOrdersOpen}</p>
          <p className="text-xs text-zinc-500">aberta, em conserto ou pronta</p>
        </div>

        <div className={`rounded-2xl border p-4 ${kpis.installmentsLate.count > 0 ? 'border-rose-200 bg-rose-50' : 'border-zinc-200 bg-white'}`}>
          <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${kpis.installmentsLate.count > 0 ? 'text-rose-700' : 'text-zinc-700'}`}>
            <CalendarClock className="h-3.5 w-3.5" />
            Parcelas atrasadas
          </div>
          <p className={`mt-1 text-2xl font-bold ${kpis.installmentsLate.count > 0 ? 'text-rose-700' : 'text-zinc-900'}`}>
            {kpis.installmentsLate.count}
          </p>
          <p className="text-xs text-zinc-500">{BRL(kpis.installmentsLate.totalCents)} a receber</p>
        </div>

        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
            <CalendarClock className="h-3.5 w-3.5" />
            Parcelas a vencer
          </div>
          <p className="mt-1 text-2xl font-bold text-blue-700">{kpis.installmentsPending.count}</p>
          <p className="text-xs text-blue-600">{BRL(kpis.installmentsPending.totalCents)}</p>
        </div>
      </div>

      {/* ── Aging de estoque ── */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm ring-1 ring-zinc-200">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
              <Package className="h-4 w-4 text-blue-500" />
              Aging de estoque (IMEIs disponíveis)
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Há quanto tempo cada aparelho tá parado. IMEIs com 60+ dias merecem atenção.
            </p>
          </div>
          <div className="text-right text-xs text-zinc-500">
            <p>Total: <span className="font-semibold text-zinc-900">{totalAvailable}</span> aparelho{totalAvailable !== 1 ? 's' : ''}</p>
            <p>Capital parado: <span className="font-semibold text-zinc-900">{BRL(totalAvailableValue)}</span></p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Até 30 dias', data: kpis.aging.bucket0_30,   color: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
            { label: '31-60 dias',  data: kpis.aging.bucket31_60,  color: 'border-blue-200 bg-blue-50 text-blue-700' },
            { label: '61-90 dias',  data: kpis.aging.bucket61_90,  color: 'border-amber-200 bg-amber-50 text-amber-700' },
            { label: '90+ dias',    data: kpis.aging.bucket90Plus, color: 'border-rose-200 bg-rose-50 text-rose-700' },
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
        <div className="rounded-2xl border bg-white p-5 shadow-sm ring-1 ring-zinc-200">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-zinc-900">
            <Smartphone className="h-4 w-4 text-amber-500" />
            Compras de aparelhos
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Quantidade</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{kpis.acquisitionsCount}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Investido</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{BRL(kpis.acquisitionsTotalCents)}</p>
            </div>
          </div>

          {kpis.topSuppliers.length > 0 ? (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-600">
                <Building2 className="h-3 w-3" />
                Top fornecedores
              </p>
              <ul className="space-y-1.5">
                {kpis.topSuppliers.map((s, idx) => (
                  <li key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-700 truncate flex-1">
                      <span className="font-mono text-zinc-400 mr-1.5">{idx + 1}.</span>
                      {s.name}
                    </span>
                    <span className="text-zinc-500">{s.count} apr · {BRL(s.totalCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Nenhuma compra de fornecedor no período.</p>
          )}
        </div>

        {/* Top modelos */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm ring-1 ring-zinc-200">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-zinc-900">
            <Award className="h-4 w-4 text-emerald-500" />
            Top modelos vendidos
          </h2>

          {kpis.topModels.length > 0 ? (
            <ul className="space-y-2">
              {kpis.topModels.map((m, idx) => (
                <li key={idx} className="rounded-lg border border-zinc-100 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-900 truncate flex-1">
                      <span className="font-mono text-zinc-400 mr-1.5">{idx + 1}.</span>
                      {m.name}
                    </p>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      {m.count} vendido{m.count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    Lucro: {BRL(m.profitCents)}
                    {m.count > 0 && (
                      <span className="text-zinc-400 ml-1">(média {BRL(Math.round(m.profitCents / m.count))}/un)</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500">Nenhum aparelho vendido com IMEI no período.</p>
          )}
        </div>
      </div>
    </div>
  )
}
