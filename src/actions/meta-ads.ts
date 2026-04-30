'use server'

/**
 * Meta Ads API — integração com Meta Graph API v19.0
 *
 * Credenciais (tenant-wide, 1 access_token compartilhado entre todas as contas):
 *   - saveMetaAdsCredentials()       → salva/atualiza credenciais + garante conta
 *   - getMetaAdsCredentials()        → credenciais sem expor access_token
 *   - deleteMetaAdsCredentials()     → remove credenciais (cascade nas contas)
 *
 * Contas de anúncios (N por tenant, sob a mesma credencial):
 *   - listAdAccounts()               → lista contas do tenant
 *   - createAdAccount()              → adiciona nova conta
 *   - updateAdAccount()              → renomeia / ativa-desativa
 *   - deleteAdAccount()              → remove uma conta (se não for a única/primária)
 *   - setPrimaryAdAccount()          → troca qual é a principal
 *   - testMetaAdsConnection()        → valida uma conta específica (popula currency)
 *
 * Fetching (adAccountId opcional; default = conta primária):
 *   - fetchMetaAdsInsights()
 *   - fetchMetaAdsCampaigns()
 */

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'

const META_API_VERSION = 'v19.0'
const META_BASE = `https://graph.facebook.com/${META_API_VERSION}`

// ── Types ──────────────────────────────────────────────────────────────────

export type MetaAdsCredentialsInput = {
  appId:        string
  appSecret:    string
  accessToken:  string
  adAccountId:  string
  businessId?:  string
}

export type MetaAdsCredentialsSafe = {
  appId:          string
  adAccountId:    string         // legacy — prefira listAdAccounts()
  businessId:     string | null
  tokenExpiresAt: string | null
  lastSyncAt:     string | null
  lastError:      string | null
  hasToken:       boolean
  createdAt:      string
  updatedAt:      string
}

export type MetaAdsAdAccount = {
  id:           string     // UUID (PK)
  adAccountId:  string     // "act_XXXXXXXXX"
  displayName:  string
  currency:     string | null
  isPrimary:    boolean
  isActive:     boolean
  lastSyncAt:   string | null
  lastError:    string | null
  createdAt:    string
  updatedAt:    string
}

export type MetaAdsInsights = {
  spendCents:    number
  impressions:   number
  clicks:        number
  reach:         number
  ctr:           number       // %
  cpmCents:      number       // custo por 1000 impressões
  cpcCents:      number       // custo por clique
  frequency:     number
  dateStart:     string
  dateEnd:       string
}

export type MetaAdsIssue = {
  errorCode:    number
  level:        string       // CAMPAIGN_LEVEL | ADSET_LEVEL | AD_LEVEL | ACCOUNT_LEVEL
  summary:      string       // Mensagem curta da Meta (ex: "Conta de anúncios suspensa")
  message:      string       // Mensagem longa
  type:         string       // OTHER_ERROR | etc
}

export type MetaAdsCampaign = {
  id:                string
  name:              string
  status:            string        // Intenção do usuário: ACTIVE, PAUSED, DELETED, ARCHIVED
  effectiveStatus:   string        // Status REAL do Meta: ACTIVE, PAUSED, WITH_ISSUES, PENDING_REVIEW, DISAPPROVED, IN_PROCESS, CAMPAIGN_PAUSED, ADSET_PAUSED, PENDING_BILLING_INFO, ARCHIVED, DELETED
  issues:            MetaAdsIssue[]  // detalhes específicos da Meta (billing, review, etc)
  objective:         string | null
  spendCents:        number
  impressions:       number
  clicks:            number
  ctr:               number
  cpcCents:          number
  dailyBudgetCents:  number | null // null se campanha usa orçamento do ad set ou CBO
}

export type MetaAdsTimeseriesPoint = {
  date:        string   // YYYY-MM-DD
  spendCents:  number
  impressions: number
  clicks:      number
  ctr:         number   // %
  cpcCents:    number
}

export type MetaAdsPeriod = '7d' | '30d' | '90d' | 'today' | 'yesterday'

// ── Helpers ────────────────────────────────────────────────────────────────

function toCents(strValue: string | number | undefined | null): number {
  if (strValue === null || strValue === undefined || strValue === '') return 0
  const n = typeof strValue === 'string' ? parseFloat(strValue) : strValue
  if (isNaN(n)) return 0
  return Math.round(n * 100)
}

