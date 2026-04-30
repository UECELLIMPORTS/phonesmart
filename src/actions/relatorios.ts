'use server'

/**
 * Relatórios detalhados estilo Bling — vendas e produtos.
 *
 * Diferente do dashboard (KPIs agregados), aqui retornamos rows individuais
 * pra renderizar tabelas filtráveis e exportáveis.
 */

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'

// ──────────────────────────────────────────────────────────────────────────
// Vendas (detalhado)
// ──────────────────────────────────────────────────────────────────────────

export type DetailedSaleRow = {
  id:               string
  createdAt:        string
  customerName:     string | null
  sellerEmail:      string | null
  saleChannel:      string | null
  paymentMethod:    string | null
  status:           string
  subtotalCents:    number
  discountCents:    number
  shippingCents:    number
  totalCents:       number
  profitCents:      number          // soma de (unit_price - cost_snapshot) * qty
  itemsCount:       number
}

export type SalesReportFilters = {
  start:           string           // ISO
  end:             string           // ISO
  paymentMethods?: string[]
  saleChannels?:   string[]
  status?:         'all' | 'completed' | 'cancelled'
  customerId?:     string
  userId?:         string
}

export type SalesReportData = {
  rows:               DetailedSaleRow[]
  totalCount:         number
  totalRevenueCents:  number
  totalProfitCents:   number
  avgTicketCents:     number
  totalDiscountCents: number
}

