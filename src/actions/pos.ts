'use server'

import { after } from 'next/server'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { tryAutoEmitNfceForSale } from '@/lib/fiscal-emit-core'

// ── Types ─────────────────────────────────────────────────────────────────────

export type Product = {
  id: string
  code: string | null
  name: string
  price_cents: number
  stock_qty: number | null
  source: 'products' | 'parts_catalog'
}

export type Customer = {
  id: string
  full_name: string
  cpf_cnpj: string | null
  whatsapp: string | null
  email: string | null
  origin: string | null
  campaign_code: string | null
}

export type CreateCustomerInput = {
  name: string; tradeName: string; personType: string
  cpf: string; ieRg: string; isActive: boolean
  whatsapp: string; phone: string; email: string; nfeEmail: string; website: string
  birthDate: string; gender: string; maritalStatus: string; profession: string
  fatherName: string; fatherCpf: string; motherName: string; motherCpf: string
  salesperson: string; contactType: string; creditLimitStr: string
  notes: string
  cep: string; addressStreet: string; addressDistrict: string
  addressNumber: string; addressComplement: string
  addressCity: string; addressState: string
  origin?: string
  campaignCode?: string
}

export type UpdateCustomerInput = CreateCustomerInput & { id: string; clienteSince?: string }

export type SaleItem = {
  productId: string | null
  source?: 'products' | 'parts_catalog'
  name: string
  quantity: number
  unitPriceCents: number
  subtotalCents: number
}

export type CreateSaleInput = {
  customerId: string | null
  subtotalCents: number
  discountCents: number
  shippingCents: number
  totalCents: number
  paymentMethod: 'cash' | 'pix' | 'card' | 'mixed'
  paymentDetails: Record<string, number> | null
  items: SaleItem[]
  saleChannel?: string | null   // whatsapp | instagram_dm | delivery_online | fisica_balcao | fisica_retirada | outro
  deliveryType?: string | null  // counter | pickup | shipping
  customerOrigin?: string | null // sobrepõe customer.origin (usado pra Consumidor Final)
}

// ── Actions ───────────────────────────────────────────────────────────────────

export async function searchProducts(query: string): Promise<Product[]> {
  if (!query || query.trim().length < 2) return []

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const q = query.trim()

  const [productsRes, partsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, code, name, price_cents, stock_qty')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
      .order('name')
      .limit(8),
    supabase
      .from('parts_catalog')
      .select('id, sku, name, cost_cents')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .ilike('name', `%${q}%`)
      .order('name')
      .limit(8),
  ])

  const products: Product[] = (productsRes.data ?? []).map(p => ({
    id:          p.id,
    code:        p.code ?? null,
    name:        p.name,
    price_cents: p.price_cents,
    stock_qty:   p.stock_qty,
    source:      'products' as const,
  }))

  const parts: Product[] = (partsRes.data ?? []).map(p => ({
    id:          p.id,
    code:        p.sku ?? null,
    name:        p.name,
    price_cents: p.cost_cents,
    stock_qty:   null,
    source:      'parts_catalog' as const,
  }))

  return [...products, ...parts].slice(0, 12)
}

export async function searchCustomers(query: string): Promise<Customer[]> {
  if (!query || query.trim().length < 2) return []

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const q      = query.trim()
  const digits = q.replace(/\D/g, '')

  const filters: string[] = [`full_name.ilike.%${q}%`]
  if (digits.length >= 8) filters.push(`whatsapp.ilike.%${digits}%`)
  if (digits.length === 11) filters.push(`cpf_cnpj.eq.${digits}`)

  const { data } = await supabase
    .from('customers')
    .select('id, full_name, cpf_cnpj, whatsapp, email, origin, campaign_code')
    .eq('tenant_id', tenantId)
    .or(filters.join(','))
    .order('full_name')
    .limit(6)

  return (data ?? []) as Customer[]
}

