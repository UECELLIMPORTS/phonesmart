'use server'

/**
 * Alertas de Meta Ads — CRUD de regras + histórico de eventos + avaliador.
 *
 * Fluxo:
 *   1. Usuário cadastra regras em /meta-ads/alertas
 *   2. Ao clicar "Avaliar agora", evaluateMyAlerts() roda no contexto do user logado
 *   3. Cada violação vira 1 linha em meta_ads_alert_events (respeitando cooldown)
 *   4. Badge no header mostra contagem de eventos não-lidos
 *
 * Automação (futuro):
 *   evaluateMyAlerts() só funciona com user autenticado. Pra rodar via cron
 *   cross-tenant, é preciso:
 *     - SUPABASE_SERVICE_ROLE_KEY no .env (Supabase dashboard → Project Settings → API)
 *     - CRON_SECRET no .env pra proteger o endpoint
 *     - Refactor do evaluator pra aceitar tenantId explícito + admin client
 *     - API route em /api/cron/meta-ads-alerts que lê todos os tenants e dispara
 *     - Scheduler externo (Vercel Cron, Supabase pg_cron, cron-job.org) batendo no endpoint
 */

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'
import { createNotification } from '@/lib/notifications'
import {
  listAdAccounts,
  fetchMetaAdsCampaigns,
  fetchCampaignTimeseries,
  type MetaAdsCampaign,
  type MetaAdsAdAccount,
  type MetaAdsTimeseriesPoint,
} from './meta-ads'

// ── Types ──────────────────────────────────────────────────────────────────

export type AlertRuleType = 'high_cpc' | 'high_daily_spend' | 'low_ctr' | 'zero_clicks'

export type MetaAdsAlertRule = {
  id:               string
  name:             string
  ruleType:         AlertRuleType
  adAccountId:      string | null
  campaignId:       string | null
  thresholdCents:   number | null
  thresholdPercent: number | null
  daysWindow:       number
  cooldownHours:    number
  isActive:         boolean
  createdAt:        string
  updatedAt:        string
}

export type MetaAdsAlertRuleInput = {
  name:              string
  ruleType:          AlertRuleType
  adAccountId?:      string | null
  campaignId?:       string | null
  thresholdCents?:   number | null
  thresholdPercent?: number | null
  daysWindow:        number
  cooldownHours:     number
}

export type MetaAdsAlertEvent = {
  id:             string
  ruleId:         string | null
  ruleType:       AlertRuleType
  ruleName:       string
  adAccountId:    string
  campaignId:     string | null
  campaignName:   string | null
  message:        string
  valueObserved:  string | null
  valueThreshold: string | null
  triggeredAt:    string
  readAt:         string | null
  dismissedAt:    string | null
}

