import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { redirect } from 'next/navigation'
import { FinanceiroClient, type FinanceiroRow } from './financeiro-client'

export const metadata = { title: 'Financeiro — Phone Smart' }

export default async function FinanceiroPage() {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { supabase, user } = auth
  const tenantId = getTenantId(user)

  const [salesRes, ordersRes] = await Promise.all([
    supabase
      .from('sales')
      .select(`
        id, customer_id, total_cents, subtotal_cents, discount_cents, shipping_cents,
        payment_method, status, created_at, sale_channel, delivery_type, customer_origin,
        customers ( full_name, cpf_cnpj, created_at ),
        sale_items ( name, quantity, unit_price_cents, product_id, cost_snapshot_cents )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(300),

    supabase
      .from('service_orders')
      .select(`
        id, customer_id, total_price_cents, service_price_cents, parts_sale_cents,
        parts_cost_cents, discount_cents, status, payment_method, received_at,
        sale_channel, delivery_type,
        customers ( full_name, cpf_cnpj, created_at )
      `)
      .eq('tenant_id', tenantId)
      .order('received_at', { ascending: false })
      .limit(300),
  ])

  type SaleRow = {
    id: string; customer_id: string | null
    total_cents: number; subtotal_cents: number
    discount_cents: number; shipping_cents: number
    payment_method: string; status: string; created_at: string
    sale_channel: string | null; delivery_type: string | null
    customer_origin: string | null
    customers: { full_name: string; cpf_cnpj: string | null; created_at: string } | null
    sale_items: { name: string; quantity: number; unit_price_cents: number; product_id: string | null; cost_snapshot_cents: number | null }[]
  }
  type OrderRow = {
    id: string; customer_id: string | null
    total_price_cents: number; service_price_cents: number
    parts_sale_cents: number; parts_cost_cents: number | null; discount_cents: number
    status: string; payment_method: string | null; received_at: string
    sale_channel: string | null; delivery_type: string | null
    customers: { full_name: string; cpf_cnpj: string | null; created_at: string } | null
  }

  const sales  = (salesRes.data  ?? []) as unknown as SaleRow[]
  const orders = (ordersRes.data ?? []) as unknown as OrderRow[]

  // Fallback de custo: itens de venda sem cost_snapshot usam cost_cents atual
  // do produto (estimativa — vendas antigas, antes do snapshot existir).
  const productIdsToFetch = new Set<string>()
  for (const s of sales) {
    for (const it of s.sale_items) {
      if (it.cost_snapshot_cents == null && it.product_id) productIdsToFetch.add(it.product_id)
    }
  }
  const costMap = new Map<string, number>()
  if (productIdsToFetch.size > 0) {
    const { data: prodData } = await supabase
      .from('products')
      .select('id, cost_cents')
      .eq('tenant_id', tenantId)
      .in('id', Array.from(productIdsToFetch))
    for (const p of (prodData ?? []) as { id: string; cost_cents: number | null }[]) {
      costMap.set(p.id, p.cost_cents ?? 0)
    }
  }

  const saleProfit = (s: SaleRow): number => {
    let cost = 0
    for (const it of s.sale_items) {
      const qty  = it.quantity ?? 0
      const unit = it.cost_snapshot_cents ?? (it.product_id ? (costMap.get(it.product_id) ?? 0) : 0)
      cost += qty * unit
    }
    return s.total_cents - cost
  }

  const osTotal = (o: OrderRow) => {
    if (o.total_price_cents) return o.total_price_cents
    return Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
  }

  const osProfit = (o: OrderRow): number => {
    return osTotal(o) - (o.parts_cost_cents ?? 0)
  }

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  function clienteType(customerCreatedAt: string | null | undefined): 'novo' | 'recorrente' | null {
    if (!customerCreatedAt) return null
    return new Date(customerCreatedAt) >= thirtyDaysAgo ? 'novo' : 'recorrente'
  }

  const allRows: FinanceiroRow[] = [
    ...sales.map(s => ({
      id:           `sale-${s.id}`,
      rawId:        s.id,
      source:       'erp' as const,
      date:         new Date(s.created_at),
      dateStr:      new Date(s.created_at).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }),
      customerName: s.customers?.full_name ?? 'Sem cliente',
      description:  s.sale_items.map(i => `${i.quantity}× ${i.name}`).join(', ') || '—',
      payment:      s.payment_method ?? null,
      osStatus:     null,
      cancelled:    s.status === 'cancelled',
      discount:     s.discount_cents ?? 0,
      total:        s.total_cents,
      profit:       saleProfit(s),
      customerId:   s.customer_id ?? null,
      saleItems:    s.sale_items.map(i => ({ name: i.name, quantity: i.quantity, unitPriceCents: i.unit_price_cents })),
      saleChannel:    s.sale_channel    ?? null,
      deliveryType:   s.delivery_type   ?? null,
      customerOrigin: s.customer_origin ?? null,
      clienteType:    s.customer_id ? clienteType(s.customers?.created_at) : null,
    })),
    ...orders.map(o => ({
      id:           `os-${o.id}`,
      rawId:        o.id,
      source:       'checksmart' as const,
      date:         new Date(o.received_at),
      dateStr:      new Date(o.received_at).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }),
      customerName: o.customers?.full_name ?? 'Sem cliente',
      customerId:   o.customer_id ?? null,
      description:  `OS — ${o.status ?? ''}`,
      payment:      o.payment_method ?? null,
      osStatus:     o.status ?? null,
      cancelled:    o.status === 'cancelled',
      discount:     o.discount_cents ?? 0,
      total:        osTotal(o),
      profit:       osProfit(o),
      saleChannel:  o.sale_channel  ?? null,
      deliveryType: o.delivery_type ?? null,
      clienteType:  o.customers ? clienteType(o.customers.created_at) : null,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime())

  return <FinanceiroClient initialRows={allRows} />
}
