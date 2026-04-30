'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Store, Globe, MapPin, DollarSign, TrendingUp, AlertTriangle,
  Package, ShoppingBag, ArrowRight, Calculator, Settings, Megaphone, Target,
} from 'lucide-react'
import type {
  ChannelAnalytics, ChannelAnalyticsPeriod, ChannelMetric,
  OriginMetric, OriginChannelMatrix, CacByChannel, InferredOriginMetric,
} from '@/actions/sales-channels'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(c / 100)
    .replace(/ /g, ' ')
    .replace(/ /g, ' ')
const NUM = (n: number) => new Intl.NumberFormat('pt-BR').format(n)
const PCT = (v: number) => `${(v * 100).toFixed(1)}%`

type Props = {
  data: ChannelAnalytics
  origins: OriginMetric[]
  inferredOrigins: InferredOriginMetric[]
  originChannelMatrix: OriginChannelMatrix
  cac: CacByChannel
  fixedCostMonthlyCents: number | null
}

/** Quantos dias o período cobre (pra pro-ratear custo fixo mensal). null pra 'all'. */
function periodDays(period: ChannelAnalyticsPeriod): number | null {
  switch (period) {
    case '7d':   return 7
    case '30d':  return 30
    case '90d':  return 90
    case '180d': return 180
    case '365d': return 365
    case 'all':  return null
  }
}

const PERIOD_OPTIONS: { v: ChannelAnalyticsPeriod; label: string }[] = [
  { v: '7d',   label: '7d' },
  { v: '30d',  label: '30d' },
  { v: '90d',  label: '90d' },
  { v: '180d', label: '180d' },
  { v: '365d', label: '1 ano' },
  { v: 'all',  label: 'Tudo' },
]

