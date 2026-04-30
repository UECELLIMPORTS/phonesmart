'use server'

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'

// ── Types ─────────────────────────────────────────────────────────────────────

export type MovementType = 'entrada' | 'saida'

export type StockMovementRow = {
  id:                   string
  product_id:           string
  type:                 MovementType
  quantity:             number
  purchase_price_cents: number
  cost_price_cents:     number
  sale_price_cents:     number
  notes:                string | null
  origin:               string | null
  depot:                string | null
  moved_at:             string
  created_at:           string
}

export type StockMovementInput = {
  productId:          string
  type:               MovementType
  quantity:           number
  purchasePriceCents: number
  costPriceCents:     number
  salePriceCents:     number
  notes:              string
  movedAt?:           string   // ISO — omitir usa now()
  depot?:             string
  origin?:            string   // padrão 'manual'; use 'balanco' para ajuste de inventário
}

export type UpdateMovementInput = {
  type?:               MovementType
  quantity?:           number
  movedAt?:            string
  notes?:              string
  origin?:             string
  purchasePriceCents?: number
  costPriceCents?:     number
  salePriceCents?:     number
}

export type StockSummary = {
  total_entrada:            number
  avg_purchase_price_cents: number
  total_saida:              number
  avg_sale_price_cents:     number
}

const MOVEMENT_COLS = `
  id, product_id, type, quantity,
  purchase_price_cents, cost_price_cents, sale_price_cents,
  notes, origin, depot, moved_at, created_at
`

// ── Helper: recalcula stock_qty do produto a partir de todas as movimentações ─

async function recalcStock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  productId: string,
  tenantId: string,
): Promise<number> {
  const { data } = await supabase
    .from('stock_movements')
    .select('type, quantity')
    .eq('product_id', productId)
    .eq('tenant_id', tenantId)

  const newQty = Math.max(
    0,
    (data ?? []).reduce(
      (sum: number, m: { type: string; quantity: number }) =>
        sum + (m.type === 'entrada' ? Number(m.quantity) : -Number(m.quantity)),
      0,
    ),
  )

  await supabase
    .from('products')
    .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('tenant_id', tenantId)

  return newQty
}

// ── List movements by product ─────────────────────────────────────────────────

export async function listMovements(productId: string): Promise<StockMovementRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data, error } = await supabase
    .from('stock_movements')
    .select(MOVEMENT_COLS)
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .order('moved_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data ?? []) as StockMovementRow[]
}

// ── Summary by product ────────────────────────────────────────────────────────

export async function getStockSummary(productId: string): Promise<StockSummary> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data, error } = await supabase
    .from('stock_summary_by_product')
    .select('total_entrada, avg_purchase_price_cents, total_saida, avg_sale_price_cents')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return (data ?? {
    total_entrada:            0,
    avg_purchase_price_cents: 0,
    total_saida:              0,
    avg_sale_price_cents:     0,
  }) as StockSummary
}

// ── Create movement ───────────────────────────────────────────────────────────

export async function createMovement(input: StockMovementInput): Promise<StockMovementRow> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (input.quantity <= 0) throw new Error('Quantidade deve ser maior que zero.')

  const { data, error } = await supabase
    .from('stock_movements')
    .insert({
      tenant_id:            tenantId,
      product_id:           input.productId,
      type:                 input.type,
      quantity:             input.quantity,
      purchase_price_cents: input.purchasePriceCents,
      cost_price_cents:     input.costPriceCents,
      sale_price_cents:     input.type === 'saida' ? input.salePriceCents : 0,
      notes:                input.notes.trim() || null,
      origin:               input.origin ?? 'manual',
      depot:                input.depot?.trim() || null,
      moved_at:             input.movedAt ?? new Date().toISOString(),
    })
    .select(MOVEMENT_COLS)
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
  return data as unknown as StockMovementRow
}

// ── Update movement (quantidade e/ou data) ────────────────────────────────────

