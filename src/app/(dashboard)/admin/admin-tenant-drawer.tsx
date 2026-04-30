'use client'

import { useEffect, useState } from 'react'
import {
  X, Loader2, Users, Package, ShoppingCart, Wrench, DollarSign,
  TrendingUp, AlertTriangle, Calendar, Mail, Eye, UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { getTenantDetails, type TenantDetails } from '@/actions/admin'
import { fmtBRL } from '@/lib/pricing'

type Props = {
  tenantId: string
  onClose:  () => void
}

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const daysSince = (iso: string | null): number | null => {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)
}

export function AdminTenantDrawer({ tenantId, onClose }: Props) {
  const [data, setData] = useState<TenantDetails | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getTenantDetails(tenantId).then(res => {
      if (cancelled) return
      if (res.ok) {
        setData(res.data ?? null)
      } else {
        toast.error(res.error)
        onClose()
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [tenantId, onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}>
      <div className="w-full max-w-2xl h-full overflow-y-auto border-l"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between border-b p-5"
          style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-3.5 w-3.5" style={{ color: '#F59E0B' }} />
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#F59E0B' }}>
                Modo suporte · acesso registrado em audit log
              </span>
            </div>
            <h2 className="text-xl font-bold truncate" style={{ color: '#F8FAFC' }}>
              {data?.name ?? '...'}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
              ID: <code style={{ color: '#CBD5E1' }}>{tenantId.slice(0, 8)}…</code>
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-card"
            style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: '#22C55E' }} />
          </div>
        )}

        {data && !loading && (
          <div className="p-5 space-y-5">

            {/* Identificação */}
            <Section title="Identificação">
              <Row icon={Mail}     label="Email do owner" value={data.ownerEmail ?? '—'} />
              <Row icon={Calendar} label="Tenant criado em" value={fmtDate(data.createdAt)} />
              <Row icon={UserCheck} label="Último login do owner"
                value={fmtDateTime(data.ownerLastLogin)}
                hint={(() => {
                  const d = daysSince(data.ownerLastLogin)
                  if (d === null) return null
                  if (d === 0) return 'hoje'
                  if (d > 30) return `há ${d}d — possível tenant dormindo 💤`
                  return `há ${d}d`
                })()}
                hintColor={(() => {
                  const d = daysSince(data.ownerLastLogin)
                  return d !== null && d > 30 ? '#EA580C' : '#94A3B8'
                })()} />
            </Section>

            {/* Faturamento */}
            <Section title="Faturamento">
              <div className="grid grid-cols-3 gap-3">
                <KPI label="Últimos 30d" value={fmtBRL(data.revenue30dCents)} color="#10B981" />
                <KPI label="Últimos 90d" value={fmtBRL(data.revenue90dCents)} color="#22C55E" />
                <KPI label="Histórico"   value={fmtBRL(data.revenueTotalCents)} color="#F59E0B" />
              </div>
              <p className="text-[10px] mt-2" style={{ color: '#94A3B8' }}>
                Soma de vendas (POS + ERP) + ordens de serviço. Exclui canceladas.
              </p>
            </Section>

            {/* Vendas */}
            <Section title="Vendas">
              <Row icon={ShoppingCart} label="Vendas (histórico)" value={String(data.salesTotal)} />
              <Row icon={ShoppingCart} label="Vendas (últimos 30d)" value={String(data.salesLast30d)} />
              <Row icon={ShoppingCart} label="Vendas (últimos 90d)" value={String(data.salesLast90d)} />
              <Row icon={DollarSign}   label="Ticket médio (30d)"    value={fmtBRL(data.avgTicketCents)} />
              <Row icon={Calendar}     label="Última venda"
                value={fmtDate(data.lastSaleAt)}
                hint={(() => {
                  const d = daysSince(data.lastSaleAt)
                  if (d === null) return 'nunca vendeu'
                  if (d === 0) return 'hoje'
                  if (d > 14) return `há ${d}d — atenção`
                  return `há ${d}d`
                })()}
                hintColor={(() => {
                  const d = daysSince(data.lastSaleAt)
                  return d !== null && d > 14 ? '#EA580C' : '#94A3B8'
                })()} />
            </Section>

            {/* Estoque & Cadastros */}
            <Section title="Cadastros">
              <Row icon={Users}    label="Clientes"  value={String(data.customers)} />
              <Row icon={Package}  label="Produtos"  value={String(data.products)} />
              <Row icon={AlertTriangle} label="Produtos com estoque baixo (≤5)"
                value={String(data.productsLowStock)}
                valueColor={data.productsLowStock > 0 ? '#EA580C' : '#CBD5E1'} />
              <Row icon={UserCheck} label="Funcionários (employees)" value={String(data.team)} />
            </Section>

            {/* OS */}
            <Section title="Ordens de serviço">
              <Row icon={Wrench} label="Histórico" value={String(data.serviceOrders.total)} />
              <Row icon={Wrench} label="Em aberto" value={String(data.serviceOrders.open)}
                valueColor={data.serviceOrders.open > 0 ? '#F59E0B' : '#CBD5E1'} />
            </Section>

            {/* Health summary */}
            <HealthSummary data={data} />
          </div>
        )}
      </div>
    </div>
  )
}

