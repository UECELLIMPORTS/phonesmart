'use server'

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProductFormat    = 'simples' | 'variacoes' | 'kit' | 'servico'
export type ProductCondition = 'novo' | 'usado' | 'recondicionado'

export type ProductRow = {
  id: string
  code: string | null
  name: string
  brand: string | null
  category: string | null
  format: ProductFormat
  condition: ProductCondition
  gtin: string | null
  weight_g: number | null
  gross_weight_g: number | null
  height_cm: number | null
  width_cm: number | null
  depth_cm: number | null
  purchase_price_cents: number
  cost_cents: number
  price_cents: number
  unit: string
  stock_qty: number
  stock_min: number
  stock_max: number
  location: string | null
  supplier: string | null
  image_urls: string[]
  description: string | null
  active: boolean
  // Fiscais
  ncm: string | null
  cfop: string | null
  cst_csosn: string | null
  origem: string | null
  unidade?: string | null
  // Garantia (override do tenants.warranty_days)
  warranty_days: number | null
  created_at: string
  updated_at: string
}

export type ProductInput = {
  code: string
  name: string
  brand: string
  category: string
  format: ProductFormat
  condition: ProductCondition
  gtin: string
  weightG: number | null
  grossWeightG: number | null
  heightCm: number | null
  widthCm: number | null
  depthCm: number | null
  purchasePriceCents: number
  costCents: number
  priceCents: number
  unit: string
  stockQty: number
  stockMin: number
  stockMax: number
  location: string
  supplier: string
  imageUrls: string[]
  description: string
  active: boolean
  // Campos fiscais (NF-e/NFC-e)
  ncm?: string         // 8 dígitos (ex: 85171231 = celular)
  cfop?: string        // 4 dígitos (ex: 5102 venda merc.)
  cstCsosn?: string    // CSOSN (Simples) ou CST (Normal)
  origem?: string      // 0=nacional, 1=importação direta, etc
  // Garantia em dias (sobrepõe o padrão do tenant). NULL = usa padrão.
  warrantyDays?: number | null
}

// Colunas para a listagem (tabela) — sem campos pesados que só o modal usa
const LIST_COLS = `id, code, name, brand, category, format, condition,
  purchase_price_cents, cost_cents, price_cents, unit,
  stock_qty, stock_min, stock_max, location,
  supplier, image_urls, active, gtin, created_at, updated_at`

// Colunas completas — usadas no modal de edição/clone
const SELECT_COLS = `id, code, name, brand, category, format, condition, gtin,
  weight_g, gross_weight_g, height_cm, width_cm, depth_cm,
  purchase_price_cents, cost_cents, price_cents, unit,
  stock_qty, stock_min, stock_max, location,
  supplier, image_urls, description, active,
  ncm, cfop, cst_csosn, origem, warranty_days,
  created_at, updated_at`

// ── Params for paginated list ─────────────────────────────────────────────────

export type ListParams = {
  search?:   string
  brand?:    string
  category?: string
  active?:   'all' | 'active' | 'inactive'
  page?:     number
  pageSize?: number
}

// ── List + brands + categories (initial page load) ────────────────────────────

export async function listProductsWithMeta(): Promise<{
  products:   ProductRow[]
  total:      number
  brands:     string[]
  categories: string[]
}> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const [productsRes, brandsRes, catsRes] = await Promise.all([
    supabase
      .from('products')
      .select(LIST_COLS, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('name')
      .range(0, 99),
    supabase.from('products').select('brand').eq('tenant_id', tenantId).not('brand', 'is', null),
    supabase.from('products').select('category').eq('tenant_id', tenantId).not('category', 'is', null),
  ])

  if (productsRes.error) throw new Error(productsRes.error.message)

  const products   = (productsRes.data ?? []) as unknown as ProductRow[]
  const total      = productsRes.count ?? 0
  const brands     = [...new Set((brandsRes.data ?? []).map(r => r.brand as string))].sort()
  const categories = [...new Set((catsRes.data ?? []).map(r => r.category as string))].sort()

  return { products, total, brands, categories }
}

// ── Client-side pagination (sem brands/categories) ────────────────────────────

