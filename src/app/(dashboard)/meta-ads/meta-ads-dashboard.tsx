'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Settings, DollarSign, Eye, MousePointer, Target,
  AlertTriangle, ExternalLink, CheckCircle2, ChevronDown, Star, Check, Tag,
  Pause, Play, Copy, Wallet, X, Loader2, LineChart as LineChartIcon, Bell,
  BarChart3,
} from 'lucide-react'
import {
  updateCampaignStatus,
  updateCampaignDailyBudget,
  duplicateCampaign,
  fetchCampaignTimeseries,
  type MetaAdsInsights, type MetaAdsCampaign, type MetaAdsPeriod, type MetaAdsAdAccount,
  type MetaAdsTimeseriesPoint, type MetaAdsAccountHealth,
} from '@/actions/meta-ads'
import type { OriginTotals, CampaignCodeTotal } from './page'
import { formatDateTime } from '@/lib/datetime'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(c / 100)
    .replace(/ /g, ' ')
    .replace(/ /g, ' ')

const NUM = (n: number) =>
  new Intl.NumberFormat('pt-BR').format(n)

type Props = {
  period: MetaAdsPeriod
  accounts: MetaAdsAdAccount[]
  selectedAccount: MetaAdsAdAccount | null
  accountHealth: MetaAdsAccountHealth | null
  insights: MetaAdsInsights | null
  campaigns: MetaAdsCampaign[]
  loadError: string | null
  originRevenue: OriginTotals
  campaignCodeTotals: CampaignCodeTotal[]
  unreadAlertsCount: number
}

