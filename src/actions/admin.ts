'use server'

/**
 * Server Actions exclusivas do painel /admin. Cada action checa se o user
 * autenticado tem email na lista ADMIN_EMAILS — caso contrário, rejeita.
 *
 * Toda ação grava row em admin_actions_log pra auditoria.
 *
 * NÃO confunde com permissions de tenant (owner/manager/employee). Admin aqui
 * é admin DA PLATAFORMA — sou eu (Felipe), pra dar suporte e liberar planos
 * manualmente quando necessário.
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/supabase/server'
import type { Product, Plan } from '@/lib/pricing'
import { getPrice } from '@/lib/pricing'

const ADMIN_EMAILS = [
  'uedsonfelipepessoal@gmail.com',
  'uedsonfelipeprofissional@gmail.com',
]

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

async function requireAdmin(): Promise<{ email: string } | { error: string }> {
  try {
    const { user } = await requireAuth()
    const email = user.email ?? ''
    if (!ADMIN_EMAILS.includes(email)) return { error: 'Acesso negado.' }
    return { email }
  } catch {
    return { error: 'Não autenticado.' }
  }
}

async function logAction(adminEmail: string, action: string, tenantId: string | null, payload: object) {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  await sb.from('admin_actions_log').insert({
    admin_email: adminEmail,
    action,
    tenant_id: tenantId,
    payload,
  })
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Liberar plano manualmente (cortesia, pagamento por fora, beta tester)
// ──────────────────────────────────────────────────────────────────────────

export type GrantManualPlanInput = {
  tenantId:      string
  product:       Product
  planName:      Plan
  billingCycle:  'MONTHLY' | 'YEARLY'
  months:        number    // duração em meses (define current_period_end)
  note?:         string    // motivo (cortesia, pago via PIX, etc) — só pro log
}

export async function grantManualPlan(input: GrantManualPlanInput): Promise<Result> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  if (input.months < 1 || input.months > 36) {
    return { ok: false, error: 'Duração deve ser entre 1 e 36 meses.' }
  }

  const price = getPrice(input.product, input.planName)
  if (!price) return { ok: false, error: 'Produto/plano inválido.' }

  // Anual: 12x preço mensal. Mensal: preço mensal mesmo.
  const priceCents = input.billingCycle === 'YEARLY' ? price.priceCents * 12 : price.priceCents

  const periodEnd = new Date()
  periodEnd.setMonth(periodEnd.getMonth() + input.months)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Upsert por (tenant_id, product) — UNIQUE constraint garante 1 sub por produto
  const { error } = await sb.from('subscriptions').upsert({
    tenant_id:             input.tenantId,
    product:               input.product,
    plan_name:             input.planName,
    price_cents:           priceCents,
    billing_cycle:         input.billingCycle,
    status:                'active',
    asaas_subscription_id: null,    // null em ambos = manual, sem cobrança automática
    payment_method:        null,
    trial_ends_at:         null,
    current_period_end:    periodEnd.toISOString(),
    next_due_date:         null,
    updated_at:            new Date().toISOString(),
  }, { onConflict: 'tenant_id,product' })

  if (error) return { ok: false, error: `Erro ao liberar plano: ${error.message}` }

  await logAction(auth.email, 'grant_manual_plan', input.tenantId, {
    product:      input.product,
    planName:     input.planName,
    billingCycle: input.billingCycle,
    months:       input.months,
    priceCents,
    note:         input.note ?? null,
  })

  revalidatePath('/admin')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Estender trial (mais dias pra cliente avaliar)
// ──────────────────────────────────────────────────────────────────────────

export type ExtendTrialInput = {
  tenantId: string
  product:  Product
  days:     number
  note?:    string
}

export async function extendTrial(input: ExtendTrialInput): Promise<Result> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  if (input.days < 1 || input.days > 365) {
    return { ok: false, error: 'Dias devem estar entre 1 e 365.' }
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Busca sub atual pra calcular novo trial_ends_at (a partir do atual ou de agora)
  const { data: sub, error: fetchErr } = await sb
    .from('subscriptions')
    .select('id, trial_ends_at, status')
    .eq('tenant_id', input.tenantId)
    .eq('product', input.product)
    .maybeSingle()

  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!sub)     return { ok: false, error: 'Assinatura não encontrada pra esse produto.' }

  // Base: trial_ends_at atual se ainda futuro; senão agora
  const now = new Date()
  const currentEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null
  const base = currentEnd && currentEnd > now ? currentEnd : now
  const newEnd = new Date(base)
  newEnd.setDate(newEnd.getDate() + input.days)

  const { error } = await sb
    .from('subscriptions')
    .update({
      trial_ends_at: newEnd.toISOString(),
      status:        'trial',   // se estava expirado, volta pra trial
      updated_at:    new Date().toISOString(),
    })
    .eq('id', sub.id)

  if (error) return { ok: false, error: `Erro ao estender trial: ${error.message}` }

  await logAction(auth.email, 'extend_trial', input.tenantId, {
    product:    input.product,
    days:       input.days,
    newEndsAt:  newEnd.toISOString(),
    note:       input.note ?? null,
  })

  revalidatePath('/admin')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// 4. Drill-down: snapshot operacional do tenant (modo suporte read-only)
// ──────────────────────────────────────────────────────────────────────────

export type TenantDetails = {
  id:               string
  name:             string
  createdAt:        string
  ownerEmail:       string | null
  ownerLastLogin:   string | null
  // counts
  customers:        number
  products:         number
  productsLowStock: number
  team:             number
  serviceOrders:    { open: number; total: number }
  // vendas
  salesTotal:       number              // count histórico
  salesLast30d:     number
  salesLast90d:     number
  revenueTotalCents:   number           // soma total_cents (sales + OS) histórico
  revenue30dCents:     number
  revenue90dCents:     number
  lastSaleAt:       string | null
  // tickets médios
  avgTicketCents:   number              // 30d
}

export async function getTenantDetails(tenantId: string): Promise<Result<TenantDetails>> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const now = new Date()
  const d30 = new Date(now.getTime() - 30  * 86400_000).toISOString()
  const d90 = new Date(now.getTime() - 90  * 86400_000).toISOString()

  // Tenant base
  const { data: tenant, error: tErr } = await sb
    .from('tenants')
    .select('id, name, created_at, owner_user_id')
    .eq('id', tenantId)
    .maybeSingle()
  if (tErr)    return { ok: false, error: tErr.message }
  if (!tenant) return { ok: false, error: 'Tenant não encontrado.' }

  // Owner: lookup em auth.users via admin
  let ownerEmail:     string | null = null
  let ownerLastLogin: string | null = null
  if (tenant.owner_user_id) {
    const { data: ownerData } = await admin.auth.admin.getUserById(tenant.owner_user_id)
    if (ownerData?.user) {
      ownerEmail     = ownerData.user.email ?? null
      ownerLastLogin = ownerData.user.last_sign_in_at ?? null
    }
  }

  // Queries em paralelo
  const [
    customersRes,
    productsRes,
    productsLowStockRes,
    salesAllRes,
    sales30dRes,
    sales90dRes,
    lastSaleRes,
    osOpenRes,
    osTotalRes,
    osAllRes,
    os30dRes,
    os90dRes,
    teamRes,
  ] = await Promise.all([
    sb.from('customers').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).lte('stock_qty', 5),
    sb.from('sales').select('total_cents', { count: 'exact' }).eq('tenant_id', tenantId).neq('status', 'cancelled'),
    sb.from('sales').select('total_cents', { count: 'exact' }).eq('tenant_id', tenantId).neq('status', 'cancelled').gte('created_at', d30),
    sb.from('sales').select('total_cents', { count: 'exact' }).eq('tenant_id', tenantId).neq('status', 'cancelled').gte('created_at', d90),
    sb.from('sales').select('created_at').eq('tenant_id', tenantId).neq('status', 'cancelled').order('created_at', { ascending: false }).limit(1),
    sb.from('service_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ['recebido', 'em_andamento', 'aguardando_peca']),
    sb.from('service_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    sb.from('service_orders').select('total_price_cents').eq('tenant_id', tenantId).neq('status', 'cancelled'),
    sb.from('service_orders').select('total_price_cents').eq('tenant_id', tenantId).neq('status', 'cancelled').gte('received_at', d30),
    sb.from('service_orders').select('total_price_cents').eq('tenant_id', tenantId).neq('status', 'cancelled').gte('received_at', d90),
    // Funcionários (employees) — owner não conta. Conta rows em tenant_member_permissions
    // distintas por user_id (cada employee tem múltiplas rows, uma por módulo)
    sb.from('tenant_member_permissions').select('user_id').eq('tenant_id', tenantId),
  ])

  type CentsRow = { total_cents?: number | null; total_price_cents?: number | null }
  const sumCents = (rows: CentsRow[] | null | undefined, key: 'total_cents' | 'total_price_cents') =>
    (rows ?? []).reduce((sum, r) => sum + (r[key] ?? 0), 0)

  const revenueAllSales = sumCents(salesAllRes.data as CentsRow[], 'total_cents')
  const revenue30dSales = sumCents(sales30dRes.data as CentsRow[], 'total_cents')
  const revenue90dSales = sumCents(sales90dRes.data as CentsRow[], 'total_cents')
  const revenueAllOs    = sumCents(osAllRes.data    as CentsRow[], 'total_price_cents')
  const revenue30dOs    = sumCents(os30dRes.data    as CentsRow[], 'total_price_cents')
  const revenue90dOs    = sumCents(os90dRes.data    as CentsRow[], 'total_price_cents')

  const sales30dCount = sales30dRes.count ?? 0
  const avgTicketCents = sales30dCount > 0 ? Math.round(revenue30dSales / sales30dCount) : 0

  const teamSet = new Set<string>()
  for (const r of (teamRes.data ?? []) as { user_id: string }[]) teamSet.add(r.user_id)

  // Loga acesso (LGPD/auditoria)
  await logAction(auth.email, 'view_tenant_data', tenantId, { tenantName: tenant.name })

  return {
    ok: true,
    data: {
      id:               tenant.id,
      name:             tenant.name,
      createdAt:        tenant.created_at,
      ownerEmail,
      ownerLastLogin,
      customers:        customersRes.count        ?? 0,
      products:         productsRes.count         ?? 0,
      productsLowStock: productsLowStockRes.count ?? 0,
      team:             teamSet.size,
      serviceOrders:    { open: osOpenRes.count ?? 0, total: osTotalRes.count ?? 0 },
      salesTotal:       salesAllRes.count ?? 0,
      salesLast30d:     sales30dCount,
      salesLast90d:     sales90dRes.count ?? 0,
      revenueTotalCents: revenueAllSales + revenueAllOs,
      revenue30dCents:   revenue30dSales + revenue30dOs,
      revenue90dCents:   revenue90dSales + revenue90dOs,
      lastSaleAt:       (lastSaleRes.data as { created_at: string }[] | null)?.[0]?.created_at ?? null,
      avgTicketCents,
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 3. Cancelar assinatura
// ──────────────────────────────────────────────────────────────────────────

export type CancelSubscriptionInput = {
  tenantId: string
  product:  Product
  note?:    string
}

export async function cancelSubscriptionAdmin(input: CancelSubscriptionInput): Promise<Result> {
  const auth = await requireAdmin()
  if ('error' in auth) return { ok: false, error: auth.error }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: sub, error: fetchErr } = await sb
    .from('subscriptions')
    .select('id, status')
    .eq('tenant_id', input.tenantId)
    .eq('product', input.product)
    .maybeSingle()

  if (fetchErr) return { ok: false, error: fetchErr.message }
  if (!sub)     return { ok: false, error: 'Assinatura não encontrada.' }
  if (sub.status === 'cancelled') return { ok: false, error: 'Já está cancelada.' }

  const { error } = await sb
    .from('subscriptions')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', sub.id)

  if (error) return { ok: false, error: `Erro ao cancelar: ${error.message}` }

  await logAction(auth.email, 'cancel_subscription', input.tenantId, {
    product: input.product,
    note:    input.note ?? null,
  })

  revalidatePath('/admin')
  return { ok: true }
}