export async function fetchProductsPage(params: ListParams): Promise<{
  products: ProductRow[]
  total:    number
}> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const page     = params.page ?? 0
  const pageSize = params.pageSize ?? 100
  const offset   = page * pageSize

  let query = supabase
    .from('products')
    .select(LIST_COLS, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('name')
    .range(offset, offset + pageSize - 1)

  if (params.search?.trim()) {
    const s = params.search.trim()
    query = query.or(`name.ilike.%${s}%,code.ilike.%${s}%,brand.ilike.%${s}%`)
  }
  if (params.brand)                 query = query.eq('brand', params.brand)
  if (params.category)              query = query.eq('category', params.category)
  if (params.active === 'active')   query = query.eq('active', true)
  if (params.active === 'inactive') query = query.eq('active', false)

  const { data, count, error } = await query
  if (error) throw new Error(error.message)
  return {
    products: (data ?? []) as unknown as ProductRow[],
    total:    count ?? 0,
  }
}

// ── Get single product by ID ──────────────────────────────────────────────────

export async function getProductById(id: string): Promise<ProductRow | null> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data, error } = await supabase
    .from('products')
    .select(SELECT_COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as unknown as ProductRow | null
}

// ── List (standalone, usado por outros módulos) ───────────────────────────────

export async function listProducts(): Promise<ProductRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data, error } = await supabase
    .from('products')
    .select(LIST_COLS)
    .eq('tenant_id', tenantId)
    .order('name')
    .range(0, 999)

  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ProductRow[]
}

// ── Brands autocomplete ───────────────────────────────────────────────────────

export async function listBrands(): Promise<string[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data } = await supabase
    .from('products').select('brand').eq('tenant_id', tenantId).not('brand', 'is', null)

  return [...new Set((data ?? []).map(r => r.brand as string))].sort()
}

// ── Categories autocomplete ───────────────────────────────────────────────────

export async function listCategories(): Promise<string[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data } = await supabase
    .from('products').select('category').eq('tenant_id', tenantId).not('category', 'is', null)

  return [...new Set((data ?? []).map(r => r.category as string))].sort()
}

// ── helpers ───────────────────────────────────────────────────────────────────

function toPayload(input: ProductInput, tenantId?: string) {
  const base = {
    code:                 input.code.trim() || null,
    name:                 input.name.trim(),
    brand:                input.brand.trim() || null,
    category:             input.category.trim() || null,
    format:               input.format,
    condition:            input.condition,
    gtin:                 input.gtin.trim() || null,
    weight_g:             input.weightG ?? null,
    gross_weight_g:       input.grossWeightG ?? null,
    height_cm:            input.heightCm ?? null,
    width_cm:             input.widthCm ?? null,
    depth_cm:             input.depthCm ?? null,
    purchase_price_cents: input.purchasePriceCents,
    cost_cents:           input.costCents,
    price_cents:          input.priceCents,
    unit:                 input.unit || 'Un',
    stock_qty:            input.stockQty,
    stock_min:            input.stockMin,
    stock_max:            input.stockMax,
    location:             input.location.trim() || null,
    supplier:             input.supplier.trim() || null,
    image_urls:           input.imageUrls,
    description:          input.description.trim() || null,
    active:               input.active,
    // Campos fiscais (Fase 2.2 NF-e)
    ncm:                  input.ncm?.replace(/\D/g, '') || null,
    cfop:                 input.cfop?.replace(/\D/g, '') || null,
    cst_csosn:            input.cstCsosn?.trim() || null,
    origem:               input.origem || '0',
    // Garantia (Fase 3 — comprovante)
    warranty_days:        (input.warrantyDays != null && Number.isFinite(input.warrantyDays))
                            ? Math.max(0, Math.min(3650, Math.round(input.warrantyDays)))
                            : null,
    updated_at:           new Date().toISOString(),
  }
  if (tenantId) return { ...base, tenant_id: tenantId }
  return base
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createProduct(input: ProductInput): Promise<ProductRow> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (!input.name.trim()) throw new Error('Nome do produto é obrigatório.')

  const { data, error } = await supabase
    .from('products')
    .insert(toPayload(input, tenantId))
    .select(SELECT_COLS)
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
  return data as unknown as ProductRow
}

// ── Update ────────────────────────────────────────────────────────────────────

export async function updateProduct(id: string, input: ProductInput): Promise<ProductRow> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (!input.name.trim()) throw new Error('Nome do produto é obrigatório.')

  const { data, error } = await supabase
    .from('products')
    .update(toPayload(input))
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(SELECT_COLS)
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
  revalidatePath('/erp-clientes')
  revalidatePath('/financeiro')
  return data as unknown as ProductRow
}

