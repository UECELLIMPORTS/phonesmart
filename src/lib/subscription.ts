import { createClient } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import type { User } from '@supabase/supabase-js'

/**
 * Modelo de assinatura por produto. Cada tenant pode ter 0..N rows em
 * `subscriptions` — uma por produto contratado.
 *
 * Produtos: 'gestao_smart' | 'checksmart' | 'crm' | 'meta_ads'
 * Planos (só fazem sentido pra gestao_smart hoje): 'basico' | 'pro' | 'premium'
 * Status: 'trial' | 'active' | 'late' | 'inactive' | 'cancelled'
 */

export type Product   = 'gestao_smart' | 'checksmart' | 'crm' | 'meta_ads'
export type Plan      = 'basico' | 'pro' | 'premium'
export type SubStatus = 'trial' | 'active' | 'late' | 'inactive' | 'cancelled'

export type Subscription = {
  product:           Product
  status:            SubStatus
  planName:          Plan | string   // 'basico'|'pro'|'premium' pra gestao_smart; outros valores pra outros produtos
  priceCents:        number
  trialEndsAt:       Date | null
  currentPeriodEnd:  Date | null
  billingCycle:      'MONTHLY' | 'YEARLY'
}

/** Status que liberam acesso ao produto (trial e active). */
const ACTIVE_STATUSES: SubStatus[] = ['trial', 'active']

/** Hierarquia de planos pra Gestão Smart — quanto maior, mais features libera. */
const PLAN_RANK: Record<Plan, number> = {
  basico:  0,
  pro:     1,
  premium: 2,
}

/**
 * Lê todas as subscriptions do tenant atual. Retorna [] se não tem nenhuma
 * (caso de user com JWT inválido ou tenant deletado).
 */
export async function getTenantSubscriptions(user: User): Promise<Subscription[]> {
  const tenantId = getTenantId(user)
  if (!tenantId) return []

  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('subscriptions')
    .select('product, status, plan_name, price_cents, trial_ends_at, current_period_end, billing_cycle')
    .eq('tenant_id', tenantId)

  if (error) {
    console.error('[getTenantSubscriptions] erro:', error.message)
    return []
  }

  type Row = {
    product: Product; status: SubStatus; plan_name: string; price_cents: number
    trial_ends_at: string | null; current_period_end: string | null
    billing_cycle: 'MONTHLY' | 'YEARLY' | null
  }
  return ((data ?? []) as Row[]).map(r => ({
    product:          r.product,
    status:           r.status,
    planName:         r.plan_name,
    priceCents:       r.price_cents,
    trialEndsAt:      r.trial_ends_at      ? new Date(r.trial_ends_at)      : null,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end) : null,
    billingCycle:     r.billing_cycle ?? 'MONTHLY',
  }))
}

/** Pega a subscription de um produto específico (ou null se não tem). */
export function getProductSubscription(subs: Subscription[], product: Product): Subscription | null {
  return subs.find(s => s.product === product) ?? null
}

/** True se o tenant tem acesso ao produto (status trial/active). */
export function hasProductAccess(subs: Subscription[], product: Product): boolean {
  const sub = getProductSubscription(subs, product)
  return !!sub && ACTIVE_STATUSES.includes(sub.status)
}

/**
 * True se o plano de Gestão Smart é >= mínimo. Usado pra gates de feature
 * dentro do próprio Gestão Smart (Pro, Premium).
 *
 * Se o tenant não tem subscription ativa de gestao_smart, retorna false.
 */
export function gestaoSmartPlanAtLeast(subs: Subscription[], minimum: Plan): boolean {
  const sub = getProductSubscription(subs, 'gestao_smart')
  if (!sub || !ACTIVE_STATUSES.includes(sub.status)) return false
  const currentRank = PLAN_RANK[sub.planName as Plan]
  if (currentRank === undefined) return false   // plan_name desconhecido
  return currentRank >= PLAN_RANK[minimum]
}

/** Quantos dias faltam pro trial expirar. null se não está em trial. */
export function daysUntilTrialEnds(subs: Subscription[]): number | null {
  const sub = getProductSubscription(subs, 'gestao_smart')
  if (!sub || sub.status !== 'trial' || !sub.trialEndsAt) return null
  const ms = sub.trialEndsAt.getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

// ── Mapeamento de rotas → requisito mínimo ────────────────────────────────
// Helper alto-nível usado pelas pages: passe a chave da feature, recebo true/false.

export type FeatureKey =
  | 'reports'         // /relatorios — exige Pro+
  | 'canais'          // /analytics/canais — exige Pro+
  | 'erp_clientes'    // /erp-clientes — exige Pro+
  | 'meta_ads'        // /meta-ads — exige Premium (módulo do gestao_smart) ou subscription própria de meta_ads
  | 'crm'             // /crm — exige Premium ou subscription própria de crm
  | 'checksmart'      // /checksmart-os e similares — exige subscription de checksmart

export function canAccess(subs: Subscription[], feature: FeatureKey): boolean {
  switch (feature) {
    case 'reports':
    case 'canais':
    case 'erp_clientes':
      return gestaoSmartPlanAtLeast(subs, 'pro')
    case 'meta_ads':
      return gestaoSmartPlanAtLeast(subs, 'premium') || hasProductAccess(subs, 'meta_ads')
    case 'crm':
      return gestaoSmartPlanAtLeast(subs, 'premium') || hasProductAccess(subs, 'crm')
    case 'checksmart':
      return gestaoSmartPlanAtLeast(subs, 'premium') || hasProductAccess(subs, 'checksmart')
  }
}

/** Plano mínimo / produto que destrava cada feature — pra mostrar na tela de upgrade. */
export const FEATURE_REQUIREMENT: Record<FeatureKey, { label: string; description: string }> = {
  reports:      { label: 'Pro ou Premium',     description: 'Relatórios avançados estão disponíveis a partir do plano Pro.' },
  canais:       { label: 'Pro ou Premium',     description: 'Análise de canais (Online vs Física, Break-even) é parte do plano Pro.' },
  erp_clientes: { label: 'Pro ou Premium',     description: 'Analytics de clientes e diagnóstico de lucro a partir do plano Pro.' },
  meta_ads:     { label: 'Premium',            description: 'Integração Meta Ads (ROAS, CAC, alertas) é parte do plano Premium.' },
  crm:          { label: 'Premium',            description: 'CRM completo (pipeline, inbox WhatsApp/Instagram) é parte do plano Premium.' },
  checksmart:   { label: 'Plano CheckSmart',   description: 'O CheckSmart (sistema pra assistência técnica) é vendido em plano à parte.' },
}
