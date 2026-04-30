'use server'

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'

// ── Helper: busca cost_cents atual dos produtos/peças pra snapshot em sale_items
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCostMap(supabase: any, productIds: (string | null)[]): Promise<Map<string, number>> {
  const ids = productIds.filter((id): id is string => !!id)
  const costMap = new Map<string, number>()
  if (ids.length === 0) return costMap

  const [prodRes, partRes] = await Promise.all([
    supabase.from('products').select('id, cost_cents').in('id', ids),
    supabase.from('parts_catalog').select('id, cost_cents').in('id', ids),
  ])
  for (const p of (prodRes.data ?? []) as { id: string; cost_cents: number }[]) costMap.set(p.id, p.cost_cents ?? 0)
  for (const p of (partRes.data ?? []) as { id: string; cost_cents: number }[]) costMap.set(p.id, p.cost_cents ?? 0)
  return costMap
}

// ── Cancel ERP sale + restore stock ──────────────────────────────────────────

export async function cancelSale(saleId: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // Fetch sale items with product_id to restore stock
  const { data: items } = await supabase
    .from('sale_items')
    .select('product_id, quantity')
    .eq('sale_id', saleId)

  const { error } = await supabase
    .from('sales')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', saleId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  // Restaura estoque via stock_movement 'entrada' (a trigger incrementa stock_qty)
  const entries = (items ?? []).filter(i => i.product_id).map(item => ({
    tenant_id:  tenantId,
    product_id: item.product_id as string,
    type:       'entrada',
    quantity:   item.quantity,
    origin:     `sale-cancel:${saleId}`,
    notes:      `Cancelamento da venda #${saleId.slice(0, 8)}`,
  }))
  if (entries.length > 0) {
    await supabase.from('stock_movements').insert(entries)
  }

  revalidatePath('/financeiro')
  revalidatePath('/estoque')
}

// ── Reactivate ERP sale + decrement stock ─────────────────────────────────────

export async function reactivateSale(saleId: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: items } = await supabase
    .from('sale_items')
    .select('product_id, quantity')
    .eq('sale_id', saleId)

  const { error } = await supabase
    .from('sales')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', saleId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  // Reativação → saída de estoque via stock_movement
  const exits = (items ?? []).filter(i => i.product_id).map(item => ({
    tenant_id:  tenantId,
    product_id: item.product_id as string,
    type:       'saida',
    quantity:   item.quantity,
    origin:     `sale-reactivate:${saleId}`,
    notes:      `Reativação da venda #${saleId.slice(0, 8)}`,
  }))
  if (exits.length > 0) {
    await supabase.from('stock_movements').insert(exits)
  }

  revalidatePath('/financeiro')
  revalidatePath('/estoque')
}

// ── Update CheckSmart OS payment method ──────────────────────────────────────