function HealthSummary({ data }: { data: TenantDetails }) {
  const issues: { label: string; severity: 'warn' | 'critical' }[] = []
  const lastSaleDays = daysSince(data.lastSaleAt)
  const lastLoginDays = daysSince(data.ownerLastLogin)

  if (lastSaleDays === null) issues.push({ label: 'Tenant nunca vendeu', severity: 'critical' })
  else if (lastSaleDays > 30) issues.push({ label: `Última venda há ${lastSaleDays}d`, severity: 'critical' })
  else if (lastSaleDays > 14) issues.push({ label: `Última venda há ${lastSaleDays}d`, severity: 'warn' })

  if (lastLoginDays !== null && lastLoginDays > 30)
    issues.push({ label: `Owner não loga há ${lastLoginDays}d`, severity: 'critical' })

  if (data.products === 0)  issues.push({ label: 'Nenhum produto cadastrado', severity: 'critical' })
  if (data.customers === 0) issues.push({ label: 'Nenhum cliente cadastrado', severity: 'warn' })
  if (data.productsLowStock > 0) issues.push({ label: `${data.productsLowStock} produto(s) com estoque baixo`, severity: 'warn' })

  if (issues.length === 0) {
    return (
      <div className="rounded-lg border p-4 flex items-center gap-3"
        style={{ background: 'rgba(16,185,129,.08)', borderColor: 'rgba(16,185,129,.3)' }}>
        <TrendingUp className="h-5 w-5" style={{ color: '#10B981' }} />
        <div>
          <p className="text-sm font-bold" style={{ color: '#10B981' }}>Tenant saudável</p>
          <p className="text-xs" style={{ color: '#CBD5E1' }}>Sem alertas no momento.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border p-4"
      style={{ background: 'rgba(255,107,53,.08)', borderColor: 'rgba(255,107,53,.3)' }}>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4" style={{ color: '#EA580C' }} />
        <p className="text-sm font-bold uppercase tracking-wider" style={{ color: '#EA580C' }}>
          Alertas ({issues.length})
        </p>
      </div>
      <ul className="space-y-1 text-xs">
        {issues.map((i, idx) => (
          <li key={idx} style={{ color: i.severity === 'critical' ? '#EF4444' : '#F59E0B' }}>
            • {i.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: '#94A3B8' }}>
        {title}
      </h3>
      <div className="rounded-lg border divide-y"
        style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, value, valueColor, hint, hintColor }: {
  icon: React.ElementType; label: string; value: string
  valueColor?: string; hint?: string | null; hintColor?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5"
      style={{ borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: '#94A3B8' }} />
        <span className="text-xs truncate" style={{ color: '#CBD5E1' }}>{label}</span>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold" style={{ color: valueColor ?? '#F8FAFC' }}>{value}</p>
        {hint && <p className="text-[10px]" style={{ color: hintColor ?? '#94A3B8' }}>{hint}</p>}
      </div>
    </div>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border p-3"
      style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#94A3B8' }}>
        {label}
      </p>
      <p className="text-sm font-bold font-mono truncate" style={{ color }}>{value}</p>
    </div>
  )
}
