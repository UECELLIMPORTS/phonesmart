'use server'

/**
 * Server Actions de IMEI/Serial tracking pra produtos (lojas de celular).
 *
 * - listSerials: lista IMEIs cadastrados de um produto (filtro por status)
 * - addSerials: adiciona N IMEIs de uma vez (parsing tolerante)
 * - updateSerial: edita IMEI específico (status, notas, custo)
 * - deleteSerial: apaga IMEI (só se status='available' — vendido não apaga)
 * - findBySerial: busca rápida por IMEI no PDV (autocomplete via barcode)
 * - countAvailableSerials: contador rápido pro estoque mostrar quantos IMEIs sobram
 * - markSerialSold / markSerialReturned: helpers usados pelo createSale
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type ProductSerial = {
  id:               string
  productId:        string
  serial:           string
  serial2:          string | null
  manufacturerSn:   string | null
  status:           'available' | 'sold' | 'returned' | 'defective'
  saleItemId:       string | null
  soldAt:           string | null
  costCents:        number | null
  notes:            string | null
  createdAt:        string
  // Sprint 2: dados de aquisição (compra de aparelho usado)
  acquiredAt?:        string | null
  acquiredFromType?:  'customer' | 'supplier' | 'trade_in' | 'other' | null
  acquiredCustomerId?: string | null
  supplierName?:      string | null
  condition?:         'A' | 'B' | 'C' | 'defective' | null
  paymentMethod?:     'cash' | 'pix' | 'transfer' | 'card' | 'trade_in_credit' | 'mixed' | null
  tradeInSaleId?:     string | null
}

export type AcquireDeviceInput = {
  productId:          string
  serial:             string
  serial2?:           string | null
  manufacturerSn?:    string | null
  costCents:          number
  condition:          'A' | 'B' | 'C' | 'defective'
  acquiredFromType:   'customer' | 'supplier' | 'trade_in' | 'other'
  acquiredCustomerId?: string | null
  supplierName?:      string | null
  paymentMethod?:     'cash' | 'pix' | 'transfer' | 'card' | 'trade_in_credit' | 'mixed' | null
  tradeInSaleId?:     string | null
  notes?:             string | null
  acquiredAt?:        string  // ISO; default = now()
}

// ──────────────────────────────────────────────────────────────────────────
// List
// ──────────────────────────────────────────────────────────────────────────

export async function listSerials(productId: string, statusFilter?: ProductSerial['status'] | 'all'): Promise<ProductSerial[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let q = sb
    .from('product_serials')
    .select('id, product_id, serial, serial_2, manufacturer_sn, status, sale_item_id, sold_at, cost_cents, notes, created_at')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(2000)

  if (statusFilter && statusFilter !== 'all') {
    q = q.eq('status', statusFilter)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)

  type Row = {
    id: string; product_id: string; serial: string; serial_2: string | null
    manufacturer_sn: string | null; status: ProductSerial['status']
    sale_item_id: string | null; sold_at: string | null
    cost_cents: number | null; notes: string | null; created_at: string
  }
  return ((data ?? []) as Row[]).map(r => ({
    id:             r.id,
    productId:      r.product_id,
    serial:         r.serial,
    serial2:        r.serial_2,
    manufacturerSn: r.manufacturer_sn,
    status:         r.status,
    saleItemId:     r.sale_item_id,
    soldAt:         r.sold_at,
    costCents:      r.cost_cents,
    notes:          r.notes,
    createdAt:      r.created_at,
  }))
}

// ──────────────────────────────────────────────────────────────────────────
// Add — aceita lista de IMEIs (1 por linha ou separados por espaço/vírgula)
// ──────────────────────────────────────────────────────────────────────────

const AddSchema = z.object({
  productId:  z.string().uuid(),
  serials:    z.array(z.string().min(4).max(50)).min(1).max(200),
  costCents:  z.number().int().min(0).optional().nullable(),
  notes:      z.string().max(500).optional().nullable(),
})

export async function addSerials(input: unknown): Promise<Result<{ added: number; duplicates: string[] }>> {
  const parsed = AddSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Confere se produto pertence ao tenant
  const { data: prod } = await sb
    .from('products').select('id').eq('id', v.productId).eq('tenant_id', tenantId).maybeSingle()
  if (!prod) return { ok: false, error: 'Produto não encontrado.' }

  // Normaliza: trim + uppercase + remove duplicatas no input
  const cleaned = Array.from(new Set(v.serials.map(s => s.trim().toUpperCase()).filter(Boolean)))
  if (cleaned.length === 0) return { ok: false, error: 'Nenhum IMEI válido pra adicionar.' }

  // Checa quais já existem no banco (mesmo tenant)
  const { data: existing } = await sb
    .from('product_serials')
    .select('serial')
    .eq('tenant_id', tenantId)
    .in('serial', cleaned)
  const existingSet = new Set(((existing ?? []) as { serial: string }[]).map(r => r.serial))
  const duplicates = cleaned.filter(s => existingSet.has(s))
  const novos = cleaned.filter(s => !existingSet.has(s))

  if (novos.length === 0) {
    return { ok: false, error: `Todos os ${cleaned.length} IMEIs já estão cadastrados (qualquer produto deste tenant).` }
  }

  const rows = novos.map(serial => ({
    tenant_id:   tenantId,
    product_id:  v.productId,
    serial,
    cost_cents:  v.costCents ?? null,
    notes:       v.notes?.trim() || null,
    status:      'available',
  }))

  const { error } = await sb.from('product_serials').insert(rows)
  if (error) return { ok: false, error: error.message }

  // Atualiza stock_qty do produto pra refletir o número de serials disponíveis
  await syncStockQtyFromSerials(tenantId, v.productId, sb)

  revalidatePath('/estoque')
  revalidatePath(`/estoque/${v.productId}`)
  return { ok: true, data: { added: novos.length, duplicates } }
}

// ──────────────────────────────────────────────────────────────────────────
// Update — editar status/custo/notas de um serial
// ──────────────────────────────────────────────────────────────────────────

const UpdateSchema = z.object({
  id:        z.string().uuid(),
  serial:    z.string().min(4).max(50).optional(),
  serial2:   z.string().max(50).optional().nullable(),
  manufacturerSn: z.string().max(50).optional().nullable(),
  status:    z.enum(['available', 'sold', 'returned', 'defective']).optional(),
  costCents: z.number().int().min(0).optional().nullable(),
  notes:     z.string().max(500).optional().nullable(),
})

export async function updateSerial(input: unknown): Promise<Result> {
  const parsed = UpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Pega product_id antes de atualizar (pra resync stock depois)
  const { data: existing } = await sb
    .from('product_serials').select('product_id').eq('id', v.id).eq('tenant_id', tenantId).maybeSingle()
  if (!existing) return { ok: false, error: 'IMEI não encontrado.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {}
  if (v.serial !== undefined)         update.serial = v.serial.trim().toUpperCase()
  if (v.serial2 !== undefined)        update.serial_2 = v.serial2?.trim().toUpperCase() || null
  if (v.manufacturerSn !== undefined) update.manufacturer_sn = v.manufacturerSn?.trim() || null
  if (v.status !== undefined)         update.status = v.status
  if (v.costCents !== undefined)      update.cost_cents = v.costCents
  if (v.notes !== undefined)          update.notes = v.notes?.trim() || null

  const { error } = await sb
    .from('product_serials')
    .update(update)
    .eq('id', v.id)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  await syncStockQtyFromSerials(tenantId, existing.product_id, sb)
  revalidatePath('/estoque')
  revalidatePath(`/estoque/${existing.product_id}`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// Delete — só permite apagar serials available (não vendidos)
// ──────────────────────────────────────────────────────────────────────────

export async function deleteSerial(id: string): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: existing } = await sb
    .from('product_serials').select('product_id, status').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!existing) return { ok: false, error: 'IMEI não encontrado.' }
  if (existing.status === 'sold') {
    return { ok: false, error: 'Não dá pra apagar IMEI vendido. Mude o status pra "devolvido" se necessário.' }
  }

  const { error } = await sb
    .from('product_serials').delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }

  await syncStockQtyFromSerials(tenantId, existing.product_id, sb)
  revalidatePath('/estoque')
  revalidatePath(`/estoque/${existing.product_id}`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// acquireDevice — registra compra de aparelho usado (cria serial + dados de aquisição)
// ──────────────────────────────────────────────────────────────────────────

const AcquireSchema = z.object({
  productId:          z.string().uuid(),
  serial:             z.string().min(4).max(50),
  serial2:            z.string().max(50).optional().nullable(),
  manufacturerSn:     z.string().max(50).optional().nullable(),
  costCents:          z.number().int().min(0),
  condition:          z.enum(['A', 'B', 'C', 'defective']),
  acquiredFromType:   z.enum(['customer', 'supplier', 'trade_in', 'other']),
  acquiredCustomerId: z.string().uuid().optional().nullable(),
  supplierName:       z.string().max(120).optional().nullable(),
  paymentMethod:      z.enum(['cash', 'pix', 'transfer', 'card', 'trade_in_credit', 'mixed']).optional().nullable(),
  tradeInSaleId:      z.string().uuid().optional().nullable(),
  notes:              z.string().max(500).optional().nullable(),
  acquiredAt:         z.string().optional(),
})

export async function acquireDevice(input: unknown): Promise<Result<{ serialId: string }>> {
  const parsed = AcquireSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Confere produto e força track_serials=true (se compra de usado, faz sentido rastrear)
  const { data: prod } = await sb
    .from('products').select('id, track_serials').eq('id', v.productId).eq('tenant_id', tenantId).maybeSingle()
  if (!prod) return { ok: false, error: 'Produto não encontrado.' }
  if (!prod.track_serials) {
    await sb.from('products').update({ track_serials: true }).eq('id', v.productId).eq('tenant_id', tenantId)
  }

  const serialUpper = v.serial.trim().toUpperCase()

  // Checa duplicata
  const { data: dup } = await sb
    .from('product_serials').select('id').eq('tenant_id', tenantId).eq('serial', serialUpper).maybeSingle()
  if (dup) return { ok: false, error: `IMEI ${serialUpper} já cadastrado.` }

  const { data: created, error } = await sb
    .from('product_serials')
    .insert({
      tenant_id:            tenantId,
      product_id:           v.productId,
      serial:               serialUpper,
      serial_2:             v.serial2?.trim().toUpperCase() || null,
      manufacturer_sn:      v.manufacturerSn?.trim() || null,
      status:               'available',
      cost_cents:           v.costCents,
      notes:                v.notes?.trim() || null,
      acquired_at:          v.acquiredAt || new Date().toISOString(),
      acquired_from_type:   v.acquiredFromType,
      acquired_customer_id: v.acquiredCustomerId || null,
      supplier_name:        v.supplierName?.trim() || null,
      condition:            v.condition,
      payment_method:       v.paymentMethod || null,
      trade_in_sale_id:     v.tradeInSaleId || null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  await syncStockQtyFromSerials(tenantId, v.productId, sb)

  revalidatePath('/estoque')
  revalidatePath(`/estoque/${v.productId}`)
  revalidatePath('/comprar')
  return { ok: true, data: { serialId: (created as { id: string }).id } }
}

// ──────────────────────────────────────────────────────────────────────────
// listAcquisitions — lista compras de aparelhos (Sprint 2)
// ──────────────────────────────────────────────────────────────────────────

export type AcquisitionRow = {
  serialId:           string
  serial:             string
  productId:          string
  productName:        string
  costCents:          number
  status:             ProductSerial['status']
  condition:          'A' | 'B' | 'C' | 'defective' | null
  acquiredAt:         string | null
  acquiredFromType:   'customer' | 'supplier' | 'trade_in' | 'other' | null
  acquiredCustomerId: string | null
  customerName:       string | null
  supplierName:       string | null
  paymentMethod:      string | null
  notes:              string | null
}

export async function listAcquisitions(limit = 100): Promise<AcquisitionRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('product_serials')
    .select(`
      id, serial, status, cost_cents, condition, acquired_at, acquired_from_type,
      acquired_customer_id, supplier_name, payment_method, notes,
      products!inner(id, name),
      customers:acquired_customer_id (full_name)
    `)
    .eq('tenant_id', tenantId)
    .not('acquired_at', 'is', null)
    .order('acquired_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  type Row = {
    id: string; serial: string; status: ProductSerial['status']; cost_cents: number | null
    condition: 'A' | 'B' | 'C' | 'defective' | null; acquired_at: string | null
    acquired_from_type: 'customer' | 'supplier' | 'trade_in' | 'other' | null
    acquired_customer_id: string | null; supplier_name: string | null
    payment_method: string | null; notes: string | null
    products: { id: string; name: string } | null
    customers: { full_name: string } | null
  }

  return ((data ?? []) as Row[])
    .filter(r => r.products)
    .map(r => ({
      serialId:           r.id,
      serial:             r.serial,
      productId:          r.products!.id,
      productName:        r.products!.name,
      costCents:          r.cost_cents ?? 0,
      status:             r.status,
      condition:          r.condition,
      acquiredAt:         r.acquired_at,
      acquiredFromType:   r.acquired_from_type,
      acquiredCustomerId: r.acquired_customer_id,
      customerName:       r.customers?.full_name ?? null,
      supplierName:       r.supplier_name,
      paymentMethod:      r.payment_method,
      notes:              r.notes,
    }))
}

// ──────────────────────────────────────────────────────────────────────────
// getDeviceProfit — comprou por X, vendeu por Y, lucro Z
// ──────────────────────────────────────────────────────────────────────────

export type DeviceProfit = {
  acquired:   { costCents: number; at: string | null } | null
  sold:       { priceCents: number; at: string | null; saleId: string | null } | null
  profitCents: number | null
}

export async function getDeviceProfit(serialId: string): Promise<DeviceProfit> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: serial } = await sb
    .from('product_serials')
    .select('cost_cents, acquired_at, sale_item_id')
    .eq('id', serialId).eq('tenant_id', tenantId).maybeSingle()

  if (!serial) return { acquired: null, sold: null, profitCents: null }

  type SerialRow = { cost_cents: number | null; acquired_at: string | null; sale_item_id: string | null }
  const s = serial as SerialRow
  const acquired = { costCents: s.cost_cents ?? 0, at: s.acquired_at }

  let sold: DeviceProfit['sold'] = null
  if (s.sale_item_id) {
    const { data: item } = await sb
      .from('sale_items')
      .select('unit_price_cents, sale_id, sales(created_at)')
      .eq('id', s.sale_item_id)
      .maybeSingle()
    type ItemRow = { unit_price_cents: number; sale_id: string; sales: { created_at: string } | null }
    if (item) {
      const it = item as ItemRow
      sold = { priceCents: it.unit_price_cents, at: it.sales?.created_at ?? null, saleId: it.sale_id }
    }
  }

  const profitCents = sold ? sold.priceCents - acquired.costCents : null
  return { acquired, sold, profitCents }
}

// ──────────────────────────────────────────────────────────────────────────
// getDeviceHistory — Sprint 6: linha do tempo completa do IMEI
// ──────────────────────────────────────────────────────────────────────────

export type TimelineEvent =
  | { type: 'acquired';     at: string; title: string; description: string; amountCents?: number; meta?: Record<string, string | null> }
  | { type: 'sold';         at: string; title: string; description: string; amountCents?: number; meta?: Record<string, string | null> }
  | { type: 'returned';     at: string; title: string; description: string }
  | { type: 'service';      at: string; title: string; description: string; amountCents?: number; meta?: Record<string, string | null> }
  | { type: 'status_change'; at: string; title: string; description: string }

export type DeviceHistory = {
  serial:      string
  productName: string
  productId:   string
  status:      'available' | 'sold' | 'returned' | 'defective'
  costCents:   number | null
  notes:       string | null
  // Métricas calculadas
  acquired:    { at: string | null; costCents: number; from: string | null }
  sold:        { at: string | null; priceCents: number | null; customerName: string | null; saleId: string | null } | null
  profitCents: number | null
  // Linha do tempo
  events:      TimelineEvent[]
}

export async function getDeviceHistory(serial: string): Promise<DeviceHistory | null> {
  const q = serial.trim().toUpperCase()
  if (q.length < 4) return null

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // 1. Acha o serial + produto + cliente da aquisição
  const { data: serialRow } = await sb
    .from('product_serials')
    .select(`
      id, serial, status, cost_cents, notes, created_at,
      acquired_at, acquired_from_type, supplier_name, condition, payment_method,
      sale_item_id,
      products!inner(id, name),
      customers:acquired_customer_id (full_name)
    `)
    .eq('tenant_id', tenantId)
    .eq('serial', q)
    .maybeSingle()

  if (!serialRow) return null

  type SerialFull = {
    id: string; serial: string; status: 'available' | 'sold' | 'returned' | 'defective'
    cost_cents: number | null; notes: string | null; created_at: string
    acquired_at: string | null; acquired_from_type: string | null
    supplier_name: string | null; condition: string | null; payment_method: string | null
    sale_item_id: string | null
    products: { id: string; name: string } | null
    customers: { full_name: string } | null
  }
  const s = serialRow as SerialFull
  if (!s.products) return null

  const events: TimelineEvent[] = []

  // 2. Aquisição
  const fromLabel =
    s.acquired_from_type === 'customer' ? (s.customers?.full_name ? `Cliente: ${s.customers.full_name}` : 'Cliente')
    : s.acquired_from_type === 'supplier' ? (s.supplier_name ? `Fornecedor: ${s.supplier_name}` : 'Fornecedor')
    : s.acquired_from_type === 'trade_in' ? 'Troca'
    : s.acquired_from_type === 'other' ? 'Outro' : null

  events.push({
    type:        'acquired',
    at:          s.acquired_at ?? s.created_at,
    title:       'Cadastrado no estoque',
    description: fromLabel ?? 'Origem não informada',
    amountCents: s.cost_cents ?? undefined,
    meta:        {
      'Condição':    s.condition,
      'Pagamento':   s.payment_method,
    },
  })

  // 3. Venda (se sale_item_id)
  let soldAt: string | null = null
  let soldPrice: number | null = null
  let soldCustomerName: string | null = null
  let saleId: string | null = null

  if (s.sale_item_id) {
    const { data: item } = await sb
      .from('sale_items')
      .select('sale_id, unit_price_cents, sales(id, created_at, customer_id, customers(full_name, whatsapp))')
      .eq('id', s.sale_item_id)
      .maybeSingle()
    type ItemRow = {
      sale_id: string; unit_price_cents: number
      sales: {
        id: string; created_at: string; customer_id: string | null
        customers: { full_name: string; whatsapp: string | null } | null
      } | null
    }
    const it = item as ItemRow | null
    if (it?.sales) {
      soldAt = it.sales.created_at
      soldPrice = it.unit_price_cents
      soldCustomerName = it.sales.customers?.full_name ?? null
      saleId = it.sales.id
      events.push({
        type:        'sold',
        at:          it.sales.created_at,
        title:       'Vendido',
        description: soldCustomerName ? `Cliente: ${soldCustomerName}` : 'Cliente não identificado',
        amountCents: it.unit_price_cents,
        meta:        {
          'WhatsApp': it.sales.customers?.whatsapp ?? null,
        },
      })
    }
  }

  // 4. Mudança de status (devolvido/defeito) — usa updated_at se status diferente de sold/available
  if (s.status === 'returned') {
    events.push({
      type:        'returned',
      at:          s.created_at,  // best effort; não temos histórico de mudança
      title:       'Devolvido',
      description: 'Aparelho devolvido pelo cliente.',
    })
  } else if (s.status === 'defective') {
    events.push({
      type:        'status_change',
      at:          s.created_at,
      title:       'Marcado como defeito',
      description: 'Aparelho não pode ser vendido.',
    })
  }

  // 5. Ordens de serviço vinculadas
  const { data: osRows } = await sb
    .from('service_orders')
    .select('id, os_number, opened_at, closed_at, status, defect_description, diagnosis, cost_cents, warranty_used, technician_name')
    .eq('tenant_id', tenantId)
    .eq('product_serial_id', s.id)
    .order('opened_at', { ascending: true })

  type OsRow = {
    id: string; os_number: string; opened_at: string; closed_at: string | null
    status: string; defect_description: string; diagnosis: string | null
    cost_cents: number; warranty_used: boolean; technician_name: string | null
  }
  for (const os of (osRows ?? []) as OsRow[]) {
    events.push({
      type:        'service',
      at:          os.opened_at,
      title:       `OS ${os.os_number} — ${os.status}`,
      description: os.defect_description,
      amountCents: os.cost_cents > 0 ? os.cost_cents : undefined,
      meta:        {
        'Técnico':      os.technician_name,
        'Garantia':     os.warranty_used ? 'Sim' : 'Não',
        'Diagnóstico':  os.diagnosis,
        'Encerrada em': os.closed_at,
      },
    })
  }

  // Ordena cronológico
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const acquiredCost = s.cost_cents ?? 0
  const profitCents = soldPrice != null ? soldPrice - acquiredCost : null

  return {
    serial:      s.serial,
    productName: s.products.name,
    productId:   s.products.id,
    status:      s.status,
    costCents:   s.cost_cents,
    notes:       s.notes,
    acquired:    { at: s.acquired_at ?? s.created_at, costCents: acquiredCost, from: fromLabel },
    sold:        soldAt ? { at: soldAt, priceCents: soldPrice, customerName: soldCustomerName, saleId } : null,
    profitCents,
    events,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// findBySerial — busca rápida no PDV (escanear código de barras)
// ──────────────────────────────────────────────────────────────────────────

export type SerialSearchResult = {
  serialId:     string
  serialNumber: string
  status:       ProductSerial['status']
  productId:    string
  productName:  string
  productCode:  string | null
  priceCents:   number
  costCents:    number
}

export async function findBySerial(query: string): Promise<SerialSearchResult[]> {
  const q = query.trim().toUpperCase()
  if (q.length < 4) return []

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('product_serials')
    .select('id, serial, status, cost_cents, products!inner(id, name, code, price_cents)')
    .eq('tenant_id', tenantId)
    .or(`serial.ilike.%${q}%,serial_2.ilike.%${q}%`)
    .eq('status', 'available')
    .limit(10)

  type Row = {
    id: string; serial: string; status: ProductSerial['status']; cost_cents: number | null
    products: { id: string; name: string; code: string | null; price_cents: number } | null
  }
  return ((data ?? []) as Row[])
    .filter(r => r.products)
    .map(r => ({
      serialId:     r.id,
      serialNumber: r.serial,
      status:       r.status,
      productId:    r.products!.id,
      productName:  r.products!.name,
      productCode:  r.products!.code,
      priceCents:   r.products!.price_cents,
      costCents:    r.cost_cents ?? 0,
    }))
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: sync products.stock_qty com count de serials available
// ──────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncStockQtyFromSerials(tenantId: string, productId: string, sb: any): Promise<void> {
  // Só sincroniza se produto tem track_serials=true
  const { data: prod } = await sb
    .from('products').select('track_serials').eq('id', productId).eq('tenant_id', tenantId).maybeSingle()
  if (!prod?.track_serials) return

  const { count } = await sb
    .from('product_serials')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .eq('status', 'available')

  await sb
    .from('products')
    .update({ stock_qty: count ?? 0 })
    .eq('id', productId)
    .eq('tenant_id', tenantId)
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers usados pelo createSale (chamados de actions/pos.ts)
// ──────────────────────────────────────────────────────────────────────────

/** Marca um serial como vendido + vincula ao sale_item. Atomico. */
export async function markSerialSold(
  serialId: string,
  saleItemId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: serial } = await sb
    .from('product_serials')
    .select('id, status, product_id, tenant_id')
    .eq('id', serialId)
    .maybeSingle()
  if (!serial) return { ok: false, error: 'IMEI não encontrado.' }
  if (serial.status !== 'available') {
    return { ok: false, error: `IMEI já está com status "${serial.status}".` }
  }

  const { error } = await sb
    .from('product_serials')
    .update({
      status:        'sold',
      sale_item_id:  saleItemId,
      sold_at:       new Date().toISOString(),
    })
    .eq('id', serialId)
  if (error) return { ok: false, error: error.message }

  await syncStockQtyFromSerials(serial.tenant_id, serial.product_id, sb)
  return { ok: true }
}