export function MetaAdsDashboard({
  period, accounts, selectedAccount, accountHealth, insights, campaigns, loadError, originRevenue, campaignCodeTotals, unreadAlertsCount,
}: Props) {
  const router = useRouter()

  function buildUrl(nextPeriod: MetaAdsPeriod, nextAccountId?: string) {
    const params = new URLSearchParams()
    params.set('period', nextPeriod)
    const accId = nextAccountId ?? selectedAccount?.adAccountId
    if (accId) params.set('account', accId)
    return `/meta-ads?${params.toString()}`
  }

  const periodOptions: { v: MetaAdsPeriod; label: string }[] = [
    { v: 'today',     label: 'Hoje' },
    { v: 'yesterday', label: 'Ontem' },
    { v: '7d',        label: '7d' },
    { v: '30d',       label: '30d' },
    { v: '90d',       label: '90d' },
  ]

  // ROAS — cruzamento: faturamento atribuído / gasto
  const metaRevenueCents = originRevenue.igPagoCents + originRevenue.igOrgCents + originRevenue.facebookCents
  const spendCents       = insights?.spendCents ?? 0
  const roas             = spendCents > 0 ? metaRevenueCents / spendCents : 0
  const returnPerReal    = spendCents > 0 ? (metaRevenueCents / spendCents).toFixed(2) : '—'

  // Status da campanha — prioridade:
  //   1. Conta inteira com problema (billing, suspensão) → sobrescreve tudo
  //   2. issues_info da campanha
  //   3. effective_status
  //   4. status (intenção do usuário)
  const statusInfo = (campaign: MetaAdsCampaign) => {
    // Conta unhealthy → problema é da conta, todas as campanhas ficam bloqueadas
    if (accountHealth && !accountHealth.isHealthy) {
      return {
        c:  '#EF4444',
        bg: 'rgba(255,77,109,.15)',
        label: accountHealth.label,
        detail: accountHealth.detail ?? 'Problema na conta de anúncios',
      }
    }
    // Se tem issues específicas, mostra a primeira (geralmente a mais crítica)
    if (campaign.issues && campaign.issues.length > 0) {
      const issue = campaign.issues[0]
      // Heurística: palavras-chave de billing
      const lower = (issue.summary + ' ' + issue.message).toLowerCase()
      const isBilling = /pag|billing|cart|cobr|sald|payment/.test(lower)
      return {
        c:  '#EF4444',
        bg: 'rgba(255,77,109,.15)',
        label: isBilling ? 'Erro no pagamento' : issue.summary.slice(0, 40) || 'Com problema',
        detail: issue.summary || issue.message,
      }
    }
    switch (campaign.effectiveStatus) {
      case 'ACTIVE':
        return { c: '#10B981', bg: 'rgba(16,185,129,.15)', label: 'Ativa', detail: null }
      case 'PAUSED':
        return { c: '#F59E0B', bg: 'rgba(255,170,0,.15)', label: 'Pausada', detail: null }
      case 'WITH_ISSUES':
        return { c: '#EF4444', bg: 'rgba(255,77,109,.15)', label: 'Com problema', detail: 'Verifique no Ads Manager' }
      case 'PENDING_BILLING_INFO':
        return { c: '#EF4444', bg: 'rgba(255,77,109,.15)', label: 'Aguarda pagamento', detail: null }
      case 'DISAPPROVED':
        return { c: '#EF4444', bg: 'rgba(255,77,109,.15)', label: 'Reprovada', detail: null }
      case 'PENDING_REVIEW':
      case 'IN_PROCESS':
        return { c: '#22C55E', bg: 'rgba(34,197,94,.15)', label: 'Em revisão', detail: null }
      case 'CAMPAIGN_PAUSED':
        return { c: '#F59E0B', bg: 'rgba(255,170,0,.15)', label: 'Pausada (campanha)', detail: null }
      case 'ADSET_PAUSED':
        return { c: '#F59E0B', bg: 'rgba(255,170,0,.15)', label: 'Pausada (ad set)', detail: null }
      case 'ARCHIVED':
        return { c: '#94A3B8', bg: 'rgba(90,122,154,.15)', label: 'Arquivada', detail: null }
      case 'DELETED':
        return { c: '#94A3B8', bg: 'rgba(90,122,154,.15)', label: 'Excluída', detail: null }
      default:
        return { c: '#CBD5E1', bg: 'rgba(138,168,200,.15)', label: campaign.status, detail: null }
    }
  }

  // Mutação é bloqueada se: conta unhealthy OU campanha com issue OU status ruim
  const isMutationBlocked = (campaign: MetaAdsCampaign) => {
    if (accountHealth && !accountHealth.isHealthy) return true
    if (campaign.issues && campaign.issues.length > 0) return true
    return campaign.effectiveStatus === 'WITH_ISSUES' ||
           campaign.effectiveStatus === 'PENDING_BILLING_INFO' ||
           campaign.effectiveStatus === 'DISAPPROVED' ||
           campaign.effectiveStatus === 'DELETED' ||
           campaign.effectiveStatus === 'ARCHIVED'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>Meta Ads</h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            {selectedAccount ? (
              <>
                <span style={{ color: '#F8FAFC' }}>{selectedAccount.displayName}</span>
                {' · '}
                <span className="font-mono">{selectedAccount.adAccountId}</span>
                {selectedAccount.lastSyncAt && <> · Última sync: {formatDateTime(selectedAccount.lastSyncAt)}</>}
              </>
            ) : (
              <>Nenhuma conta ativa</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {accounts.filter(a => a.isActive).length > 1 && selectedAccount && (
            <AccountSelector
              accounts={accounts.filter(a => a.isActive)}
              selectedId={selectedAccount.adAccountId}
              onSelect={id => router.push(buildUrl(period, id))}
            />
          )}
          <div className="flex gap-1 rounded-xl p-1" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
            {periodOptions.map(p => (
              <button
                key={p.v}
                onClick={() => router.push(buildUrl(p.v))}
                className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                style={period === p.v
                  ? { background: '#E4405F', color: '#fff' }
                  : { color: '#94A3B8' }
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <Link
            href={`/meta-ads/relatorios?period=${period}${selectedAccount ? `&account=${selectedAccount.adAccountId}` : ''}`}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
            style={{ borderColor: '#2A3650', color: '#22C55E' }}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Relatórios
          </Link>
          <Link
            href="/meta-ads/alertas"
            className="relative flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
            style={{ borderColor: '#2A3650', color: '#F59E0B' }}
          >
            <Bell className="h-3.5 w-3.5" />
            Alertas
            {unreadAlertsCount > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full text-[9px] font-bold"
                style={{
                  background: '#EF4444', color: '#fff',
                  minWidth: '18px', height: '18px', padding: '0 4px',
                  boxShadow: '0 0 0 2px #131C2A',
                }}
              >
                {unreadAlertsCount > 99 ? '99+' : unreadAlertsCount}
              </span>
            )}
          </Link>
          <Link
            href="/meta-ads/configuracoes"
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
            style={{ borderColor: '#2A3650', color: '#22C55E' }}
          >
            <Settings className="h-3.5 w-3.5" />
            Configurações
          </Link>
        </div>
      </div>

      {/* Alerta de saúde da conta (billing/suspensão) */}
      {accountHealth && !accountHealth.isHealthy && (
        <div className="rounded-xl border px-4 py-3 flex items-start gap-3"
          style={{ background: 'rgba(255,77,109,.08)', borderColor: 'rgba(255,77,109,.4)' }}>
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: '#EF4444' }}>
              {accountHealth.label}
            </p>
            {accountHealth.detail && (
              <p className="text-xs mt-1" style={{ color: '#F8FAFC' }}>{accountHealth.detail}</p>
            )}
            <p className="text-[11px] mt-2" style={{ color: '#CBD5E1' }}>
              Enquanto o problema não for resolvido no Meta, as campanhas não veiculam e as ações do dashboard (pausar, ajustar budget, duplicar) vão falhar.
              {' '}
              <a
                href="https://business.facebook.com/billing_hub/accounts_overview"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold"
                style={{ color: '#22C55E' }}
              >
                Abrir Central de Cobrança
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Erro de carregamento */}
      {loadError && (
        <div className="rounded-xl border px-4 py-3 flex items-start gap-2"
          style={{ background: 'rgba(255,77,109,.08)', borderColor: 'rgba(255,77,109,.3)' }}>
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>Erro ao carregar dados da Meta</p>
            <p className="text-xs font-mono mt-1" style={{ color: '#EF4444' }}>{loadError}</p>
            <p className="text-xs mt-2" style={{ color: '#CBD5E1' }}>
              Tokens de longa duração expiram em 60 dias.{' '}
              <Link href="/meta-ads/configuracoes" className="underline" style={{ color: '#22C55E' }}>
                Revise suas credenciais
              </Link>
              {' '}ou teste a conexão.
            </p>
          </div>
        </div>
      )}

      {/* KPIs principais */}
      {insights && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard
            label="Investido"
            value={BRL(insights.spendCents)}
            sub={`${insights.dateStart} – ${insights.dateEnd}`}
            color="#E4405F"
            icon={DollarSign}
          />
          <KpiCard
            label="Impressões"
            value={NUM(insights.impressions)}
            sub={`Alcance: ${NUM(insights.reach)} · Freq: ${insights.frequency.toFixed(1)}`}
            color="#22C55E"
            icon={Eye}
          />
          <KpiCard
            label="Cliques"
            value={NUM(insights.clicks)}
            sub={`CTR: ${insights.ctr.toFixed(2)}%`}
            color="#F59E0B"
            icon={MousePointer}
          />
          <KpiCard
            label="CPC / CPM"
            value={BRL(insights.cpcCents)}
            sub={`CPM: ${BRL(insights.cpmCents)}`}
            color="#8B5CF6"
            icon={Target}
          />
        </div>
      )}

      {/* ROAS — destaque */}
      {insights && (
        <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="h-4 w-1 rounded-full" style={{ background: '#10B981' }} />
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>ROAS Real</h2>
              <p className="text-[11px]" style={{ color: '#94A3B8' }}>
                Gasto no Meta × Faturamento atribuído aos canais <strong>Instagram Pago</strong>, <strong>Instagram Orgânico</strong> e <strong>Facebook</strong>
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            <div className="rounded-xl border p-5" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>Investido</div>
              <div className="text-2xl font-bold mt-1" style={{ color: '#E4405F', fontFamily: 'ui-monospace,monospace' }}>
                {BRL(insights.spendCents)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: '#94A3B8' }}>em Meta Ads</div>
            </div>

            <div className="rounded-xl border p-5" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>Retornou</div>
              <div className="text-2xl font-bold mt-1" style={{ color: '#10B981', fontFamily: 'ui-monospace,monospace' }}>
                {BRL(metaRevenueCents)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: '#94A3B8' }}>{originRevenue.txCount} venda(s)/OS atribuídas</div>
            </div>

            <div className="rounded-xl border p-5 relative overflow-hidden"
              style={{ background: '#131C2A', borderColor: roas >= 1 ? 'rgba(16,185,129,.4)' : 'rgba(255,77,109,.4)' }}>
              <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>ROAS</div>
              <div className="text-2xl font-bold mt-1" style={{ color: roas >= 1 ? '#10B981' : '#EF4444', fontFamily: 'ui-monospace,monospace' }}>
                {returnPerReal === '—' ? '—' : `${returnPerReal}x`}
              </div>
              <div className="text-[11px] mt-1" style={{ color: '#94A3B8' }}>
                {spendCents > 0 && metaRevenueCents > 0
                  ? `R$ 1 investido → ${BRL(metaRevenueCents / (spendCents / 100))}`
                  : 'Sem dados suficientes'}
              </div>
            </div>
          </div>

          {/* Breakdown por canal */}
          <div className="mt-4 pt-4 border-t space-y-2" style={{ borderColor: '#2A3650' }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
              Faturamento por canal no período
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ChannelRow label="Instagram Pago" value={originRevenue.igPagoCents}  color="#E4405F" />
              <ChannelRow label="Instagram Orgânico" value={originRevenue.igOrgCents} color="#C13584" />
              <ChannelRow label="Facebook" value={originRevenue.facebookCents} color="#1877F2" />
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 text-[11px] rounded-lg px-3 py-2"
            style={{ background: 'rgba(34,197,94,.05)', borderLeft: '2px solid #22C55E', color: '#CBD5E1' }}>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: '#22C55E' }} />
            <span>
              O ROAS usa a origem do cliente (&quot;Como nos conheceu?&quot;) pra atribuir o faturamento. Quanto mais clientes cadastrados com origem correta, mais preciso fica.
            </span>
          </div>
        </div>
      )}

      {/* ROAS por código de campanha */}
      <CampaignCodeSection totals={campaignCodeTotals} spendCents={insights?.spendCents ?? 0} />

      {/* Campanhas */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 rounded-full" style={{ background: '#E4405F' }} />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>Campanhas</p>
              <p className="text-[11px]" style={{ color: '#94A3B8' }}>Performance por campanha no período</p>
            </div>
          </div>
          {campaigns.length > 0 && (
            <span className="text-[11px] rounded-full px-2.5 py-1 font-bold"
              style={{ background: 'rgba(228,64,95,.1)', color: '#E4405F' }}>
              {campaigns.length} campanha(s)
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          {campaigns.length === 0 ? (
            <p className="p-10 text-center text-sm" style={{ color: '#94A3B8' }}>
              {loadError ? 'Verifique a conexão pra ver as campanhas' : 'Nenhuma campanha no período'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
                  {['Campanha', 'Status', 'Objetivo', 'Investido', 'Budget/dia', 'Impressões', 'Cliques', 'CTR', 'CPC', 'Ações'].map(h => (
                    <th key={h} className="px-5 py-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaigns
                  .sort((a, b) => b.spendCents - a.spendCents)
                  .map(c => {
                    const s = statusInfo(c)
                    const blocked = isMutationBlocked(c)
                    return (
                      <tr key={c.id} className="border-b hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
                        <td className="px-5 py-3">
                          <p className="font-medium text-sm" style={{ color: '#F8FAFC' }}>{c.name}</p>
                          <p className="text-[10px] font-mono mt-0.5" style={{ color: '#94A3B8' }}>ID: {c.id}</p>
                        </td>
                        <td className="px-5 py-3">
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap"
                            style={{ background: s.bg, color: s.c }} title={s.detail ?? undefined}>
                            {s.label}
                          </span>
                          {s.detail && (
                            <p className="text-[9px] mt-1 max-w-[200px]" style={{ color: '#CBD5E1' }}>
                              {s.detail}
                            </p>
                          )}
                          {blocked && c.status === 'ACTIVE' && (
                            <p className="text-[9px] mt-1 italic" style={{ color: '#94A3B8' }}>
                              Intenção: ativa
                            </p>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs" style={{ color: '#CBD5E1' }}>
                          {c.objective ?? '—'}
                        </td>
                        <td className="px-5 py-3 font-mono font-semibold" style={{ color: '#E4405F' }}>
                          {BRL(c.spendCents)}
                        </td>
                        <td className="px-5 py-3 font-mono" style={{ color: c.dailyBudgetCents != null ? '#22C55E' : '#94A3B8' }}>
                          {c.dailyBudgetCents != null ? BRL(c.dailyBudgetCents) : '—'}
                        </td>
                        <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>
                          {NUM(c.impressions)}
                        </td>
                        <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>
                          {NUM(c.clicks)}
                        </td>
                        <td className="px-5 py-3 font-mono" style={{ color: c.ctr >= 2 ? '#10B981' : c.ctr >= 1 ? '#F59E0B' : '#EF4444' }}>
                          {c.ctr.toFixed(2)}%
                        </td>
                        <td className="px-5 py-3 font-mono" style={{ color: '#CBD5E1' }}>
                          {BRL(c.cpcCents)}
                        </td>
                        <td className="px-5 py-3">
                          <CampaignActions
                            campaign={c}
                            adAccountId={selectedAccount?.adAccountId ?? null}
                            period={period}
                            mutationBlocked={blocked}
                            blockReason={blocked ? s.label : null}
                          />
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Rodapé com link útil */}
      {selectedAccount && (
        <div className="flex items-center justify-center gap-2 text-[11px]" style={{ color: '#94A3B8' }}>
          <a
            href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${selectedAccount.adAccountId.replace('act_', '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-[#22C55E]"
          >
            <ExternalLink className="h-3 w-3" />
            Abrir no Ads Manager
          </a>
        </div>
      )}
    </div>
  )
}

function AccountSelector({
  accounts, selectedId, onSelect,
}: {
  accounts: MetaAdsAdAccount[]
  selectedId: string
  onSelect: (adAccountId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = accounts.find(a => a.adAccountId === selectedId)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
        style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }}
      >
        <span className="truncate max-w-[160px]">{selected?.displayName ?? 'Selecionar conta'}</span>
        {selected?.isPrimary && <Star className="h-3 w-3 fill-current shrink-0" style={{ color: '#F59E0B' }} />}
        <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: '#94A3B8' }} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 w-72 rounded-xl border shadow-lg z-20 overflow-hidden"
          style={{ background: '#1B2638', borderColor: '#2A3650' }}
        >
          <div className="px-3 py-2 border-b text-[10px] font-bold uppercase tracking-wider"
            style={{ borderColor: '#2A3650', color: '#94A3B8' }}>
            Contas ativas
          </div>
          {accounts.map(acc => {
            const isSelected = acc.adAccountId === selectedId
            return (
              <button
                key={acc.id}
                onMouseDown={() => onSelect(acc.adAccountId)}
                className="w-full flex items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5"
                style={{ borderBottom: '1px solid rgba(30,45,69,.3)' }}
              >
                <div className="mt-0.5 shrink-0 w-4">
                  {isSelected && <Check className="h-3.5 w-3.5" style={{ color: '#10B981' }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold truncate" style={{ color: '#F8FAFC' }}>
                      {acc.displayName}
                    </span>
                    {acc.isPrimary && (
                      <Star className="h-3 w-3 fill-current shrink-0" style={{ color: '#F59E0B' }} />
                    )}
                  </div>
                  <div className="text-[10px] font-mono truncate" style={{ color: '#94A3B8' }}>
                    {acc.adAccountId}
                    {acc.currency && <span className="ml-1">· {acc.currency}</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
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

function CampaignCodeSection({ totals, spendCents }: { totals: CampaignCodeTotal[]; spendCents: number }) {
  const totalRevenue = totals.reduce((s, t) => s + t.revenueCents, 0)
  const hasData      = totals.length > 0

  return (
    <div className="rounded-2xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#F59E0B' }} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
              <Tag className="h-3.5 w-3.5" />
              ROAS por Código de Campanha
            </h2>
            <p className="text-[11px]" style={{ color: '#94A3B8' }}>
              Cruzamento de <strong>códigos preenchidos no cadastro do cliente</strong> com vendas e OS do período
            </p>
          </div>
        </div>
        {hasData && (
          <span className="text-[11px] rounded-full px-2.5 py-1 font-bold"
            style={{ background: 'rgba(255,170,0,.1)', color: '#F59E0B' }}>
            {totals.length} código(s) · {BRL(totalRevenue)} atribuído
          </span>
        )}
      </div>

      {!hasData ? (
        <div className="rounded-xl border p-5 text-center" style={{ background: '#131C2A', borderColor: 'rgba(255,170,0,.2)' }}>
          <Tag className="h-8 w-8 mx-auto mb-2" style={{ color: '#F59E0B', opacity: 0.5 }} />
          <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>Nenhum cliente com código de campanha no período</p>
          <p className="text-xs mt-2 max-w-lg mx-auto" style={{ color: '#CBD5E1' }}>
            Pra rastrear qual anúncio trouxe o cliente, edite a mensagem pré-preenchida dos seus anúncios Click-to-WhatsApp no Meta Ads Manager com um código identificador, tipo:
          </p>
          <div className="mt-3 inline-block rounded-lg border px-3 py-2 font-mono text-xs"
            style={{ background: '#131C2A', borderColor: '#2A3650', color: '#10B981' }}>
            &quot;Olá! Vi anúncio <span style={{ color: '#F59E0B' }}>[HJ-VAI-1]</span> — tenho interesse&quot;
          </div>
          <p className="text-xs mt-3 max-w-lg mx-auto" style={{ color: '#CBD5E1' }}>
            Quando o cliente chegar no WhatsApp com a mensagem, copie o código e preencha no campo <strong>&quot;Código da campanha&quot;</strong> do cadastro.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
                {['Código', 'Clientes', 'Transações', 'Faturamento', '% do Investido'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totals.map(t => {
                const pct = spendCents > 0 ? (t.revenueCents / spendCents) : 0
                return (
                  <tr key={t.code} className="border-b hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-bold rounded-lg px-2 py-1"
                        style={{ background: 'rgba(255,170,0,.1)', color: '#F59E0B' }}>
                        {t.code}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: '#CBD5E1' }}>
                      {t.customerCount}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: '#CBD5E1' }}>
                      {t.txCount}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold" style={{ color: '#10B981' }}>
                      {BRL(t.revenueCents)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: spendCents > 0 ? (pct >= 1 ? '#10B981' : pct >= 0.5 ? '#F59E0B' : '#EF4444') : '#94A3B8' }}>
                      {spendCents > 0 ? `${(pct * 100).toFixed(0)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p className="mt-3 text-[11px] rounded-lg px-3 py-2 flex items-start gap-2"
            style={{ background: 'rgba(34,197,94,.05)', borderLeft: '2px solid #22C55E', color: '#CBD5E1' }}>
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: '#22C55E' }} />
            <span>
              <strong style={{ color: '#F8FAFC' }}>Como é calculado:</strong> cada código cruza os clientes que o possuem com todas as vendas e OS (entregues) do período.
              A coluna <strong>% do Investido</strong> mostra quanto esse código representa do gasto total no Meta —
              útil pra identificar quais anúncios pagam o próprio custo.
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

// ── Campaign actions (pausar/despausar/ajustar budget/duplicar) ────────────

function CampaignActions({
  campaign, adAccountId, period, mutationBlocked, blockReason,
}: {
  campaign: MetaAdsCampaign
  adAccountId: string | null
  period: MetaAdsPeriod
  mutationBlocked: boolean
  blockReason: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [chartOpen, setChartOpen]   = useState(false)

  const isActive   = campaign.status === 'ACTIVE'
  const isPaused   = campaign.status === 'PAUSED'
  const canToggle  = (isActive || isPaused) && !mutationBlocked
  const canMutate  = adAccountId !== null && !mutationBlocked
  const blockTitle = blockReason ? `Ação bloqueada — ${blockReason}. Resolva no Ads Manager.` : ''

  async function handleToggle() {
    if (!adAccountId) return
    setBusy(true)
    try {
      await updateCampaignStatus(campaign.id, isActive ? 'PAUSED' : 'ACTIVE', adAccountId)
      toast.success(isActive ? 'Campanha pausada' : 'Campanha ativada')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function handleDuplicate() {
    if (!adAccountId) return
    if (!confirm(`Duplicar "${campaign.name}"?\nA cópia será criada pausada pra você revisar antes de ativar.`)) return
    setBusy(true)
    try {
      await duplicateCampaign(campaign.id, adAccountId)
      toast.success('Campanha duplicada (pausada — revise antes de ativar)')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {/* Gráfico temporal — sempre disponível (leitura, não afetado por bloqueio) */}
      {adAccountId && (
        <button
          onClick={() => setChartOpen(true)}
          disabled={busy}
          title="Ver gráfico temporal"
          className="rounded-md border p-1.5 transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{ borderColor: '#2A3650', color: '#F59E0B' }}
        >
          <LineChartIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {canToggle && (
        <button
          onClick={handleToggle}
          disabled={busy}
          title={isActive ? 'Pausar campanha' : 'Ativar campanha'}
          className="rounded-md border p-1.5 transition-colors disabled:opacity-40"
          style={{
            borderColor:  isActive ? 'rgba(255,170,0,.3)' : 'rgba(16,185,129,.3)',
            color:        isActive ? '#F59E0B' : '#10B981',
            background:   isActive ? 'rgba(255,170,0,.05)' : 'rgba(16,185,129,.05)',
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />)}
        </button>
      )}
      {canMutate && (
        <button
          onClick={() => setBudgetOpen(true)}
          disabled={busy}
          title={campaign.dailyBudgetCents != null ? 'Ajustar orçamento diário' : 'Campanha usa orçamento do ad set (CBO)'}
          className="rounded-md border p-1.5 transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{ borderColor: '#2A3650', color: '#22C55E' }}
        >
          <Wallet className="h-3.5 w-3.5" />
        </button>
      )}
      {canMutate && (
        <button
          onClick={handleDuplicate}
          disabled={busy}
          title="Duplicar campanha"
          className="rounded-md border p-1.5 transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{ borderColor: '#2A3650', color: '#8B5CF6' }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
      {mutationBlocked && adAccountId && (
        <span
          title={blockTitle}
          className="rounded-md border p-1.5 text-[10px] font-bold"
          style={{ borderColor: 'rgba(255,77,109,.3)', color: '#EF4444', background: 'rgba(255,77,109,.05)' }}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
      )}
      {budgetOpen && adAccountId && (
        <BudgetModal
          campaign={campaign}
          adAccountId={adAccountId}
          onClose={() => setBudgetOpen(false)}
          onSaved={() => { setBudgetOpen(false); router.refresh() }}
        />
      )}
      {chartOpen && adAccountId && (
        <TimeseriesModal
          campaign={campaign}
          adAccountId={adAccountId}
          period={period}
          onClose={() => setChartOpen(false)}
        />
      )}
    </div>
  )
}

function BudgetModal({
  campaign, adAccountId, onClose, onSaved,
}: {
  campaign: MetaAdsCampaign
  adAccountId: string
  onClose: () => void
  onSaved: () => void
}) {
  const current = campaign.dailyBudgetCents != null ? (campaign.dailyBudgetCents / 100) : 0
  const [value, setValue] = useState(current > 0 ? current.toFixed(2).replace('.', ',') : '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const parsed = parseFloat(value.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Informe um valor maior que zero')
      return
    }
    setSaving(true)
    try {
      await updateCampaignDailyBudget(campaign.id, Math.round(parsed * 100), adAccountId)
      toast.success(`Orçamento atualizado: R$ ${parsed.toFixed(2).replace('.', ',')}/dia`)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar orçamento')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-4"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4" style={{ color: '#22C55E' }} />
            <h3 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>Ajustar orçamento diário</h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-coral transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <p className="text-xs" style={{ color: '#94A3B8' }}>Campanha</p>
          <p className="text-sm font-semibold mt-0.5" style={{ color: '#F8FAFC' }}>{campaign.name}</p>
          {campaign.dailyBudgetCents == null && (
            <div className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px]"
              style={{ background: 'rgba(255,170,0,.06)', borderLeft: '2px solid #F59E0B', color: '#CBD5E1' }}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
              <span>
                Essa campanha não tem orçamento no nível da campanha (provavelmente usa CBO ou orçamento por ad set).
                Definir um valor aqui vai sobrescrever essa estrutura.
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Orçamento diário
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#CBD5E1' }}>R$</span>
            <input
              value={value}
              onChange={e => setValue(e.target.value.replace(/[^0-9,]/g, ''))}
              placeholder="0,00"
              className="w-full rounded-lg border pl-10 pr-3 py-2.5 text-sm outline-none font-mono"
              style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
            />
          </div>
          <p className="text-[10px]" style={{ color: '#94A3B8' }}>
            Valor em reais (ex: <code>25,00</code>). A Meta ajusta a entrega pra gastar até esse valor por dia.
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ borderColor: '#2A3650', color: '#CBD5E1' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !value}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Timeseries (gráfico temporal por campanha) ────────────────────────────

type Metric = 'spend' | 'clicks' | 'impressions' | 'ctr'

const METRIC_CONFIG: Record<Metric, { label: string; color: string; format: (v: number) => string }> = {
  spend:       { label: 'Gasto',       color: '#E4405F', format: v => BRL(v) },
  clicks:      { label: 'Cliques',     color: '#F59E0B', format: v => NUM(v) },
  impressions: { label: 'Impressões',  color: '#22C55E', format: v => NUM(v) },
  ctr:         { label: 'CTR',         color: '#8B5CF6', format: v => `${v.toFixed(2)}%` },
}

function TimeseriesModal({
  campaign, adAccountId, period, onClose,
}: {
  campaign: MetaAdsCampaign
  adAccountId: string
  period: MetaAdsPeriod
  onClose: () => void
}) {
  type State = { loading: boolean; data: MetaAdsTimeseriesPoint[]; error: string | null }
  const [state, setState]   = useState<State>({ loading: true, data: [], error: null })
  const [metric, setMetric] = useState<Metric>('spend')
  const { loading, data, error } = state

  useEffect(() => {
    let cancelled = false
    fetchCampaignTimeseries(campaign.id, period, adAccountId)
      .then(d => {
        if (!cancelled) setState({ loading: false, data: d, error: null })
      })
      .catch(err => {
        if (!cancelled) {
          setState({
            loading: false,
            data:    [],
            error:   err instanceof Error ? err.message : 'Erro ao carregar gráfico',
          })
        }
      })
    return () => { cancelled = true }
  }, [campaign.id, period, adAccountId])

  const totalSpend       = data.reduce((s, p) => s + p.spendCents, 0)
  const totalClicks      = data.reduce((s, p) => s + p.clicks, 0)
  const totalImpressions = data.reduce((s, p) => s + p.impressions, 0)
  const avgCtr           = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0

  const chartPoints = data.map(p => ({
    date: p.date,
    value: metric === 'spend'       ? p.spendCents
         : metric === 'clicks'      ? p.clicks
         : metric === 'impressions' ? p.impressions
         : p.ctr,
  }))

  const cfg = METRIC_CONFIG[metric]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-4xl rounded-2xl border p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <LineChartIcon className="h-4 w-4" style={{ color: '#F59E0B' }} />
              <h3 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>Evolução diária</h3>
            </div>
            <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>
              <span style={{ color: '#F8FAFC' }}>{campaign.name}</span>
              <span className="ml-2" style={{ color: '#94A3B8' }}>· {period.toUpperCase()}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-coral transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* KPIs totais do período */}
        {!loading && !error && data.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniKpi label="Gasto total"     value={BRL(totalSpend)}            color="#E4405F" />
            <MiniKpi label="Cliques totais"  value={NUM(totalClicks)}           color="#F59E0B" />
            <MiniKpi label="Impressões"      value={NUM(totalImpressions)}      color="#22C55E" />
            <MiniKpi label="CTR médio"       value={`${avgCtr.toFixed(2)}%`}    color="#8B5CF6" />
          </div>
        )}

        {/* Toggle de métrica */}
        {!loading && !error && data.length > 0 && (
          <div className="flex gap-1 rounded-xl p-1 w-fit" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
            {(['spend', 'clicks', 'impressions', 'ctr'] as Metric[]).map(m => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
                style={metric === m
                  ? { background: METRIC_CONFIG[m].color, color: '#131C2A' }
                  : { color: '#CBD5E1' }
                }
              >
                {METRIC_CONFIG[m].label}
              </button>
            ))}
          </div>
        )}

        {/* Conteúdo principal */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: '#22C55E' }} />
          </div>
        )}

        {error && (
          <div className="rounded-xl border px-4 py-6 text-center"
            style={{ background: 'rgba(255,77,109,.08)', borderColor: 'rgba(255,77,109,.3)' }}>
            <AlertTriangle className="h-6 w-6 mx-auto mb-2" style={{ color: '#EF4444' }} />
            <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>Erro ao carregar gráfico</p>
            <p className="text-xs font-mono mt-1" style={{ color: '#EF4444' }}>{error}</p>
          </div>
        )}

        {!loading && !error && data.length === 0 && (
          <p className="py-12 text-center text-sm" style={{ color: '#94A3B8' }}>
            Sem dados no período. A campanha pode não ter tido entrega nesse intervalo.
          </p>
        )}

        {!loading && !error && data.length > 0 && (
          <div className="rounded-xl border p-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <TimeseriesChart points={chartPoints} color={cfg.color} formatY={cfg.format} />
          </div>
        )}
      </div>
    </div>
  )
}

function MiniKpi({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>{label}</div>
      <div className="text-sm font-bold mt-1 font-mono" style={{ color }}>{value}</div>
    </div>
  )
}

function TimeseriesChart({
  points, color, formatY,
}: {
  points: { date: string; value: number }[]
  color: string
  formatY: (v: number) => string
}) {
  const width  = 800
  const height = 260
  const padL   = 60
  const padR   = 20
  const padT   = 20
  const padB   = 40
  const innerW = width  - padL - padR
  const innerH = height - padT - padB

  const maxVal = Math.max(1, ...points.map(p => p.value))
  const minVal = 0

  const xScale = (i: number) => padL + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const yScale = (v: number) => padT + innerH - ((v - minVal) / (maxVal - minVal)) * innerH

  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.value).toFixed(1)}`).join(' ')
  const areaD = points.length > 0
    ? `${lineD} L${xScale(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${xScale(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`
    : ''

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    value: maxVal * t,
    y:     padT + innerH - t * innerH,
  }))

  const xStep = Math.max(1, Math.ceil(points.length / 8))

  const fmtShortDate = (iso: string) => iso.slice(5).replace('-', '/')

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {yTicks.map(t => (
        <line key={t.y}
          x1={padL} y1={t.y} x2={width - padR} y2={t.y}
          stroke="#2A3650" strokeWidth="1" strokeDasharray="2 3"
        />
      ))}

      {areaD && <path d={areaD} fill={color} opacity="0.12" />}
      {lineD && <path d={lineD}   fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}

      {points.map((p, i) => (
        <circle key={i} cx={xScale(i)} cy={yScale(p.value)} r="3" fill={color}>
          <title>{`${p.date}: ${formatY(p.value)}`}</title>
        </circle>
      ))}

      {yTicks.map(t => (
        <text key={`ylbl-${t.y}`}
          x={padL - 8} y={t.y + 3}
          textAnchor="end" fontSize="10" fill="#94A3B8" fontFamily="ui-monospace,monospace"
        >
          {formatY(t.value)}
        </text>
      ))}

      {points.map((p, i) => (i % xStep === 0 || i === points.length - 1) && (
        <text key={`xlbl-${i}`}
          x={xScale(i)} y={height - 15}
          textAnchor="middle" fontSize="10" fill="#94A3B8" fontFamily="ui-monospace,monospace"
        >
          {fmtShortDate(p.date)}
        </text>
      ))}
    </svg>
  )
}

function ChannelRow({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2 mb-1">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px]" style={{ color: '#CBD5E1' }}>{label}</span>
      </div>
      <div className="font-mono font-bold text-sm" style={{ color }}>
        {BRL(value)}
      </div>
    </div>
  )
}