function toNumber(strValue: string | number | undefined | null): number {
  if (strValue === null || strValue === undefined || strValue === '') return 0
  const n = typeof strValue === 'string' ? parseFloat(strValue) : strValue
  return isNaN(n) ? 0 : n
}

function normalizeAdAccountId(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('Ad Account ID é obrigatório')
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`
}

async function metaApi<T>(path: string, params: Record<string, string>, accessToken: string): Promise<T> {
  const url = new URL(`${META_BASE}${path}`)
  url.searchParams.set('access_token', accessToken)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))

  if (!res.ok || body.error) {
    const msg = body.error?.message || `HTTP ${res.status}`
    const type = body.error?.type ? ` (${body.error.type})` : ''
    throw new Error(`Meta API: ${msg}${type}`)
  }
  return body as T
}

async function metaApiPost<T>(path: string, params: Record<string, string>, accessToken: string): Promise<T> {
  const body = new URLSearchParams()
  body.set('access_token', accessToken)
  for (const [k, v] of Object.entries(params)) body.set(k, v)

  const res = await fetch(`${META_BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
    cache:   'no-store',
  })
  const respBody = await res.json().catch(() => ({}))

  if (!res.ok || respBody.error) {
    const msg = respBody.error?.message || `HTTP ${res.status}`
    const type = respBody.error?.type ? ` (${respBody.error.type})` : ''
    throw new Error(`Meta API: ${msg}${type}`)
  }
  return respBody as T
}

// ── Credentials CRUD ───────────────────────────────────────────────────────

export async function saveMetaAdsCredentials(input: MetaAdsCredentialsInput): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (!input.appId.trim())        throw new Error('App ID é obrigatório')
  if (!input.appSecret.trim())    throw new Error('App Secret é obrigatório')
  if (!input.accessToken.trim())  throw new Error('Access Token é obrigatório')
  if (!input.adAccountId.trim())  throw new Error('Ad Account ID é obrigatório')

  const normalizedAdAccount = normalizeAdAccountId(input.adAccountId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: credRow, error: credErr } = await sb
    .from('meta_ads_credentials')
    .upsert(
      {
        tenant_id:     tenantId,
        app_id:        input.appId.trim(),
        app_secret:    input.appSecret.trim(),
        access_token:  input.accessToken.trim(),
        ad_account_id: normalizedAdAccount,
        business_id:   input.businessId?.trim() || null,
        updated_at:    new Date().toISOString(),
        last_error:    null,
      },
      { onConflict: 'tenant_id' },
    )
    .select('id')
    .single()

  if (credErr) throw new Error(`Erro ao salvar credenciais: ${credErr.message}`)

  // Garante que a ad_account_id informada está em meta_ads_ad_accounts.
  // Se for a primeira do tenant, marca como primária.
  const { data: existing } = await sb
    .from('meta_ads_ad_accounts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('ad_account_id', normalizedAdAccount)
    .maybeSingle()

  if (!existing) {
    const { data: anyAccount } = await sb
      .from('meta_ads_ad_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()

    await sb.from('meta_ads_ad_accounts').insert({
      tenant_id:      tenantId,
      credentials_id: credRow.id,
      ad_account_id:  normalizedAdAccount,
      display_name:   'Conta principal',
      is_primary:     !anyAccount,
      is_active:      true,
    })
  }

  revalidatePath('/meta-ads')
  revalidatePath('/meta-ads/configuracoes')
  return { ok: true }
}

export async function getMetaAdsCredentials(): Promise<MetaAdsCredentialsSafe | null> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('meta_ads_credentials')
    .select('app_id, ad_account_id, business_id, token_expires_at, last_sync_at, last_error, access_token, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data) return null

  return {
    appId:          data.app_id,
    adAccountId:    data.ad_account_id,
    businessId:     data.business_id,
    tokenExpiresAt: data.token_expires_at,
    lastSyncAt:     data.last_sync_at,
    lastError:      data.last_error,
    hasToken:       !!data.access_token,
    createdAt:      data.created_at,
    updatedAt:      data.updated_at,
  }
}

export async function deleteMetaAdsCredentials(): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // meta_ads_ad_accounts cai por CASCADE da FK
  const { error } = await sb
    .from('meta_ads_credentials')
    .delete()
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/meta-ads')
  revalidatePath('/meta-ads/configuracoes')
  return { ok: true }
}

// ── Ad Accounts CRUD ───────────────────────────────────────────────────────