export async function getOrCreateConsumidorFinal(): Promise<Customer> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data: existing } = await supabase
    .from('customers')
    .select('id, full_name, cpf_cnpj, whatsapp, email, origin, campaign_code')
    .eq('tenant_id', tenantId)
    .eq('full_name', 'Consumidor Final')
    .is('cpf_cnpj', null)
    .limit(1)

  if (existing && existing.length > 0) return existing[0] as Customer

  const { data, error } = await supabase
    .from('customers')
    .insert({ tenant_id: tenantId, full_name: 'Consumidor Final' })
    .select('id, full_name, cpf_cnpj, whatsapp, email, origin, campaign_code')
    .single()

  if (error) throw new Error(error.message)
  return data as Customer
}

export type CustomerResult =
  | { ok: true;  customer: Customer }
  | { ok: false; error: string }

export async function createCustomer(input: CreateCustomerInput): Promise<CustomerResult> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // Duplicate CPF check (returns error result em vez de throw — Next 16 mascara
  // throw em produção e mostra mensagem genérica "Server Components render")
  const cpfDigits = input.cpf.replace(/\D/g, '')
  if (cpfDigits) {
    const { data: dups } = await supabase
      .from('customers')
      .select('full_name')
      .eq('tenant_id', tenantId)
      .eq('cpf_cnpj', cpfDigits)
      .limit(1)
    if (dups && dups.length > 0) return { ok: false, error: `CPF já cadastrado para: ${dups[0].full_name}` }
  }

  // Duplicate WhatsApp check
  const whatsDigits = input.whatsapp.replace(/\D/g, '')
  if (whatsDigits) {
    const { data: dups } = await supabase
      .from('customers')
      .select('full_name')
      .eq('tenant_id', tenantId)
      .eq('whatsapp', whatsDigits)
      .limit(1)
    if (dups && dups.length > 0) return { ok: false, error: `WhatsApp já cadastrado para: ${dups[0].full_name}` }
  }

  const creditCents = Math.round(parseFloat(input.creditLimitStr.replace(',', '.') || '0') * 100) || 0

  const { data, error } = await supabase
    .from('customers')
    .insert({
      tenant_id:           tenantId,
      full_name:           input.name.trim(),
      trade_name:          input.tradeName.trim() || null,
      person_type:         input.personType || 'fisica',
      cpf_cnpj:            cpfDigits || null,
      ie_rg:               input.ieRg.trim() || null,
      is_active:           input.isActive,
      whatsapp:            whatsDigits || null,
      phone:               input.phone.replace(/\D/g, '') || null,
      email:               input.email.trim() || null,
      nfe_email:           input.nfeEmail.trim() || null,
      website:             input.website.trim() || null,
      birth_date:          input.birthDate || null,
      gender:              input.gender || null,
      marital_status:      input.maritalStatus || null,
      profession:          input.profession.trim() || null,
      father_name:         input.fatherName.trim() || null,
      father_cpf:          input.fatherCpf.replace(/\D/g, '') || null,
      mother_name:         input.motherName.trim() || null,
      mother_cpf:          input.motherCpf.replace(/\D/g, '') || null,
      salesperson:         input.salesperson.trim() || null,
      contact_type:        input.contactType || null,
      credit_limit_cents:  creditCents,
      notes:               input.notes.trim() || null,
      address_zip:         input.cep.replace(/\D/g, '') || null,
      address_street:      input.addressStreet.trim() || null,
      address_district:    input.addressDistrict.trim() || null,
      address_number:      input.addressNumber.trim() || null,
      address_complement:  input.addressComplement.trim() || null,
      address_city:        input.addressCity.trim() || null,
      address_state:       input.addressState.trim() || null,
      origin:              input.origin || null,
      campaign_code:       input.campaignCode?.trim() || null,
    })
    .select('id, full_name, cpf_cnpj, whatsapp, email, origin, campaign_code')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, customer: data as Customer }
}

