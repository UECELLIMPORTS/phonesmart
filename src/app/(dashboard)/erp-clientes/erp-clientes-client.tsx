'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  TrendingUp, Users, UserPlus, Lightbulb,
  ShoppingCart, Wrench, Link2, AlertTriangle, Star, Calendar, Megaphone,
  Phone, MessageCircle, Download, Stethoscope,
} from 'lucide-react'
import { CUSTOMER_ORIGIN_OPTIONS, originLabel } from '@/lib/customer-origin'
import type { DashboardData, TopClient, MonthPoint, ChurnClient, WeekdayPoint, OriginBreakdown } from './page'

// ── Helpers ────────────────────────────────────────────────────────────────

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

// ── Donut Chart (CSS conic-gradient) ──────────────────────────────────────

function DonutChart({ recShare, novShare }: { recShare: number; novShare: number }) {
  const recDeg = Math.round((recShare / 100) * 360)
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
        <div style={{
          width: 180, height: 180, borderRadius: '50%',
          background: recShare === 0
            ? '#8B5CF6'
            : recShare === 100
            ? '#10B981'
            : `conic-gradient(#10B981 0deg ${recDeg}deg, #8B5CF6 ${recDeg}deg 360deg)`,
        }} />
        <div
          className="absolute flex flex-col items-center justify-center"
          style={{ width: 112, height: 112, borderRadius: '50%', background: '#1B2638' }}
        >
          <span className="text-xl font-bold" style={{ color: '#F8FAFC', fontFamily: 'ui-monospace,monospace' }}>
            {recShare}%
          </span>
          <span className="text-[10px]" style={{ color: '#94A3B8', marginTop: 2 }}>Recorrentes</span>
        </div>
      </div>
      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: '#10B981' }} />
          <span className="text-xs" style={{ color: '#CBD5E1' }}>Recorrentes {recShare}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: '#8B5CF6' }} />
          <span className="text-xs" style={{ color: '#CBD5E1' }}>Novos {novShare}%</span>
        </div>
      </div>
    </div>
  )
}

// ── Bar Chart (CSS flexbox) ────────────────────────────────────────────────