export async function listAdAccounts(): Promise<MetaAdsAdAccount[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('meta_ads_ad_accounts')
    .select('id, ad_account_id, display_name, currency, is_primary, is_active, last_sync_at, last_error, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Erro ao listar contas: ${error.message}`)

  type Row = {
    id: string; ad_account_id: string; display_name: string
    currency: string | null; is_primary: boolean; is_active: boolean
    last_sync_at: string | null; last_error: string | null
    created_at: string; updated_at: string
  }

  return ((data ?? []) as Row[]).map(row => ({
    id:           row.id,
    adAccountId:  row.ad_account_id,
    displayName:  row.display_name,
    currency:     row.currency,
    isPrimary:    row.is_primary,
    isActive:     row.is_active,
    lastSyncAt:   row.last_sync_at,
    lastError:    row.last_error,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  }))
}

export async function createAdAccount(input: { adAccountId: string; displayName: string }): Promise<{ ok: true; id: string }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const adAccountId = normalizeAdAccountId(input.adAccountId)
  const displayName = input.displayName.trim()
  if (!displayName) throw new Error('Nome da conta é obrigatório')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: creds } = await sb
    .from('meta_ads_credentials')
    .select('id')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!creds) throw new Error('Configure as credenciais do Meta Ads antes de adicionar contas.')

  const { data: anyAccount } = await sb
    .from('meta_ads_ad_accounts')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle()

  const { data, error } = await sb
    .from('meta_ads_ad_accounts')
    .insert({
      tenant_id:      tenantId,
      credentials_id: creds.id,
      ad_account_id:  adAccountId,
      display_name:   displayName,
      is_primary:     !anyAccount,
      is_active:      true,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') throw new Error('Essa conta de anúncios já está cadastrada.')
    throw new Error(`Erro ao cadastrar conta: ${error.message}`)
  }

  revalidatePath('/meta-ads')
  revalidatePath('/meta-ads/configuracoes')
  return { ok: true, id: data.id }
}

export async function updateAdAccount(id: string, patch: { displayName?: string; isActive?: boolean }): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.displayName !== undefined) {
    const trimmed = patch.displayName.trim()
    if (!trimmed) throw new Error('Nome não pode ficar vazio')
    updates.display_name = trimmed
  }
  if (patch.isActive !== undefined) updates.is_active = patch.isActive

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('meta_ads_ad_accounts')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) throw new Error(`Erro ao atualizar conta: ${error.message}`)

  revalidatePath('/meta-ads')
  revalidatePath('/meta-ads/configuracoes')
  return { ok: true }
}

export async function deleteAdAccount(id: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { count } = await sb
    .from('meta_ads_ad_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  if ((count ?? 0) <= 1) {
    throw new Error('Você precisa manter pelo menos uma conta cadastrada.')
  }

  const { data: target } = await sb
    .from('meta_ads_ad_accounts')
    .select('is_primary')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()

  if (!target) throw new Error('Conta não encontrada')
  if (target.is_primary) throw new Error('Não é possível remover a conta principal. Defina outra como principal antes.')

  const { error } = await sb
    .from('meta_ads_ad_accounts')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) throw new Error(`Erro ao remover conta: ${error.message}`)

  revalidatePath('/meta-ads')
  revalidatePath('/meta-ads/configuracoes')
  return { ok: true }
}

export async function setPrimaryAdAccount(id: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: target } = await sb
    .from('meta_ads_ad_accounts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()

  if (!target) throw new Error('Conta não encontrada')

  // Libera o unique index parcial desmarcando todas primeiro
  await sb
    .from('meta_ads_ad_accounts')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)

  const { error } = await sb
    .from('meta_ads_ad_accounts')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)

  if (error) throw new Error(`Erro ao definir conta principal: ${error.message}`)

  revalidatePath('/meta-ads')
  revalidatePath('/meta-ads/configuracoes')
  return { ok: true }
}

// ── Internal: resolve access_token + ad_account_id pra fetching ────────────

type ResolvedAccount = {
  accessToken: string
  adAccountId: string
  accountPk:   string
}