export async function updateMovement(
  id: string,
  input: UpdateMovementInput,
): Promise<{ movement: StockMovementRow; newStockQty: number }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // Busca lançamento atual para calcular delta de quantidade
  const { data: current, error: fetchErr } = await supabase
    .from('stock_movements')
    .select('product_id, type, quantity')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchErr || !current) throw new Error('Lançamento não encontrado.')

  const patch: Record<string, unknown> = {}
  if (input.quantity           !== undefined) patch.quantity             = input.quantity
  if (input.movedAt            !== undefined) patch.moved_at             = input.movedAt
  if (input.notes              !== undefined) patch.notes                = input.notes?.trim() || null
  if (input.type               !== undefined) patch.type                 = input.type
  if (input.origin             !== undefined) patch.origin               = input.origin
  if (input.purchasePriceCents !== undefined) patch.purchase_price_cents = input.purchasePriceCents
  if (input.costPriceCents     !== undefined) patch.cost_price_cents     = input.costPriceCents
  if (input.salePriceCents     !== undefined) patch.sale_price_cents     = input.salePriceCents

  const { data, error } = await supabase
    .from('stock_movements')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(MOVEMENT_COLS)
    .single()

  if (error) throw new Error(error.message)

  // Sincroniza products.cost_cents / purchase_price_cents quando o
  // usuário corrige os preços de uma ENTRADA. Sem isso, o ERP Clientes
  // continuaria usando o custo antigo pra calcular lucro das vendas
  // (a trigger do banco só roda em INSERT, não em UPDATE).
  const finalType = (input.type ?? current.type) as 'entrada' | 'saida'
  if (finalType === 'entrada') {
    const prodPatch: Record<string, unknown> = {}
    if (input.purchasePriceCents !== undefined && input.purchasePriceCents > 0) {
      prodPatch.purchase_price_cents = input.purchasePriceCents
    }
    if (input.costPriceCents !== undefined && input.costPriceCents > 0) {
      prodPatch.cost_cents = input.costPriceCents
    }
    if (Object.keys(prodPatch).length > 0) {
      prodPatch.updated_at = new Date().toISOString()
      await supabase
        .from('products')
        .update(prodPatch)
        .eq('id', current.product_id)
        .eq('tenant_id', tenantId)
    }
  }

  // Recalcula stock_qty se quantidade ou tipo mudou
  const qtyChanged  = input.quantity !== undefined && input.quantity !== Number(current.quantity)
  const typeChanged = input.type     !== undefined && input.type     !== current.type
  let newStockQty: number
  if (qtyChanged || typeChanged) {
    newStockQty = await recalcStock(supabase, current.product_id, tenantId)
  } else {
    const { data: prod } = await supabase
      .from('products')
      .select('stock_qty')
      .eq('id', current.product_id)
      .single()
    newStockQty = prod?.stock_qty ?? 0
  }

  revalidatePath('/estoque')
  revalidatePath('/erp-clientes')
  revalidatePath('/financeiro')
  return { movement: data as unknown as StockMovementRow, newStockQty }
}

// ── Delete movement ───────────────────────────────────────────────────────────

export async function deleteMovement(id: string): Promise<{ newStockQty: number }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: movement, error: fetchErr } = await supabase
    .from('stock_movements')
    .select('product_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchErr || !movement) throw new Error('Lançamento não encontrado.')

  const { error } = await supabase
    .from('stock_movements')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  const newStockQty = await recalcStock(supabase, movement.product_id, tenantId)

  revalidatePath('/estoque')
  return { newStockQty }
}

// ── Reconciliar vendas antigas (sem stock_movement correspondente) ───────────
// Busca sale_items com este product_id em vendas completed e cria
// stock_movements retroativos apenas para vendas que ainda não têm.

export async function reconcileProductSales(productId: string): Promise<{ created: number }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // 1) Todos os sale_items deste produto em vendas completed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: items, error: itemsErr } = await sb
    .from('sale_items')
    .select('id, sale_id, quantity, unit_price_cents, sales!inner(id, status, created_at, tenant_id)')
    .eq('product_id', productId)
    .eq('sales.tenant_id', tenantId)
    .eq('sales.status', 'completed')

  if (itemsErr) throw new Error(itemsErr.message)
  type SaleItemJoin = {
    id: string
    sale_id: string
    quantity: number
    unit_price_cents: number
    sales: { id: string; status: string; created_at: string; tenant_id: string }
  }
  const rows = (items ?? []) as SaleItemJoin[]
  if (rows.length === 0) return { created: 0 }

  // 2) Ver quais sales já têm stock_movement criado
  const saleIds = [...new Set(rows.map(r => r.sale_id))]
  const origins = saleIds.map(id => `sale:${id}`)
  const { data: existing } = await sb
    .from('stock_movements')
    .select('origin')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .in('origin', origins)

  const alreadyCovered = new Set(
    ((existing ?? []) as { origin: string }[])
      .map(m => m.origin.replace('sale:', '')),
  )

  // 3) Criar movements faltando
  const toInsert = rows
    .filter(r => !alreadyCovered.has(r.sale_id))
    .map(r => ({
      tenant_id:        tenantId,
      product_id:       productId,
      type:             'saida',
      quantity:         r.quantity,
      sale_price_cents: r.unit_price_cents,
      origin:           `sale:${r.sale_id}`,
      notes:            `Reconciliação: venda antiga #${r.sale_id.slice(0, 8)} de ${new Date(r.sales.created_at).toLocaleDateString('pt-BR')}`,
      created_at:       r.sales.created_at,
    }))

  if (toInsert.length === 0) return { created: 0 }

  const { error: insertErr } = await sb.from('stock_movements').insert(toInsert)
  if (insertErr) throw new Error(insertErr.message)

  revalidatePath('/estoque')
  return { created: toInsert.length }
}