export function CanaisClient({ data, origins, inferredOrigins, originChannelMatrix, cac, fixedCostMonthlyCents }: Props) {
  const router = useRouter()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
            <Store className="h-5 w-5" style={{ color: '#22C55E' }} />
            Canais de venda
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            Análise cruzada de vendas online (WhatsApp, Instagram, Delivery) vs loja física (Balcão, Retirada)
          </p>
        </div>
        <div className="flex gap-1 rounded-xl p-1" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
          {PERIOD_OPTIONS.map(p => (
            <button
              key={p.v}
              onClick={() => router.push(`/analytics/canais?period=${p.v}`)}
              className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
              style={data.period === p.v
                ? { background: '#22C55E', color: '#131C2A' }
                : { color: '#94A3B8' }
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alert se muitas vendas sem canal */}
      {data.naoInformadoCount > 0 && data.totalTxCount > 0 && (
        <NaoInformadoBanner
          count={data.naoInformadoCount}
          total={data.totalTxCount}
          cents={data.naoInformadoCents}
        />
      )}

      {/* KPIs principais */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Faturamento total"
          value={BRL(data.totalCents)}
          sub={`${data.totalTxCount} transações no período`}
          color="#F8FAFC"
          icon={DollarSign}
        />
        <KpiCard
          label="Online"
          value={BRL(data.onlineCents)}
          sub={PCT(data.pctOnline)}
          color="#22C55E"
          icon={Globe}
        />
        <KpiCard
          label="Física"
          value={BRL(data.fisicaCents)}
          sub={PCT(data.pctFisica)}
          color="#F59E0B"
          icon={MapPin}
        />
        <KpiCard
          label="Ticket médio geral"
          value={data.totalTxCount > 0 ? BRL(Math.round(data.totalCents / data.totalTxCount)) : '—'}
          sub={`${data.channels.filter(c => c.totalCents > 0).length} canais ativos`}
          color="#8B5CF6"
          icon={TrendingUp}
        />
      </div>

      {/* Donut + Sustento */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <OnlineVsFisicaCard data={data} />
        <SustentoCard data={data} />
      </div>

      {/* Modalidade de entrega */}
      <DeliveryBreakdownCard data={data} />

      {/* Cruzamento Canal × Tipo de Entrega */}
      <ChannelDeliveryMatrixSection data={data} />

      {/* Break-even da loja física */}
      <BreakEvenSection
        data={data}
        fixedCostMonthlyCents={fixedCostMonthlyCents}
      />

      {/* Tabela por canal */}
      <ChannelTableSection channels={data.channels.filter(c => c.totalCents > 0 || (c.salesCount + c.osCount) > 0)} />

      {/* Origem dos clientes */}
      <OriginSection origins={origins} />

      {/* Origem inferida (vendas sem cadastro) */}
      <InferredOriginSection inferredOrigins={inferredOrigins} />

      {/* Heatmap Origem × Canal */}
      <OriginChannelMatrixSection matrix={originChannelMatrix} />

      {/* CAC por canal (Meta Ads) */}
      <CacByChannelSection cac={cac} />

      {/* Gráfico temporal */}
      {data.daily.length > 0 && <DailyChartSection daily={data.daily} />}
    </div>
  )
}

// ── Componentes ────────────────────────────────────────────────────────────

function NaoInformadoBanner({ count, total, cents }: { count: number; total: number; cents: number }) {
  const pct = total > 0 ? count / total : 0
  if (pct < 0.1) return null  // só mostra se > 10%
  return (
    <div className="rounded-xl border p-4 flex items-start gap-3"
      style={{ background: 'rgba(255,170,0,.06)', borderColor: 'rgba(255,170,0,.4)' }}>
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#F59E0B' }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: '#F59E0B' }}>
          {count} transação(ões) sem canal informado ({PCT(pct)} do total)
        </p>
        <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>
          {BRL(cents)} em vendas não foram classificadas. Marque o canal ao finalizar a venda no POS ou Financeiro — quanto mais dados, mais preciso fica o relatório.
        </p>
      </div>
    </div>
  )
}

function OnlineVsFisicaCard({ data }: { data: ChannelAnalytics }) {
  const { pctOnline, pctFisica, pctOutro, onlineCents, fisicaCents, outroCents } = data
  const onlineDeg = pctOnline * 360
  const fisicaDeg = pctFisica * 360
  const outroDeg  = pctOutro  * 360
  const total = onlineCents + fisicaCents + outroCents

  return (
    <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="h-4 w-1 rounded-full" style={{ background: '#22C55E' }} />
        <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
          Online vs Física
        </h2>
      </div>

      {total === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem vendas classificadas no período
        </p>
      ) : (
        <div className="flex items-center gap-6 flex-wrap">
          <div
            className="h-40 w-40 rounded-full shrink-0 relative"
            style={{
              background: `conic-gradient(
                #22C55E 0deg ${onlineDeg}deg,
                #F59E0B ${onlineDeg}deg ${onlineDeg + fisicaDeg}deg,
                #94A3B8 ${onlineDeg + fisicaDeg}deg ${onlineDeg + fisicaDeg + outroDeg}deg
              )`,
            }}
          >
            <div className="absolute inset-5 rounded-full flex flex-col items-center justify-center"
              style={{ background: '#1B2638' }}>
              <span className="text-3xl font-bold font-mono" style={{ color: '#22C55E' }}>
                {PCT(pctOnline)}
              </span>
              <span className="text-[10px] uppercase tracking-wider mt-1" style={{ color: '#94A3B8' }}>Online</span>
            </div>
          </div>
          <div className="flex-1 min-w-[200px] space-y-2">
            <LegendRow color="#22C55E" label="Online" value={BRL(onlineCents)} pct={PCT(pctOnline)} />
            <LegendRow color="#F59E0B" label="Física" value={BRL(fisicaCents)} pct={PCT(pctFisica)} />
            {outroCents > 0 && (
              <LegendRow color="#94A3B8" label="Outro" value={BRL(outroCents)} pct={PCT(pctOutro)} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function LegendRow({ color, label, value, pct }: { color: string; label: string; value: string; pct: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <span className="h-3 w-3 rounded shrink-0" style={{ background: color }} />
        <span style={{ color: '#F8FAFC' }}>{label}</span>
      </div>
      <div className="text-right">
        <span className="font-mono font-semibold" style={{ color }}>{value}</span>
        <span className="ml-2" style={{ color: '#94A3B8' }}>{pct}</span>
      </div>
    </div>
  )
}

function SustentoCard({ data }: { data: ChannelAnalytics }) {
  const { fisicaBalcaoCents, fisicaRetiradaCents, pctSustento } = data
  const total = fisicaBalcaoCents + fisicaRetiradaCents

  return (
    <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="h-4 w-1 rounded-full" style={{ background: '#8B5CF6' }} />
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            Efeito Sustento
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
            Quanto da &quot;física&quot; é na verdade retirada de venda online
          </p>
        </div>
      </div>

      {total === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem vendas físicas no período
        </p>
      ) : (
        <>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span style={{ color: '#CBD5E1' }}>
                  <ShoppingBag className="h-3 w-3 inline mr-1" />
                  Balcão (física pura)
                </span>
                <span className="font-mono font-bold" style={{ color: '#F59E0B' }}>{BRL(fisicaBalcaoCents)}</span>
              </div>
              <div className="h-3 rounded-md overflow-hidden" style={{ background: '#131C2A' }}>
                <div className="h-full" style={{
                  width: `${(fisicaBalcaoCents / total) * 100}%`,
                  background: 'linear-gradient(90deg, #F59E0B66, #F59E0B)',
                }} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span style={{ color: '#CBD5E1' }}>
                  <Package className="h-3 w-3 inline mr-1" />
                  Retirada (veio de venda online)
                </span>
                <span className="font-mono font-bold" style={{ color: '#8B5CF6' }}>{BRL(fisicaRetiradaCents)}</span>
              </div>
              <div className="h-3 rounded-md overflow-hidden" style={{ background: '#131C2A' }}>
                <div className="h-full" style={{
                  width: `${(fisicaRetiradaCents / total) * 100}%`,
                  background: 'linear-gradient(90deg, #8B5CF666, #8B5CF6)',
                }} />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t text-center" style={{ borderColor: '#2A3650' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Do movimento da loja física
            </p>
            <p className="text-2xl font-bold font-mono mt-1" style={{ color: '#8B5CF6' }}>
              {PCT(pctSustento)}
            </p>
            <p className="text-[11px] mt-1" style={{ color: '#CBD5E1' }}>
              {pctSustento >= 0.3
                ? 'é movimento que o online gerou — a física depende do online'
                : 'é movimento que o online gerou — a física ainda tem vida própria'}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

type BreakEvenMetric = 'revenue' | 'profit'
type BreakEvenSource = 'all' | 'sales' | 'os'

/** Pega o valor de um canal conforme métrica + fonte selecionadas. */
function pickChannelValue(c: ChannelMetric | undefined, metric: BreakEvenMetric, source: BreakEvenSource): number {
  if (!c) return 0
  if (metric === 'revenue') {
    if (source === 'sales') return c.salesRevenueCents
    if (source === 'os')    return c.osRevenueCents
    return c.totalCents
  }
  if (source === 'sales') return c.salesProfitCents
  if (source === 'os')    return c.osProfitCents
  return c.totalProfitCents
}

function DeliveryBreakdownCard({ data }: { data: ChannelAnalytics }) {
  const total = data.deliveryBreakdown.reduce((s, d) => s + d.cents, 0)
  const visible = data.deliveryBreakdown.filter(d => d.cents > 0)

  // Cores fixas por modalidade pra ficar consistente entre recargas.
  const COLORS: Record<string, string> = {
    counter:       '#F59E0B',  // balcão (igual à física)
    pickup:        '#8B5CF6',  // retirada
    shipping:      '#22C55E',  // delivery (igual à online)
    nao_informado: '#94A3B8',
  }

  return (
    <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2 mb-4">
        <div className="h-4 w-1 rounded-full" style={{ background: '#22C55E' }} />
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
            <Package className="h-3.5 w-3.5" />
            Modalidade de Entrega
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
            Como o produto/aparelho chegou ao cliente (independente do canal de fechamento)
          </p>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem modalidade de entrega registrada no período
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map(d => {
            const pct   = total > 0 ? d.cents / total : 0
            const color = COLORS[d.delivery] ?? '#CBD5E1'
            return (
              <div key={d.delivery}>
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-3 w-3 rounded shrink-0" style={{ background: color }} />
                    <span className="font-medium truncate" style={{ color: '#F8FAFC' }}>{d.label}</span>
                    <span className="font-mono shrink-0" style={{ color: '#94A3B8' }}>{PCT(pct)}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-2">
                    <span className="font-mono" style={{ color: '#CBD5E1' }}>{NUM(d.count)} tx</span>
                    <span className="font-mono font-bold" style={{ color }}>{BRL(d.cents)}</span>
                  </div>
                </div>
                <div className="h-2 rounded-md overflow-hidden" style={{ background: '#131C2A' }}>
                  <div className="h-full transition-all" style={{
                    width: `${pct * 100}%`,
                    background: `linear-gradient(90deg, ${color}55, ${color})`,
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BreakEvenSection({
  data, fixedCostMonthlyCents,
}: {
  data: ChannelAnalytics
  fixedCostMonthlyCents: number | null
}) {
  const [metric, setMetric] = useState<BreakEvenMetric>('profit')
  const [source, setSource] = useState<BreakEvenSource>('all')

  // Não configurado → CTA
  if (fixedCostMonthlyCents == null) {
    return (
      <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-4 w-1 rounded-full" style={{ background: '#F59E0B' }} />
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            Break-even da loja física
          </h2>
        </div>
        <div className="rounded-xl border p-6 text-center"
          style={{ background: '#131C2A', borderColor: 'rgba(255,170,0,.25)' }}>
          <Calculator className="h-8 w-8 mx-auto mb-3" style={{ color: '#F59E0B', opacity: 0.6 }} />
          <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
            Configure o custo fixo mensal da loja física
          </p>
          <p className="text-xs mt-2 max-w-md mx-auto" style={{ color: '#CBD5E1' }}>
            Pra descobrir quanto a loja física se paga (ou não) e quanto o online sustenta, precisamos do custo fixo mensal (aluguel + salários + contas).
          </p>
          <Link
            href="/configuracoes"
            className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors hover:bg-white/5"
            style={{ background: 'rgba(255,170,0,.1)', color: '#F59E0B', border: '1px solid rgba(255,170,0,.3)' }}
          >
            <Settings className="h-3.5 w-3.5" />
            Configurar agora
          </Link>
        </div>
      </div>
    )
  }

  // Período = 'all' → não faz sentido prorratear
  const days = periodDays(data.period)
  if (days === null) {
    return (
      <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 mb-4">
          <div className="h-4 w-1 rounded-full" style={{ background: '#F59E0B' }} />
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            Break-even da loja física
          </h2>
        </div>
        <p className="text-xs text-center py-6" style={{ color: '#94A3B8' }}>
          Escolha um período específico (7d, 30d, 90d…) pra calcular o break-even.
        </p>
      </div>
    )
  }

  const balcaoCh   = data.channels.find(c => c.channel === 'fisica_balcao')
  const retiradaCh = data.channels.find(c => c.channel === 'fisica_retirada')
  const onlineChs  = data.channels.filter(c => c.group === 'online' && c.channel !== 'fisica_retirada')

  // Cálculo do break-even — agora respeita métrica (faturamento ou lucro) + fonte (sales/os/ambos).
  const custoPeriodoCents    = Math.round(fixedCostMonthlyCents * (days / 30))
  const fisicaPuraCents      = pickChannelValue(balcaoCh, metric, source)
  const deficitCents         = custoPeriodoCents - fisicaPuraCents
  const isLoja               = deficitCents > 0
  const onlinePuroCents      = onlineChs.reduce((s, c) => s + pickChannelValue(c, metric, source), 0)
  const retiradaCents        = pickChannelValue(retiradaCh, metric, source)
  const onlineCents          = onlinePuroCents + retiradaCents  // retirada conta como online
  const pctOnlineCobriuDeficit = isLoja && onlineCents > 0
    ? Math.min(1, deficitCents / onlineCents)
    : 0
  const sobraOnlineCents     = isLoja ? onlineCents - deficitCents : onlineCents

  const periodoTxt =
    days === 7   ? 'últimos 7 dias'    :
    days === 30  ? 'últimos 30 dias'   :
    days === 90  ? 'últimos 90 dias'   :
    days === 180 ? 'últimos 180 dias'  :
    'últimos 12 meses'

  const metricLabel    = metric === 'profit' ? 'lucro'        : 'faturamento'
  const metricLabelCap = metric === 'profit' ? 'Lucro'        : 'Faturamento'
  const sourceLabel    = source === 'sales' ? 'só PhoneSmart (vendas)'
                       : source === 'os'    ? 'só CheckSmart (OS)'
                       : 'PhoneSmart + CheckSmart'

  // Em modo "lucro", o conceito muda: o lucro do balcão precisa cobrir o custo
  // fixo. "Déficit" significa que o lucro não dá pra cobrir o aluguel.
  const balcaoCardLabel = metric === 'profit'
    ? 'Lucro do balcão (física pura)'
    : 'Faturamento do balcão (física pura)'
  const balcaoCardSub = metric === 'profit'
    ? `lucro do balcão (${sourceLabel})`
    : `faturamento de balcão (${sourceLabel})`
  const deficitCardLabel = isLoja
    ? (metric === 'profit' ? 'Déficit (lucro abaixo do custo)' : 'Déficit da física')
    : (metric === 'profit' ? 'Superávit (lucro cobre o custo)' : 'Superávit')
  const deficitCardSub = isLoja
    ? (metric === 'profit' ? 'o lucro do balcão não cobre o custo fixo' : 'a física está abaixo do custo')
    : (metric === 'profit' ? 'o lucro do balcão cobre o custo fixo'    : 'a física cobre o próprio custo')

  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: isLoja ? '#EF4444' : '#10B981' }} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <Calculator className="h-3.5 w-3.5" />
              Break-even da loja física
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
              {metric === 'profit'
                ? `Quanto o ${metricLabel} do balcão cobre do custo fixo nos ${periodoTxt}`
                : `Quanto o online está sustentando a física nos ${periodoTxt}`}
            </p>
          </div>
        </div>
        <Link
          href="/configuracoes"
          className="text-[11px] font-bold transition-colors hover:underline"
          style={{ color: '#94A3B8' }}
          title="Editar custo fixo"
        >
          <Settings className="h-3 w-3 inline mr-1" />
          {BRL(fixedCostMonthlyCents)}/mês
        </Link>
      </div>

      {/* Toggles: métrica + fonte */}
      <div className="flex flex-wrap gap-3">
        <ToggleGroup
          label="Métrica"
          options={[
            { v: 'profit',  label: 'Lucro' },
            { v: 'revenue', label: 'Faturamento' },
          ]}
          value={metric}
          onChange={setMetric}
          activeColor="#10B981"
        />
        <ToggleGroup
          label="Fonte"
          options={[
            { v: 'all',   label: 'Ambos' },
            { v: 'sales', label: 'PhoneSmart' },
            { v: 'os',    label: 'CheckSmart' },
          ]}
          value={source}
          onChange={setSource}
          activeColor="#22C55E"
        />
      </div>

      {/* Aviso pequeno se algumas vendas usaram custo atual no fallback */}
      {metric === 'profit' && data.salesItemsWithFallbackCount > 0 && (source === 'all' || source === 'sales') && (
        <div className="rounded-lg border px-3 py-2 text-[11px] flex items-start gap-2"
          style={{ background: 'rgba(255,170,0,.05)', borderColor: 'rgba(255,170,0,.25)', color: '#CBD5E1' }}>
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: '#F59E0B' }} />
          <span>
            <strong style={{ color: '#F59E0B' }}>{NUM(data.salesItemsWithFallbackCount)}</strong> item(s) de venda sem custo gravado na época —
            usamos o custo atual do produto como estimativa. O lucro pode estar levemente impreciso pra vendas antigas.
          </span>
        </div>
      )}

      {/* 3 cards horizontais: custo, balcão (lucro/fat), déficit/superávit */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border p-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Custo fixo do período
          </p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: '#F59E0B' }}>
            {BRL(custoPeriodoCents)}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#CBD5E1' }}>
            {BRL(fixedCostMonthlyCents)}/mês × ({days}/30)
          </p>
        </div>

        <div className="rounded-xl border p-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            {balcaoCardLabel}
          </p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: metric === 'profit' ? '#10B981' : '#F8FAFC' }}>
            {BRL(fisicaPuraCents)}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#CBD5E1' }}>
            {balcaoCardSub}
          </p>
        </div>

        <div className="rounded-xl border p-4"
          style={{
            background: isLoja ? 'rgba(255,77,109,.08)' : 'rgba(16,185,129,.06)',
            borderColor: isLoja ? 'rgba(255,77,109,.3)' : 'rgba(16,185,129,.3)',
          }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            {deficitCardLabel}
          </p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: isLoja ? '#EF4444' : '#10B981' }}>
            {isLoja ? '-' : '+'} {BRL(Math.abs(deficitCents))}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#CBD5E1' }}>
            {deficitCardSub}
          </p>
        </div>
      </div>

      {/* Mensagem principal */}
      {isLoja ? (
        <div className="rounded-xl border p-5"
          style={{ background: 'rgba(255,77,109,.04)', borderColor: 'rgba(255,77,109,.3)' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: '#EF4444' }}>
                {onlineCents <= 0
                  ? `Loja física com déficit — ${metricLabel} do online insuficiente nesta visão`
                  : onlineCents < deficitCents
                    ? `${metricLabelCap} do online não é suficiente pra cobrir a física`
                    : `O ${metricLabel} do online está sustentando a loja física`}
              </p>
              <p className="text-xs mt-1" style={{ color: '#F8FAFC' }}>
                Nos {periodoTxt}, o balcão gerou <strong>{BRL(fisicaPuraCents)}</strong> de {metricLabel} ({sourceLabel}),
                mas o custo fixo da loja foi <strong>{BRL(custoPeriodoCents)}</strong>.
                {onlineCents <= 0
                  ? <> Mude a fonte ou métrica pra ver outras combinações.</>
                  : onlineCents < deficitCents
                    ? <> O <strong style={{ color: '#22C55E' }}>{metricLabel} online ({BRL(onlineCents)})</strong> cobre parte do déficit, mas ainda faltam <strong style={{ color: '#EF4444' }}>{BRL(deficitCents - onlineCents)}</strong>.</>
                    : <> O <strong style={{ color: '#22C55E' }}>{metricLabel} online (incluindo retiradas) está cobrindo {BRL(deficitCents)}</strong> de déficit.</>
                }
              </p>
              {onlineCents >= deficitCents && onlineCents > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span style={{ color: '#CBD5E1' }}>
                      Sobra do {metricLabel} online após pagar o déficit da física
                    </span>
                    <span className="font-mono font-bold" style={{ color: sobraOnlineCents >= 0 ? '#10B981' : '#EF4444' }}>
                      {BRL(sobraOnlineCents)}
                    </span>
                  </div>
                  <div className="h-3 rounded-md overflow-hidden flex" style={{ background: '#131C2A' }}>
                    <div className="h-full" style={{
                      width: `${pctOnlineCobriuDeficit * 100}%`,
                      background: 'linear-gradient(90deg, #EF444466, #EF4444)',
                    }} title="Déficit da física" />
                    <div className="h-full" style={{
                      width: `${(1 - pctOnlineCobriuDeficit) * 100}%`,
                      background: 'linear-gradient(90deg, #10B98166, #10B981)',
                    }} title="Sobra do online" />
                  </div>
                  <div className="flex items-center justify-between text-[10px]" style={{ color: '#94A3B8' }}>
                    <span>Cobre o déficit da física ({PCT(pctOnlineCobriuDeficit)})</span>
                    <span>Sobra livre ({PCT(1 - pctOnlineCobriuDeficit)})</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border p-5"
          style={{ background: 'rgba(16,185,129,.04)', borderColor: 'rgba(16,185,129,.3)' }}>
          <div className="flex items-start gap-3">
            <TrendingUp className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#10B981' }} />
            <div>
              <p className="text-sm font-bold" style={{ color: '#10B981' }}>
                {metric === 'profit'
                  ? 'O lucro do balcão cobre o custo fixo da loja'
                  : 'A loja física cobre o próprio custo'}
              </p>
              <p className="text-xs mt-1" style={{ color: '#F8FAFC' }}>
                Nos {periodoTxt}, o balcão gerou {BRL(fisicaPuraCents)} de {metricLabel} ({sourceLabel}) contra {BRL(custoPeriodoCents)} de custo fixo —
                sobram <strong style={{ color: '#10B981' }}>{BRL(Math.abs(deficitCents))}</strong> só da física.
                O {metricLabel} online ({BRL(onlineCents)}) é {metric === 'profit' ? 'lucro líquido' : 'faturamento'} em cima disso.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ToggleGroup<T extends string>({
  label, options, value, onChange, activeColor,
}: {
  label:       string
  options:     { v: T; label: string }[]
  value:       T
  onChange:    (v: T) => void
  activeColor: string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
        {label}
      </span>
      <div className="flex gap-1 rounded-xl p-1" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
        {options.map(o => {
          const active = o.v === value
          return (
            <button
              key={o.v}
              onClick={() => onChange(o.v)}
              className="rounded-lg px-3 py-1 text-[11px] font-bold transition-all"
              style={active
                ? { background: activeColor, color: '#131C2A' }
                : { color: '#CBD5E1' }
              }
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ChannelDeliveryMatrixSection({ data }: { data: ChannelAnalytics }) {
  const m = data.channelDeliveryMatrix
  if (!m.rows.length || m.grandTotal.count === 0) return null

  // Esconde colunas com 0 em todas as linhas pra não poluir
  const visibleCols = m.deliveries.filter(col => (m.columnTotals[col.key]?.count ?? 0) > 0)
  if (visibleCols.length === 0) return null

  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#06B6D4' }} />
          <h2 className="text-base font-semibold text-text">Canal × Tipo de Entrega</h2>
        </div>
        <p className="mt-1 text-xs text-muted">
          Resposta exata pra <em>&quot;quantos do WhatsApp vêm retirar na loja vs receber por delivery?&quot;</em>.
          Cada célula mostra <strong>vendas / faturamento / lucro</strong>.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'rgba(15,23,42,.5)' }}>
              <th className="sticky left-0 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted"
                  style={{ background: 'rgba(15,23,42,.95)' }}>
                Canal
              </th>
              {visibleCols.map(col => (
                <th key={col.key} className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {col.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: '#10B981' }}>
                Total do canal
              </th>
            </tr>
          </thead>
          <tbody>
            {m.rows.map(row => (
              <tr key={row.channel} className="border-t" style={{ borderColor: '#2A3650' }}>
                <td className="sticky left-0 px-4 py-3 text-text"
                    style={{ background: '#1B2638' }}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full shrink-0" style={{ background: row.channelColor }} />
                    <span className="font-medium">{row.channelLabel}</span>
                  </div>
                </td>
                {visibleCols.map(col => {
                  const cell = row.cells[col.key]
                  const empty = !cell || cell.count === 0
                  return (
                    <td key={col.key} className="px-4 py-3 text-right" style={{ color: empty ? '#3A4868' : '#E2E8F0' }}>
                      {empty ? (
                        <span>—</span>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="text-[11px] uppercase tracking-wide" style={{ color: '#94A3B8' }}>
                            {cell.count} {cell.count === 1 ? 'venda' : 'vendas'}
                          </div>
                          <div className="font-semibold">{BRL(cell.revenueCents)}</div>
                          <div className="text-xs" style={{ color: cell.profitCents >= 0 ? '#10B981' : '#EF4444' }}>
                            Lucro {BRL(cell.profitCents)}
                          </div>
                        </div>
                      )}
                    </td>
                  )
                })}
                <td className="px-4 py-3 text-right">
                  {row.rowTotal.count === 0 ? (
                    <span style={{ color: '#3A4868' }}>—</span>
                  ) : (
                    <div className="space-y-0.5">
                      <div className="text-[11px] uppercase tracking-wide" style={{ color: '#94A3B8' }}>
                        {row.rowTotal.count} {row.rowTotal.count === 1 ? 'venda' : 'vendas'}
                      </div>
                      <div className="font-bold" style={{ color: '#10B981' }}>{BRL(row.rowTotal.revenueCents)}</div>
                      <div className="text-xs" style={{ color: row.rowTotal.profitCents >= 0 ? '#10B981' : '#EF4444' }}>
                        Lucro {BRL(row.rowTotal.profitCents)}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {/* Linha de totais por coluna */}
            <tr className="border-t" style={{ borderColor: '#2A3650', background: 'rgba(15,23,42,.5)' }}>
              <td className="sticky left-0 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted"
                  style={{ background: 'rgba(15,23,42,.95)' }}>
                Total da entrega
              </td>
              {visibleCols.map(col => {
                const total = m.columnTotals[col.key] ?? { count: 0, revenueCents: 0, profitCents: 0 }
                return (
                  <td key={col.key} className="px-4 py-3 text-right">
                    {total.count === 0 ? (
                      <span style={{ color: '#3A4868' }}>—</span>
                    ) : (
                      <div className="space-y-0.5">
                        <div className="text-[11px] uppercase tracking-wide" style={{ color: '#94A3B8' }}>
                          {total.count} {total.count === 1 ? 'venda' : 'vendas'}
                        </div>
                        <div className="font-bold text-text">{BRL(total.revenueCents)}</div>
                        <div className="text-xs" style={{ color: total.profitCents >= 0 ? '#10B981' : '#EF4444' }}>
                          Lucro {BRL(total.profitCents)}
                        </div>
                      </div>
                    )}
                  </td>
                )
              })}
              <td className="px-4 py-3 text-right">
                <div className="space-y-0.5">
                  <div className="text-[11px] uppercase tracking-wide" style={{ color: '#94A3B8' }}>
                    {m.grandTotal.count} {m.grandTotal.count === 1 ? 'venda' : 'vendas'}
                  </div>
                  <div className="font-bold" style={{ color: '#10B981' }}>{BRL(m.grandTotal.revenueCents)}</div>
                  <div className="text-xs" style={{ color: m.grandTotal.profitCents >= 0 ? '#10B981' : '#EF4444' }}>
                    Lucro {BRL(m.grandTotal.profitCents)}
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ChannelTableSection({ channels }: { channels: ChannelMetric[] }) {
  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#E4405F' }} />
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            Performance por canal
          </h2>
        </div>
      </div>

      <div className="overflow-x-auto">
        {channels.length === 0 ? (
          <p className="p-10 text-center text-sm" style={{ color: '#94A3B8' }}>
            Sem dados de canais no período
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
                {['Canal', 'Grupo', 'Vendas', 'OS', 'Faturamento', 'Lucro', 'Margem', 'Ticket médio'].map(h => (
                  <th key={h} className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channels
                .sort((a, b) => b.totalCents - a.totalCents)
                .map(c => {
                  const margin = c.totalCents > 0 ? c.totalProfitCents / c.totalCents : 0
                  const profitColor = c.totalProfitCents < 0 ? '#EF4444'
                                    : c.totalProfitCents === 0 ? '#94A3B8'
                                    : '#10B981'
                  const marginColor = margin < 0    ? '#EF4444'
                                    : margin < 0.15 ? '#F59E0B'
                                    : margin < 0.30 ? '#F8FAFC'
                                    : '#10B981'
                  return (
                    <tr key={c.channel} className="border-b hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c.color }} />
                          <span className="font-medium" style={{ color: '#F8FAFC' }}>{c.label}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                          style={{
                            background: c.group === 'online' ? 'rgba(34,197,94,.1)'
                                      : c.group === 'fisica' ? 'rgba(255,170,0,.1)'
                                      : 'rgba(138,168,200,.1)',
                            color: c.group === 'online' ? '#22C55E'
                                 : c.group === 'fisica' ? '#F59E0B'
                                 : '#CBD5E1',
                          }}>
                          {c.group}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>{NUM(c.salesCount)}</td>
                      <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>{NUM(c.osCount)}</td>
                      <td className="px-5 py-3 font-mono font-semibold" style={{ color: c.color }}>
                        {BRL(c.totalCents)}
                      </td>
                      <td className="px-5 py-3 font-mono font-semibold" style={{ color: profitColor }}>
                        {c.totalCents > 0 ? BRL(c.totalProfitCents) : '—'}
                      </td>
                      <td className="px-5 py-3 font-mono" style={{ color: marginColor }}>
                        {c.totalCents > 0 ? PCT(margin) : '—'}
                      </td>
                      <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>
                        {c.avgTicketCents > 0 ? BRL(c.avgTicketCents) : '—'}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function OriginSection({ origins }: { origins: OriginMetric[] }) {
  const sorted     = [...origins].sort((a, b) => b.totalCents - a.totalCents)
  const totalCents = sorted.reduce((s, o) => s + o.totalCents, 0)
  const totalCust  = sorted.reduce((s, o) => s + o.customers,  0)
  const totalTx    = sorted.reduce((s, o) => s + o.transactions, 0)
  const maxCents   = sorted[0]?.totalCents ?? 0

  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#E4405F' }} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <Megaphone className="h-3.5 w-3.5" />
              Origem dos clientes
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
              De onde vieram os clientes que compraram no período (canal de aquisição, não onde fecharam)
            </p>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="p-10 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem clientes com origem registrada no período. Marque a origem ao cadastrar o cliente em /erp-clientes.
        </p>
      ) : (
        <div className="p-6 space-y-5">
          {/* Resumo */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border p-3" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Faturamento</p>
              <p className="text-lg font-bold font-mono mt-1" style={{ color: '#F8FAFC' }}>{BRL(totalCents)}</p>
            </div>
            <div className="rounded-xl border p-3" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Clientes únicos</p>
              <p className="text-lg font-bold font-mono mt-1" style={{ color: '#22C55E' }}>{NUM(totalCust)}</p>
            </div>
            <div className="rounded-xl border p-3" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Transações</p>
              <p className="text-lg font-bold font-mono mt-1" style={{ color: '#8B5CF6' }}>{NUM(totalTx)}</p>
            </div>
          </div>

          {/* Barras por origem */}
          <div className="space-y-3">
            {sorted.map(o => {
              const pct = totalCents > 0 ? o.totalCents / totalCents : 0
              const barW = maxCents > 0 ? (o.totalCents / maxCents) * 100 : 0
              return (
                <div key={o.origin}>
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-3 w-3 rounded shrink-0" style={{ background: o.color }} />
                      <span className="font-medium truncate" style={{ color: '#F8FAFC' }}>{o.label}</span>
                      <span className="font-mono shrink-0" style={{ color: '#94A3B8' }}>{PCT(pct)}</span>
                    </div>
                    <span className="font-mono font-bold shrink-0 ml-2" style={{ color: o.color }}>
                      {BRL(o.totalCents)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-md overflow-hidden" style={{ background: '#131C2A' }}>
                    <div className="h-full transition-all" style={{
                      width: `${barW}%`,
                      background: `linear-gradient(90deg, ${o.color}55, ${o.color})`,
                    }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                    <span>
                      <span className="font-mono" style={{ color: '#CBD5E1' }}>{NUM(o.customers)}</span> cliente(s)
                      {' · '}
                      <span className="font-mono" style={{ color: '#CBD5E1' }}>{NUM(o.transactions)}</span> transação(ões)
                    </span>
                    <span>
                      ticket médio <span className="font-mono" style={{ color: '#CBD5E1' }}>{o.avgTicketCents > 0 ? BRL(o.avgTicketCents) : '—'}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function InferredOriginSection({ inferredOrigins }: { inferredOrigins: InferredOriginMetric[] }) {
  const sorted     = [...inferredOrigins].sort((a, b) => b.totalCents - a.totalCents)
  const totalCents = sorted.reduce((s, o) => s + o.totalCents, 0)
  const totalTx    = sorted.reduce((s, o) => s + o.transactions, 0)
  const maxCents   = sorted[0]?.totalCents ?? 0

  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#8B5CF6' }} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <Megaphone className="h-3.5 w-3.5" />
              Origem inferida (vendas sem cadastro)
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
              Vendas pra Consumidor Final ou clientes sem origem cadastrada — usamos o canal de venda como aproximação. Não é tão preciso quanto a seção acima, mas ajuda a entender de onde vem o tráfego anônimo.
            </p>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="p-10 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem vendas anônimas no período (todos os clientes têm origem cadastrada).
        </p>
      ) : (
        <div className="p-6 space-y-5">
          {/* Resumo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Faturamento anônimo</p>
              <p className="text-lg font-bold font-mono mt-1" style={{ color: '#F8FAFC' }}>{BRL(totalCents)}</p>
            </div>
            <div className="rounded-xl border p-3" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Transações anônimas</p>
              <p className="text-lg font-bold font-mono mt-1" style={{ color: '#8B5CF6' }}>{NUM(totalTx)}</p>
            </div>
          </div>

          {/* Barras por origem inferida */}
          <div className="space-y-3">
            {sorted.map(o => {
              const pct  = totalCents > 0 ? o.totalCents / totalCents : 0
              const barW = maxCents > 0 ? (o.totalCents / maxCents) * 100 : 0
              return (
                <div key={o.channel}>
                  <div className="flex items-center justify-between text-[11px] mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-3 w-3 rounded shrink-0" style={{ background: o.color }} />
                      <span className="font-medium truncate" style={{ color: '#F8FAFC' }}>{o.label}</span>
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: 'rgba(155,109,255,.15)', color: '#8B5CF6' }}>
                        inferido
                      </span>
                      <span className="font-mono shrink-0" style={{ color: '#94A3B8' }}>{PCT(pct)}</span>
                    </div>
                    <span className="font-mono font-bold shrink-0 ml-2" style={{ color: o.color }}>
                      {BRL(o.totalCents)}
                    </span>
                  </div>
                  <div className="h-2.5 rounded-md overflow-hidden" style={{ background: '#131C2A' }}>
                    <div className="h-full transition-all" style={{
                      width: `${barW}%`,
                      background: `linear-gradient(90deg, ${o.color}55, ${o.color})`,
                    }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                    <span>
                      <span className="font-mono" style={{ color: '#CBD5E1' }}>{NUM(o.transactions)}</span> transação(ões)
                    </span>
                    <span>
                      ticket médio <span className="font-mono" style={{ color: '#CBD5E1' }}>{o.avgTicketCents > 0 ? BRL(o.avgTicketCents) : '—'}</span>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="rounded-lg border p-3 flex items-start gap-2 text-[11px]"
            style={{ background: 'rgba(255,170,0,.04)', borderColor: 'rgba(255,170,0,.2)' }}>
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: '#F59E0B' }} />
            <span style={{ color: '#CBD5E1' }}>
              <strong style={{ color: '#F59E0B' }}>Atenção:</strong> a origem aqui é <em>inferida</em> pelo canal de fechamento.
              Um cliente que viu seu Instagram pago e foi até o balcão, por exemplo, vai aparecer aqui como
              &quot;Passou na porta&quot;. Pra atribuição precisa, cadastre o cliente e marque a origem real.
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function OriginChannelMatrixSection({ matrix }: { matrix: OriginChannelMatrix }) {
  const [mode, setMode] = useState<'absolute' | 'pct_row'>('absolute')
  const { origins, channels, cells, rowTotals, colTotals, grandTotal } = matrix

  if (grandTotal === 0 || origins.length === 0 || channels.length === 0) {
    return (
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 rounded-full" style={{ background: '#8B5CF6' }} />
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
              Origem × Canal
            </h2>
          </div>
        </div>
        <p className="p-10 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem dados pra cruzar origem e canal no período
        </p>
      </div>
    )
  }

  const cellMap = new Map<string, { totalCents: number; transactions: number }>()
  for (const c of cells) cellMap.set(`${c.origin}|${c.channel}`, { totalCents: c.totalCents, transactions: c.transactions })

  const maxCent = Math.max(0, ...cells.map(c => c.totalCents))

  // Em modo absoluto, intensidade da célula = valor / max global.
  // Em modo % por linha, intensidade = valor / total da origem.
  const intensity = (origin: string, value: number) => {
    if (mode === 'pct_row') {
      const row = rowTotals[origin] ?? 0
      return row > 0 ? value / row : 0
    }
    return maxCent > 0 ? value / maxCent : 0
  }

  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4 flex items-start justify-between gap-3 flex-wrap" style={{ borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#8B5CF6' }} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
              Origem × Canal
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
              De onde vem o cliente (linhas) × onde fechou a venda (colunas)
            </p>
          </div>
        </div>
        <ToggleGroup
          label="Visão"
          options={[
            { v: 'absolute', label: 'Valor' },
            { v: 'pct_row',  label: '% por origem' },
          ]}
          value={mode}
          onChange={setMode}
          activeColor="#8B5CF6"
        />
      </div>

      <div className="overflow-x-auto p-4">
        <table className="w-full text-xs border-separate" style={{ borderSpacing: '4px' }}>
          <thead>
            <tr>
              <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                Origem ↓ / Canal →
              </th>
              {channels.map(ch => (
                <th key={ch.key} className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider" style={{ color: ch.color }}>
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: ch.color }} />
                    {ch.label}
                  </div>
                </th>
              ))}
              <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider" style={{ color: '#CBD5E1' }}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {origins.map(or => {
              const rowTotal = rowTotals[or.key] ?? 0
              return (
                <tr key={or.key}>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: or.color }} />
                      <span style={{ color: '#F8FAFC' }}>{or.label}</span>
                    </div>
                  </td>
                  {channels.map(ch => {
                    const cell = cellMap.get(`${or.key}|${ch.key}`)
                    const value = cell?.totalCents ?? 0
                    const tx    = cell?.transactions ?? 0
                    const inten = intensity(or.key, value)
                    const pctRow = rowTotal > 0 ? value / rowTotal : 0
                    if (value === 0) {
                      return (
                        <td key={ch.key} className="px-2 py-2 text-center font-mono text-[10px]"
                          style={{ background: '#131C2A', borderRadius: 6, color: '#3A4A60' }}>
                          —
                        </td>
                      )
                    }
                    return (
                      <td key={ch.key}
                        className="px-2 py-2 text-center font-mono"
                        style={{
                          background: hexWithAlpha(ch.color, 0.12 + inten * 0.55),
                          color: inten > 0.5 ? '#F8FAFC' : '#CBD5E1',
                          borderRadius: 6,
                        }}
                        title={`${or.label} × ${ch.label} — ${BRL(value)} em ${tx} transação(ões) (${PCT(pctRow)} dessa origem)`}
                      >
                        <div className="text-[11px] font-semibold" style={{ color: '#F8FAFC' }}>
                          {mode === 'pct_row' ? PCT(pctRow) : BRL(value)}
                        </div>
                        <div className="text-[9px]" style={{ color: '#CBD5E1' }}>
                          {NUM(tx)} tx
                        </div>
                      </td>
                    )
                  })}
                  <td className="px-2 py-2 text-right font-mono text-[11px] font-bold" style={{ color: '#F8FAFC' }}>
                    {BRL(rowTotal)}
                  </td>
                </tr>
              )
            })}
            {/* Linha de totais por canal */}
            <tr>
              <td className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                Total
              </td>
              {channels.map(ch => (
                <td key={ch.key} className="px-2 py-2 text-center font-mono text-[11px] font-bold" style={{ color: ch.color }}>
                  {BRL(colTotals[ch.key] ?? 0)}
                </td>
              ))}
              <td className="px-2 py-2 text-right font-mono text-[11px] font-bold" style={{ color: '#10B981' }}>
                {BRL(grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="text-[10px] mt-3" style={{ color: '#94A3B8' }}>
          {mode === 'pct_row'
            ? 'Cada célula mostra que % do faturamento daquela origem fechou em cada canal.'
            : 'Cada célula mostra o faturamento — cor mais forte = maior valor.'}
        </p>
      </div>
    </div>
  )
}

function CacByChannelSection({ cac }: { cac: CacByChannel }) {
  if (!cac.available) {
    return (
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 rounded-full" style={{ background: '#1877F2' }} />
            <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <Target className="h-3.5 w-3.5" />
              CAC por canal (Meta Ads)
            </h2>
          </div>
        </div>
        <p className="p-8 text-center text-sm" style={{ color: '#CBD5E1' }}>
          {cac.unavailableReason ?? 'Dados de Meta Ads indisponíveis no período.'}
        </p>
      </div>
    )
  }

  const noAttribution = cac.metaCustomerCount === 0

  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#1877F2' }} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <Target className="h-3.5 w-3.5" />
              CAC e ROAS por canal (Meta Ads)
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
              Cruza gasto Meta com clientes que tinham <code style={{ color: '#CBD5E1' }}>campaign_code</code> preenchido — mostra onde os clientes pagos fecharam.
            </p>
          </div>
        </div>
      </div>

      {/* KPIs do topo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-6 pb-3">
        <div className="rounded-xl border p-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Gasto Meta no período
          </p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: '#E4405F' }}>
            {BRL(cac.spendCents)}
          </p>
        </div>
        <div className="rounded-xl border p-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Clientes Meta atribuídos
          </p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: '#22C55E' }}>
            {NUM(cac.metaCustomerCount)}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#CBD5E1' }}>
            com campaign_code que fecharam venda/OS
          </p>
        </div>
        <div className="rounded-xl border p-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            CAC Meta global
          </p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: '#F59E0B' }}>
            {noAttribution ? '—' : BRL(cac.cacCents)}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#CBD5E1' }}>
            gasto ÷ clientes atribuídos
          </p>
        </div>
        <div className="rounded-xl border p-4"
          style={{
            background: cac.globalRoas >= 1 ? 'rgba(16,185,129,.06)' : 'rgba(255,77,109,.08)',
            borderColor: cac.globalRoas >= 1 ? 'rgba(16,185,129,.3)' : 'rgba(255,77,109,.3)',
          }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            ROAS global
          </p>
          <p className="text-xl font-bold font-mono mt-1" style={{ color: cac.globalRoas >= 1 ? '#10B981' : '#EF4444' }}>
            {noAttribution ? '—' : `${cac.globalRoas.toFixed(2)}×`}
          </p>
          <p className="text-[10px] mt-1" style={{ color: '#CBD5E1' }}>
            {BRL(cac.totalAttributedRevenueCents)} de receita atribuída
          </p>
        </div>
      </div>

      {/* Aviso se não tem atribuição */}
      {noAttribution && (
        <div className="mx-6 mb-4 rounded-lg border p-3 flex items-start gap-2 text-[11px]"
          style={{ background: 'rgba(255,170,0,.05)', borderColor: 'rgba(255,170,0,.25)', color: '#CBD5E1' }}>
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: '#F59E0B' }} />
          <span>
            Nenhuma venda/OS atribuída a Meta no período. Verifique se o atendente está preenchendo
            o <strong style={{ color: '#F59E0B' }}>campaign_code</strong> ao cadastrar clientes vindos de anúncios.
          </span>
        </div>
      )}

      {/* Tabela por canal */}
      {!noAttribution && cac.byChannel.length > 0 && (
        <div className="overflow-x-auto px-6 pb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
                {['Canal', 'Clientes Meta', '% do Meta', 'Receita atribuída', 'ROAS canal'].map(h => (
                  <th key={h} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cac.byChannel.map(c => (
                <tr key={c.channel} className="border-b hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: c.color }} />
                      <span className="font-medium" style={{ color: '#F8FAFC' }}>{c.label}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono" style={{ color: '#CBD5E1' }}>{NUM(c.customers)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded overflow-hidden max-w-[120px]" style={{ background: '#131C2A' }}>
                        <div className="h-full" style={{
                          width: `${c.pctCustomers * 100}%`,
                          background: `linear-gradient(90deg, ${c.color}66, ${c.color})`,
                        }} />
                      </div>
                      <span className="text-[11px] font-mono" style={{ color: '#CBD5E1' }}>{PCT(c.pctCustomers)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold" style={{ color: c.color }}>
                    {BRL(c.revenueCents)}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold" style={{ color: c.roas >= 1 ? '#10B981' : '#EF4444' }}>
                    {c.roas.toFixed(2)}×
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] mt-3" style={{ color: '#94A3B8' }}>
            ROAS canal = receita atribuída do canal ÷ gasto Meta total. Soma dos ROAS dos canais = ROAS global.
          </p>
        </div>
      )}
    </div>
  )
}

/** Aceita um hex #RRGGBB e devolve rgba(r,g,b,alpha). */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`
}

function DailyChartSection({
  daily,
}: {
  daily: { date: string; onlineCents: number; fisicaCents: number; onlineProfitCents: number; fisicaProfitCents: number }[]
}) {
  const [metric, setMetric] = useState<BreakEvenMetric>('revenue')

  const width  = 800
  const height = 260
  const padL   = 60
  const padR   = 20
  const padT   = 20
  const padB   = 40
  const innerW = width  - padL - padR
  const innerH = height - padT - padB

  const series = daily.map(d => ({
    date:   d.date,
    online: metric === 'profit' ? d.onlineProfitCents : d.onlineCents,
    fisica: metric === 'profit' ? d.fisicaProfitCents : d.fisicaCents,
  }))

  // Em modo lucro pode haver valores negativos. Eixo y precisa ir do mínimo ao máximo,
  // com baseline em zero quando aparecer negativo.
  const allVals  = series.flatMap(d => [d.online, d.fisica])
  const maxVal   = Math.max(0, ...allVals, 1)
  const minVal   = Math.min(0, ...allVals)
  const range    = maxVal - minVal || 1
  const barGroupW = innerW / Math.max(1, series.length)
  const barW = Math.max(2, (barGroupW / 2) - 2)

  const xBase  = (i: number) => padL + i * barGroupW
  const yScale = (v: number) => padT + innerH - ((v - minVal) / range) * innerH
  const yZero  = yScale(0)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    value: minVal + range * t,
    y:     padT + innerH - t * innerH,
  }))
  const xStep  = Math.max(1, Math.ceil(series.length / 10))
  const fmtShortDate = (iso: string) => iso.slice(5).replace('-', '/')
  const metricLabel = metric === 'profit' ? 'Lucro' : 'Faturamento'

  return (
    <div className="rounded-2xl border p-6 space-y-3" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#10B981' }} />
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            Evolução diária — Online vs Física ({metricLabel.toLowerCase()})
          </h2>
        </div>
        <ToggleGroup
          label="Métrica"
          options={[
            { v: 'revenue', label: 'Faturamento' },
            { v: 'profit',  label: 'Lucro' },
          ]}
          value={metric}
          onChange={setMetric}
          activeColor="#10B981"
        />
      </div>
      <div className="rounded-xl border p-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {yTicks.map(t => (
            <line key={t.y}
              x1={padL} y1={t.y} x2={width - padR} y2={t.y}
              stroke="#2A3650" strokeWidth="1" strokeDasharray="2 3"
            />
          ))}
          {/* Linha do zero destacada quando há valores negativos */}
          {minVal < 0 && (
            <line x1={padL} y1={yZero} x2={width - padR} y2={yZero}
              stroke="#94A3B8" strokeWidth="1" />
          )}

          {series.map((d, i) => {
            const x = xBase(i) + 2
            const yOnline  = yScale(d.online)
            const yFisica  = yScale(d.fisica)
            const hOnline  = Math.abs(yOnline - yZero)
            const hFisica  = Math.abs(yFisica - yZero)
            const yOnTop   = Math.min(yOnline, yZero)
            const yFiTop   = Math.min(yFisica, yZero)
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={yOnTop}
                  width={barW}
                  height={Math.max(1, hOnline)}
                  fill={d.online < 0 ? '#EF4444' : '#22C55E'}
                  opacity="0.85"
                >
                  <title>{`${d.date}: Online ${metricLabel} ${BRL(d.online)}`}</title>
                </rect>
                <rect
                  x={x + barW + 2}
                  y={yFiTop}
                  width={barW}
                  height={Math.max(1, hFisica)}
                  fill={d.fisica < 0 ? '#EF4444' : '#F59E0B'}
                  opacity="0.85"
                >
                  <title>{`${d.date}: Física ${metricLabel} ${BRL(d.fisica)}`}</title>
                </rect>
              </g>
            )
          })}

          {yTicks.map(t => (
            <text key={`ylbl-${t.y}`}
              x={padL - 8} y={t.y + 3}
              textAnchor="end" fontSize="10" fill="#94A3B8" fontFamily="ui-monospace,monospace"
            >
              {BRL(Math.round(t.value))}
            </text>
          ))}

          {series.map((d, i) => (i % xStep === 0 || i === series.length - 1) && (
            <text key={`xlbl-${i}`}
              x={xBase(i) + barGroupW / 2} y={height - 15}
              textAnchor="middle" fontSize="10" fill="#94A3B8" fontFamily="ui-monospace,monospace"
            >
              {fmtShortDate(d.date)}
            </text>
          ))}
        </svg>
        <div className="mt-2 flex items-center justify-center gap-4 text-[11px]">
          <span className="inline-flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
            <span className="h-2.5 w-2.5 rounded" style={{ background: '#22C55E' }} /> Online
          </span>
          <span className="inline-flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
            <span className="h-2.5 w-2.5 rounded" style={{ background: '#F59E0B' }} /> Física
          </span>
          {minVal < 0 && (
            <span className="inline-flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <span className="h-2.5 w-2.5 rounded" style={{ background: '#EF4444' }} /> Lucro negativo (prejuízo)
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function KpiCard({
  label, value, sub, color, icon: Icon,
}: {
  label: string; value: string; sub: string
  color: string; icon: React.ElementType
}) {
  return (
    <div className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full opacity-15"
        style={{ background: `radial-gradient(circle, ${color}, transparent)` }} />
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>{label}</span>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color, fontFamily: 'ui-monospace,monospace' }}>{value}</div>
      <div className="mt-1 text-[11px]" style={{ color: '#94A3B8' }}>{sub}</div>
    </div>
  )
}

// Suprime warning do TS se algum dia usarmos ArrowRight
void ArrowRight