async function resolveAccount(adAccountId?: string): Promise<ResolvedAccount | null> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: creds } = await sb
    .from('meta_ads_credentials')
    .select('access_token')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!creds?.access_token) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = sb
    .from('meta_ads_ad_accounts')
    .select('id, ad_account_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (adAccountId) {
    query = query.eq('ad_account_id', normalizeAdAccountId(adAccountId))
  } else {
    query = query.eq('is_primary', true)
  }

  const { data: account } = await query.maybeSingle()
  if (!account) return null

  return {
    accessToken: creds.access_token,
    adAccountId: account.ad_account_id,
    accountPk:   account.id,
  }
}

async function recordSync(accountPk: string, success: boolean, error?: string, currency?: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const patch: Record<string, unknown> = {
    last_error:  success ? null : (error?.slice(0, 500) ?? 'Erro desconhecido'),
    updated_at:  new Date().toISOString(),
  }
  if (success)  patch.last_sync_at = new Date().toISOString()
  if (currency) patch.currency = currency

  await sb
    .from('meta_ads_ad_accounts')
    .update(patch)
    .eq('tenant_id', tenantId)
    .eq('id', accountPk)
}

// ── Test connection ────────────────────────────────────────────────────────

export async function testMetaAdsConnection(adAccountId?: string): Promise<{ ok: boolean; message: string; accountName?: string }> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) return { ok: false, message: 'Configure as credenciais e uma conta de anúncios primeiro' }

  try {
    const res = await metaApi<{ id: string; name: string; account_status: number; currency: string }>(
      `/${resolved.adAccountId}`,
      { fields: 'id,name,account_status,currency' },
      resolved.accessToken,
    )
    await recordSync(resolved.accountPk, true, undefined, res.currency)
    return {
      ok:          true,
      message:     `Conectado a "${res.name}" (${res.currency})`,
      accountName: res.name,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await recordSync(resolved.accountPk, false, msg)
    return { ok: false, message: msg }
  }
}

// ── Period helpers ─────────────────────────────────────────────────────────

function periodToRange(period: MetaAdsPeriod): { since: string; until: string } {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)

  if (period === 'today')     return { since: today, until: today }
  if (period === 'yesterday') {
    const y = new Date(now); y.setDate(y.getDate() - 1)
    const ys = y.toISOString().slice(0, 10)
    return { since: ys, until: ys }
  }

  const days = period === '7d' ? 6 : period === '30d' ? 29 : 89
  const start = new Date(now); start.setDate(start.getDate() - days)
  return { since: start.toISOString().slice(0, 10), until: today }
}

// ── Fetch insights ─────────────────────────────────────────────────────────

export async function fetchMetaAdsInsights(period: MetaAdsPeriod = '30d', adAccountId?: string): Promise<MetaAdsInsights | null> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) return null

  const range = periodToRange(period)

  try {
    type InsightRow = {
      spend?: string; impressions?: string; clicks?: string; reach?: string
      ctr?: string; cpm?: string; cpc?: string; frequency?: string
      date_start?: string; date_stop?: string
    }
    const res = await metaApi<{ data: InsightRow[] }>(
      `/${resolved.adAccountId}/insights`,
      {
        fields:     'spend,impressions,clicks,reach,ctr,cpm,cpc,frequency',
        time_range: JSON.stringify(range),
        level:      'account',
      },
      resolved.accessToken,
    )
    await recordSync(resolved.accountPk, true)

    const row = res.data[0]
    if (!row) {
      return {
        spendCents: 0, impressions: 0, clicks: 0, reach: 0,
        ctr: 0, cpmCents: 0, cpcCents: 0, frequency: 0,
        dateStart: range.since, dateEnd: range.until,
      }
    }

    return {
      spendCents:  toCents(row.spend),
      impressions: toNumber(row.impressions),
      clicks:      toNumber(row.clicks),
      reach:       toNumber(row.reach),
      ctr:         toNumber(row.ctr),
      cpmCents:    toCents(row.cpm),
      cpcCents:    toCents(row.cpc),
      frequency:   toNumber(row.frequency),
      dateStart:   row.date_start ?? range.since,
      dateEnd:     row.date_stop  ?? range.until,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await recordSync(resolved.accountPk, false, msg)
    throw err
  }
}

// ── Fetch campaigns ────────────────────────────────────────────────────────