function BarChart({ months }: { months: MonthPoint[] }) {
  const [metric, setMetric] = useState<'fatur' | 'lucro'>('fatur')
  const recKey  = metric === 'fatur' ? 'recorrentes' : 'recorrentesProfit'
  const novKey  = metric === 'fatur' ? 'novos'       : 'novosProfit'
  const maxVal = Math.max(...months.flatMap(m => [m[recKey], m[novKey]]), 1)

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="flex gap-1 rounded-lg p-1" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
          <button
            onClick={() => setMetric('fatur')}
            className="rounded px-3 py-1 text-[11px] font-bold transition-all"
            style={metric === 'fatur' ? { background: '#2A3650', color: '#F8FAFC' } : { color: '#94A3B8' }}
          >
            Faturamento
          </button>
          <button
            onClick={() => setMetric('lucro')}
            className="rounded px-3 py-1 text-[11px] font-bold transition-all"
            style={metric === 'lucro' ? { background: '#2A3650', color: '#10B981' } : { color: '#94A3B8' }}
          >
            Lucro
          </button>
        </div>
      </div>
      <div className="flex w-full items-end gap-2" style={{ height: 180 }}>
        {months.map(m => {
          const recVal = m[recKey]
          const novVal = m[novKey]
          const recH = Math.max((recVal / maxVal) * 140, recVal > 0 ? 6 : 0)
          const novH = Math.max((novVal / maxVal) * 140, novVal > 0 ? 6 : 0)
          return (
            <div key={m.label} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-end gap-0.5" style={{ height: 140 }}>
                <div
                  className="flex-1 rounded-t-sm transition-all duration-500"
                  style={{ height: recH, background: 'rgba(16,185,129,0.65)' }}
                  title={`Recorrentes (${metric}): ${BRL(recVal)}`}
                />
                <div
                  className="flex-1 rounded-t-sm transition-all duration-500"
                  style={{ height: novH, background: 'rgba(155,109,255,0.65)' }}
                  title={`Novos (${metric}): ${BRL(novVal)}`}
                />
              </div>
              <span className="text-[10px] capitalize" style={{ color: '#94A3B8' }}>{m.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────

function ClientCard({
  label, icon: Icon, color, glowColor,
  totalCents, profitCents, ticketMedioCents, avgProducts, sharePercent, marginPercent, transactions,
}: {
  label: string; icon: React.ElementType; color: string; glowColor: string
  totalCents: number; profitCents: number
  ticketMedioCents: number; avgProducts: string
  sharePercent: number; marginPercent: number; transactions: number
}) {
  return (
    <div
      className="rounded-2xl border p-6 relative overflow-hidden"
      style={{ background: '#1B2638', borderColor: '#2A3650' }}
    >
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-30"
        style={{ background: `radial-gradient(circle, ${glowColor}, transparent)` }}
      />
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: `${color}20` }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
          {label}
        </span>
      </div>

      {/* Faturamento */}
      <div>
        <span className="text-3xl font-bold tracking-tight" style={{ color, fontFamily: 'ui-monospace,monospace' }}>
          {BRL(totalCents)}
        </span>
        <span className="ml-2 text-xs" style={{ color: '#94A3B8' }}>{transactions} pedidos</span>
      </div>

      {/* Lucro + margem */}
      <div className="mb-4 mt-1 flex items-baseline gap-2">
        <span className="text-lg font-bold" style={{ color: '#10B981', fontFamily: 'ui-monospace,monospace' }}>
          {BRL(profitCents)}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
          Lucro · margem {marginPercent}%
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Ticket Médio', value: BRL(ticketMedioCents) },
          { label: 'Produtos/OS',  value: avgProducts },
          { label: 'Share',        value: `${sharePercent}%` },
        ].map(({ label: l, value }) => (
          <div
            key={l}
            className="flex flex-col items-center rounded-lg py-2.5"
            style={{ background: '#131C2A', border: '1px solid #2A3650' }}
          >
            <span className="text-sm font-bold" style={{ color, fontFamily: 'ui-monospace,monospace' }}>
              {value}
            </span>
            <span className="mt-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              {l}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sources: PhoneSmart vs CheckSmart ───────────────────────────────────────

function SourcesSection({ sources }: { sources: DashboardData['sources'] }) {
  const items = [
    {
      label: 'PhoneSmart — POS',
      icon: ShoppingCart,
      color: '#22C55E',
      glow: 'rgba(34,197,94,.4)',
      totalCents: sources.phonesmart.totalCents,
      profitCents: sources.phonesmart.profitCents,
      transactions: sources.phonesmart.transactions,
      customers: sources.phonesmart.uniqueCustomers,
      sub: 'vendas no caixa',
    },
    {
      label: 'CheckSmart — OS',
      icon: Wrench,
      color: '#8B5CF6',
      glow: 'rgba(155,109,255,.4)',
      totalCents: sources.checksmart.totalCents,
      profitCents: sources.checksmart.profitCents,
      transactions: sources.checksmart.transactions,
      customers: sources.checksmart.uniqueCustomers,
      sub: 'ordens de serviço',
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {items.map(({ label, icon: Icon, color, glow, totalCents, profitCents, transactions, customers, sub }) => {
        const marginPct = totalCents > 0 ? Math.round((profitCents / totalCents) * 100) : 0
        return (
          <div
            key={label}
            className="rounded-2xl border p-6 relative overflow-hidden"
            style={{ background: '#1B2638', borderColor: '#2A3650' }}
          >
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20"
              style={{ background: `radial-gradient(circle, ${glow}, transparent)` }}
            />
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: `${color}20` }}>
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
                {label}
              </span>
            </div>

            {/* Faturamento */}
            <div className="mb-1">
              <span className="text-3xl font-bold tracking-tight" style={{ color, fontFamily: 'ui-monospace,monospace' }}>
                {BRL(totalCents)}
              </span>
              <p className="text-[10px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: '#94A3B8' }}>
                Faturamento
              </p>
            </div>

            {/* Lucro */}
            <div className="mb-4 flex items-baseline gap-2">
              <span className="text-lg font-bold" style={{ color: '#10B981', fontFamily: 'ui-monospace,monospace' }}>
                {BRL(profitCents)}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                Lucro · margem {marginPct}%
              </span>
            </div>

            <div className="flex gap-3">
              <div className="flex flex-col items-center flex-1 rounded-lg py-2.5"
                style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
                <span className="text-sm font-bold" style={{ color, fontFamily: 'ui-monospace,monospace' }}>{transactions}</span>
                <span className="mt-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>{sub}</span>
              </div>
              <div className="flex flex-col items-center flex-1 rounded-lg py-2.5"
                style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
                <span className="text-sm font-bold" style={{ color, fontFamily: 'ui-monospace,monospace' }}>{customers}</span>
                <span className="mt-1 text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>clientes únicos</span>
              </div>
            </div>
          </div>
        )
      })}

      {/* Overlap card */}
      <div
        className="rounded-2xl border p-6 relative overflow-hidden flex flex-col items-center justify-center text-center"
        style={{ background: '#1B2638', borderColor: '#2A3650' }}
      >
        <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, rgba(16,185,129,.4), transparent)' }}
        />
        <div className="flex h-10 w-10 items-center justify-center rounded-xl mb-3"
          style={{ background: 'rgba(16,185,129,.15)' }}>
          <Link2 className="h-5 w-5" style={{ color: '#10B981' }} />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: '#94A3B8' }}>
          Clientes em Ambos
        </span>
        <span className="text-5xl font-bold" style={{ color: '#10B981', fontFamily: 'ui-monospace,monospace' }}>
          {sources.overlap}
        </span>
        <p className="mt-2 text-xs" style={{ color: '#94A3B8' }}>
          usaram PhoneSmart e CheckSmart no período
        </p>
      </div>
    </div>
  )
}

// ── RFM Segments ──────────────────────────────────────────────────────────

function RfmSection({ rfmSegments }: { rfmSegments: DashboardData['rfmSegments'] }) {
  const segments = [
    {
      key: 'campeoes' as const,
      label: 'Campeões',
      desc: 'Recentes, frequentes e alto valor',
      color: '#10B981',
      bg: 'rgba(16,185,129,.12)',
      icon: '🏆',
    },
    {
      key: 'emRisco' as const,
      label: 'Em Risco',
      desc: 'Alto valor mas sem comprar há tempo',
      color: '#EF4444',
      bg: 'rgba(255,77,109,.12)',
      icon: '⚠️',
    },
    {
      key: 'novosPromissores' as const,
      label: 'Promissores',
      desc: 'Compraram recentemente, pouco frequentes',
      color: '#22C55E',
      bg: 'rgba(34,197,94,.12)',
      icon: '✨',
    },
    {
      key: 'dormentes' as const,
      label: 'Dormentes',
      desc: 'Inativos com baixo histórico',
      color: '#94A3B8',
      bg: 'rgba(90,122,154,.12)',
      icon: '💤',
    },
  ]

  const total = Object.values(rfmSegments).reduce((a, b) => a + b, 0) || 1

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {segments.map(({ key, label, desc, color, bg, icon }) => {
        const count = rfmSegments[key]
        const pct = Math.round((count / total) * 100)
        return (
          <div
            key={key}
            className="rounded-2xl border p-5 flex flex-col"
            style={{ background: '#1B2638', borderColor: '#2A3650' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-lg">{icon}</span>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                style={{ background: bg, color }}
              >
                {pct}%
              </span>
            </div>
            <span className="text-2xl font-bold mb-1" style={{ color, fontFamily: 'ui-monospace,monospace' }}>
              {count}
            </span>
            <span className="text-xs font-bold" style={{ color: '#F8FAFC' }}>{label}</span>
            <span className="mt-1 text-[10px]" style={{ color: '#94A3B8' }}>{desc}</span>
            {/* Progress bar */}
            <div className="mt-3 h-1 rounded-full" style={{ background: '#2A3650' }}>
              <div
                className="h-1 rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Weekday Heatmap ───────────────────────────────────────────────────────

type SourceFilter = 'total' | 'phonesmart' | 'checksmart'

function WeekdayHeatmap({ days }: { days: WeekdayPoint[] }) {
  const [source, setSource] = useState<SourceFilter>('total')
  const [metric, setMetric] = useState<'totalCents' | 'profitCents'>('totalCents')

  const bucketOf = (d: WeekdayPoint) => d[source]
  const valueOf  = (d: WeekdayPoint) => bucketOf(d)[metric]

  const maxVal = Math.max(...days.map(valueOf), 1)
  const bestIdx = days.reduce((best, d, i) => valueOf(d) > valueOf(days[best]) ? i : best, 0)
  const hasAny = days.some(d => valueOf(d) > 0)

  const SOURCE_OPTS: { value: SourceFilter; label: string; color: string }[] = [
    { value: 'total',      label: 'Ambos',      color: '#22C55E' },
    { value: 'phonesmart',   label: 'PhoneSmart',   color: '#10B981' },
    { value: 'checksmart', label: 'CheckSmart', color: '#8B5CF6' },
  ]
  const activeColor = SOURCE_OPTS.find(o => o.value === source)?.color ?? '#22C55E'

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg p-1" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
          {SOURCE_OPTS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSource(opt.value)}
              className="rounded px-3 py-1 text-[11px] font-bold transition-all"
              style={source === opt.value
                ? { background: opt.color, color: '#000' }
                : { color: '#94A3B8' }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg p-1" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
          <button
            onClick={() => setMetric('totalCents')}
            className="rounded px-3 py-1 text-[11px] font-bold transition-all"
            style={metric === 'totalCents'
              ? { background: '#2A3650', color: '#F8FAFC' }
              : { color: '#94A3B8' }
            }
          >
            Faturamento
          </button>
          <button
            onClick={() => setMetric('profitCents')}
            className="rounded px-3 py-1 text-[11px] font-bold transition-all"
            style={metric === 'profitCents'
              ? { background: '#2A3650', color: '#10B981' }
              : { color: '#94A3B8' }
            }
          >
            Lucro
          </button>
        </div>
      </div>

      {metric === 'profitCents' && (
        <div
          className="flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]"
          style={{ background: 'rgba(255,170,0,.06)', borderColor: 'rgba(255,170,0,.3)', color: '#CBD5E1' }}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
          <span>
            <strong style={{ color: '#F59E0B' }}>Lucro pode estar inflado</strong> se produtos estiverem sem custo
            cadastrado no Estoque ou OS sem peças lançadas. Cadastre o custo real em cada produto e
            lance peças nas OS para ter o lucro correto.
          </span>
        </div>
      )}

      {!hasAny ? (
        <p className="py-10 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem dados para os filtros selecionados no período
        </p>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {days.map((day, i) => {
            const bucket = bucketOf(day)
            const v = valueOf(day)
            const tx = bucket.transactions
            const intensity = v / maxVal
            const isBest = i === bestIdx && v > 0
            const rgba = activeColor === '#10B981'
              ? `rgba(16,185,129,${0.04 + intensity * 0.22})`
              : activeColor === '#8B5CF6'
              ? `rgba(155,109,255,${0.04 + intensity * 0.22})`
              : `rgba(34,197,94,${0.04 + intensity * 0.22})`
            return (
              <div
                key={day.label}
                className="flex flex-col items-center gap-1.5 rounded-xl p-2.5 transition-all"
                style={{
                  background: rgba,
                  border: isBest ? `1px solid ${activeColor}80` : '1px solid #2A3650',
                }}
              >
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-bold" style={{ color: isBest ? activeColor : '#CBD5E1' }}>
                    {day.label}
                  </span>
                  {isBest && (
                    <span className="rounded-full px-1 py-0.5 text-[7px] font-bold"
                      style={{ background: `${activeColor}33`, color: activeColor }}>
                      TOP
                    </span>
                  )}
                </div>

                {tx === 0 ? (
                  <span className="text-xs" style={{ color: '#94A3B8', marginTop: 4, marginBottom: 4 }}>—</span>
                ) : (
                  <>
                    {/* Faturamento */}
                    <div className="flex flex-col items-center w-full">
                      <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                        Fatur.
                      </span>
                      <span className="text-[11px] font-bold leading-tight"
                        style={{ color: metric === 'totalCents' && intensity > 0.5 ? activeColor : '#F8FAFC', fontFamily: 'ui-monospace,monospace' }}>
                        {BRL(bucket.totalCents)}
                      </span>
                    </div>

                    {/* Lucro */}
                    <div className="flex flex-col items-center w-full">
                      <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                        Lucro
                      </span>
                      <span className="text-[11px] font-bold leading-tight"
                        style={{ color: metric === 'profitCents' && intensity > 0.5 ? activeColor : '#10B981', fontFamily: 'ui-monospace,monospace' }}>
                        {BRL(bucket.profitCents)}
                      </span>
                    </div>

                    {/* Vendas */}
                    <div className="flex flex-col items-center w-full">
                      <span className="text-[8px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                        Vendas
                      </span>
                      <span className="text-[11px] font-bold leading-tight" style={{ color: '#F8FAFC', fontFamily: 'ui-monospace,monospace' }}>
                        {tx}
                      </span>
                    </div>
                  </>
                )}

                <div className="w-full h-1 rounded-full mt-1" style={{ background: '#2A3650' }}>
                  <div
                    className="h-1 rounded-full"
                    style={{ width: `${Math.round(intensity * 100)}%`, background: activeColor }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Churn Risk Table ──────────────────────────────────────────────────────

function ChurnTable({ clients }: { clients: ChurnClient[] }) {
  const [source, setSource]         = useState<SourceFilter>('total')
  const [originVal, setOriginVal]   = useState<string>('all')
  const [threshold, setThreshold]   = useState<number>(60)

  function urgency(days: number) {
    if (days >= 120) return { label: 'Crítico', color: '#EF4444', bg: 'rgba(255,77,109,.15)' }
    if (days >= 90)  return { label: 'Alto',    color: '#F59E0B', bg: 'rgba(255,170,0,.15)' }
    return              { label: 'Médio',    color: '#8B5CF6', bg: 'rgba(155,109,255,.15)' }
  }

  const extract = (c: ChurnClient) => {
    if (source === 'phonesmart')   return { days: c.sources.phonesmart.daysSince,   total: c.sources.phonesmart.totalCents,   tx: c.sources.phonesmart.transactions }
    if (source === 'checksmart') return { days: c.sources.checksmart.daysSince, total: c.sources.checksmart.totalCents, tx: c.sources.checksmart.transactions }
    return { days: c.daysSince, total: c.totalCents, tx: c.transactions }
  }

  const filtered = clients
    .map(c => ({ c, m: extract(c) }))
    .filter(x => x.m.tx > 0 && x.m.days !== null && x.m.days >= threshold)
    .filter(x => {
      if (originVal === 'all')            return true
      if (originVal === '__no_origin__')  return !x.c.origin
      return x.c.origin === originVal
    })
    .sort((a, b) => b.m.total - a.m.total)
    .slice(0, 50)

  const SOURCE_OPTS: { value: SourceFilter; label: string; color: string }[] = [
    { value: 'total',      label: 'Ambos',      color: '#EF4444' },
    { value: 'phonesmart',   label: 'PhoneSmart',   color: '#10B981' },
    { value: 'checksmart', label: 'CheckSmart', color: '#8B5CF6' },
  ]

  function stripDigits(s: string | null): string {
    return (s ?? '').replace(/\D/g, '')
  }
  function fmtPhone(s: string | null): string {
    const d = stripDigits(s)
    if (!d) return ''
    if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
    if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
    return s ?? ''
  }
  function waLink(whats: string | null, name: string, days: number): string {
    const d = stripDigits(whats)
    if (!d) return ''
    const msg = encodeURIComponent(
      `Oi ${name.split(' ')[0]}! Aqui é da UÉ Cell Imports. Vi que faz ${days} dias que você não passa por aqui. Tem alguma novidade que podemos te ajudar?`,
    )
    const prefix = d.length <= 11 && !d.startsWith('55') ? '55' : ''
    return `https://wa.me/${prefix}${d}?text=${msg}`
  }

  function exportCsv() {
    const BOM = '﻿'
    const header = 'Cliente;WhatsApp;Telefone;Origem;Dias sem comprar;Valor total (6m);Pedidos;Risco\n'
    const lines = filtered.map(({ c, m }) => {
      const days = m.days ?? 0
      const risk = urgency(days).label
      const total = (m.total / 100).toFixed(2).replace('.', ',')
      const ori = c.origin ? originLabel(c.origin) : 'Não informado'
      const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
      return [
        cell(c.name),
        cell(fmtPhone(c.whatsapp)),
        cell(fmtPhone(c.phone)),
        cell(ori),
        days,
        `"R$ ${total}"`,
        m.tx,
        cell(risk),
      ].join(';')
    }).join('\n')

    const blob = new Blob([BOM + header + lines], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes-em-risco-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Sistema */}
        <div className="flex gap-1 rounded-lg p-1" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
          {SOURCE_OPTS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSource(opt.value)}
              className="rounded px-3 py-1 text-[11px] font-bold transition-all"
              style={source === opt.value
                ? { background: opt.color, color: '#000' }
                : { color: '#94A3B8' }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Origem */}
        <select
          value={originVal}
          onChange={e => setOriginVal(e.target.value)}
          className="rounded-lg border px-3 py-1 text-xs outline-none"
          style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
        >
          <option value="all">Todas as origens</option>
          {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
          <option value="__no_origin__">Sem origem informada</option>
        </select>

        {/* Threshold */}
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Sem comprar há</span>
          <input
            type="number"
            min={1}
            max={180}
            value={threshold}
            onChange={e => setThreshold(Math.max(1, Math.min(180, parseInt(e.target.value) || 1)))}
            className="w-14 bg-transparent text-xs font-bold outline-none text-right tabular-nums"
            style={{ color: '#F8FAFC' }}
          />
          <span className="text-[11px]" style={{ color: '#94A3B8' }}>dias+</span>
        </div>

        {/* Export CSV */}
        <button
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="ml-auto flex items-center gap-2 rounded-lg border px-3 py-1 text-xs font-bold transition-all hover:bg-white/5 disabled:opacity-50"
          style={{ borderColor: '#2A3650', color: '#10B981' }}
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </button>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
              {['Cliente', 'Contato', 'Origem', 'Sem comprar há', 'Valor (6m)', 'Pedidos', 'Risco'].map(h => (
                <th key={h} className="pb-3 pr-4 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: '#94A3B8' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ c, m }, i) => {
              const days  = m.days ?? 0
              const u     = urgency(days)
              const wa    = waLink(c.whatsapp, c.name, days)
              const phone = fmtPhone(c.whatsapp || c.phone)
              return (
                <tr
                  key={i}
                  className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: 'rgba(30,45,69,.5)' }}
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                        style={{ background: 'rgba(255,77,109,.12)', color: '#EF4444' }}>
                        {c.name.trim().charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium" style={{ color: '#F8FAFC' }}>{c.name}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {phone ? (
                      <div className="flex items-center gap-1.5">
                        {wa && (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:opacity-80"
                            style={{ background: 'rgba(37,211,102,.15)', color: '#25D366' }}
                            title={`WhatsApp ${phone}`}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <a
                          href={`tel:${stripDigits(c.whatsapp || c.phone)}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:opacity-80"
                          style={{ background: 'rgba(34,197,94,.12)', color: '#22C55E' }}
                          title={`Ligar ${phone}`}
                        >
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                        <span className="text-xs font-mono" style={{ color: '#CBD5E1' }}>{phone}</span>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: '#94A3B8' }}>—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-xs" style={{ color: '#CBD5E1' }}>
                    {c.origin ? originLabel(c.origin) : <span style={{ color: '#94A3B8' }}>—</span>}
                  </td>
                  <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#EF4444' }}>
                    {days} dias
                  </td>
                  <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#CBD5E1' }}>
                    {BRL(m.total)}
                  </td>
                  <td className="py-3 pr-4 font-mono" style={{ color: '#CBD5E1' }}>
                    {m.tx}
                  </td>
                  <td className="py-3">
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                      style={{ background: u.bg, color: u.color }}>
                      {u.label}
                    </span>
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm" style={{ color: '#94A3B8' }}>
                  Nenhum cliente em risco com os filtros atuais — ótimo sinal!
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Top Clients Table ─────────────────────────────────────────────────────

function ClientsTable({ clients }: { clients: TopClient[] }) {
  const [source, setSource] = useState<SourceFilter>('total')

  function badge(c: TopClient) {
    if (c.transactions >= 5 || c.totalCents >= 500000) return { label: 'VIP', color: '#F59E0B', bg: 'rgba(255,170,0,.15)' }
    if (c.type === 'recorrente') return { label: 'Recorrente', color: '#10B981', bg: 'rgba(16,185,129,.12)' }
    return { label: 'Novo', color: '#8B5CF6', bg: 'rgba(155,109,255,.15)' }
  }

  // Extrai totalCents/profitCents/tx conforme filtro
  const metricsOf = (c: TopClient) => {
    if (source === 'phonesmart')   return { total: c.sources.phonesmart.totalCents,   profit: c.sources.phonesmart.profitCents,   tx: c.sources.phonesmart.transactions }
    if (source === 'checksmart') return { total: c.sources.checksmart.totalCents, profit: c.sources.checksmart.profitCents, tx: c.sources.checksmart.transactions }
    return { total: c.totalCents, profit: c.profitCents, tx: c.transactions }
  }

  const filtered = clients
    .map(c => ({ c, m: metricsOf(c) }))
    .filter(x => x.m.tx > 0)
    .sort((a, b) => b.m.total - a.m.total)
    .slice(0, 10)

  const SOURCE_OPTS: { value: SourceFilter; label: string; color: string }[] = [
    { value: 'total',      label: 'Ambos',      color: '#22C55E' },
    { value: 'phonesmart',   label: 'PhoneSmart',   color: '#10B981' },
    { value: 'checksmart', label: 'CheckSmart', color: '#8B5CF6' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg p-1 w-fit" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
        {SOURCE_OPTS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSource(opt.value)}
            className="rounded px-3 py-1 text-[11px] font-bold transition-all"
            style={source === opt.value
              ? { background: opt.color, color: '#000' }
              : { color: '#94A3B8' }
            }
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
              {['Cliente', 'Contato', 'Pedidos', 'Faturamento', 'Lucro', 'Ticket Médio', 'Tipo', 'Último contato'].map(h => (
                <th key={h} className="pb-3 pr-4 text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: '#94A3B8' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(({ c, m }, i) => {
              const b = badge(c)
              const ticket = m.tx > 0 ? Math.round(m.total / m.tx) : 0
              const waNum = stripDigits(c.whatsapp)
              const phoneNum = stripDigits(c.whatsapp || c.phone)
              const phoneDisplay = fmtPhone(c.whatsapp || c.phone)
              const wa = waNum
                ? `https://wa.me/${waNum.startsWith('55') ? '' : '55'}${waNum}?text=${encodeURIComponent(`Olá ${c.name.split(' ')[0]}! Tudo bem?`)}`
                : ''
              return (
                <tr
                  key={i}
                  className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: 'rgba(30,45,69,.5)' }}
                >
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
                        style={{ background: 'rgba(34,197,94,.12)', color: '#22C55E' }}>
                        {c.name.trim().charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-sm" style={{ color: '#F8FAFC' }}>{c.name}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    {phoneDisplay ? (
                      <div className="flex items-center gap-1.5">
                        {wa && (
                          <a href={wa} target="_blank" rel="noopener noreferrer"
                            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:opacity-80"
                            style={{ background: 'rgba(37,211,102,.15)', color: '#25D366' }}
                            title={`WhatsApp ${phoneDisplay}`}>
                            <MessageCircle className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <a href={`tel:${phoneNum}`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:opacity-80"
                          style={{ background: 'rgba(34,197,94,.12)', color: '#22C55E' }}
                          title={`Ligar ${phoneDisplay}`}>
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                        <span className="text-xs font-mono" style={{ color: '#CBD5E1' }}>{phoneDisplay}</span>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: '#94A3B8' }}>—</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#F8FAFC' }}>
                    {m.tx}
                  </td>
                  <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#F8FAFC' }}>
                    {BRL(m.total)}
                  </td>
                  <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#10B981' }}>
                    {BRL(m.profit)}
                  </td>
                  <td className="py-3 pr-4 font-mono" style={{ color: '#CBD5E1' }}>
                    {BRL(ticket)}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-bold"
                      style={{ background: b.bg, color: b.color }}>
                      {b.label}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-xs" style={{ color: '#94A3B8' }}>
                    {c.lastDate}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm" style={{ color: '#94A3B8' }}>
                  Nenhum cliente encontrado no sistema selecionado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function stripDigits(s: string | null): string {
  return (s ?? '').replace(/\D/g, '')
}
function fmtPhone(s: string | null): string {
  const d = stripDigits(s)
  if (!d) return ''
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return s ?? ''
}

// ── Origem dos clientes ──────────────────────────────────────────────────

const ORIGIN_COLORS: Record<string, string> = {
  instagram_pago:     '#E4405F',
  instagram_organico: '#C13584',
  indicacao:          '#10B981',
  passou_na_porta:    '#F59E0B',
  google:             '#4285F4',
  facebook:           '#1877F2',
  outros:             '#8B5CF6',
}

function OriginSection({ breakdown }: { breakdown: OriginBreakdown[] }) {
  const [source, setSource] = useState<SourceFilter>('total')
  const [metric, setMetric] = useState<'totalCents' | 'profitCents'>('totalCents')

  const bucketOf = (b: OriginBreakdown) => b[source]
  const valueOf  = (b: OriginBreakdown) => bucketOf(b)[metric]

  const filtered = breakdown
    .map(b => ({ ...b, _val: valueOf(b), _bucket: bucketOf(b) }))
    .filter(b => b._val > 0 || b._bucket.transactions > 0)
    .sort((a, b) => b._val - a._val)

  if (filtered.length === 0) {
    return (
      <div className="space-y-4">
        <OriginFilters source={source} metric={metric} setSource={setSource} setMetric={setMetric} />
        <p className="py-10 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem dados para os filtros selecionados no período
        </p>
      </div>
    )
  }

  const maxVal = Math.max(...filtered.map(b => b._val), 1)
  const filteredTotal = filtered.reduce((sum, b) => sum + b._val, 0)
  const totalCustomers = filtered.reduce((sum, b) => sum + b._bucket.uniqueCustomers, 0)
  const topOrigin = filtered[0]
  const metricLabel = metric === 'profitCents' ? 'lucro' : 'faturamento'

  return (
    <div className="space-y-5">
      <OriginFilters source={source} metric={metric} setSource={setSource} setMetric={setMetric} />

      {metric === 'profitCents' && (
        <div
          className="flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]"
          style={{ background: 'rgba(255,170,0,.06)', borderColor: 'rgba(255,170,0,.3)', color: '#CBD5E1' }}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
          <span>
            <strong style={{ color: '#F59E0B' }}>Lucro depende de custo cadastrado</strong> — produtos sem custo
            e OS sem peças lançadas fazem o lucro parecer maior do que é.
          </span>
        </div>
      )}

      {/* Insight destaque */}
      {topOrigin.value && (
        <div
          className="flex items-start gap-3 rounded-xl border px-4 py-3"
          style={{
            background: `${ORIGIN_COLORS[topOrigin.value] ?? '#22C55E'}0D`,
            borderColor: `${ORIGIN_COLORS[topOrigin.value] ?? '#22C55E'}40`,
            borderLeftWidth: 3,
            borderLeftColor: ORIGIN_COLORS[topOrigin.value] ?? '#22C55E',
          }}
        >
          <Megaphone className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: ORIGIN_COLORS[topOrigin.value] ?? '#22C55E' }} />
          <p className="text-sm" style={{ color: '#CBD5E1' }}>
            <span className="font-semibold" style={{ color: '#F8FAFC' }}>{topOrigin.label}</span>{' '}
            é seu principal canal no período — {filteredTotal > 0 ? Math.round((topOrigin._val / filteredTotal) * 100) : 0}% do {metricLabel}
            ({BRL(topOrigin._val)}) vindo de {topOrigin._bucket.uniqueCustomers} cliente(s).
          </p>
        </div>
      )}

      {/* Ranking por origem */}
      <div className="space-y-3">
        {filtered.map(b => {
          const color = b.value ? (ORIGIN_COLORS[b.value] ?? '#94A3B8') : '#94A3B8'
          const barPct = Math.round((b._val / maxVal) * 100)
          const pct    = filteredTotal > 0 ? Math.round((b._val / filteredTotal) * 100) : 0
          const ticket = b._bucket.transactions > 0 ? Math.round(b._bucket.totalCents / b._bucket.transactions) : 0
          return (
            <div
              key={b.value ?? 'sem-origem'}
              className="rounded-xl border p-4"
              style={{ background: '#131C2A', borderColor: '#2A3650' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-sm font-semibold truncate" style={{ color: '#F8FAFC' }}>
                    {b.label}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0"
                    style={{ background: `${color}20`, color }}
                  >
                    {pct}%
                  </span>
                </div>
                <span className="font-bold text-sm shrink-0" style={{ color, fontFamily: 'ui-monospace,monospace' }}>
                  {BRL(b._val)}
                </span>
              </div>
              <div className="h-1.5 rounded-full mb-3" style={{ background: '#2A3650' }}>
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${barPct}%`, background: color }}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Clientes"     value={String(b._bucket.uniqueCustomers)} />
                <Stat label="Transações"   value={String(b._bucket.transactions)} />
                <Stat label="Ticket Médio" value={BRL(ticket)} />
              </div>
            </div>
          )
        })}

        {totalCustomers > 0 && (
          <p className="text-center text-[11px] pt-2" style={{ color: '#94A3B8' }}>
            Total agregado: {totalCustomers} cliente(s) únicos no filtro selecionado
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-sm font-bold" style={{ color: '#F8FAFC', fontFamily: 'ui-monospace,monospace' }}>{value}</p>
      <p className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>{label}</p>
    </div>
  )
}

function OriginFilters({
  source, metric, setSource, setMetric,
}: {
  source: SourceFilter
  metric: 'totalCents' | 'profitCents'
  setSource: (s: SourceFilter) => void
  setMetric: (m: 'totalCents' | 'profitCents') => void
}) {
  const SOURCE_OPTS: { value: SourceFilter; label: string; color: string }[] = [
    { value: 'total',      label: 'Ambos',      color: '#22C55E' },
    { value: 'phonesmart',   label: 'PhoneSmart',   color: '#10B981' },
    { value: 'checksmart', label: 'CheckSmart', color: '#8B5CF6' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 rounded-lg p-1" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
        {SOURCE_OPTS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSource(opt.value)}
            className="rounded px-3 py-1 text-[11px] font-bold transition-all"
            style={source === opt.value
              ? { background: opt.color, color: '#000' }
              : { color: '#94A3B8' }
            }
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1 rounded-lg p-1" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
        <button
          onClick={() => setMetric('totalCents')}
          className="rounded px-3 py-1 text-[11px] font-bold transition-all"
          style={metric === 'totalCents' ? { background: '#2A3650', color: '#F8FAFC' } : { color: '#94A3B8' }}
        >
          Faturamento
        </button>
        <button
          onClick={() => setMetric('profitCents')}
          className="rounded px-3 py-1 text-[11px] font-bold transition-all"
          style={metric === 'profitCents' ? { background: '#2A3650', color: '#10B981' } : { color: '#94A3B8' }}
        >
          Lucro
        </button>
      </div>
    </div>
  )
}

// ── Section header helper ─────────────────────────────────────────────────

function SectionHeader({
  accentColor, title, subtitle, icon: Icon, badge,
}: {
  accentColor: string; title: string; subtitle: string
  icon?: React.ElementType; badge?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-4 w-1 rounded-full" style={{ background: accentColor }} />
      <div className="flex-1">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>{title}</p>
        <p className="text-[11px]" style={{ color: '#94A3B8' }}>{subtitle}</p>
      </div>
      {badge}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export function ErpClientesClient({ data }: { data: DashboardData }) {
  const router = useRouter()
  const {
    period, recorrentes, novos, monthlyData, topClients, insightText,
    sources, churnRisk, rfmSegments, weekdayHeatmap, originBreakdown,
  } = data

  const periods: Period[] = ['7d', '30d', '90d']
  type Period = '7d' | '30d' | '90d' | 'custom'

  const [customOpen, setCustomOpen] = useState(period === 'custom')
  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')

  function applyCustom() {
    if (!fromDate || !toDate) return
    router.push(`/erp-clientes?period=custom&from=${fromDate}&to=${toDate}`)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>ERP — Clientes</h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            Análise de clientes novos vs recorrentes
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/erp-clientes/diagnostico-lucro"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors hover:opacity-90"
            style={{ background: 'rgba(255,170,0,.1)', color: '#F59E0B', border: '1px solid rgba(255,170,0,.3)' }}
            title="Identificar vendas/OSs com lucro inflado por falta de custo cadastrado"
          >
            <Stethoscope className="h-3.5 w-3.5" />
            Diagnóstico de Lucro
          </Link>
          <div className="flex gap-1 rounded-xl p-1" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
            {periods.map(p => (
              <button
                key={p}
                onClick={() => { setCustomOpen(false); router.push(`/erp-clientes?period=${p}`) }}
                className="rounded-lg px-4 py-1.5 text-xs font-bold transition-all"
                style={period === p
                  ? { background: '#22C55E', color: '#000' }
                  : { color: '#94A3B8' }
                }
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setCustomOpen(v => !v)}
              className="rounded-lg px-4 py-1.5 text-xs font-bold transition-all"
              style={period === 'custom' || customOpen
                ? { background: '#22C55E', color: '#000' }
                : { color: '#94A3B8' }
              }
            >
              Datas
            </button>
          </div>
          {customOpen && (
            <div className="flex items-center gap-2 rounded-xl p-2" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                className="rounded-lg border px-2 py-1 text-xs text-text outline-none"
                style={{ background: '#131C2A', borderColor: '#2A3650' }}
              />
              <span className="text-xs" style={{ color: '#94A3B8' }}>até</span>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                className="rounded-lg border px-2 py-1 text-xs text-text outline-none"
                style={{ background: '#131C2A', borderColor: '#2A3650' }}
              />
              <button
                onClick={applyCustom}
                disabled={!fromDate || !toDate}
                className="rounded-lg px-3 py-1 text-xs font-bold transition-opacity disabled:opacity-50"
                style={{ background: '#10B981', color: '#000' }}
              >
                Aplicar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Insight box */}
      <div
        className="flex items-start gap-3 rounded-xl border px-4 py-3"
        style={{ background: 'rgba(34,197,94,.05)', borderColor: 'rgba(34,197,94,.2)', borderLeftWidth: 3, borderLeftColor: '#22C55E' }}
      >
        <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: '#22C55E' }} />
        <p className="text-sm" style={{ color: '#CBD5E1' }}>{insightText}</p>
      </div>

      {/* PhoneSmart vs CheckSmart */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <SectionHeader
            accentColor="#22C55E"
            title="Comparativo de Sistemas"
            subtitle="PhoneSmart (POS) vs CheckSmart (OS) no período"
          />
        </div>
        <div className="p-6">
          <SourcesSection sources={sources} />
        </div>
      </div>

      {/* Origem dos clientes */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <SectionHeader
            accentColor="#E4405F"
            title="Origem dos Clientes"
            subtitle='De onde vêm seus clientes — "Como nos conheceu?"'
            icon={Megaphone}
          />
          {originBreakdown.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1"
              style={{ background: 'rgba(228,64,95,.08)', border: '1px solid rgba(228,64,95,.2)' }}>
              <Megaphone className="h-3 w-3" style={{ color: '#E4405F' }} />
              <span className="text-[10px] font-bold" style={{ color: '#E4405F' }}>
                {originBreakdown.length} {originBreakdown.length === 1 ? 'canal' : 'canais'}
              </span>
            </div>
          )}
        </div>
        <div className="p-6">
          <OriginSection breakdown={originBreakdown} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ClientCard
          label="Clientes Recorrentes"
          icon={Users}
          color="#10B981"
          glowColor="rgba(16,185,129,.4)"
          totalCents={recorrentes.totalCents}
          profitCents={recorrentes.profitCents}
          ticketMedioCents={recorrentes.ticketMedioCents}
          avgProducts={recorrentes.avgProducts}
          sharePercent={recorrentes.sharePercent}
          marginPercent={recorrentes.marginPercent}
          transactions={recorrentes.transactions}
        />
        <ClientCard
          label="Clientes Novos"
          icon={UserPlus}
          color="#8B5CF6"
          glowColor="rgba(155,109,255,.4)"
          totalCents={novos.totalCents}
          profitCents={novos.profitCents}
          ticketMedioCents={novos.ticketMedioCents}
          avgProducts={novos.avgProducts}
          sharePercent={novos.sharePercent}
          marginPercent={novos.marginPercent}
          transactions={novos.transactions}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="mb-5">
            <SectionHeader
              accentColor="#10B981"
              title="Recorrentes vs Novos"
              subtitle="Distribuição do faturamento"
            />
          </div>
          <div className="flex items-center justify-center py-2">
            <DonutChart recShare={recorrentes.sharePercent} novShare={novos.sharePercent} />
          </div>
        </div>

        <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="mb-5 flex items-start justify-between">
            <SectionHeader
              accentColor="#8B5CF6"
              title="Evolução Mensal"
              subtitle="Faturamento nos últimos 6 meses"
            />
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ background: '#10B981' }} />
                <span className="text-[10px]" style={{ color: '#94A3B8' }}>Recorrentes</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ background: '#8B5CF6' }} />
                <span className="text-[10px]" style={{ color: '#94A3B8' }}>Novos</span>
              </div>
            </div>
          </div>
          <BarChart months={monthlyData} />
        </div>
      </div>

      {/* RFM Segments */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <SectionHeader
            accentColor="#F59E0B"
            title="Segmentação RFM"
            subtitle="Classificação por Recência, Frequência e Valor — últimos 6 meses"
            icon={Star}
          />
        </div>
        <div className="p-6">
          <RfmSection rfmSegments={rfmSegments} />
        </div>
      </div>

      {/* Weekday heatmap */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <SectionHeader
            accentColor="#22C55E"
            title="Heatmap por Dia da Semana"
            subtitle="Dias com maior faturamento no período selecionado"
            icon={Calendar}
          />
        </div>
        <div className="p-6">
          <WeekdayHeatmap days={weekdayHeatmap} />
        </div>
      </div>

      {/* Churn risk */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <SectionHeader
            accentColor="#EF4444"
            title="Clientes em Risco de Perda"
            subtitle="Sem comprar há 60+ dias — baseado nos últimos 6 meses"
            icon={AlertTriangle}
          />
          {churnRisk.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1"
              style={{ background: 'rgba(255,77,109,.08)', border: '1px solid rgba(255,77,109,.2)' }}>
              <AlertTriangle className="h-3 w-3" style={{ color: '#EF4444' }} />
              <span className="text-[10px] font-bold" style={{ color: '#EF4444' }}>
                {churnRisk.length} clientes
              </span>
            </div>
          )}
        </div>
        <div className="p-6">
          <ChurnTable clients={churnRisk} />
        </div>
      </div>

      {/* Top clients */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <SectionHeader
            accentColor="#22C55E"
            title="Top Clientes"
            subtitle="Por valor total no período"
          />
          <div className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1"
            style={{ background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.2)' }}>
            <TrendingUp className="h-3 w-3" style={{ color: '#22C55E' }} />
            <span className="text-[10px] font-bold" style={{ color: '#22C55E' }}>
              {topClients.length} clientes
            </span>
          </div>
        </div>
        <div className="p-6">
          <ClientsTable clients={topClients} />
        </div>
      </div>
    </div>
  )
}
