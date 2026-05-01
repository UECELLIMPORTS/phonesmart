'use server'

/**
 * Sprint 7 — Cadastro de fornecedores.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type SupplierRow = {
  id:                string
  name:              string
  tradeName:         string | null
  cpfCnpj:           string | null
  stateReg:          string | null
  whatsapp:          string | null
  phone:             string | null
  email:             string | null
  contactName:       string | null
  addressZip:        string | null
  addressStreet:     string | null
  addressNumber:     string | null
  addressComplement: string | null
  addressDistrict:   string | null
  addressCity:       string | null
  addressState:      string | null
  category:          string | null
  notes:             string | null
  isActive:          boolean
  createdAt:         string
  // Métricas (preenchidas em listSuppliers)
  acquisitionsCount?: number
  totalAcquiredCents?: number
}

const SupplierSchema = z.object({
  id:                z.string().uuid().optional(),
  name:              z.string().min(2).max(200),
  tradeName:         z.string().max(200).optional().nullable(),
  cpfCnpj:           z.string().max(20).optional().nullable(),
  stateReg:          z.string().max(30).optional().nullable(),
  whatsapp:          z.string().max(20).optional().nullable(),
  phone:             z.string().max(20).optional().nullable(),
  email:             z.string().max(120).optional().nullable(),
  contactName:       z.string().max(120).optional().nullable(),
  addressZip:        z.string().max(10).optional().nullable(),
  addressStreet:     z.string().max(200).optional().nullable(),
  addressNumber:     z.string().max(20).optional().nullable(),
  addressComplement: z.string().max(120).optional().nullable(),
  addressDistrict:   z.string().max(120).optional().nullable(),
  addressCity:       z.string().max(120).optional().nullable(),
  addressState:      z.string().max(2).optional().nullable(),
  category:          z.string().max(40).optional().nullable(),
  notes:             z.string().max(1000).optional().nullable(),
  isActive:          z.boolean().default(true),
})

// ──────────────────────────────────────────────────────────────────────────
// listSuppliers
// ──────────────────────────────────────────────────────────────────────────

export async function listSuppliers(includeInactive = false): Promise<SupplierRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let q = sb
    .from('suppliers')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('name')
    .limit(500)

  if (!includeInactive) q = q.eq('is_active', true)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  // Carrega contagens via product_serials
  const ids = ((data ?? []) as { id: string }[]).map(s => s.id)
  const counts = new Map<string, { count: number; total: number }>()
  if (ids.length > 0) {
    const { data: serials } = await sb
      .from('product_serials')
      .select('supplier_id, cost_cents')
      .eq('tenant_id', tenantId)
      .in('supplier_id', ids)
    type SerialAgg = { supplier_id: string; cost_cents: number | null }
    for (const s of (serials ?? []) as SerialAgg[]) {
      if (!s.supplier_id) continue
      const cur = counts.get(s.supplier_id) ?? { count: 0, total: 0 }
      cur.count += 1
      cur.total += s.cost_cents ?? 0
      counts.set(s.supplier_id, cur)
    }
  }

  type Row = {
    id: string; name: string; trade_name: string | null; cpf_cnpj: string | null
    state_reg: string | null; whatsapp: string | null; phone: string | null
    email: string | null; contact_name: string | null
    address_zip: string | null; address_street: string | null; address_number: string | null
    address_complement: string | null; address_district: string | null
    address_city: string | null; address_state: string | null
    category: string | null; notes: string | null; is_active: boolean
    created_at: string
  }
  return ((data ?? []) as Row[]).map(r => {
    const m = counts.get(r.id)
    return {
      id:                r.id,
      name:              r.name,
      tradeName:         r.trade_name,
      cpfCnpj:           r.cpf_cnpj,
      stateReg:          r.state_reg,
      whatsapp:          r.whatsapp,
      phone:             r.phone,
      email:             r.email,
      contactName:       r.contact_name,
      addressZip:        r.address_zip,
      addressStreet:     r.address_street,
      addressNumber:     r.address_number,
      addressComplement: r.address_complement,
      addressDistrict:   r.address_district,
      addressCity:       r.address_city,
      addressState:      r.address_state,
      category:          r.category,
      notes:             r.notes,
      isActive:          r.is_active,
      createdAt:         r.created_at,
      acquisitionsCount: m?.count ?? 0,
      totalAcquiredCents: m?.total ?? 0,
    }
  })
}

// ──────────────────────────────────────────────────────────────────────────
// searchSuppliers — autocomplete
// ──────────────────────────────────────────────────────────────────────────

export async function searchSuppliers(query: string): Promise<SupplierRow[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('suppliers')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .or(`name.ilike.%${q}%,trade_name.ilike.%${q}%,cpf_cnpj.ilike.%${q}%`)
    .order('name')
    .limit(8)

  type Row = {
    id: string; name: string; trade_name: string | null; cpf_cnpj: string | null
    state_reg: string | null; whatsapp: string | null; phone: string | null
    email: string | null; contact_name: string | null
    address_zip: string | null; address_street: string | null; address_number: string | null
    address_complement: string | null; address_district: string | null
    address_city: string | null; address_state: string | null
    category: string | null; notes: string | null; is_active: boolean
    created_at: string
  }
  return ((data ?? []) as Row[]).map(r => ({
    id: r.id, name: r.name, tradeName: r.trade_name, cpfCnpj: r.cpf_cnpj,
    stateReg: r.state_reg, whatsapp: r.whatsapp, phone: r.phone, email: r.email,
    contactName: r.contact_name,
    addressZip: r.address_zip, addressStreet: r.address_street,
    addressNumber: r.address_number, addressComplement: r.address_complement,
    addressDistrict: r.address_district, addressCity: r.address_city, addressState: r.address_state,
    category: r.category, notes: r.notes, isActive: r.is_active, createdAt: r.created_at,
  }))
}

// ──────────────────────────────────────────────────────────────────────────
// createSupplier
// ──────────────────────────────────────────────────────────────────────────

export async function createSupplier(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = SupplierSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const cpfDigits = v.cpfCnpj?.replace(/\D/g, '') || null

  // Duplicate CPF/CNPJ check
  if (cpfDigits) {
    const { data: dup } = await sb
      .from('suppliers').select('id, name').eq('tenant_id', tenantId).eq('cpf_cnpj', cpfDigits).limit(1)
    if (dup && dup.length > 0) {
      return { ok: false, error: `CPF/CNPJ já cadastrado: ${dup[0].name}` }
    }
  }

  const { data, error } = await sb
    .from('suppliers')
    .insert({
      tenant_id:          tenantId,
      name:               v.name.trim(),
      trade_name:         v.tradeName?.trim() || null,
      cpf_cnpj:           cpfDigits,
      state_reg:          v.stateReg?.trim() || null,
      whatsapp:           v.whatsapp?.replace(/\D/g, '') || null,
      phone:              v.phone?.replace(/\D/g, '') || null,
      email:              v.email?.trim() || null,
      contact_name:       v.contactName?.trim() || null,
      address_zip:        v.addressZip?.replace(/\D/g, '') || null,
      address_street:     v.addressStreet?.trim() || null,
      address_number:     v.addressNumber?.trim() || null,
      address_complement: v.addressComplement?.trim() || null,
      address_district:   v.addressDistrict?.trim() || null,
      address_city:       v.addressCity?.trim() || null,
      address_state:      v.addressState?.trim().toUpperCase() || null,
      category:           v.category || null,
      notes:              v.notes?.trim() || null,
      is_active:          v.isActive,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  revalidatePath('/fornecedores')
  revalidatePath('/comprar')
  return { ok: true, data: { id: data.id } }
}

// ──────────────────────────────────────────────────────────────────────────
// updateSupplier
// ──────────────────────────────────────────────────────────────────────────

export async function updateSupplier(input: unknown): Promise<Result> {
  const parsed = SupplierSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  if (!parsed.data.id) return { ok: false, error: 'ID obrigatório.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data
  const cpfDigits = v.cpfCnpj?.replace(/\D/g, '') || null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  if (cpfDigits) {
    const { data: dup } = await sb
      .from('suppliers').select('id, name')
      .eq('tenant_id', tenantId).eq('cpf_cnpj', cpfDigits).neq('id', v.id!).limit(1)
    if (dup && dup.length > 0) {
      return { ok: false, error: `CPF/CNPJ já cadastrado: ${dup[0].name}` }
    }
  }

  const { error } = await sb
    .from('suppliers')
    .update({
      name:               v.name.trim(),
      trade_name:         v.tradeName?.trim() || null,
      cpf_cnpj:           cpfDigits,
      state_reg:          v.stateReg?.trim() || null,
      whatsapp:           v.whatsapp?.replace(/\D/g, '') || null,
      phone:              v.phone?.replace(/\D/g, '') || null,
      email:              v.email?.trim() || null,
      contact_name:       v.contactName?.trim() || null,
      address_zip:        v.addressZip?.replace(/\D/g, '') || null,
      address_street:     v.addressStreet?.trim() || null,
      address_number:     v.addressNumber?.trim() || null,
      address_complement: v.addressComplement?.trim() || null,
      address_district:   v.addressDistrict?.trim() || null,
      address_city:       v.addressCity?.trim() || null,
      address_state:      v.addressState?.trim().toUpperCase() || null,
      category:           v.category || null,
      notes:              v.notes?.trim() || null,
      is_active:          v.isActive,
    })
    .eq('id', v.id!)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/fornecedores')
  revalidatePath('/comprar')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// deleteSupplier — soft delete (is_active=false) preserva FK em product_serials
// ──────────────────────────────────────────────────────────────────────────

export async function deleteSupplier(id: string): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('suppliers')
    .update({ is_active: false })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/fornecedores')
  return { ok: true }
}
