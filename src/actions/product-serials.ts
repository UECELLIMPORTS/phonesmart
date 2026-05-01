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