export async function fetchMetaAdsCampaigns(period: MetaAdsPeriod = '30d', adAccountId?: string): Promise<MetaAdsCampaign[]> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) return []

  const range = periodToRange(period)

  try {
    type IssueRow = {
      error_code?: number; level?: string
      error_summary?: string; error_message?: string; error_type?: string
    }
    type CampaignRow = {
      id: string; name: string; status: string; effective_status?: string
      issues_info?: IssueRow[]
      objective?: string; daily_budget?: string
      insights?: {
        data?: Array<{ spend?: string; impressions?: string; clicks?: string; ctr?: string; cpc?: string }>
      }
    }
    const res = await metaApi<{ data: CampaignRow[] }>(
      `/${resolved.adAccountId}/campaigns`,
      {
        fields: `id,name,status,effective_status,issues_info,objective,daily_budget,insights.time_range(${JSON.stringify(range)}){spend,impressions,clicks,ctr,cpc}`,
        limit:  '50',
      },
      resolved.accessToken,
    )
    await recordSync(resolved.accountPk, true)

    return (res.data ?? []).map(c => {
      const ins = c.insights?.data?.[0]
      // Meta API retorna daily_budget já em cents da moeda da conta (ex: "1000" = R$ 10,00)
      const parsed = c.daily_budget ? parseInt(c.daily_budget, 10) : NaN
      const issues: MetaAdsIssue[] = (c.issues_info ?? []).map(i => ({
        errorCode: i.error_code ?? 0,
        level:     i.level ?? '',
        summary:   i.error_summary ?? '',
        message:   i.error_message ?? '',
        type:      i.error_type ?? '',
      }))
      return {
        id:                c.id,
        name:              c.name,
        status:            c.status,
        effectiveStatus:   c.effective_status ?? c.status,
        issues,
        objective:         c.objective ?? null,
        spendCents:        toCents(ins?.spend),
        impressions:       toNumber(ins?.impressions),
        clicks:            toNumber(ins?.clicks),
        ctr:               toNumber(ins?.ctr),
        cpcCents:          toCents(ins?.cpc),
        dailyBudgetCents:  Number.isFinite(parsed) ? parsed : null,
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await recordSync(resolved.accountPk, false, msg)
    throw err
  }
}

// ── Fetch campaign timeseries (daily) ──────────────────────────────────────

export async function fetchCampaignTimeseries(
  campaignId: string,
  period: MetaAdsPeriod = '30d',
  adAccountId?: string,
): Promise<MetaAdsTimeseriesPoint[]> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) return []

  const range = periodToRange(period)

  try {
    type Row = {
      date_start?: string; date_stop?: string
      spend?: string; impressions?: string; clicks?: string; ctr?: string; cpc?: string
    }
    const res = await metaApi<{ data: Row[] }>(
      `/${campaignId}/insights`,
      {
        fields:         'spend,impressions,clicks,ctr,cpc',
        time_range:     JSON.stringify(range),
        time_increment: '1',
      },
      resolved.accessToken,
    )
    await recordSync(resolved.accountPk, true)

    return (res.data ?? []).map(r => ({
      date:        r.date_start ?? '',
      spendCents:  toCents(r.spend),
      impressions: toNumber(r.impressions),
      clicks:      toNumber(r.clicks),
      ctr:         toNumber(r.ctr),
      cpcCents:    toCents(r.cpc),
    })).filter(p => p.date !== '')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await recordSync(resolved.accountPk, false, msg)
    throw err
  }
}

// ── Fetch account health (status + disable reason) ────────────────────────

export type MetaAdsAccountHealth = {
  adAccountId:   string
  accountStatus: number     // 1=Active, 2=Disabled, 3=Unsettled, 7=PendingReview, 8=PendingSettlement, 9=InGracePeriod, 100=PendingClosure, 101=Closed
  disableReason: number     // 0=None, 1=AdsIntegrity, 2=IpReview, 3=RiskPayment, 4=ResellerBlocked, 5=Compromised, ...
  balanceCents:  number     // débito pendente (quando UNSETTLED)
  currency:      string | null
  isHealthy:     boolean
  label:         string     // texto amigável pra UI
  detail:        string | null
}

