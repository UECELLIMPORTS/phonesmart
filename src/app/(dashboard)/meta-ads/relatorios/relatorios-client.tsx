'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, BarChart3, DollarSign, Users, TrendingDown, TrendingUp,
  AlertTriangle, Target, ExternalLink,
} from 'lucide-react'
import type { MetaAdsPeriod } from '@/actions/meta-ads'
import type { RelatoriosData, DailyCrossPoint, ChannelMetrics, CacByChannel, FunnelMetrics } from './page'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(c / 100)
    .replace(/ /g, ' ')
    .replace(/ /g, ' ')
const NUM = (n: number) =>
  new Intl.NumberFormat('pt-BR').format(n)
const PCT = (v: number) =>
  `${(v * 100).toFixed(1)}%`

export function RelatoriosClient({ data }: { data: RelatoriosData }) {
  const router = useRouter()

  const periodOptions: { v: MetaAdsPeriod; label: string }[] = [
    { v: 'today',     label: 'Hoje' },
    { v: 'yesterday', label: 'Ontem' },
    { v: '7d',        label: '7d' },
    { v: '30d',       label: '30d' },
    { v: '90d',       label: '90d' },
  ]

  function buildUrl(nextPeriod: MetaAdsPeriod) {
    const params = new URLSearchParams()
    params.set('period', nextPeriod)
    if (data.selectedAccount) params.set('account', data.selectedAccount.adAccountId)
    return `/meta-ads/relatorios?${params.toString()}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/meta-ads" className="mb-2 inline-flex items-center gap-1 text-xs" style={{ color: '#94A3B8' }}>
            <ArrowLeft className="h-3 w-3" /> Voltar ao Dashboard
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
            <BarChart3 className="h-5 w-5" style={{ color: '#22C55E' }} />
            Relatórios
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            Análises cruzadas entre gasto no Meta Ads e desempenho no ERP
            {data.selectedAccount && <> · <span className="font-mono" style={{ color: '#CBD5E1' }}>{data.selectedAccount.displayName}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 rounded-xl p-1" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
            {periodOptions.map(p => (
              <button
                key={p.v}
                onClick={() => router.push(buildUrl(p.v))}
                className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                style={data.period === p.v
                  ? { background: '#E4405F', color: '#fff' }
                  : { color: '#94A3B8' }
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {data.loadError && (
        <div className="rounded-xl border px-4 py-3 flex items-start gap-2"
          style={{ background: 'rgba(255,77,109,.08)', borderColor: 'rgba(255,77,109,.3)' }}>
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>Erro ao carregar dados do Meta</p>
            <p className="text-xs font-mono mt-1" style={{ color: '#EF4444' }}>{data.loadError}</p>
          </div>
        </div>
      )}

      <DailyCrossSection points={data.dailyCross} />
      <CacSection items={data.cac} totalSpend={data.insightsSpendCents} />
      <ChannelTableSection channels={data.channels} />
      <FunnelSection funnel={data.funnel} spendCents={data.insightsSpendCents} />

      {/* Atalho pro dashboard de canais (análise cruzada online vs física) */}
      <Link
        href="/analytics/canais"
        className="block rounded-2xl border p-5 transition-colors hover:bg-white/5"
        style={{ background: '#1B2638', borderColor: '#2A3650' }}
      >
        <div className="flex items-center gap-4">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #22C55E22, #10B98122)', border: '1px solid rgba(34,197,94,.3)' }}>
            <BarChart3 className="h-5 w-5" style={{ color: '#22C55E' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold" style={{ color: '#F8FAFC' }}>
              Análise completa: Online vs Física
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>
              Dashboard dedicado cruzando vendas por canal (WhatsApp, Instagram, Delivery, Balcão, Retirada) + efeito sustento da loja física
            </p>
          </div>
          <span className="text-xs font-bold shrink-0" style={{ color: '#22C55E' }}>
            Ver dashboard →
          </span>
        </div>
      </Link>

      <div className="flex items-center justify-center gap-2 text-[11px]" style={{ color: '#94A3B8' }}>
        <Link href="/meta-ads" className="inline-flex items-center gap-1.5 transition-colors hover:text-[#22C55E]">
          <ExternalLink className="h-3 w-3" />
          Voltar ao Dashboard
        </Link>
      </div>
    </div>
  )
}

// ── Seção 1 — Evolução diária: Gasto × Faturamento ────────────────────────

function DailyCrossSection({ points }: { points: DailyCrossPoint[] }) {
  const totalSpend   = points.reduce((s, p) => s + p.spendCents,   0)
  const totalRevenue = points.reduce((s, p) => s + p.revenueCents, 0)
  const overallRoas  = totalSpend > 0 ? totalRevenue / totalSpend : 0

  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#22C55E' }} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
              Evolução diária — Gasto Meta × Faturamento ERP
            </h2>
            <p className="text-[11px]" style={{ color: '#94A3B8' }}>
              Linhas sobrepostas por dia. Faturamento = vendas + OS de clientes com origem <strong>Instagram Pago</strong> ou <strong>Facebook</strong>.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Gasto Meta"         value={BRL(totalSpend)}   color="#E4405F" />
        <MiniStat label="Faturamento Meta"   value={BRL(totalRevenue)} color="#10B981" />
        <MiniStat
          label="ROAS real"
          value={overallRoas > 0 ? `${overallRoas.toFixed(2)}x` : '—'}
          color={overallRoas >= 1 ? '#10B981' : '#EF4444'}
        />
      </div>

      {points.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem dados no período pra gráfico.
        </p>
      ) : (
        <div className="rounded-xl border p-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <DualBarChart points={points} />
          <div className="mt-3 flex items-center justify-center gap-4 text-[11px]">
            <span className="inline-flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <span className="h-2.5 w-2.5 rounded" style={{ background: '#E4405F' }} /> Gasto Meta
            </span>
            <span className="inline-flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <span className="h-2.5 w-2.5 rounded" style={{ background: '#10B981' }} /> Faturamento ERP
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function DualBarChart({ points }: { points: DailyCrossPoint[] }) {
  const width  = 800
  const height = 260
  const padL   = 60
  const padR   = 20
  const padT   = 20
  const padB   = 40
  const innerW = width  - padL - padR
  const innerH = height - padT - padB

  const maxVal = Math.max(1, ...points.flatMap(p => [p.spendCents, p.revenueCents]))
  const barGroupW = innerW / Math.max(1, points.length)
  const barW = Math.max(2, (barGroupW / 2) - 2)

  const xBase   = (i: number) => padL + i * barGroupW
  const yScale  = (v: number) => padT + innerH - (v / maxVal) * innerH

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({ value: maxVal * t, y: padT + innerH - t * innerH }))
  const xStep  = Math.max(1, Math.ceil(points.length / 10))
  const fmtShortDate = (iso: string) => iso.slice(5).replace('-', '/')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {yTicks.map(t => (
        <line key={t.y}
          x1={padL} y1={t.y} x2={width - padR} y2={t.y}
          stroke="#2A3650" strokeWidth="1" strokeDasharray="2 3"
        />
      ))}

      {points.map((p, i) => {
        const x      = xBase(i) + 2
        const hSpend = Math.max(1, innerH - (yScale(p.spendCents)   - padT))
        const hRev   = Math.max(1, innerH - (yScale(p.revenueCents) - padT))
        return (
          <g key={i}>
            <rect x={x} y={yScale(p.spendCents)}   width={barW} height={hSpend} fill="#E4405F" opacity="0.85">
              <title>{`${p.date}: Gasto ${BRL(p.spendCents)}`}</title>
            </rect>
            <rect x={x + barW + 2} y={yScale(p.revenueCents)} width={barW} height={hRev}   fill="#10B981" opacity="0.85">
              <title>{`${p.date}: Faturamento ${BRL(p.revenueCents)}`}</title>
            </rect>
          </g>
        )
      })}

      {yTicks.map(t => (
        <text key={`ylbl-${t.y}`}
          x={padL - 8} y={t.y + 3}
          textAnchor="end" fontSize="10" fill="#94A3B8" fontFamily="ui-monospace,monospace"
        >
          {BRL(t.value)}
        </text>
      ))}

      {points.map((p, i) => (i % xStep === 0 || i === points.length - 1) && (
        <text key={`xlbl-${i}`}
          x={xBase(i) + barGroupW / 2} y={height - 15}
          textAnchor="middle" fontSize="10" fill="#94A3B8" fontFamily="ui-monospace,monospace"
        >
          {fmtShortDate(p.date)}
        </text>
      ))}
    </svg>
  )
}

// ── Seção 2 — CAC por canal ────────────────────────────────────────────────

function CacSection({ items, totalSpend }: { items: CacByChannel[]; totalSpend: number }) {
  const paidOnly = items.filter(i => i.channel === 'instagram_pago' || i.channel === 'facebook')
  const totalNew = paidOnly.reduce((s, i) => s + i.newCustomers, 0)
  const avgCac   = totalNew > 0 ? Math.round(totalSpend / totalNew) : 0

  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full" style={{ background: '#8B5CF6' }} />
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            CAC — Custo de aquisição de cliente
          </h2>
          <p className="text-[11px]" style={{ color: '#94A3B8' }}>
            Gasto no Meta dividido pelos novos clientes do período com origem paga (IG Pago + Facebook).
            Orgânico aparece só como volume (custo zero).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border p-4 col-span-1 sm:col-span-3"
          style={{ background: '#131C2A', borderColor: 'rgba(155,109,255,.3)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
            CAC médio geral (pagos)
          </p>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-3xl font-bold font-mono" style={{ color: '#8B5CF6' }}>
              {avgCac > 0 ? BRL(avgCac) : '—'}
            </span>
            <span className="text-xs" style={{ color: '#CBD5E1' }}>
              {BRL(totalSpend)} / {totalNew} novo{totalNew === 1 ? '' : 's'} cliente{totalNew === 1 ? '' : 's'}
            </span>
          </div>
          {avgCac === 0 && totalSpend > 0 && (
            <p className="text-[11px] mt-2" style={{ color: '#F59E0B' }}>
              ⚠ Você gastou mas nenhum cliente novo foi cadastrado com origem &quot;Instagram Pago&quot; ou &quot;Facebook&quot; no período.
              Marque a origem ao cadastrar novos clientes.
            </p>
          )}
        </div>

        {items.map(item => (
          <div key={item.channel} className="rounded-xl border p-4"
            style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
              <p className="text-xs font-semibold" style={{ color: '#F8FAFC' }}>{item.label}</p>
            </div>
            <p className="text-2xl font-bold font-mono mt-1" style={{ color: item.color }}>
              {item.cacCents != null ? BRL(item.cacCents) : item.channel === 'instagram_organico' ? 'Grátis' : '—'}
            </p>
            <p className="text-[11px] mt-1" style={{ color: '#CBD5E1' }}>
              {item.newCustomers} novo{item.newCustomers === 1 ? '' : 's'} cliente{item.newCustomers === 1 ? '' : 's'}
              {item.spendCents > 0 && <> · {BRL(item.spendCents)} atribuído</>}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Seção 3 — Tabela por canal ─────────────────────────────────────────────

function ChannelTableSection({ channels }: { channels: ChannelMetrics[] }) {
  const total = channels.reduce((acc, c) => ({
    newCustomers: acc.newCustomers + c.newCustomers,
    txCount:      acc.txCount      + c.txCount,
    revenueCents: acc.revenueCents + c.revenueCents,
  }), { newCustomers: 0, txCount: 0, revenueCents: 0 })
  const totalAvgTicket = total.txCount > 0 ? Math.round(total.revenueCents / total.txCount) : 0

  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <div className="h-4 w-1 rounded-full" style={{ background: '#E4405F' }} />
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            Performance por canal
          </h2>
          <p className="text-[11px]" style={{ color: '#94A3B8' }}>
            Clientes novos, transações, faturamento e ticket médio por canal de origem
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
              {['Canal', 'Novos clientes', 'Transações', 'Faturamento', 'Ticket médio'].map(h => (
                <th key={h} className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map(c => (
              <tr key={c.channel} className="border-b hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c.color }} />
                    <span className="font-medium" style={{ color: '#F8FAFC' }}>{c.label}</span>
                  </div>
                </td>
                <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>
                  {NUM(c.newCustomers)}
                </td>
                <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>
                  {NUM(c.txCount)}
                </td>
                <td className="px-5 py-3 font-mono font-semibold" style={{ color: c.revenueCents > 0 ? '#10B981' : '#94A3B8' }}>
                  {c.revenueCents > 0 ? BRL(c.revenueCents) : '—'}
                </td>
                <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>
                  {c.avgTicketCents > 0 ? BRL(c.avgTicketCents) : '—'}
                </td>
              </tr>
            ))}
            <tr style={{ background: 'rgba(228,64,95,.04)' }}>
              <td className="px-5 py-3 font-bold" style={{ color: '#F8FAFC' }}>Total</td>
              <td className="px-5 py-3 font-mono font-bold" style={{ color: '#F8FAFC' }}>{NUM(total.newCustomers)}</td>
              <td className="px-5 py-3 font-mono font-bold" style={{ color: '#F8FAFC' }}>{NUM(total.txCount)}</td>
              <td className="px-5 py-3 font-mono font-bold" style={{ color: '#10B981' }}>
                {total.revenueCents > 0 ? BRL(total.revenueCents) : '—'}
              </td>
              <td className="px-5 py-3 font-mono font-bold" style={{ color: '#F8FAFC' }}>
                {totalAvgTicket > 0 ? BRL(totalAvgTicket) : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Seção 4 — Funil ────────────────────────────────────────────────────────

function FunnelSection({ funnel, spendCents }: { funnel: FunnelMetrics; spendCents: number }) {
  const { impressions, clicks, newCustomers, salesCount, salesRevenueCents } = funnel

  // Taxas de conversão
  const ctr              = impressions > 0  ? clicks / impressions         : 0
  const clickToCustomer  = clicks > 0       ? newCustomers / clicks        : 0
  const customerToSale   = newCustomers > 0 ? salesCount / newCustomers    : 0
  const overallRoas      = spendCents > 0   ? salesRevenueCents / spendCents : 0

  const stages = [
    { label: 'Impressões Meta',      value: impressions,   fmt: NUM, color: '#22C55E' },
    { label: 'Cliques Meta',         value: clicks,        fmt: NUM, color: '#F59E0B' },
    { label: 'Clientes novos (ERP)', value: newCustomers,  fmt: NUM, color: '#8B5CF6' },
    { label: 'Vendas atribuídas',    value: salesCount,    fmt: NUM, color: '#10B981' },
  ]
  const maxVal = Math.max(1, ...stages.map(s => s.value))

  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full" style={{ background: '#F59E0B' }} />
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
            <Target className="h-3.5 w-3.5" />
            Funil de conversão — Meta → ERP
          </h2>
          <p className="text-[11px]" style={{ color: '#94A3B8' }}>
            Do anúncio até a venda. A atribuição cliente → origem depende do campo &quot;Como nos conheceu&quot; preenchido no cadastro.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {stages.map((stage, i) => {
          const width = `${Math.max(5, (stage.value / maxVal) * 100)}%`
          const next = stages[i + 1]
          let convRate: number | null = null
          if (next) {
            convRate = stage.value > 0 ? next.value / stage.value : null
          }
          return (
            <div key={stage.label}>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs" style={{ color: '#CBD5E1' }}>{stage.label}</span>
                    <span className="text-sm font-bold font-mono" style={{ color: stage.color }}>{stage.fmt(stage.value)}</span>
                  </div>
                  <div className="h-6 rounded-md overflow-hidden" style={{ background: '#131C2A' }}>
                    <div className="h-full rounded-md transition-all"
                      style={{ width, background: `linear-gradient(90deg, ${stage.color}66, ${stage.color})` }} />
                  </div>
                </div>
              </div>
              {next && convRate != null && (
                <div className="ml-4 my-1 flex items-center gap-2 text-[10px]" style={{ color: '#94A3B8' }}>
                  {convRate >= 0.01
                    ? <TrendingUp className="h-3 w-3" style={{ color: '#10B981' }} />
                    : <TrendingDown className="h-3 w-3" style={{ color: '#EF4444' }} />
                  }
                  <span>Conversão: <strong style={{ color: '#F8FAFC' }}>{PCT(convRate)}</strong></span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t" style={{ borderColor: '#2A3650' }}>
        <MiniStat label="CTR"                       value={PCT(ctr)}             color="#F59E0B" icon={TrendingUp} />
        <MiniStat label="Clique → Cliente"          value={PCT(clickToCustomer)} color="#8B5CF6" icon={Users} />
        <MiniStat label="Cliente → Venda"           value={PCT(customerToSale)}  color="#10B981" icon={DollarSign} />
        <MiniStat
          label="ROAS real"
          value={overallRoas > 0 ? `${overallRoas.toFixed(2)}x` : '—'}
          color={overallRoas >= 1 ? '#10B981' : '#EF4444'}
          icon={TrendingUp}
        />
      </div>
    </div>
  )
}

// ── UI helpers ─────────────────────────────────────────────────────────────

function MiniStat({
  label, value, color, icon: Icon,
}: {
  label: string
  value: string
  color: string
  icon?: React.ElementType
}) {
  return (
    <div className="rounded-lg border p-3" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>{label}</span>
        {Icon && <Icon className="h-3.5 w-3.5" style={{ color }} />}
      </div>
      <p className="text-lg font-bold font-mono" style={{ color }}>{value}</p>
    </div>
  )
}
