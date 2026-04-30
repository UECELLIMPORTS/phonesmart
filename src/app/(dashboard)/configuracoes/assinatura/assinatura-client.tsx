'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  Store, Users, TrendingUp, Wrench, Sparkles, ArrowLeft,
  Check, Plus, AlertTriangle,
} from 'lucide-react'
import type { Subscription } from '@/lib/subscription'
import { SubscribeModal } from './subscribe-modal'
import { UpgradeModal } from './upgrade-modal'
import { cancelSubscriptionAsaas } from '@/actions/billing'
import { toast } from 'sonner'
import type { Product, Plan } from '@/lib/pricing'

const BRL = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)

const DT = (date: Date | null) => {
  if (!date) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

type Data = {
  gestaoSmart:           Subscription | null
  checkSmart:            Subscription | null
  crm:                   Subscription | null
  metaAds:               Subscription | null
  trialDays:             number | null
  userEmail:             string
  hasCpfCnpj:            boolean
  /** True se Gestão Smart está com plano Premium ativo (libera Meta Ads + CRM). */
  gestaoSmartIsPremium:  boolean
}

export function AssinaturaClient({ data }: { data: Data }) {
  const [modal, setModal] = useState<{ product: Product; label: string } | null>(null)
  const [upgradeModal, setUpgradeModal] = useState<{ product: Product; label: string; currentPlan: Plan } | null>(null)

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-2"
          style={{ color: '#94A3B8' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pra Configurações
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
          <Sparkles className="h-5 w-5" style={{ color: '#F59E0B' }} />
          Minha Assinatura
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
          Gerencie os produtos contratados, mude de plano ou cancele.
        </p>
      </div>

      {/* Banner de trial expirando, se for o caso */}
      {data.trialDays !== null && data.trialDays <= 3 && (
        <div className="rounded-xl border p-4 flex items-start gap-3"
          style={{ background: 'rgba(255,77,109,.06)', borderColor: 'rgba(255,77,109,.3)' }}>
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
          <div className="text-sm" style={{ color: '#F8FAFC' }}>
            <p className="font-bold" style={{ color: '#EF4444' }}>
              {data.trialDays === 0 ? 'Seu trial expira hoje!' : `Faltam ${data.trialDays} dias do seu trial`}
            </p>
            <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>
              Assine agora pra não perder acesso aos seus dados.
            </p>
          </div>
        </div>
      )}

      {/* Cards dos produtos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProductCard
          name="Gestão Smart" product="gestao_smart"
          description="ERP completo: vendas, estoque, financeiro, dashboards"
          icon={Store} color="#22C55E" sub={data.gestaoSmart}
          plansAvailable={['basico', 'pro', 'premium']}
          onSubscribe={(label) => setModal({ product: 'gestao_smart', label })}
          onUpgrade={(label, currentPlan) => setUpgradeModal({ product: 'gestao_smart', label, currentPlan })}
        />
        <ProductCard
          name="CRM" product="crm"
          description="Pipeline + inbox WhatsApp/Instagram unificado"
          icon={Users} color="#10B981" sub={data.crm}
          plansAvailable={['basico', 'pro', 'premium']}
          onSubscribe={(label) => setModal({ product: 'crm', label })}
          onUpgrade={(label, currentPlan) => setUpgradeModal({ product: 'crm', label, currentPlan })}
          comingSoon
          includedInPremium={data.gestaoSmartIsPremium}
        />
        <ProductCard
          name="Meta Ads" product="meta_ads"
          description="ROAS e CAC integrados ao seu ERP"
          icon={TrendingUp} color="#E4405F" sub={data.metaAds}
          plansAvailable={['basico']}
          onSubscribe={(label) => setModal({ product: 'meta_ads', label })}
          onUpgrade={(label, currentPlan) => setUpgradeModal({ product: 'meta_ads', label, currentPlan })}
          note="Add-on de R$47/mês — incluso no Premium do Gestão Smart"
          includedInPremium={data.gestaoSmartIsPremium}
        />
        <ProductCard
          name="CheckSmart" product="checksmart"
          description="OS de assistência técnica com escudo jurídico"
          icon={Wrench} color="#F59E0B" sub={data.checkSmart}
          plansAvailable={['basico', 'pro', 'premium']}
          onSubscribe={(label) => setModal({ product: 'checksmart', label })}
          onUpgrade={(label, currentPlan) => setUpgradeModal({ product: 'checksmart', label, currentPlan })}
          includedInPremium={data.gestaoSmartIsPremium}
        />
      </div>

      {/* Modal de assinatura (1ª vez) */}
      <SubscribeModal
        open={!!modal}
        onClose={() => setModal(null)}
        product={modal?.product ?? 'gestao_smart'}
        productLabel={modal?.label ?? ''}
        hasCpfCnpj={data.hasCpfCnpj}
      />

      {/* Modal de upgrade (mudança entre planos pagos) */}
      <UpgradeModal
        open={!!upgradeModal}
        onClose={() => setUpgradeModal(null)}
        product={upgradeModal?.product ?? 'gestao_smart'}
        productLabel={upgradeModal?.label ?? ''}
        currentPlan={upgradeModal?.currentPlan ?? 'basico'}
      />
    </div>
  )
}

// ── Card de produto ─────────────────────────────────────────────────────────

function ProductCard({
  name, product, description, icon: Icon, color, sub, plansAvailable,
  onSubscribe, onUpgrade, comingSoon, note, includedInPremium,
}: {
  name:               string
  product:            Product
  description:        string
  icon:               React.ElementType
  color:              string
  sub:                Subscription | null
  plansAvailable:     string[]
  onSubscribe:        (label: string) => void
  onUpgrade:          (label: string, currentPlan: Plan) => void
  comingSoon?:        boolean
  note?:              string
  /** Se true, oculta "Contratar" e mostra "Incluso no Premium" — pra produtos
   *  cobertos pelo plano Premium do Gestão Smart (Meta Ads, CRM). */
  includedInPremium?: boolean
}) {
  const [cancelling, setCancelling] = useState(false)
  const isActive = !!sub && (sub.status === 'active' || sub.status === 'trial')
  const isTrial  = sub?.status === 'trial'
  const isPaidActive = sub?.status === 'active'   // tá pago e ativo (pode upgrade)

  async function handleCancel() {
    if (!confirm(`Cancelar assinatura de ${name}? Você mantém acesso até o fim do ciclo atual.`)) return
    setCancelling(true)
    const res = await cancelSubscriptionAsaas(product)
    setCancelling(false)
    if (res.ok) {
      toast.success('Assinatura cancelada.')
      window.location.reload()
    } else {
      toast.error(res.error ?? 'Erro ao cancelar.')
    }
  }

  return (
    <article className="rounded-2xl border p-6"
      style={{ background: '#131C2A', borderColor: isActive ? `${color}40` : '#2A3650' }}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl shrink-0 border"
          style={{ background: `${color}15`, borderColor: `${color}40` }}>
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold" style={{ color: '#F8FAFC' }}>{name}</h3>
            {isActive && (
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                style={{ background: `${color}18`, color }}>
                {isTrial ? 'TRIAL' : 'ATIVO'}
              </span>
            )}
          </div>
          <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>{description}</p>
        </div>
      </div>

      {/* Estado: contratado vs não contratado */}
      {isActive && sub ? (
        <>
          <div className="rounded-lg border p-3 mb-4 space-y-1.5"
            style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <Row label="Plano">
              <span className="font-bold capitalize" style={{ color: '#F8FAFC' }}>{sub.planName}</span>
            </Row>
            <Row label={sub.billingCycle === 'YEARLY' ? 'Valor anual' : 'Valor mensal'}>
              <span className="font-mono font-bold" style={{ color }}>
                {BRL(sub.priceCents)}
                <span className="text-[10px] font-normal ml-1" style={{ color: '#94A3B8' }}>
                  {sub.billingCycle === 'YEARLY' ? '/ano' : '/mês'}
                </span>
              </span>
            </Row>
            {isTrial && sub.trialEndsAt && (
              <Row label="Trial até">
                <span className="font-mono" style={{ color: '#F59E0B' }}>{DT(sub.trialEndsAt)}</span>
              </Row>
            )}
            {!isTrial && sub.currentPeriodEnd && (
              <Row label="Próxima cobrança">
                <span className="font-mono" style={{ color: '#F8FAFC' }}>{DT(sub.currentPeriodEnd)}</span>
              </Row>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => {
                if (isPaidActive && sub) onUpgrade(name, sub.planName as Plan)
                else onSubscribe(name)
              }}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-opacity hover:opacity-90"
              style={{ background: '#22C55E', color: '#131C2A' }}>
              {isTrial ? 'Assinar agora' : 'Mudar plano'}
            </button>
            {!isTrial && (
              <button onClick={handleCancel} disabled={cancelling}
                className="inline-flex items-center justify-center gap-1 rounded-lg border px-4 py-2.5 text-xs font-semibold transition-colors hover:bg-white/5 disabled:opacity-50"
                style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>
                {cancelling ? '…' : 'Cancelar'}
              </button>
            )}
          </div>
        </>
      ) : includedInPremium ? (
        <>
          <p className="text-xs mb-4" style={{ color: '#94A3B8' }}>
            {comingSoon
              ? '🚧 Em desenvolvimento — você terá acesso assim que lançarmos'
              : 'Esse módulo já está liberado pelo seu plano atual.'}
          </p>
          <div className="w-full inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold border"
            style={{ background: 'rgba(16,185,129,.08)', color: '#10B981', borderColor: 'rgba(16,185,129,.3)' }}>
            <Check className="h-3.5 w-3.5" />
            Incluso no plano Premium
          </div>
        </>
      ) : (
        <>
          <p className="text-xs mb-4" style={{ color: '#94A3B8' }}>
            {comingSoon
              ? '🚧 Em desenvolvimento — falaremos com você quando estiver disponível'
              : note ?? 'Você ainda não contratou esse produto.'}
          </p>
          <button
            onClick={() => !comingSoon && onSubscribe(name)}
            disabled={comingSoon}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-bold transition-opacity hover:opacity-90 disabled:cursor-not-allowed"
            style={comingSoon
              ? { background: '#2A3650', color: '#CBD5E1' }
              : { background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }
            }>
            <Plus className="h-3.5 w-3.5" />
            {comingSoon ? 'Em breve' : `Contratar ${name}`}
          </button>
        </>
      )}

      {/* Lista de planos disponíveis (info) */}
      {!comingSoon && plansAvailable.length > 1 && (
        <div className="mt-4 pt-4 border-t" style={{ borderColor: '#2A3650' }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#94A3B8' }}>
            Planos disponíveis
          </p>
          <div className="flex gap-2 flex-wrap">
            {plansAvailable.map(plan => (
              <span key={plan} className="text-[10px] font-bold uppercase px-2 py-0.5 rounded"
                style={sub?.planName === plan
                  ? { background: `${color}18`, color }
                  : { background: '#1B2638', color: '#94A3B8' }
                }>
                <Check className="h-3 w-3 inline mr-1" />
                {plan}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: '#CBD5E1' }}>{label}</span>
      {children}
    </div>
  )
}