export async function updateCustomer(input: UpdateCustomerInput): Promise<CustomerResult> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const cpfDigits   = input.cpf.replace(/\D/g, '')
  const whatsDigits = input.whatsapp.replace(/\D/g, '')

  // Duplicate CPF check (exclude self)
  if (cpfDigits) {
    const { data: dups } = await supabase
      .from('customers')
      .select('full_name')
      .eq('tenant_id', tenantId)
      .eq('cpf_cnpj', cpfDigits)
      .neq('id', input.id)
      .limit(1)
    if (dups && dups.length > 0) return { ok: false, error: `CPF já cadastrado para: ${dups[0].full_name}` }
  }

  // Duplicate WhatsApp check (exclude self)
  if (whatsDigits) {
    const { data: dups } = await supabase
      .from('customers')
      .select('full_name')
      .eq('tenant_id', tenantId)
      .eq('whatsapp', whatsDigits)
      .neq('id', input.id)
      .limit(1)
    if (dups && dups.length > 0) return { ok: false, error: `WhatsApp já cadastrado para: ${dups[0].full_name}` }
  }

  const creditCents = Math.round(parseFloat(input.creditLimitStr.replace(',', '.') || '0') * 100) || 0

  const { data, error } = await supabase
    .from('customers')
    .update({
      full_name:           input.name.trim(),
      trade_name:          input.tradeName.trim() || null,
      person_type:         input.personType || 'fisica',
      cpf_cnpj:            cpfDigits || null,
      ie_rg:               input.ieRg.trim() || null,
      is_active:           input.isActive,
      whatsapp:            whatsDigits || null,
      phone:               input.phone.replace(/\D/g, '') || null,
      email:               input.email.trim() || null,
      nfe_email:           input.nfeEmail.trim() || null,
      website:             input.website.trim() || null,
      birth_date:          input.birthDate || null,
      gender:              input.gender || null,
      marital_status:      input.maritalStatus || null,
      profession:          input.profession.trim() || null,
      father_name:         input.fatherName.trim() || null,
      father_cpf:          input.fatherCpf.replace(/\D/g, '') || null,
      mother_name:         input.motherName.trim() || null,
      mother_cpf:          input.motherCpf.replace(/\D/g, '') || null,
      salesperson:         input.salesperson.trim() || null,
      contact_type:        input.contactType || null,
      credit_limit_cents:  creditCents,
      notes:               input.notes.trim() || null,
      address_zip:         input.cep.replace(/\D/g, '') || null,
      address_street:      input.addressStreet.trim() || null,
      address_district:    input.addressDistrict.trim() || null,
      address_number:      input.addressNumber.trim() || null,
      address_complement:  input.addressComplement.trim() || null,
      address_city:        input.addressCity.trim() || null,
      address_state:       input.addressState.trim() || null,
      origin:              input.origin || null,
      campaign_code:       input.campaignCode?.trim() || null,
      ...(input.clienteSince ? { created_at: input.clienteSince + 'T00:00:00.000Z' } : {}),
    })
    .eq('id', input.id)
    .eq('tenant_id', tenantId)
    .select('id, full_name, cpf_cnpj, whatsapp, email, origin, campaign_code')
    .single()

  if (error) return { ok: false, error: error.message }
  return { ok: true, customer: data as Customer }
}

export async function updateCustomerCampaignCode(id: string, code: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const trimmed = code.trim().toUpperCase().slice(0, 40)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('customers')
    .update({ campaign_code: trimmed || null })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)
  return { ok: true }
}

export async function listUsedCampaignCodes(): Promise<string[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('customers')
    .select('campaign_code')
    .eq('tenant_id', tenantId)
    .not('campaign_code', 'is', null)
    .limit(500)

  const codes = new Set<string>()
  for (const row of (data ?? []) as { campaign_code: string }[]) {
    if (row.campaign_code) codes.add(row.campaign_code)
  }
  return [...codes].sort()
}