export type EvaluateAlertsResult = {
  rulesEvaluated:   number
  campaignsChecked: number
  eventsCreated:    number
  errors:           string[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

function validateThreshold(input: MetaAdsAlertRuleInput): void {
  switch (input.ruleType) {
    case 'high_cpc':
    case 'high_daily_spend':
      if (!input.thresholdCents || input.thresholdCents <= 0) {
        throw new Error('Defina um valor (em R$) maior que zero para a regra')
      }
      break
    case 'low_ctr':
      if (input.thresholdPercent == null || input.thresholdPercent <= 0) {
        throw new Error('Defina um percentual maior que zero para a regra')
      }
      break
    case 'zero_clicks':
      // sem threshold
      break
  }
}

// ── CRUD de regras ─────────────────────────────────────────────────────────

type RuleRow = {
  id: string; name: string; rule_type: AlertRuleType
  ad_account_id: string | null; campaign_id: string | null
  threshold_cents: number | null; threshold_percent: number | null
  days_window: number; cooldown_hours: number
  is_active: boolean; created_at: string; updated_at: string
}

function mapRule(r: RuleRow): MetaAdsAlertRule {
  return {
    id:               r.id,
    name:             r.name,
    ruleType:         r.rule_type,
    adAccountId:      r.ad_account_id,
    campaignId:       r.campaign_id,
    thresholdCents:   r.threshold_cents,
    thresholdPercent: r.threshold_percent != null ? Number(r.threshold_percent) : null,
    daysWindow:       r.days_window,
    cooldownHours:    r.cooldown_hours,
    isActive:         r.is_active,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
  }
}

export async function listAlertRules(): Promise<MetaAdsAlertRule[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('meta_ads_alert_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return ((data ?? []) as RuleRow[]).map(mapRule)
}

export async function createAlertRule(input: MetaAdsAlertRuleInput): Promise<{ ok: true; id: string }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (!input.name.trim()) throw new Error('Nome da regra é obrigatório')
  validateThreshold(input)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('meta_ads_alert_rules')
    .insert({
      tenant_id:         tenantId,
      name:              input.name.trim(),
      rule_type:         input.ruleType,
      ad_account_id:     input.adAccountId ?? null,
      campaign_id:       input.campaignId ?? null,
      threshold_cents:   input.thresholdCents ?? null,
      threshold_percent: input.thresholdPercent ?? null,
      days_window:       input.daysWindow,
      cooldown_hours:    input.cooldownHours,
      is_active:         true,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/meta-ads/alertas')
  revalidatePath('/meta-ads')
  return { ok: true, id: data.id }
}

export async function updateAlertRule(id: string, input: MetaAdsAlertRuleInput): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (!input.name.trim()) throw new Error('Nome da regra é obrigatório')
  validateThreshold(input)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('meta_ads_alert_rules')
    .update({
      name:              input.name.trim(),
      rule_type:         input.ruleType,
      ad_account_id:     input.adAccountId ?? null,
      campaign_id:       input.campaignId ?? null,
      threshold_cents:   input.thresholdCents ?? null,
      threshold_percent: input.thresholdPercent ?? null,
      days_window:       input.daysWindow,
      cooldown_hours:    input.cooldownHours,
      updated_at:        new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/meta-ads/alertas')
  return { ok: true }
}

export async function toggleAlertRule(id: string, isActive: boolean): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('meta_ads_alert_rules')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/meta-ads/alertas')
  return { ok: true }
}

export async function deleteAlertRule(id: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('meta_ads_alert_rules')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/meta-ads/alertas')
  return { ok: true }
}

// ── Eventos ────────────────────────────────────────────────────────────────

type EventRow = {
  id: string; rule_id: string | null; rule_type: AlertRuleType; rule_name: string
  ad_account_id: string; campaign_id: string | null; campaign_name: string | null
  message: string; value_observed: string | null; value_threshold: string | null
  triggered_at: string; read_at: string | null; dismissed_at: string | null
}

function mapEvent(r: EventRow): MetaAdsAlertEvent {
  return {
    id:             r.id,
    ruleId:         r.rule_id,
    ruleType:       r.rule_type,
    ruleName:       r.rule_name,
    adAccountId:    r.ad_account_id,
    campaignId:     r.campaign_id,
    campaignName:   r.campaign_name,
    message:        r.message,
    valueObserved:  r.value_observed,
    valueThreshold: r.value_threshold,
    triggeredAt:    r.triggered_at,
    readAt:         r.read_at,
    dismissedAt:    r.dismissed_at,
  }
}

export async function listAlertEvents(opts?: {
  includeDismissed?: boolean
  limit?: number
}): Promise<MetaAdsAlertEvent[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = sb
    .from('meta_ads_alert_events')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('triggered_at', { ascending: false })
    .limit(opts?.limit ?? 100)

  if (!opts?.includeDismissed) {
    query = query.is('dismissed_at', null)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as EventRow[]).map(mapEvent)
}

export async function countUnreadAlerts(): Promise<number> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { count } = await sb
    .from('meta_ads_alert_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('read_at', null)
    .is('dismissed_at', null)

  return count ?? 0
}

export async function markAlertEventRead(id: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('meta_ads_alert_events')
    .update({ read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('read_at', null)

  if (error) throw new Error(error.message)
  revalidatePath('/meta-ads/alertas')
  revalidatePath('/meta-ads')
  return { ok: true }
}

export async function markAllAlertEventsRead(): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('meta_ads_alert_events')
    .update({ read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .is('read_at', null)
    .is('dismissed_at', null)

  if (error) throw new Error(error.message)
  revalidatePath('/meta-ads/alertas')
  revalidatePath('/meta-ads')
  return { ok: true }
}

export async function dismissAlertEvent(id: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const now = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('meta_ads_alert_events')
    .update({ dismissed_at: now, read_at: now })
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/meta-ads/alertas')
  revalidatePath('/meta-ads')
  return { ok: true }
}

// ── Evaluator ──────────────────────────────────────────────────────────────

type Violation = { message: string; observed: string; threshold: string } | null

function evaluateRule(
  rule: MetaAdsAlertRule,
  campaign: MetaAdsCampaign,
  timeseries: MetaAdsTimeseriesPoint[],
): Violation {
  switch (rule.ruleType) {
    case 'high_cpc': {
      const threshold = rule.thresholdCents ?? 0
      if (threshold <= 0 || campaign.clicks === 0) return null
      if (campaign.cpcCents > threshold) {
        return {
          message:   `CPC de "${campaign.name}" está em ${BRL(campaign.cpcCents)}, acima do limite de ${BRL(threshold)}`,
          observed:  BRL(campaign.cpcCents),
          threshold: BRL(threshold),
        }
      }
      return null
    }
    case 'high_daily_spend': {
      const threshold = rule.thresholdCents ?? 0
      if (threshold <= 0 || timeseries.length === 0) return null
      const violating = timeseries.filter(d => d.spendCents > threshold)
      if (violating.length === 0) return null
      const worst = violating.reduce((a, b) => a.spendCents > b.spendCents ? a : b)
      return {
        message:   `"${campaign.name}" gastou ${BRL(worst.spendCents)} em ${worst.date} (limite: ${BRL(threshold)}/dia)`,
        observed:  BRL(worst.spendCents),
        threshold: BRL(threshold),
      }
    }
    case 'low_ctr': {
      const threshold = rule.thresholdPercent ?? 0
      if (threshold <= 0 || campaign.impressions === 0) return null
      if (campaign.ctr < threshold) {
        return {
          message:   `CTR de "${campaign.name}" está em ${campaign.ctr.toFixed(2)}%, abaixo do mínimo de ${threshold.toFixed(2)}%`,
          observed:  `${campaign.ctr.toFixed(2)}%`,
          threshold: `${threshold.toFixed(2)}%`,
        }
      }
      return null
    }
    case 'zero_clicks': {
      // Dispara se a campanha está entregando (impressions > 0) mas teve zero cliques
      if (timeseries.length === 0) {
        if (campaign.impressions > 0 && campaign.clicks === 0) {
          return {
            message:   `"${campaign.name}" teve ${campaign.impressions} impressões mas zero cliques`,
            observed:  `0 cliques / ${campaign.impressions} impressões`,
            threshold: `> 0 cliques`,
          }
        }
        return null
      }
      const delivering = timeseries.filter(d => d.impressions > 0)
      if (delivering.length === 0) return null
      const zero = delivering.filter(d => d.clicks === 0)
      if (zero.length === delivering.length) {
        const totalImp = delivering.reduce((s, d) => s + d.impressions, 0)
        return {
          message:   `"${campaign.name}" teve ${totalImp} impressões em ${delivering.length} dia(s) e zero cliques`,
          observed:  `0 cliques / ${totalImp} impressões`,
          threshold: `> 0 cliques`,
        }
      }
      return null
    }
  }
}

export async function evaluateMyAlerts(): Promise<EvaluateAlertsResult> {
  const result: EvaluateAlertsResult = {
    rulesEvaluated:   0,
    campaignsChecked: 0,
    eventsCreated:    0,
    errors:           [],
  }

  const rules = (await listAlertRules()).filter(r => r.isActive)
  if (rules.length === 0) return result

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const accounts = (await listAdAccounts()).filter(a => a.isActive)
  if (accounts.length === 0) {
    result.errors.push('Nenhuma conta de anúncios ativa.')
    return result
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  for (const rule of rules) {
    result.rulesEvaluated++
    try {
      const targets: MetaAdsAdAccount[] = rule.adAccountId
        ? accounts.filter(a => a.adAccountId === rule.adAccountId)
        : accounts

      for (const account of targets) {
        const period = rule.daysWindow <= 7 ? '7d' : '30d'
        const campaigns = await fetchMetaAdsCampaigns(period, account.adAccountId)
        const scoped = rule.campaignId
          ? campaigns.filter(c => c.id === rule.campaignId)
          : campaigns.filter(c => c.status === 'ACTIVE')

        for (const campaign of scoped) {
          result.campaignsChecked++

          const needsTS = rule.ruleType === 'zero_clicks' || rule.ruleType === 'high_daily_spend'
          const timeseries = needsTS
            ? await fetchCampaignTimeseries(campaign.id, period, account.adAccountId)
            : []

          const violation = evaluateRule(rule, campaign, timeseries)
          if (!violation) continue

          // Cooldown — já tem evento recente pra (rule, campaign)?
          const cooldownSince = new Date(Date.now() - rule.cooldownHours * 3600 * 1000).toISOString()
          const { data: recent } = await sb
            .from('meta_ads_alert_events')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('rule_id', rule.id)
            .eq('campaign_id', campaign.id)
            .gte('triggered_at', cooldownSince)
            .limit(1)
            .maybeSingle()
          if (recent) continue

          const { error: insertErr } = await sb
            .from('meta_ads_alert_events')
            .insert({
              tenant_id:       tenantId,
              rule_id:         rule.id,
              rule_type:       rule.ruleType,
              rule_name:       rule.name,
              ad_account_id:   account.adAccountId,
              campaign_id:     campaign.id,
              campaign_name:   campaign.name,
              message:         violation.message,
              value_observed:  violation.observed,
              value_threshold: violation.threshold,
            })
          if (insertErr) {
            result.errors.push(`Regra "${rule.name}" × "${campaign.name}": ${insertErr.message}`)
          } else {
            result.eventsCreated++
            // Dispara notificação in-app pro owner do tenant
            void createNotification({
              userId:   user.id,
              tenantId,
              type:     'meta_ads_alert',
              title:    `Alerta Meta Ads: ${rule.name}`,
              body:     `${campaign.name}: ${violation.message}`,
              link:     '/meta-ads/alertas',
              metadata: {
                ruleId:     rule.id,
                campaignId: campaign.id,
              },
            })
          }
        }
      }
    } catch (err) {
      result.errors.push(`Regra "${rule.name}": ${err instanceof Error ? err.message : 'erro desconhecido'}`)
    }
  }

  revalidatePath('/meta-ads/alertas')
  revalidatePath('/meta-ads')
  return result
}