export async function updateServiceOrderPayment(orderId: string, paymentMethod: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { error } = await supabase
    .from('service_orders')
    .update({ payment_method: paymentMethod, updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/financeiro')
}

// ── Editar OS (versão "Opção B") ────────────────────────────────────────────
// Permite alterar cliente, data, valor de serviço, desconto, pagamento.
// NÃO mexe em peças (order_parts) — pra isso o usuário deve usar o CheckSmart.
// Espelha as Server Actions updateOrder + updateOrderFinancials do CheckSmart.

export type EditServiceOrderInput = {
  customer_id?:         string | null
  received_at?:         string         // ISO string da data de recebimento
  service_price_cents?: number
  discount_cents?:      number
  payment_method?:      string | null
  payment_installments?: number | null
  paid_at?:             string | null  // ISO ou null pra "não pago"
}

export async function updateServiceOrder(orderId: string, input: EditServiceOrderInput): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // Confirma posse + status (não permite editar OS cancelada — igual CheckSmart)
  const { data: order, error: fetchErr } = await supabase
    .from('service_orders')
    .select('id, status')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchErr || !order) throw new Error('Ordem de serviço não encontrada.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  // service_orders.customer_id é NOT NULL — só atualiza se veio um valor real
  if (input.customer_id          !== undefined && input.customer_id !== null) {
    patch.customer_id = input.customer_id
  }
  if (input.received_at          !== undefined) patch.received_at          = input.received_at
  if (input.service_price_cents  !== undefined) patch.service_price_cents  = Math.max(0, Math.round(input.service_price_cents))
  if (input.discount_cents       !== undefined) patch.discount_cents       = Math.max(0, Math.round(input.discount_cents))
  if (input.payment_method       !== undefined) patch.payment_method       = input.payment_method
  if (input.payment_installments !== undefined) patch.payment_installments = input.payment_installments
  if (input.paid_at              !== undefined) patch.paid_at              = input.paid_at

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('service_orders')
    .update(patch)
    .eq('id', orderId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/financeiro')
  revalidatePath('/analytics/canais')
  revalidatePath('/erp-clientes')
}

// ── Listar peças de uma OS (read-only — pra exibir no modal) ─────────────────

export type OrderPartView = {
  id:                     string
  name:                   string
  quantity:               number
  unitCostCents:          number
  unitSalePriceCents:     number
  totalSaleCents:         number   // qty × unitSalePrice
  supplier:               string | null
}

export async function getServiceOrderParts(orderId: string): Promise<OrderPartView[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // Confirma posse via join com service_orders.tenant_id (RLS seguro)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('order_parts')
    .select('id, name, quantity, unit_cost_cents, unit_sale_price_cents, supplier, service_orders!inner(tenant_id)')
    .eq('order_id', orderId)
    .eq('service_orders.tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)

  type Row = { id: string; name: string; quantity: number; unit_cost_cents: number | null; unit_sale_price_cents: number | null; supplier: string | null }
  return ((data ?? []) as Row[]).map(r => ({
    id:                 r.id,
    name:               r.name,
    quantity:           r.quantity,
    unitCostCents:      r.unit_cost_cents ?? 0,
    unitSalePriceCents: r.unit_sale_price_cents ?? 0,
    totalSaleCents:     (r.unit_sale_price_cents ?? 0) * r.quantity,
    supplier:           r.supplier,
  }))
}

// ── Delete ERP sale (only when already cancelled) ────────────────────────────

export async function deleteSale(saleId: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: sale } = await supabase
    .from('sales')
    .select('status')
    .eq('id', saleId)
    .eq('tenant_id', tenantId)
    .single()

  if (!sale) throw new Error('Venda não encontrada.')
  if (sale.status !== 'cancelled') throw new Error('Cancele a venda antes de excluí-la.')

  await supabase.from('sale_items').delete().eq('sale_id', saleId)

  const { error } = await supabase
    .from('sales')
    .delete()
    .eq('id', saleId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/financeiro')
}

// ── Update cancelled ERP sale (full edit) ────────────────────────────────────

export type EditSaleInput = {
  customerId:    string | null
  items:         { productId: string | null; name: string; quantity: number; unitPriceCents: number }[]
  discountCents: number
  paymentMethod: string
  saleDate:      string
  saleChannel?:  string | null
  deliveryType?: string | null
  customerOrigin?: string | null  // só aplicado quando cliente é Consumidor Final
}

export async function updateCancelledSale(saleId: string, input: EditSaleInput): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: sale } = await supabase
    .from('sales')
    .select('status')
    .eq('id', saleId)
    .eq('tenant_id', tenantId)
    .single()

  if (!sale) throw new Error('Venda não encontrada.')
  // NOTA: removida a trava de 'só cancelada' — agora dá pra editar qualquer venda (inclusive pra só
  // reclassificar canal/entrega sem precisar cancelar + reativar).
  // NOTA: items vazios são permitidos — útil pra reclassificar canal/entrega de vendas legadas
  // que não têm sale_items no banco. Nesse caso, só os fields da venda são atualizados.

  const subtotal     = input.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0)
  const total        = Math.max(0, subtotal - input.discountCents)
  const newCreatedAt = new Date(input.saleDate + 'T12:00:00').toISOString()

  const { error } = await supabase
    .from('sales')
    .update({
      customer_id:    input.customerId,
      total_cents:    total,
      subtotal_cents: subtotal,
      discount_cents: input.discountCents,
      payment_method: input.paymentMethod,
      created_at:     newCreatedAt,
      updated_at:     new Date().toISOString(),
      sale_channel:   input.saleChannel  ?? null,
      delivery_type:  input.deliveryType ?? null,
      customer_origin: input.customerOrigin ?? null,
    })
    .eq('id', saleId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  // Só refaz sale_items se foram informados — preserva items existentes em
  // edições só pra reclassificação (canal/entrega).
  if (input.items.length > 0) {
    await supabase.from('sale_items').delete().eq('sale_id', saleId)
    const costMapEdit = await fetchCostMap(supabase, input.items.map(i => i.productId))
    await supabase.from('sale_items').insert(
      input.items.map(i => ({
        sale_id:             saleId,
        product_id:          i.productId,
        name:                i.name,
        quantity:            i.quantity,
        unit_price_cents:    i.unitPriceCents,
        subtotal_cents:      i.unitPriceCents * i.quantity,
        cost_snapshot_cents: i.productId ? (costMapEdit.get(i.productId) ?? null) : null,
      })),
    )
  }

  revalidatePath('/financeiro')
}

// ── Update sale date (cancel → update date → reactivate) ─────────────────────

export async function updateSaleDate(saleId: string, newDate: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: items } = await supabase
    .from('sale_items')
    .select('product_id, quantity')
    .eq('sale_id', saleId)

  // Restaura estoque (entrada) para depois decrementar com a nova data
  const restores = (items ?? []).filter(i => i.product_id).map(item => ({
    tenant_id:  tenantId,
    product_id: item.product_id as string,
    type:       'entrada',
    quantity:   item.quantity,
    origin:     `sale-date-revert:${saleId}`,
    notes:      `Revertendo venda #${saleId.slice(0, 8)} para alterar data`,
  }))
  if (restores.length > 0) {
    await supabase.from('stock_movements').insert(restores)
  }

  const newCreatedAt = new Date(newDate + 'T12:00:00').toISOString()
  const { error } = await supabase
    .from('sales')
    .update({ created_at: newCreatedAt, status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', saleId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  const exits = (items ?? []).filter(i => i.product_id).map(item => ({
    tenant_id:  tenantId,
    product_id: item.product_id as string,
    type:       'saida',
    quantity:   item.quantity,
    origin:     `sale-date-redo:${saleId}`,
    notes:      `Venda #${saleId.slice(0, 8)} com nova data`,
  }))
  if (exits.length > 0) {
    await supabase.from('stock_movements').insert(exits)
  }

  revalidatePath('/financeiro')
  revalidatePath('/estoque')
}

