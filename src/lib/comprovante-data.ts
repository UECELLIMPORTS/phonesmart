/**
 * Busca todos os dados necessários pra renderizar o PDF de comprovante.
 * Usado tanto pela rota privada (/api/financeiro/comprovante/[id]) quanto
 * pela rota pública (/api/comprovante-publico/[token]).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { ComprovanteData, ComprovanteItem } from '@/lib/comprovante-pdf'

type SaleRow = {
  id: string
  user_id: string | null
  total_cents: number
  subtotal_cents: number
  discount_cents: number
  shipping_cents: number
  payment_method: string | null
  sale_channel: string | null
  delivery_type: string | null
  created_at: string
  customers: { full_name: string; cpf_cnpj: string | null; whatsapp: string | null; email: string | null } | null
  sale_items: { name: string; product_id: string | null; quantity: number; unit_price_cents: number; subtotal_cents: number }[]
}

type TenantRow = {
  id: string
  name: string
  cpf_cnpj: string | null
  warranty_days: number | null
  logo_url: string | null
  warranty_terms: string | null
  business_phone: string | null
  business_email: string | null
  instagram_handle: string | null
}

type FiscalCfgRow = {
  inscricao_estadual: string | null
  endereco_logradouro: string | null
  endereco_numero: string | null
  endereco_bairro: string | null
  endereco_cidade: string | null
  endereco_uf: string | null
  endereco_cep: string | null
}

export async function getComprovanteData(
  tenantId: string,
  saleId: string,
  observation?: string,
): Promise<ComprovanteData | null> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const [saleRes, tenantRes, fiscalRes] = await Promise.all([
    sb.from('sales')
      .select(`
        id, user_id, total_cents, subtotal_cents, discount_cents, shipping_cents,
        payment_method, sale_channel, delivery_type, created_at,
        customers ( full_name, cpf_cnpj, whatsapp, email ),
        sale_items ( name, product_id, quantity, unit_price_cents, subtotal_cents )
      `)
      .eq('id', saleId)
      .eq('tenant_id', tenantId)
      .single(),
    sb.from('tenants')
      .select('id, name, cpf_cnpj, warranty_days, logo_url, warranty_terms, business_phone, business_email, instagram_handle')
      .eq('id', tenantId)
      .single(),
    sb.from('fiscal_configs')
      .select('inscricao_estadual, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  const sale   = saleRes.data as SaleRow | null
  const tenant = tenantRes.data as TenantRow | null
  const fiscal = fiscalRes.data as FiscalCfgRow | null

  if (!sale || !tenant) return null

  const productIds = sale.sale_items.map(i => i.product_id).filter(Boolean) as string[]
  const warrantyMap = new Map<string, number | null>()
  if (productIds.length > 0) {
    const { data: prods } = await sb
      .from('products')
      .select('id, warranty_days')
      .in('id', productIds)
    for (const p of (prods ?? []) as { id: string; warranty_days: number | null }[]) {
      warrantyMap.set(p.id, p.warranty_days)
    }
  }

  // Vendedor: busca user_metadata.full_name de quem operou a venda
  let sellerName: string | null = null
  if (sale.user_id) {
    try {
      const { data: userRes } = await sb.auth.admin.getUserById(sale.user_id)
      const u = userRes?.user
      sellerName = (u?.user_metadata?.full_name as string | undefined)
                ?? (u?.email ? u.email.split('@')[0] : null)
    } catch { /* swallow — vendedor é opcional */ }
  }

  const defaultWarranty = tenant.warranty_days ?? 90

  const items: ComprovanteItem[] = sale.sale_items.map(it => ({
    name:           it.name,
    quantity:       it.quantity,
    unitPriceCents: it.unit_price_cents,
    subtotalCents:  it.subtotal_cents,
    warrantyDays:   (it.product_id ? warrantyMap.get(it.product_id) : null) ?? defaultWarranty,
  }))

  const saleNumber = `VND-${sale.id.slice(0, 8).toUpperCase()}`

  // CEP formatado: 49000000 → 49000-000
  const cepFmt = fiscal?.endereco_cep
    ? fiscal.endereco_cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')
    : null

  return {
    saleId:         sale.id,
    saleNumber,
    saleDate:       sale.created_at,
    paymentMethod:  sale.payment_method,
    saleChannel:    sale.sale_channel,
    deliveryType:   sale.delivery_type,
    sellerName,
    observation,

    tenant: {
      name:             tenant.name,
      tradeName:        null,
      cnpj:             tenant.cpf_cnpj,
      ie:               fiscal?.inscricao_estadual,
      addressStreet:    fiscal?.endereco_logradouro,
      addressNumber:    fiscal?.endereco_numero,
      addressDistrict:  fiscal?.endereco_bairro,
      addressCity:      fiscal?.endereco_cidade,
      addressState:     fiscal?.endereco_uf,
      addressZip:       cepFmt,
      phone:            tenant.business_phone,
      email:            tenant.business_email,
      instagram:        tenant.instagram_handle,
      logoUrl:          tenant.logo_url,
      warrantyTerms:    tenant.warranty_terms,
    },

    customer: {
      name:    sale.customers?.full_name || 'Consumidor Final',
      cpfCnpj: sale.customers?.cpf_cnpj ?? null,
      phone:   sale.customers?.whatsapp ?? null,
      email:   sale.customers?.email   ?? null,
    },

    items,
    subtotalCents:  sale.subtotal_cents,
    discountCents:  sale.discount_cents,
    shippingCents:  sale.shipping_cents,
    totalCents:     sale.total_cents,

    defaultWarrantyDays: defaultWarranty,
  }
}