// ── Update price only (inline edit) ──────────────────────────────────────────

export async function updateProductPrice(id: string, priceCents: number): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { error } = await supabase
    .from('products')
    .update({ price_cents: priceCents, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
  revalidatePath('/erp-clientes')
}

// ── Clone product ─────────────────────────────────────────────────────────────

export async function cloneProduct(id: string): Promise<ProductRow> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: original, error: fetchErr } = await supabase
    .from('products')
    .select(SELECT_COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (fetchErr || !original) throw new Error('Produto não encontrado.')

  const p = original as unknown as ProductRow

  const { data, error } = await supabase
    .from('products')
    .insert({
      tenant_id:            tenantId,
      code:                 p.code ? `${p.code}-COPIA` : null,
      name:                 `${p.name} (Cópia)`,
      brand:                p.brand,
      category:             p.category,
      format:               p.format,
      condition:            p.condition,
      gtin:                 null,
      weight_g:             p.weight_g,
      gross_weight_g:       p.gross_weight_g,
      height_cm:            p.height_cm,
      width_cm:             p.width_cm,
      depth_cm:             p.depth_cm,
      purchase_price_cents: p.purchase_price_cents,
      cost_cents:           p.cost_cents,
      price_cents:          p.price_cents,
      unit:                 p.unit,
      stock_qty:            0,
      stock_min:            p.stock_min,
      stock_max:            p.stock_max,
      location:             p.location,
      supplier:             p.supplier,
      image_urls:           p.image_urls,
      description:          p.description,
      active:               false,
    })
    .select(SELECT_COLS)
    .single()

  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
  return data as unknown as ProductRow
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteProduct(id: string): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
}

// ── Adjust stock ──────────────────────────────────────────────────────────────

export async function adjustStock(id: string, newQty: number): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { error } = await supabase
    .from('products')
    .update({ stock_qty: Math.max(0, newQty), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
}

// ── Bulk import (upsert) ──────────────────────────────────────────────────────

export async function importProducts(
  rows: ProductInput[]
): Promise<{ created: number; updated: number; errors: number }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: existing } = await supabase
    .from('products')
    .select('id, code, name')
    .eq('tenant_id', tenantId)

  const byCode = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const p of existing ?? []) {
    if (p.code) byCode.set(p.code.trim().toLowerCase(), p.id)
    byName.set(p.name.trim().toLowerCase(), p.id)
  }

  let created = 0, updated = 0, errors = 0

  for (const row of rows) {
    const name = row.name.trim()
    const code = row.code.trim()
    if (!name) { errors++; continue }

    const payload = toPayload(row, tenantId)
    const existingId =
      (code && byCode.get(code.toLowerCase())) ||
      byName.get(name.toLowerCase())

    if (existingId) {
      const { error } = await supabase.from('products').update(payload).eq('id', existingId).eq('tenant_id', tenantId)
      if (error) errors++; else updated++
    } else {
      const { error } = await supabase.from('products').insert({ ...payload, image_urls: [] })
      if (error) errors++
      else {
        created++
        if (code) byCode.set(code.toLowerCase(), 'new')
        byName.set(name.toLowerCase(), 'new')
      }
    }
  }

  revalidatePath('/estoque')
  return { created, updated, errors }
}

// ── Remove duplicates ─────────────────────────────────────────────────────────

export async function removeDuplicateProducts(): Promise<{ removed: number }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data } = await supabase
    .from('products')
    .select('id, code, name, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })

  if (!data || data.length === 0) return { removed: 0 }

  const seen = new Map<string, string>()
  const toDelete: string[] = []

  for (const p of data) {
    const key = p.code
      ? `code:${p.code.trim().toLowerCase()}`
      : `name:${p.name.trim().toLowerCase()}`
    if (seen.has(key)) toDelete.push(p.id)
    else seen.set(key, p.id)
  }

  if (toDelete.length === 0) return { removed: 0 }

  const { error } = await supabase.from('products').delete().in('id', toDelete).eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
  return { removed: toDelete.length }
}

// ── Toggle active ─────────────────────────────────────────────────────────────

export async function toggleProductActive(id: string, active: boolean): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { error } = await supabase
    .from('products')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  revalidatePath('/estoque')
}