function interpretAccountHealth(
  accountStatus: number,
  disableReason: number,
  balanceCents: number,
): { isHealthy: boolean; label: string; detail: string | null } {
  // Status 1 = ACTIVE, sem problema
  if (accountStatus === 1 && balanceCents === 0) {
    return { isHealthy: true, label: 'Ativa', detail: null }
  }
  // Status 3 = UNSETTLED → débito pendente
  if (accountStatus === 3) {
    return { isHealthy: false, label: 'Pagamento pendente', detail: balanceCents > 0 ? `Saldo devedor` : 'Regularize em Cobrança' }
  }
  // Status 8 = PENDING_SETTLEMENT → aviso de pagamento
  if (accountStatus === 8) {
    return { isHealthy: false, label: 'Aguarda pagamento', detail: 'Liquide o saldo pra voltar a veicular' }
  }
  // Status 9 = IN_GRACE_PERIOD → período de graça após falha de pagamento
  if (accountStatus === 9) {
    return { isHealthy: false, label: 'Erro no pagamento', detail: 'Método de pagamento recusado — atualize em Cobrança' }
  }
  // Status 2 = DISABLED com disable_reason = 3 (RISK_PAYMENT)
  if (accountStatus === 2 && disableReason === 3) {
    return { isHealthy: false, label: 'Conta suspensa', detail: 'Problema de pagamento — resolva no Business Manager' }
  }
  // Outros status 2
  if (accountStatus === 2) {
    return { isHealthy: false, label: 'Conta desativada', detail: 'Verifique no Business Manager' }
  }
  // Status 7 = PENDING_RISK_REVIEW
  if (accountStatus === 7) {
    return { isHealthy: false, label: 'Em revisão', detail: 'Conta em análise de segurança' }
  }
  // Status 100, 101 = encerramento
  if (accountStatus === 100 || accountStatus === 101) {
    return { isHealthy: false, label: 'Conta encerrada', detail: null }
  }
  // Qualquer status não conhecido
  if (accountStatus !== 1) {
    return { isHealthy: false, label: `Status ${accountStatus}`, detail: 'Verifique no Business Manager' }
  }
  return { isHealthy: true, label: 'Ativa', detail: null }
}

export async function fetchAdAccountHealth(adAccountId?: string): Promise<MetaAdsAccountHealth | null> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) return null

  try {
    type AccountRes = {
      id: string
      account_status?: number
      disable_reason?: number
      balance?: string
      currency?: string
    }
    const res = await metaApi<AccountRes>(
      `/${resolved.adAccountId}`,
      { fields: 'id,account_status,disable_reason,balance,currency' },
      resolved.accessToken,
    )
    const accountStatus = res.account_status ?? 1
    const disableReason = res.disable_reason ?? 0
    const balanceCents  = res.balance ? parseInt(res.balance, 10) || 0 : 0
    const interp = interpretAccountHealth(accountStatus, disableReason, balanceCents)
    return {
      adAccountId:   resolved.adAccountId,
      accountStatus,
      disableReason,
      balanceCents,
      currency:      res.currency ?? null,
      ...interp,
    }
  } catch {
    // Se falhar, retorna null — UI trata como sem info
    return null
  }
}

// ── Fetch account-level timeseries ─────────────────────────────────────────

export async function fetchAccountTimeseries(
  period: MetaAdsPeriod = '30d',
  adAccountId?: string,
): Promise<MetaAdsTimeseriesPoint[]> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) return []

  const range = periodToRange(period)

  try {
    type Row = {
      date_start?: string; date_stop?: string
      spend?: string; impressions?: string; clicks?: string; ctr?: string; cpc?: string
    }
    const res = await metaApi<{ data: Row[] }>(
      `/${resolved.adAccountId}/insights`,
      {
        fields:         'spend,impressions,clicks,ctr,cpc',
        time_range:     JSON.stringify(range),
        time_increment: '1',
        level:          'account',
      },
      resolved.accessToken,
    )
    await recordSync(resolved.accountPk, true)

    return (res.data ?? []).map(r => ({
      date:        r.date_start ?? '',
      spendCents:  toCents(r.spend),
      impressions: toNumber(r.impressions),
      clicks:      toNumber(r.clicks),
      ctr:         toNumber(r.ctr),
      cpcCents:    toCents(r.cpc),
    })).filter(p => p.date !== '')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await recordSync(resolved.accountPk, false, msg)
    throw err
  }
}

// ── Sugestões de campaign_code (Meta + histórico) ──────────────────────────

export type CampaignCodeSuggestion = {
  code:          string        // código sugerido (UPPERCASE)
  label:         string        // texto exibido no picker
  source:        'meta' | 'history'
  campaignName?: string        // nome original se vier do Meta
  status?:       string        // ACTIVE/PAUSED se vier do Meta
  spendCents?:   number        // gasto no período se vier do Meta
}