export async function updateCustomerOrigin(id: string, origin: string): Promise<Customer> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data, error } = await supabase
    .from('customers')
    .update({ origin: origin || null })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, full_name, cpf_cnpj, whatsapp, email, origin, campaign_code')
    .single()

  if (error) throw new Error(error.message)
  return data as Customer
}

export async function createSale(input: CreateSaleInput): Promise<{ id: string }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // Pega sessão de caixa aberta (se houver) pra associar a venda. Se caixa
  // fechado, a venda fica com cash_session_id=null — POS UI já bloqueia
  // vender com caixa fechado, então normalmente isso não acontece.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: activeSession } = await sb
    .from('cash_sessions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .maybeSingle()

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .insert({
      tenant_id:       tenantId,
      user_id:         user.id,
      customer_id:     input.customerId,
      subtotal_cents:  input.subtotalCents,
      discount_cents:  input.discountCents,
      shipping_cents:  input.shippingCents,
      total_cents:     input.totalCents,
      payment_method:  input.paymentMethod,
      payment_details: input.paymentDetails,
      sale_channel:    input.saleChannel  ?? null,
      delivery_type:   input.deliveryType ?? null,
      customer_origin: input.customerOrigin ?? null,
      cash_session_id: activeSession?.id ?? null,
    })
    .select('id')
    .single()

  if (saleError) throw new Error(saleError.message)

  // Busca o custo atual de cada produto pra gravar snapshot no sale_item.
  // Preserva o lucro dessa venda mesmo se o cost_cents do produto mudar depois.
  const productIds = input.items.filter(i => i.productId).map(i => i.productId as string)
  const costMap = new Map<string, number>()
  if (productIds.length > 0) {
    const [prodRes, partRes] = await Promise.all([
      supabase.from('products').select('id, cost_cents').in('id', productIds),
      supabase.from('parts_catalog').select('id, cost_cents').in('id', productIds),
    ])
    for (const p of (prodRes.data ?? []) as { id: string; cost_cents: number }[]) costMap.set(p.id, p.cost_cents ?? 0)
    for (const p of (partRes.data ?? []) as { id: string; cost_cents: number }[]) costMap.set(p.id, p.cost_cents ?? 0)
  }

  const { error: itemsError } = await supabase
    .from('sale_items')
    .insert(
      input.items.map(item => ({
        sale_id:             sale.id,
        product_id:          item.productId,
        name:                item.name,
        quantity:            item.quantity,
        unit_price_cents:    item.unitPriceCents,
        subtotal_cents:      item.subtotalCents,
        cost_snapshot_cents: item.productId ? (costMap.get(item.productId) ?? null) : null,
      })),
    )

  if (itemsError) throw new Error(itemsError.message)

  // Registrar saída de estoque como stock_movement (a trigger
  // trg_sync_product_after_movement decrementa products.stock_qty
  // automaticamente). Isso mantém o histórico de movimentações
  // coerente com o saldo do produto.
  const stockItems = input.items.filter(i => i.productId && i.source === 'products')
  if (stockItems.length > 0) {
    const { error: movError } = await supabase.from('stock_movements').insert(
      stockItems.map(item => ({
        tenant_id:        tenantId,
        product_id:       item.productId as string,
        type:             'saida',
        quantity:         item.quantity,
        sale_price_cents: item.unitPriceCents,
        origin:           `sale:${sale.id}`,
        notes:            `Venda PDV #${sale.id.slice(0, 8)}`,
      })),
    )
    if (movError) throw new Error(`Erro ao registrar saída de estoque: ${movError.message}`)
  }

  // Modo automático de NFC-e: dispara emissão depois da resposta voltar pro
  // cliente (after()). Se config.emission_mode !== 'automatic' ou !enabled,
  // tryAutoEmitNfceForSale retorna sem fazer nada. Erros são logados, não
  // jogados — venda já foi gravada e PDV não pode travar por falha fiscal.
  after(() => tryAutoEmitNfceForSale(tenantId, sale.id))

  return sale as { id: string }
}
