'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Gift, Clock, X, Loader2, Eye } from 'lucide-react'
import { toast } from 'sonner'
import {
  grantManualPlan, extendTrial, cancelSubscriptionAdmin,
} from '@/actions/admin'
import type { Product, Plan } from '@/lib/pricing'
import { AdminTenantDrawer } from './admin-tenant-drawer'

type Sub = {
  product:        Product
  status:         string
  planName:       string | null
  billingCycle:   'MONTHLY' | 'YEARLY' | null
  priceCents:     number
}

type Props = {
  tenant: {
    id:          string
    name:        string
    createdAt:   string
    subs:        Sub[]
  }
}

const PRODUCT_LABELS: Record<Product, string> = {
  gestao_smart: 'Gestão Smart',
  checksmart:   'CheckSmart',
  crm:          'CRM',
  meta_ads:     'Meta Ads',
}

const STATUS_COLORS: Record<string, string> = {
  active:    '#10B981',
  trial:     '#F59E0B',
  late:      '#EA580C',
  inactive:  '#EF4444',
  cancelled: '#94A3B8',
}

export function AdminTenantRow({ tenant }: Props) {
  const [grantOpen,  setGrantOpen]  = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Resumo do tenant: pega a sub principal (gestao_smart) pra exibir
  const mainSub = tenant.subs.find(s => s.product === 'gestao_smart') ?? tenant.subs[0]
  const statusColor = STATUS_COLORS[mainSub?.status ?? ''] ?? '#94A3B8'
  const planLabel = mainSub
    ? mainSub.status === 'active'
      ? `${mainSub.planName ?? '?'} · ${mainSub.billingCycle === 'YEARLY' ? 'Anual' : 'Mensal'}`
      : mainSub.status
    : 'sem sub'

  return (
    <div className="rounded-lg border p-3"
      style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="min-w-0 text-left transition-opacity hover:opacity-80 cursor-pointer"
          title="Ver dados operacionais (modo suporte)">
          <p className="text-sm font-semibold truncate flex items-center gap-1.5" style={{ color: '#F8FAFC' }}>
            {tenant.name}
            <Eye className="h-3 w-3" style={{ color: '#94A3B8' }} />
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>
            Cadastrado: {new Date(tenant.createdAt).toLocaleDateString('pt-BR')}
            {' · '}
            {tenant.subs.length} {tenant.subs.length === 1 ? 'assinatura' : 'assinaturas'}
          </p>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded"
            style={{ background: `${statusColor}18`, color: statusColor }}>
            {planLabel}
          </span>
          <button
            type="button"
            onClick={() => setGrantOpen(true)}
            title="Liberar plano manualmente"
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-card"
            style={{ borderColor: '#2A3650', color: '#10B981' }}>
            <Gift className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setExtendOpen(true)}
            title="Estender trial"
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-card"
            style={{ borderColor: '#2A3650', color: '#F59E0B' }}>
            <Clock className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Lista de subs com botão cancelar individual */}
      {tenant.subs.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {tenant.subs.map(sub => (
            <SubRow key={`${tenant.id}-${sub.product}`} tenantId={tenant.id} sub={sub} />
          ))}
        </div>
      )}

      {grantOpen  && <GrantManualModal  tenantId={tenant.id} tenantName={tenant.name} onClose={() => setGrantOpen(false)} />}
      {extendOpen && <ExtendTrialModal  tenantId={tenant.id} tenantName={tenant.name} subs={tenant.subs} onClose={() => setExtendOpen(false)} />}
      {drawerOpen && <AdminTenantDrawer tenantId={tenant.id} onClose={() => setDrawerOpen(false)} />}
    </div>
  )
}