// Converte nome de campanha em código curto tipo "HJ-VAI".
// Remove acentos, stopwords, pega 2 palavras principais.
function suggestCodeFromName(name: string): string {
  const stopwords = new Set([
    'campanha', 'de', 'do', 'da', 'a', 'o', 'e', 'em', 'para', 'com',
    'nova', 'minha', 'meu', 'ads', 'cópia', 'copia',
  ])
  const words = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(w => w.length > 1 && !stopwords.has(w))
  const picked = words.slice(0, 2)
  return picked.join('-').toUpperCase().slice(0, 20) || 'CAMP'
}

export async function getCampaignCodeSuggestions(adAccountId?: string): Promise<CampaignCodeSuggestion[]> {
  // Busca campanhas Meta (30d por padrão) — tolerante a erro
  let metaCampaigns: MetaAdsCampaign[] = []
  try {
    metaCampaigns = await fetchMetaAdsCampaigns('30d', adAccountId)
  } catch { /* ignora se não conseguir */ }

  // Prioriza ACTIVE, depois PAUSED, ordena por gasto desc
  const relevant = metaCampaigns
    .filter(c => c.status === 'ACTIVE' || c.status === 'PAUSED')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1
      return b.spendCents - a.spendCents
    })

  const seen = new Set<string>()
  const suggestions: CampaignCodeSuggestion[] = []

  for (const c of relevant) {
    const code = suggestCodeFromName(c.name)
    if (seen.has(code)) continue
    seen.add(code)
    suggestions.push({
      code,
      label:        c.name,
      source:       'meta',
      campaignName: c.name,
      status:       c.status,
      spendCents:   c.spendCents,
    })
  }

  // Agora códigos históricos (já usados em clientes) que ainda não apareceram
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { listUsedCampaignCodes } = await import('./pos') as any
  try {
    const historical = await listUsedCampaignCodes() as string[]
    for (const code of historical) {
      if (seen.has(code)) continue
      seen.add(code)
      suggestions.push({ code, label: code, source: 'history' })
    }
  } catch { /* ignora */ }

  return suggestions
}

// ── Campaign mutations (ads_management) ────────────────────────────────────

export async function updateCampaignStatus(
  campaignId: string,
  status: 'ACTIVE' | 'PAUSED',
  adAccountId?: string,
): Promise<{ ok: true }> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) throw new Error('Conta de anúncios não encontrada ou inativa')

  try {
    await metaApiPost(`/${campaignId}`, { status }, resolved.accessToken)
    await recordSync(resolved.accountPk, true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await recordSync(resolved.accountPk, false, msg)
    throw err
  }

  revalidatePath('/meta-ads')
  return { ok: true }
}

export async function updateCampaignDailyBudget(
  campaignId: string,
  dailyBudgetCents: number,
  adAccountId?: string,
): Promise<{ ok: true }> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) throw new Error('Conta de anúncios não encontrada ou inativa')

  if (!Number.isFinite(dailyBudgetCents) || dailyBudgetCents <= 0) {
    throw new Error('Orçamento deve ser maior que zero')
  }

  try {
    await metaApiPost(
      `/${campaignId}`,
      { daily_budget: String(Math.round(dailyBudgetCents)) },
      resolved.accessToken,
    )
    await recordSync(resolved.accountPk, true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await recordSync(resolved.accountPk, false, msg)
    throw err
  }

  revalidatePath('/meta-ads')
  return { ok: true }
}

export async function duplicateCampaign(
  campaignId: string,
  adAccountId?: string,
): Promise<{ ok: true; newCampaignId: string }> {
  const resolved = await resolveAccount(adAccountId)
  if (!resolved) throw new Error('Conta de anúncios não encontrada ou inativa')

  try {
    // deep_copy: clona ad sets + ads. status_option PAUSED: cópia nasce pausada pra revisão.
    const response = await metaApiPost<{ copied_campaign_id?: string; id?: string }>(
      `/${campaignId}/copies`,
      {
        deep_copy:     'true',
        status_option: 'PAUSED',
        rename_options: JSON.stringify({
          rename_suffix:   ' — Cópia',
          rename_strategy: 'DEEP_RENAME',
        }),
      },
      resolved.accessToken,
    )
    await recordSync(resolved.accountPk, true)

    const newId = response.copied_campaign_id ?? response.id ?? ''
    revalidatePath('/meta-ads')
    return { ok: true, newCampaignId: newId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    await recordSync(resolved.accountPk, false, msg)
    throw err
  }
}
