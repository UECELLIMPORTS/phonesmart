'use server'

/**
 * Sprint 3 — Ordens de Serviço (assistência técnica + garantia por IMEI).
 *
 * - findSaleByImei: busca venda original do aparelho dado um IMEI (pra validar garantia)
 * - createServiceOrder: abre OS
 * - updateServiceOrder: atualiza status/diagnóstico/peças
 * - listServiceOrders: lista OS com filtro por status
 * - getServiceOrder: detalhes de uma OS
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type ServiceOrderStatus = 'open' | 'in_progress' | 'ready' | 'delivered' | 'rejected'

export type ServiceOrderRow = {
  id:                 string
  osNumber:           string
  productSerialId:    string | null
  saleItemId:         string | null
  customerId:         string | null
  customerName:       string | null
  customerWhatsapp:   string | null
  serial:             string | null         // do FK product_serials OU serial_text
  productName:        string | null
  deviceDescription:  string | null
  defectDescription:  string
  diagnosis:          string | null
  status:             ServiceOrderStatus
  warrantyUsed:       boolean
  costCents:          number
  serviceCostCents:   number
  technicianName:     string | null
  estimatedReadyAt:   string | null
  openedAt:           string
  closedAt:           string | null
  notes:              string | null
}

// ──────────────────────────────────────────────────────────────────────────
// findSaleByImei — dado IMEI, retorna venda + cliente + status garantia
// ──────────────────────────────────────────────────────────────────────────

export type SaleByImeiResult = {
  serialId:        string
  serial:          string
  productId:       string
  productName:     string
  status:          'available' | 'sold' | 'returned' | 'defective'
  // Quando vendido:
  saleId:          string | null
  saleItemId:      string | null
  saleDate:        string | null
  customerId:      string | null
  customerName:    string | null
  customerWhatsapp: string | null
  warrantyDays:    number      // efetivo (product.warranty_days OR tenant.warranty_days OR 90)
  warrantyExpiresAt: string | null  // ISO; null se nunca vendido
  warrantyValid:   boolean     // true se vendido + dentro do prazo
}

export async function findSaleByImei(imei: string): Promise<SaleByImeiResult | null> {
  const q = imei.trim().toUpperCase()
  if (q.length < 4) return null

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // 1. Acha o serial
  const { data: serial } = await sb
    .from('product_serials')
    .select(`
      id, serial, status, sale_item_id,
      products!inner(id, name, warranty_days)
    `)
    .eq('tenant_id', tenantId)
    .eq('serial', q)
    .maybeSingle()

  if (!serial) return null

  type SerialRow = {
    id: string; serial: string; status: 'available' | 'sold' | 'returned' | 'defective'
    sale_item_id: string | null
    products: { id: string; name: string; warranty_days: number | null } | null
  }
  const s = serial as SerialRow
  if (!s.products) return null

  // 2. Pega tenant.warranty_days como fallback
  const { data: tenant } = await sb
    .from('tenants').select('warranty_days').eq('id', tenantId).maybeSingle()
  const tenantWarranty = (tenant as { warranty_days: number | null } | null)?.warranty_days ?? 90
  const warrantyDays = s.products.warranty_days ?? tenantWarranty

  let saleId: string | null = null
  let saleDate: string | null = null
  let customerId: string | null = null
  let customerName: string | null = null
  let customerWhatsapp: string | null = null

  if (s.sale_item_id) {
    const { data: item } = await sb
      .from('sale_items')
      .select('sale_id, sales(id, created_at, customer_id, customers(id, full_name, whatsapp))')
      .eq('id', s.sale_item_id)
      .maybeSingle()
    type ItemRow = {
      sale_id: string
      sales: {
        id: string; created_at: string; customer_id: string | null
        customers: { id: string; full_name: string; whatsapp: string | null } | null
      } | null
    }
    const it = item as ItemRow | null
    if (it?.sales) {
      saleId = it.sales.id
      saleDate = it.sales.created_at
      customerId = it.sales.customer_id
      customerName = it.sales.customers?.full_name ?? null
      customerWhatsapp = it.sales.customers?.whatsapp ?? null
    }
  }

  let warrantyExpiresAt: string | null = null
  let warrantyValid = false
  if (saleDate) {
    const exp = new Date(new Date(saleDate).getTime() + warrantyDays * 86400000)
    warrantyExpiresAt = exp.toISOString()
    warrantyValid = exp.getTime() > Date.now()
  }

  return {
    serialId:         s.id,
    serial:           s.serial,
    productId:        s.products.id,
    productName:      s.products.name,
    status:           s.status,
    saleId,
    saleItemId:       s.sale_item_id,
    saleDate,
    customerId,
    customerName,
    customerWhatsapp,
    warrantyDays,
    warrantyExpiresAt,
    warrantyValid,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// createServiceOrder
// ──────────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  productSerialId:    z.string().uuid().optional().nullable(),
  saleItemId:         z.string().uuid().optional().nullable(),
  customerId:         z.string().uuid().optional().nullable(),
  deviceDescription:  z.string().max(200).optional().nullable(),
  serialText:         z.string().max(50).optional().nullable(),
  defectDescription:  z.string().min(3).max(500),
  warrantyUsed:       z.boolean().default(false),
  costCents:          z.number().int().min(0).default(0),
  serviceCostCents:   z.number().int().min(0).default(0),
  technicianName:     z.string().max(80).optional().nullable(),
  estimatedReadyAt:   z.string().optional().nullable(),
  notes:              z.string().max(500).optional().nullable(),
})

export async function createServiceOrder(input: unknown): Promise<Result<{ id: string; osNumber: string }>> {
  const parsed = CreateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('service_orders')
    .insert({
      tenant_id:          tenantId,
      product_serial_id:  v.productSerialId || null,
      sale_item_id:       v.saleItemId || null,
      customer_id:        v.customerId || null,
      device_description: v.deviceDescription?.trim() || null,
      serial_text:        v.serialText?.trim().toUpperCase() || null,
      defect_description: v.defectDescription.trim(),
      warranty_used:      v.warrantyUsed,
      cost_cents:         v.costCents,
      service_cost_cents: v.serviceCostCents,
      technician_name:    v.technicianName?.trim() || null,
      estimated_ready_at: v.estimatedReadyAt || null,
      notes:              v.notes?.trim() || null,
      // os_number gerado por trigger
      os_number:          '',
    })
    .select('id, os_number')
    .single()

  if (error) return { ok: false, error: error.message }

  revalidatePath('/assistencia')
  return { ok: true, data: { id: data.id, osNumber: data.os_number } }
}

// ──────────────────────────────────────────────────────────────────────────
// updateServiceOrder
// ──────────────────────────────────────────────────────────────────────────

const UpdateSchema = z.object({
  id:                 z.string().uuid(),
  status:             z.enum(['open', 'in_progress', 'ready', 'delivered', 'rejected']).optional(),
  diagnosis:          z.string().max(1000).optional().nullable(),
  defectDescription:  z.string().max(500).optional(),
  warrantyUsed:       z.boolean().optional(),
  costCents:          z.number().int().min(0).optional(),
  serviceCostCents:   z.number().int().min(0).optional(),
  technicianName:     z.string().max(80).optional().nullable(),
  estimatedReadyAt:   z.string().optional().nullable(),
  notes:              z.string().max(500).optional().nullable(),
})

export async function updateServiceOrder(input: unknown): Promise<Result> {
  const parsed = UpdateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {}
  if (v.status !== undefined)            update.status = v.status
  if (v.diagnosis !== undefined)         update.diagnosis = v.diagnosis?.trim() || null
  if (v.defectDescription !== undefined) update.defect_description = v.defectDescription.trim()
  if (v.warrantyUsed !== undefined)      update.warranty_used = v.warrantyUsed
  if (v.costCents !== undefined)         update.cost_cents = v.costCents
  if (v.serviceCostCents !== undefined)  update.service_cost_cents = v.serviceCostCents
  if (v.technicianName !== undefined)    update.technician_name = v.technicianName?.trim() || null
  if (v.estimatedReadyAt !== undefined)  update.estimated_ready_at = v.estimatedReadyAt || null
  if (v.notes !== undefined)             update.notes = v.notes?.trim() || null

  // closed_at automaticamente quando entra em delivered/rejected
  if (v.status === 'delivered' || v.status === 'rejected') {
    update.closed_at = new Date().toISOString()
  } else if (v.status === 'open' || v.status === 'in_progress' || v.status === 'ready') {
    update.closed_at = null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('service_orders')
    .update(update)
    .eq('id', v.id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }

  // WhatsApp post_service: notifica cliente que aparelho está pronto/entregue
  if (v.status === 'delivered') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sbAny = supabase as any
    const { data: os } = await sbAny
      .from('service_orders')
      .select(`
        os_number, customer_id, device_description,
        product_serials:product_serial_id (serial, products(name))
      `)
      .eq('id', v.id)
      .maybeSingle()
    type OsRow = {
      os_number: string; customer_id: string | null; device_description: string | null
      product_serials: { serial: string; products: { name: string } | null } | null
    }
    const o = os as OsRow | null
    if (o?.customer_id) {
      const aparelho = o.product_serials?.products?.name ?? o.device_description ?? 'seu aparelho'
      const { scheduleWhatsAppMessage } = await import('@/lib/whatsapp-scheduler')
      await scheduleWhatsAppMessage({
        tenantId,
        type:        'post_service',
        customerId:  o.customer_id,
        referenceId: v.id,
        vars:        { aparelho, os_numero: o.os_number },
      }).catch(() => null)
    }
  }

  revalidatePath('/assistencia')
  revalidatePath(`/assistencia/${v.id}`)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// listServiceOrders
// ──────────────────────────────────────────────────────────────────────────

export async function listServiceOrders(statusFilter?: ServiceOrderStatus | 'all'): Promise<ServiceOrderRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let q = sb
    .from('service_orders')
    .select(`
      id, os_number, product_serial_id, sale_item_id, customer_id,
      device_description, serial_text, defect_description, diagnosis, status,
      warranty_used, cost_cents, service_cost_cents, technician_name,
      estimated_ready_at, opened_at, closed_at, notes,
      product_serials:product_serial_id (serial, products(name)),
      customers:customer_id (full_name, whatsapp)
    `)
    .eq('tenant_id', tenantId)
    .order('opened_at', { ascending: false })
    .limit(200)

  if (statusFilter && statusFilter !== 'all') {
    q = q.eq('status', statusFilter)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)

  type Row = {
    id: string; os_number: string; product_serial_id: string | null; sale_item_id: string | null
    customer_id: string | null; device_description: string | null; serial_text: string | null
    defect_description: string; diagnosis: string | null; status: ServiceOrderStatus
    warranty_used: boolean; cost_cents: number; service_cost_cents: number
    technician_name: string | null; estimated_ready_at: string | null
    opened_at: string; closed_at: string | null; notes: string | null
    product_serials: { serial: string; products: { name: string } | null } | null
    customers: { full_name: string; whatsapp: string | null } | null
  }

  return ((data ?? []) as Row[]).map(r => ({
    id:                r.id,
    osNumber:          r.os_number,
    productSerialId:   r.product_serial_id,
    saleItemId:        r.sale_item_id,
    customerId:        r.customer_id,
    customerName:      r.customers?.full_name ?? null,
    customerWhatsapp:  r.customers?.whatsapp ?? null,
    serial:            r.product_serials?.serial ?? r.serial_text ?? null,
    productName:       r.product_serials?.products?.name ?? null,
    deviceDescription: r.device_description,
    defectDescription: r.defect_description,
    diagnosis:         r.diagnosis,
    status:            r.status,
    warrantyUsed:      r.warranty_used,
    costCents:         r.cost_cents,
    serviceCostCents:  r.service_cost_cents,
    technicianName:    r.technician_name,
    estimatedReadyAt:  r.estimated_ready_at,
    openedAt:          r.opened_at,
    closedAt:          r.closed_at,
    notes:             r.notes,
  }))
}

// ──────────────────────────────────────────────────────────────────────────
// getServiceOrder — detalhes
// ──────────────────────────────────────────────────────────────────────────

export async function getServiceOrder(id: string): Promise<ServiceOrderRow | null> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('service_orders')
    .select(`
      id, os_number, product_serial_id, sale_item_id, customer_id,
      device_description, serial_text, defect_description, diagnosis, status,
      warranty_used, cost_cents, service_cost_cents, technician_name,
      estimated_ready_at, opened_at, closed_at, notes,
      product_serials:product_serial_id (serial, products(name)),
      customers:customer_id (full_name, whatsapp)
    `)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()

  if (!data) return null

  type Row = {
    id: string; os_number: string; product_serial_id: string | null; sale_item_id: string | null
    customer_id: string | null; device_description: string | null; serial_text: string | null
    defect_description: string; diagnosis: string | null; status: ServiceOrderStatus
    warranty_used: boolean; cost_cents: number; service_cost_cents: number
    technician_name: string | null; estimated_ready_at: string | null
    opened_at: string; closed_at: string | null; notes: string | null
    product_serials: { serial: string; products: { name: string } | null } | null
    customers: { full_name: string; whatsapp: string | null } | null
  }
  const r = data as Row
  return {
    id:                r.id,
    osNumber:          r.os_number,
    productSerialId:   r.product_serial_id,
    saleItemId:        r.sale_item_id,
    customerId:        r.customer_id,
    customerName:      r.customers?.full_name ?? null,
    customerWhatsapp:  r.customers?.whatsapp ?? null,
    serial:            r.product_serials?.serial ?? r.serial_text ?? null,
    productName:       r.product_serials?.products?.name ?? null,
    deviceDescription: r.device_description,
    defectDescription: r.defect_description,
    diagnosis:         r.diagnosis,
    status:            r.status,
    warrantyUsed:      r.warranty_used,
    costCents:         r.cost_cents,
    serviceCostCents:  r.service_cost_cents,
    technicianName:    r.technician_name,
    estimatedReadyAt:  r.estimated_ready_at,
    openedAt:          r.opened_at,
    closedAt:          r.closed_at,
    notes:             r.notes,
  }
}
