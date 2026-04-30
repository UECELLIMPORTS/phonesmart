import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Lock } from 'lucide-react'
import { getTenantSubscriptions, getProductSubscription, daysUntilTrialEnds } from '@/lib/subscription'
import { getTenantId } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { AssinaturaClient } from './assinatura-client'

export const metadata = { title: 'Minha Assinatura — Phone Smart' }

export default async function AssinaturaPage() {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  // Gate owner-only — manager não pode mexer em assinatura
  const isOwner = auth.user.app_metadata?.tenant_role === 'owner'
  if (!isOwner) {
    return (
      <div className="max-w-2xl">
        <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-4"
          style={{ color: '#94A3B8' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pra Configurações
        </Link>
        <div className="rounded-2xl border p-8 text-center"
          style={{ background: '#131C2A', borderColor: 'rgba(255,77,109,.3)' }}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border"
            style={{ background: 'rgba(255,77,109,.1)', borderColor: 'rgba(255,77,109,.3)' }}>
            <Lock className="h-7 w-7" style={{ color: '#EF4444' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#F8FAFC' }}>Acesso restrito</h1>
          <p className="text-sm" style={{ color: '#CBD5E1' }}>
            Apenas o dono da conta pode ver e gerenciar a assinatura.
          </p>
        </div>
      </div>
    )
  }

  const subs = await getTenantSubscriptions(auth.user)

  // Lê CPF/CNPJ do tenant pra modal de assinatura saber se precisa pedir
  const tenantId = getTenantId(auth.user)
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data: tenantRow } = await sb.from('tenants')
    .select('cpf_cnpj').eq('id', tenantId).maybeSingle()
  const hasCpfCnpj = !!tenantRow?.cpf_cnpj

  const gestaoSub = getProductSubscription(subs, 'gestao_smart')
  // Premium ativo libera Meta Ads + CRM como add-ons inclusos
  const gestaoSmartIsPremium =
    gestaoSub?.planName === 'premium' &&
    (gestaoSub.status === 'active' || gestaoSub.status === 'trial')

  // Estado consolidado pra renderizar os 4 produtos (contratados ou não)
  const data = {
    gestaoSmart: gestaoSub,
    checkSmart:  getProductSubscription(subs, 'checksmart'),
    crm:         getProductSubscription(subs, 'crm'),
    metaAds:     getProductSubscription(subs, 'meta_ads'),
    trialDays:   daysUntilTrialEnds(subs),
    userEmail:   auth.user.email ?? '',
    hasCpfCnpj,
    gestaoSmartIsPremium,
  }

  return <AssinaturaClient data={data} />
}