// ── Cancel CheckSmart OS ──────────────────────────────────────────────────────

export async function cancelServiceOrder(orderId: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: current } = await supabase
    .from('service_orders')
    .select('status')
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .single()

  const { error } = await supabase
    .from('service_orders')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  await supabase.from('order_status_logs').insert({
    tenant_id:   tenantId,
    order_id:    orderId,
    from_status: current?.status ?? null,
    to_status:   'cancelled',
    notes:       'Cancelado pelo PhoneSmart',
  })

  revalidatePath('/financeiro')
}

// ── Reactivate CheckSmart OS ──────────────────────────────────────────────────

export async function reactivateServiceOrder(orderId: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { error } = await supabase
    .from('service_orders')
    .update({ status: 'received', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/financeiro')
}

// ── Create manual sale (with custom date + items) ────────────────────────────

export type ManualSaleItem = {
  productId:      string | null
  source?:        'products' | 'parts_catalog'
  name:           string
  quantity:       number
  unitPriceCents: number
}

export type ManualSaleInput = {
  saleDate:      string
  customerId:    string | null
  items:         ManualSaleItem[]
  discountCents: number
  paymentMethod: 'cash' | 'pix' | 'card' | 'mixed'
  saleChannel?:  string | null
  deliveryType?: string | null
}

export async function createManualSale(input: ManualSaleInput): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (!input.items.length) throw new Error('Adicione ao menos um item.')

  const subtotal = input.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0)
  const total    = Math.max(0, subtotal - input.discountCents)

  const saleDate = new Date(input.saleDate + 'T12:00:00')

  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .insert({
      tenant_id:      tenantId,
      user_id:        user.id,
      customer_id:    input.customerId,
      subtotal_cents: subtotal,
      discount_cents: input.discountCents,
      shipping_cents: 0,
      total_cents:    total,
      payment_method: input.paymentMethod,
      status:         'completed',
      created_at:     saleDate.toISOString(),
      sale_channel:   input.saleChannel  ?? null,
      delivery_type:  input.deliveryType ?? null,
    })
    .select('id')
    .single()

  if (saleErr) throw new Error(saleErr.message)

  const costMapManual = await fetchCostMap(supabase, input.items.map(i => i.productId))
  await supabase.from('sale_items').insert(
    input.items.map(i => ({
      sale_id:             sale.id,
      product_id:          i.productId,
      name:                i.name,
      quantity:            i.quantity,
      unit_price_cents:    i.unitPriceCents,
      subtotal_cents:      i.unitPriceCents * i.quantity,
      cost_snapshot_cents: i.productId ? (costMapManual.get(i.productId) ?? null) : null,
    })),
  )

  // Saída de estoque via stock_movement
  const manualExits = input.items
    .filter(i => i.productId && i.source === 'products')
    .map(item => ({
      tenant_id:        tenantId,
      product_id:       item.productId as string,
      type:             'saida',
      quantity:         item.quantity,
      sale_price_cents: item.unitPriceCents,
      origin:           `sale:${sale.id}`,
      notes:            `Venda manual #${sale.id.slice(0, 8)}`,
    }))
  if (manualExits.length > 0) {
    await supabase.from('stock_movements').insert(manualExits)
  }

  revalidatePath('/financeiro')
  revalidatePath('/estoque')
}

