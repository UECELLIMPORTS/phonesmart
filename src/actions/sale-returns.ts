'use server'

/**
 * Sprint 10 — Devolução/cancelamento de venda com IMEI.
 *
 * Diferenças sobre cancelSale (que continua existindo no financeiro):
 *   - Devolve IMEIs corretamente (status='returned' ou 'available')
 *   - Estorna installment_plan vinculado (cancela parcelas pendentes)
 *   - Pula stock_movement pra itens com IMEI (já controlado via syncStockQty)
 *   - Registra motivo + timestamp de quem cancelou
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type SaleReturnPreview = {
  saleId:           string
  saleNumber:       string
  customerName:     string | null
  totalCents:       number
  paymentMethod:    string | null
  createdAt:        string
  status:           string
  itemsCount:       number
  // IMEIs vinculados
  serialItems:      Array<{
    serialId:       string
    serial:         string
    productName:    string
    soldAt:         string | null
  }>
  // Crediário ativo
  installmentPlan:  null | {
    planId:           string
    totalInstallments: number
    paidCount:        number
    pendingCount:     number
    totalPaidCents:   number
    totalPendingCents: number
  }
}

// ──────────────────────────────────────────────────────────────────────────
// getSaleReturnPreview — antes de devolver, mostra o que vai acontecer
// ──────────────────────────────────────────────────────────────────────────

export async function getSaleReturnPreview(saleId: string): Promise<SaleReturnPreview | null> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: sale } = await sb
    .from('sales')
    .select('id, total_cents, payment_method, status, created_at, customers(full_name)')
    .eq('id', saleId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!sale) return null

  // sale_items + serials
  const { data: items } = await sb
    .from('sale_items')
    .select(`
      id, product_serial_id,
      product_serials:product_serial_id (id, serial, sold_at, products(name))
    `)
    .eq('sale_id', saleId)

  type Item = {
    id: string; product_serial_id: string | null
    product_serials: { id: string; serial: string; sold_at: string | null; products: { name: string } | null } | null
  }
  const list = (items ?? []) as Item[]
  const serialItems: SaleReturnPreview['serialItems'] = list
    .filter(i => i.product_serials)
    .map(i => ({
      serialId:    i.product_serials!.id,
      serial:      i.product_serials!.serial,
      productName: i.product_serials!.products?.name ?? '—',
      soldAt:      i.product_serials!.sold_at,
    }))

  // Plano de crediário ativo
  const { data: plan } = await sb
    .from('installment_plans')
    .select('id, installments_count, status')
    .eq('tenant_id', tenantId)
    .eq('sale_id', saleId)
    .maybeSingle()

  let installmentPlan: SaleReturnPreview['installmentPlan'] = null
  if (plan) {
    const { data: insts } = await sb
      .from('installments')
      .select('amount_cents, status')
      .eq('plan_id', plan.id)
    type Inst = { amount_cents: number; status: string }
    const arr = (insts ?? []) as Inst[]
    const paid     = arr.filter(i => i.status === 'paid')
    const pending  = arr.filter(i => i.status === 'pending' || i.status === 'late')
    installmentPlan = {
      planId:             plan.id,
      totalInstallments:  plan.installments_count,
      paidCount:          paid.length,
      pendingCount:       pending.length,
      totalPaidCents:     paid.reduce((s, i) => s + i.amount_cents, 0),
      totalPendingCents:  pending.reduce((s, i) => s + i.amount_cents, 0),
    }
  }

  return {
    saleId:        sale.id,
    saleNumber:    `VND-${sale.id.slice(0, 8).toUpperCase()}`,
    customerName:  (sale.customers as { full_name: string } | null)?.full_name ?? null,
    totalCents:    sale.total_cents,
    paymentMethod: sale.payment_method,
    createdAt:     sale.created_at,
    status:        sale.status,
    itemsCount:    list.length,
    serialItems,
    installmentPlan,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// processReturn — executa a devolução completa
// ──────────────────────────────────────────────────────────────────────────

const ProcessSchema = z.object({
  saleId:        z.string().uuid(),
  // 'available' = volta pro estoque pra revenda; 'returned' = mantém marcado
  serialAction:  z.enum(['available', 'returned']).default('available'),
  reason:        z.string().min(3).max(500),
})

export async function processReturn(input: unknown): Promise<Result<{ saleId: string }>> {
  const parsed = ProcessSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // 1. Busca a venda + itens
  const { data: sale } = await sb
    .from('sales')
    .select('id, status, total_cents')
    .eq('id', v.saleId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!sale) return { ok: false, error: 'Venda não encontrada.' }
  if (sale.status === 'cancelled') return { ok: false, error: 'Venda já estava cancelada.' }

  const { data: items } = await sb
    .from('sale_items')
    .select('id, product_id, quantity, product_serial_id')
    .eq('sale_id', v.saleId)

  type Item = { id: string; product_id: string | null; quantity: number; product_serial_id: string | null }
  const list = (items ?? []) as Item[]

  // 2. Marca venda como cancelled
  const { error: saleErr } = await sb
    .from('sales')
    .update({
      status:               'cancelled',
      cancelled_at:         new Date().toISOString(),
      cancellation_reason:  v.reason.trim(),
      cancelled_by_user_id: user.id,
      return_serial_action: list.some(i => i.product_serial_id) ? v.serialAction : null,
      updated_at:           new Date().toISOString(),
    })
    .eq('id', v.saleId)
    .eq('tenant_id', tenantId)
  if (saleErr) return { ok: false, error: saleErr.message }

  // 3. Pra cada IMEI vendido: muda status + limpa sale_item_id + sold_at
  const serialIds = list.map(i => i.product_serial_id).filter(Boolean) as string[]
  if (serialIds.length > 0) {
    const { error: serialErr } = await sb
      .from('product_serials')
      .update({
        status:       v.serialAction,
        sale_item_id: null,
        sold_at:      null,
      })
      .in('id', serialIds)
      .eq('tenant_id', tenantId)
    if (serialErr) return { ok: false, error: `Erro ao devolver IMEIs: ${serialErr.message}` }

    // Sync stock_qty pros produtos afetados
    const productIds = Array.from(new Set(list.filter(i => i.product_serial_id && i.product_id).map(i => i.product_id as string)))
    for (const pid of productIds) {
      const { count } = await sb
        .from('product_serials')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('product_id', pid)
        .eq('status', 'available')
      await sb.from('products').update({ stock_qty: count ?? 0 }).eq('id', pid).eq('tenant_id', tenantId)
    }
  }

  // 4. Pra itens SEM IMEI: stock_movement entrada (restaura estoque)
  const nonSerialItems = list.filter(i => i.product_id && !i.product_serial_id)
  if (nonSerialItems.length > 0) {
    const movs = nonSerialItems.map(item => ({
      tenant_id:  tenantId,
      product_id: item.product_id as string,
      type:       'entrada',
      quantity:   item.quantity,
      origin:     `sale-return:${v.saleId}`,
      notes:      `Devolução da venda #${v.saleId.slice(0, 8)} — ${v.reason.slice(0, 100)}`,
    }))
    await sb.from('stock_movements').insert(movs)
  }

  // 5. Estorna crediário: cancela plano + parcelas pendentes (paid fica histórico)
  const { data: plan } = await sb
    .from('installment_plans')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('sale_id', v.saleId)
    .eq('status', 'active')
    .maybeSingle()

  if (plan) {
    await sb
      .from('installment_plans')
      .update({ status: 'cancelled' })
      .eq('id', plan.id)
      .eq('tenant_id', tenantId)

    await sb
      .from('installments')
      .update({ status: 'cancelled' })
      .eq('plan_id', plan.id)
      .in('status', ['pending', 'late'])
  }

  revalidatePath('/financeiro')
  revalidatePath('/financeiro/parcelas')
  revalidatePath('/estoque')
  for (const sid of serialIds) {
    revalidatePath(`/imei/${sid}`)
  }

  return { ok: true, data: { saleId: v.saleId } }
}
