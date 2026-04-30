/**
 * Dashboard admin — só pra você (Felipe). Mostra MRR, customers, churn.
 *
 * Acesso restrito por email — ninguém mais vê. Pra adicionar outros admins,
 * adiciona email no array ADMIN_EMAILS abaixo.
 *
 * Não puxa dados do Asaas em tempo real (pra não estourar rate limit). Usa
 * dados locais das tabelas tenants/subscriptions.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, DollarSign, Users, Crown, AlertTriangle, TrendingUp, Lock,
} from 'lucide-react'
import { requireAuth } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fmtBRL } from '@/lib/pricing'
import type { Product } from '@/lib/pricing'
import { AdminTenantRow } from './admin-tenant-row'

export const metadata = { title: 'Admin — Phone Smart' }

const ADMIN_EMAILS = [
  'uedsonfelipepessoal@gmail.com',
  'uedsonfelipeprofissional@gmail.com',
]

export default async function AdminPage() {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const email = auth.user.email ?? ''
  if (!ADMIN_EMAILS.includes(email)) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-4"
          style={{ color: '#94A3B8' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pro Dashboard
        </Link>
        <div className="rounded-2xl border p-12 text-center"
          style={{ background: '#131C2A', borderColor: 'rgba(255,77,109,.3)' }}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border"
            style={{ background: 'rgba(255,77,109,.1)', borderColor: 'rgba(255,77,109,.3)' }}>
            <Lock className="h-7 w-7" style={{ color: '#EF4444' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#F8FAFC' }}>Acesso restrito</h1>
          <p className="text-sm" style={{ color: '#CBD5E1' }}>
            Esta página é exclusiva pra administradores da plataforma.
          </p>
        </div>
      </div>
    )
  }

  // ── Queries (admin client pula RLS — vê todos os tenants) ────────────────
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [
    tenantsRes,
    subsActiveRes,
    subsTrialRes,
    subsCancelledRecentRes,
    subsAllRes,
  ] = await Promise.all([
    sb.from('tenants').select('id, name, created_at', { count: 'exact' }),
    sb.from('subscriptions').select('id, tenant_id, product, plan_name, price_cents, billing_cycle, status, created_at')
      .eq('status', 'active'),
    sb.from('subscriptions').select('id, tenant_id, plan_name, trial_ends_at')
      .eq('status', 'trial')
      .gte('trial_ends_at', new Date().toISOString()),
    sb.from('subscriptions').select('id, tenant_id, price_cents, billing_cycle')
      .eq('status', 'cancelled')
      .gte('updated_at', thirtyDaysAgo),
    sb.from('subscriptions').select('id, tenant_id, product, plan_name, status, billing_cycle, price_cents'),
  ])

  type Sub = {
    id: string; tenant_id: string; product?: string; plan_name?: string
    price_cents: number; billing_cycle?: 'MONTHLY' | 'YEARLY'; status?: string
    created_at?: string
  }

  const tenants      = (tenantsRes.data ?? []) as { id: string; name: string; created_at: string }[]
  const subsActive   = (subsActiveRes.data ?? []) as Sub[]
  const subsTrial    = (subsTrialRes.data ?? []) as Sub[]
  const subsCancelledRecent = (subsCancelledRecentRes.data ?? []) as Sub[]
  const subsAll      = (subsAllRes.data ?? []) as Sub[]

  // MRR: soma de (price_cents normalizado pra mensal) das subs ativas
  const mrrCents = subsActive.reduce((sum, s) => {
    const monthly = s.billing_cycle === 'YEARLY' ? Math.round(s.price_cents / 12) : s.price_cents
    return sum + monthly
  }, 0)

  // ARR (anualizado)
  const arrCents = mrrCents * 12

  // Tenants pagantes (1+ sub active)
  const payingTenants = new Set(subsActive.map(s => s.tenant_id)).size

  // Tenants em trial
  const trialingTenants = new Set(subsTrial.map(s => s.tenant_id)).size

  // Churn: (cancelled últimos 30d) / (active no início do período)
  // Aproximação: subs canceladas nos últimos 30d / subs totais não-canceladas
  const totalNonCancelled = subsAll.filter(s => s.status !== 'cancelled').length
  const churnRate = totalNonCancelled > 0
    ? (subsCancelledRecent.length / totalNonCancelled) * 100
    : 0

  // Distribuição por plano (das subs ativas)
  type Plan = 'basico' | 'pro' | 'premium'
  const byPlan: Record<Plan, number> = { basico: 0, pro: 0, premium: 0 }
  for (const s of subsActive) {
    if (s.plan_name && s.plan_name in byPlan) byPlan[s.plan_name as Plan]++
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-2"
          style={{ color: '#94A3B8' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pro Dashboard
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
          <Crown className="h-5 w-5" style={{ color: '#F59E0B' }} />
          Admin — Métricas SaaS
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
          Visão geral da receita, clientes e churn da plataforma.
        </p>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI title="MRR" value={fmtBRL(mrrCents)} sub="Receita recorrente mensal"
             icon={DollarSign} color="#10B981" />
        <KPI title="ARR" value={fmtBRL(arrCents)} sub="Receita anualizada"
             icon={TrendingUp} color="#22C55E" />
        <KPI title="Clientes pagantes" value={String(payingTenants)} sub={`+${trialingTenants} em trial`}
             icon={Users} color="#F59E0B" />
        <KPI title="Churn (30d)" value={`${churnRate.toFixed(1)}%`} sub={`${subsCancelledRecent.length} cancelamentos`}
             icon={AlertTriangle} color={churnRate > 5 ? '#EF4444' : '#CBD5E1'} />
      </div>

      {/* Distribuição por plano */}
      <div className="rounded-2xl border p-6"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <h3 className="text-sm font-bold mb-4 uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
          Distribuição por plano (assinaturas ativas)
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <PlanBox label="Básico" count={byPlan.basico} color="#CBD5E1" />
          <PlanBox label="Pro" count={byPlan.pro} color="#22C55E" />
          <PlanBox label="Premium" count={byPlan.premium} color="#10B981" />
        </div>
      </div>

      {/* Tenants — clique nos botões pra liberar plano, estender trial ou cancelar */}
      <div className="rounded-2xl border p-6"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            Tenants ({tenants.length} total)
          </h3>
          <p className="text-[10px]" style={{ color: '#94A3B8' }}>
            🎁 liberar manual · ⏰ estender trial · ✕ cancelar sub
          </p>
        </div>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {tenants.length === 0 ? (
            <p className="text-xs" style={{ color: '#94A3B8' }}>Nenhum tenant ainda.</p>
          ) : (
            tenants.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).map(t => {
              const tenantSubs = subsAll
                .filter(s => s.tenant_id === t.id)
                .map(s => ({
                  product:      s.product as Product,
                  status:       s.status ?? 'inactive',
                  planName:     s.plan_name ?? null,
                  billingCycle: s.billing_cycle ?? null,
                  priceCents:   s.price_cents,
                }))
              return (
                <AdminTenantRow
                  key={t.id}
                  tenant={{ id: t.id, name: t.name, createdAt: t.created_at, subs: tenantSubs }}
                />
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function KPI({ title, value, sub, icon: Icon, color }: {
  title: string; value: string; sub: string; icon: React.ElementType; color: string
}) {
  return (
    <div className="rounded-2xl border p-5"
      style={{ background: '#131C2A', borderColor: '#2A3650' }}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
          {title}
        </p>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ background: `${color}15`, color }}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="text-2xl font-bold font-mono" style={{ color }}>{value}</p>
      <p className="text-[11px] mt-1" style={{ color: '#CBD5E1' }}>{sub}</p>
    </div>
  )
}

function PlanBox({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-lg border p-4 text-center"
      style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <p className="text-[11px] font-bold uppercase tracking-widest"
        style={{ color: '#94A3B8' }}>{label}</p>
      <p className="text-3xl font-bold font-mono mt-1" style={{ color }}>{count}</p>
      <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
        {count === 1 ? 'cliente' : 'clientes'}
      </p>
    </div>
  )
}