// ── Bulk cancel (ERP sales + CheckSmart OS) ───────────────────────────────────

export async function bulkCancel(
  saleIds: string[],
  orderIds: string[],
): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  for (const saleId of saleIds) {
    const { data: items } = await supabase
      .from('sale_items')
      .select('product_id, quantity')
      .eq('sale_id', saleId)

    await supabase
      .from('sales')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', saleId)
      .eq('tenant_id', tenantId)

    const bulkEntries = (items ?? []).filter(i => i.product_id).map(item => ({
      tenant_id:  tenantId,
      product_id: item.product_id as string,
      type:       'entrada',
      quantity:   item.quantity,
      origin:     `sale-cancel:${saleId}`,
      notes:      `Cancelamento em massa da venda #${saleId.slice(0, 8)}`,
    }))
    if (bulkEntries.length > 0) {
      await supabase.from('stock_movements').insert(bulkEntries)
    }
  }

  if (orderIds.length > 0) {
    const { data: currentOrders } = await supabase
      .from('service_orders')
      .select('id, status')
      .in('id', orderIds)
      .eq('tenant_id', tenantId)

    await supabase
      .from('service_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', orderIds)
      .eq('tenant_id', tenantId)

    const logs = (currentOrders ?? []).map(o => ({
      tenant_id:   tenantId,
      order_id:    o.id,
      from_status: o.status,
      to_status:   'cancelled',
      notes:       'Cancelado pelo PhoneSmart',
    }))
    if (logs.length > 0) await supabase.from('order_status_logs').insert(logs)
  }

  revalidatePath('/financeiro')
  revalidatePath('/estoque')
}

// ── Bulk delete cancelled ERP sales ──────────────────────────────────────────

export async function bulkDeleteSales(saleIds: string[]): Promise<void> {
  if (saleIds.length === 0) return
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: sales } = await supabase
    .from('sales')
    .select('id, status')
    .in('id', saleIds)
    .eq('tenant_id', tenantId)

  const notCancelled = (sales ?? []).filter(s => s.status !== 'cancelled')
  if (notCancelled.length > 0) throw new Error('Cancele todas as vendas selecionadas antes de excluir.')

  for (const saleId of saleIds) {
    await supabase.from('sale_items').delete().eq('sale_id', saleId)
    await supabase.from('sales').delete().eq('id', saleId).eq('tenant_id', tenantId)
  }

  revalidatePath('/financeiro')
}

// ── Bulk delete cancelled CheckSmart OS ───────────────────────────────────────

export async function bulkDeleteServiceOrders(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: orders } = await supabase
    .from('service_orders')
    .select('id, status')
    .in('id', orderIds)
    .eq('tenant_id', tenantId)

  const notCancelled = (orders ?? []).filter(o => o.status !== 'cancelled')
  if (notCancelled.length > 0) throw new Error('Apenas OS canceladas podem ser excluídas.')

  const { error } = await supabase
    .from('service_orders')
    .delete()
    .in('id', orderIds)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/financeiro')
}