function SubRow({ tenantId, sub }: { tenantId: string; sub: Sub }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const statusColor = STATUS_COLORS[sub.status] ?? '#94A3B8'

  function handleCancel() {
    if (!confirm(`Cancelar assinatura de ${PRODUCT_LABELS[sub.product]}?`)) return
    startTransition(async () => {
      const res = await cancelSubscriptionAdmin({ tenantId, product: sub.product })
      if (res.ok) {
        toast.success('Assinatura cancelada.')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="flex items-center justify-between rounded px-2 py-1.5"
      style={{ background: '#131C2A' }}>
      <div className="flex items-center gap-2 text-[11px]">
        <span style={{ color: '#CBD5E1' }}>{PRODUCT_LABELS[sub.product]}</span>
        <span className="font-bold uppercase" style={{ color: statusColor }}>
          {sub.status}
        </span>
        {sub.planName && (
          <span style={{ color: '#94A3B8' }}>
            {sub.planName} · {sub.billingCycle === 'YEARLY' ? 'Anual' : 'Mensal'}
          </span>
        )}
      </div>
      {sub.status !== 'cancelled' && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending}
          title="Cancelar assinatura"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-card disabled:opacity-50"
          style={{ color: '#EF4444' }}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Modal: Liberar plano manualmente
// ──────────────────────────────────────────────────────────────────────────

function GrantManualModal({ tenantId, tenantName, onClose }: {
  tenantId: string; tenantName: string; onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [product,      setProduct]      = useState<Product>('gestao_smart')
  const [planName,     setPlanName]     = useState<Plan>('basico')
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY')
  const [months,       setMonths]       = useState(1)
  const [note,         setNote]         = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await grantManualPlan({ tenantId, product, planName, billingCycle, months, note })
      if (res.ok) {
        toast.success(`Plano liberado pra ${tenantName}.`)
        router.refresh()
        onClose()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <ModalShell title="Liberar plano manual" subtitle={tenantName} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Produto">
          <select value={product} onChange={e => setProduct(e.target.value as Product)} className={inputCls} style={inputStyle}>
            <option value="gestao_smart">Gestão Smart</option>
            <option value="checksmart">CheckSmart</option>
            <option value="crm">CRM</option>
            <option value="meta_ads">Meta Ads</option>
          </select>
        </Field>

        <Field label="Plano">
          <select value={planName} onChange={e => setPlanName(e.target.value as Plan)} className={inputCls} style={inputStyle}>
            <option value="basico">Básico</option>
            <option value="pro">Pro</option>
            <option value="premium">Premium</option>
          </select>
        </Field>

        <Field label="Ciclo de cobrança">
          <select value={billingCycle} onChange={e => setBillingCycle(e.target.value as 'MONTHLY' | 'YEARLY')} className={inputCls} style={inputStyle}>
            <option value="MONTHLY">Mensal</option>
            <option value="YEARLY">Anual</option>
          </select>
        </Field>

        <Field label="Duração (meses) — quando expira o acesso">
          <input type="number" min={1} max={36} value={months} onChange={e => setMonths(Number(e.target.value))}
            className={inputCls} style={inputStyle} />
        </Field>

        <Field label="Motivo (opcional)">
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="ex: pagamento via PIX manual, cortesia parceiro, beta tester"
            className={inputCls} style={inputStyle} />
        </Field>

        <p className="text-[11px]" style={{ color: '#F59E0B' }}>
          ⚠ Plano liberado manualmente NÃO gera cobrança recorrente no Asaas.
          Quando expirar, a sub vira <code>inactive</code> e o tenant perde acesso.
        </p>

        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={pending}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: '#10B981', color: '#131C2A' }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            Liberar plano
          </button>
          <button type="button" onClick={onClose}
            className="rounded-lg border px-4 py-2.5 text-sm transition-colors hover:bg-card"
            style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>
            Cancelar
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Modal: Estender trial
// ──────────────────────────────────────────────────────────────────────────

function ExtendTrialModal({ tenantId, tenantName, subs, onClose }: {
  tenantId: string; tenantName: string; subs: Sub[]; onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [product, setProduct] = useState<Product>(subs[0]?.product ?? 'gestao_smart')
  const [days,    setDays]    = useState(7)
  const [note,    setNote]    = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await extendTrial({ tenantId, product, days, note })
      if (res.ok) {
        toast.success(`Trial estendido por ${days} dias.`)
        router.refresh()
        onClose()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <ModalShell title="Estender trial" subtitle={tenantName} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Produto">
          <select value={product} onChange={e => setProduct(e.target.value as Product)} className={inputCls} style={inputStyle}>
            {subs.map(s => (
              <option key={s.product} value={s.product}>{PRODUCT_LABELS[s.product]}</option>
            ))}
          </select>
        </Field>

        <Field label="Dias adicionais">
          <input type="number" min={1} max={365} value={days} onChange={e => setDays(Number(e.target.value))}
            className={inputCls} style={inputStyle} />
        </Field>

        <Field label="Motivo (opcional)">
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="ex: cliente pediu mais tempo pra avaliar"
            className={inputCls} style={inputStyle} />
        </Field>

        <p className="text-[11px]" style={{ color: '#CBD5E1' }}>
          Se trial já expirou, sub volta pra <code>status=trial</code> e o tenant
          recupera acesso por mais {days} dias.
        </p>

        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={pending}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: '#F59E0B', color: '#131C2A' }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
            Estender trial
          </button>
          <button type="button" onClick={onClose}
            className="rounded-lg border px-4 py-2.5 text-sm transition-colors hover:bg-card"
            style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>
            Cancelar
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers de UI
// ──────────────────────────────────────────────────────────────────────────

const inputCls   = 'w-full rounded-lg border px-3.5 py-2.5 text-sm text-text outline-none transition-colors focus:border-accent/60'
const inputStyle = { background: '#1B2638', borderColor: '#2A3650' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#CBD5E1' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function ModalShell({ title, subtitle, onClose, children }: {
  title: string; subtitle: string; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: '#F8FAFC' }}>{title}</h2>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>{subtitle}</p>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-card"
            style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