export async function getDetailedSalesReport(filters: SalesReportFilters): Promise<SalesReportData> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const cols = 'id, created_at, customer_id, user_id, sale_channel, payment_method, status, subtotal_cents, discount_cents, shipping_cents, total_cents, customers(full_name), sale_items(quantity, unit_price_cents, cost_snapshot_cents)'

  let q = sb.from('sales').select(cols)
    .eq('tenant_id', tenantId)
    .gte('created_at', filters.start)
    .lte('created_at', filters.end)
    .order('created_at', { ascending: false })

  if (filters.status === 'completed') q = q.neq('status', 'cancelled')
  else if (filters.status === 'cancelled') q = q.eq('status', 'cancelled')
  // 'all' ou undefined → sem filtro de status

  if (filters.paymentMethods && filters.paymentMethods.length > 0)
    q = q.in('payment_method', filters.paymentMethods)
  if (filters.saleChannels && filters.saleChannels.length > 0)
    q = q.in('sale_channel', filters.saleChannels)
  if (filters.customerId) q = q.eq('customer_id', filters.customerId)
  if (filters.userId)     q = q.eq('user_id', filters.userId)

  q = q.limit(1000)   // proteção — UI tem que paginar se atingir esse cap

  const { data, error } = await q
  if (error) throw new Error(error.message)

  type ItemRow = { quantity: number; unit_price_cents: number; cost_snapshot_cents: number | null }
  type SaleRow = {
    id: string; created_at: string; customer_id: string | null; user_id: string | null
    sale_channel: string | null; payment_method: string | null; status: string
    subtotal_cents: number; discount_cents: number; shipping_cents: number; total_cents: number
    customers: { full_name: string | null } | null
    sale_items: ItemRow[] | null
  }

  // Pega emails dos sellers em batch
  const userIds = Array.from(new Set(((data ?? []) as SaleRow[]).map(s => s.user_id).filter(Boolean))) as string[]
  const emailByUser = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: usersRes } = await admin.auth.admin.listUsers({ page: 1, perPage: 100 })
    for (const u of usersRes?.users ?? []) {
      if (u.email) emailByUser.set(u.id, u.email)
    }
  }

  const rows: DetailedSaleRow[] = ((data ?? []) as SaleRow[]).map(s => {
    let profit = 0
    let count = 0
    for (const it of s.sale_items ?? []) {
      count += it.quantity
      const unitProfit = it.cost_snapshot_cents !== null
        ? (it.unit_price_cents - it.cost_snapshot_cents)
        : 0
      profit += unitProfit * it.quantity
    }
    return {
      id:            s.id,
      createdAt:     s.created_at,
      customerName:  s.customers?.full_name ?? null,
      sellerEmail:   s.user_id ? (emailByUser.get(s.user_id) ?? null) : null,
      saleChannel:   s.sale_channel,
      paymentMethod: s.payment_method,
      status:        s.status,
      subtotalCents: s.subtotal_cents,
      discountCents: s.discount_cents,
      shippingCents: s.shipping_cents,
      totalCents:    s.total_cents,
      profitCents:   profit,
      itemsCount:    count,
    }
  })

  // Totais (excluindo canceladas pra "totalRevenue" — fica mais útil)
  const nonCancelled = rows.filter(r => r.status !== 'cancelled')
  const totalRevenue = nonCancelled.reduce((s, r) => s + r.totalCents, 0)
  const totalProfit  = nonCancelled.reduce((s, r) => s + r.profitCents, 0)
  const totalDisc    = nonCancelled.reduce((s, r) => s + r.discountCents, 0)
  const avgTicket    = nonCancelled.length > 0 ? Math.round(totalRevenue / nonCancelled.length) : 0

  return {
    rows,
    totalCount:         rows.length,
    totalRevenueCents:  totalRevenue,
    totalProfitCents:   totalProfit,
    avgTicketCents:     avgTicket,
    totalDiscountCents: totalDisc,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Produtos (ranking)
// ──────────────────────────────────────────────────────────────────────────

export type ProductReportRow = {
  productId:       string | null
  productName:     string
  category:        string | null
  quantitySold:    number
  revenueCents:    number
  costCents:       number
  profitCents:     number
  marginPercent:   number
  salesCount:      number              // # de vendas em que apareceu
}

export type ProductsReportFilters = {
  start:    string
  end:      string
  category?: string
}

export async function getProductsReport(filters: ProductsReportFilters): Promise<ProductReportRow[]> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Pega sale_items com sales filtradas por período + status
  const { data, error } = await sb
    .from('sale_items')
    .select('product_id, name, quantity, unit_price_cents, cost_snapshot_cents, sale_id, sales!inner(tenant_id, created_at, status)')
    .eq('sales.tenant_id', tenantId)
    .neq('sales.status', 'cancelled')
    .gte('sales.created_at', filters.start)
    .lte('sales.created_at', filters.end)
    .limit(5000)

  if (error) throw new Error(error.message)

  type ItemRow = {
    product_id:           string | null
    name:                 string
    quantity:             number
    unit_price_cents:     number
    cost_snapshot_cents:  number | null
    sale_id:              string
    sales:                { created_at: string; status: string } | null
  }

  // Pega categorias dos produtos referenciados
  const productIds = Array.from(new Set(
    ((data ?? []) as ItemRow[]).map(i => i.product_id).filter(Boolean)
  )) as string[]
  const categoryById = new Map<string, string | null>()
  if (productIds.length > 0) {
    const { data: prods } = await sb
      .from('products')
      .select('id, category')
      .in('id', productIds)
    type P = { id: string; category: string | null }
    for (const p of (prods ?? []) as P[]) categoryById.set(p.id, p.category)
  }

  // Agrega por produto
  const byProduct = new Map<string, ProductReportRow>()
  for (const it of (data ?? []) as ItemRow[]) {
    const key = it.product_id ?? `manual:${it.name}`
    const existing = byProduct.get(key) ?? {
      productId:     it.product_id,
      productName:   it.name,
      category:      it.product_id ? (categoryById.get(it.product_id) ?? null) : null,
      quantitySold:  0,
      revenueCents:  0,
      costCents:     0,
      profitCents:   0,
      marginPercent: 0,
      salesCount:    0,
    }
    existing.quantitySold += it.quantity
    existing.revenueCents += it.unit_price_cents * it.quantity
    if (it.cost_snapshot_cents !== null) {
      existing.costCents += it.cost_snapshot_cents * it.quantity
    }
    existing.salesCount++
    byProduct.set(key, existing)
  }

  // Calcula profit + margin
  let rows = Array.from(byProduct.values()).map(r => {
    r.profitCents = r.revenueCents - r.costCents
    r.marginPercent = r.revenueCents > 0 ? Math.round((r.profitCents / r.revenueCents) * 100) : 0
    return r
  })

  // Filtro de categoria (depois da agregação porque pega de products table)
  if (filters.category && filters.category !== 'all') {
    rows = rows.filter(r => r.category === filters.category)
  }

  return rows.sort((a, b) => b.revenueCents - a.revenueCents)
}
