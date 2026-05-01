/**
 * Busca todos os dados necessários pra renderizar o PDF do recibo de compra
 * de aparelho usado (Termo de Cessão).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import type { AcquisitionReceiptData } from '@/lib/acquisition-receipt-pdf'

type SerialRow = {
  id:                    string
  serial:                string
  serial_2:              string | null
  manufacturer_sn:       string | null
  cost_cents:            number | null
  acquired_at:           string | null
  acquired_from_type:    'customer' | 'supplier' | 'trade_in' | 'other' | null
  acquired_customer_id:  string | null
  supplier_id:           string | null
  supplier_name:         string | null
  condition:             'A' | 'B' | 'C' | 'defective' | null
  payment_method:        string | null
  notes:                 string | null
  products: {
    id:           string
    name:         string
    code:         string | null
  } | null
  customers: {
    full_name:        string
    cpf_cnpj:         string | null
    ie_rg:            string | null
    whatsapp:         string | null
    email:            string | null
    address_zip:      string | null
    address_street:   string | null
    address_number:   string | null
    address_complement: string | null
    address_district: string | null
    address_city:     string | null
    address_state:    string | null
  } | null
  suppliers: {
    name:           string
    trade_name:     string | null
    cpf_cnpj:       string | null
    contact_name:   string | null
    whatsapp:       string | null
    email:          string | null
    address_zip:    string | null
    address_street: string | null
    address_number: string | null
    address_district: string | null
    address_city:   string | null
    address_state:  string | null
  } | null
}

type TenantRow = {
  name:             string
  cpf_cnpj:         string | null
  logo_url:         string | null
  business_phone:   string | null
  business_email:   string | null
  instagram_handle: string | null
}

type FiscalCfgRow = {
  inscricao_estadual:   string | null
  endereco_logradouro:  string | null
  endereco_numero:      string | null
  endereco_bairro:      string | null
  endereco_cidade:      string | null
  endereco_uf:          string | null
  endereco_cep:         string | null
}

export async function getAcquisitionReceiptData(
  tenantId: string,
  serialId: string,
): Promise<AcquisitionReceiptData | null> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const [serialRes, tenantRes, fiscalRes] = await Promise.all([
    sb.from('product_serials')
      .select(`
        id, serial, serial_2, manufacturer_sn, cost_cents,
        acquired_at, acquired_from_type, acquired_customer_id,
        supplier_id, supplier_name, condition, payment_method, notes,
        products!inner(id, name, code),
        customers:acquired_customer_id (
          full_name, cpf_cnpj, ie_rg, whatsapp, email,
          address_zip, address_street, address_number, address_complement,
          address_district, address_city, address_state
        ),
        suppliers:supplier_id (
          name, trade_name, cpf_cnpj, contact_name, whatsapp, email,
          address_zip, address_street, address_number,
          address_district, address_city, address_state
        )
      `)
      .eq('id', serialId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    sb.from('tenants')
      .select('name, cpf_cnpj, logo_url, business_phone, business_email, instagram_handle')
      .eq('id', tenantId)
      .maybeSingle(),
    sb.from('fiscal_configs')
      .select('inscricao_estadual, endereco_logradouro, endereco_numero, endereco_bairro, endereco_cidade, endereco_uf, endereco_cep')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  const s      = serialRes.data as SerialRow | null
  const tenant = tenantRes.data as TenantRow | null
  const fiscal = fiscalRes.data as FiscalCfgRow | null

  if (!s || !tenant || !s.products) return null
  // Recibo só faz sentido pra aparelhos que foram adquiridos (tem dados de aquisição)
  if (!s.acquired_at || !s.acquired_from_type) return null

  const cepFmt = fiscal?.endereco_cep
    ? fiscal.endereco_cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')
    : null

  // Determina os dados do "Cedente" (quem vendeu pra loja)
  let seller: AcquisitionReceiptData['seller']
  if (s.acquired_from_type === 'customer' && s.customers) {
    const c = s.customers
    seller = {
      kind:       'customer',
      name:       c.full_name,
      cpfCnpj:    c.cpf_cnpj,
      ieRg:       c.ie_rg,
      whatsapp:   c.whatsapp,
      email:      c.email,
      addressZip:    c.address_zip,
      addressStreet: c.address_street,
      addressNumber: c.address_number,
      addressComplement: c.address_complement,
      addressDistrict: c.address_district,
      addressCity:   c.address_city,
      addressState:  c.address_state,
    }
  } else if (s.acquired_from_type === 'supplier' && s.suppliers) {
    const sp = s.suppliers
    seller = {
      kind:       'supplier',
      name:       sp.trade_name || sp.name,
      cpfCnpj:    sp.cpf_cnpj,
      ieRg:       null,
      whatsapp:   sp.whatsapp,
      email:      sp.email,
      contactName: sp.contact_name,
      addressZip:    sp.address_zip,
      addressStreet: sp.address_street,
      addressNumber: sp.address_number,
      addressComplement: null,
      addressDistrict: sp.address_district,
      addressCity:   sp.address_city,
      addressState:  sp.address_state,
    }
  } else {
    // trade_in / other → usa supplier_name texto livre legado
    seller = {
      kind:       s.acquired_from_type ?? 'other',
      name:       s.supplier_name ?? 'Não informado',
      cpfCnpj:    null,
      ieRg:       null,
      whatsapp:   null,
      email:      null,
      addressZip: null, addressStreet: null, addressNumber: null,
      addressComplement: null, addressDistrict: null, addressCity: null, addressState: null,
    }
  }

  const acqShortId = s.id.slice(0, 8).toUpperCase()
  const receiptNumber = `REC-${acqShortId}`

  return {
    receiptNumber,
    acquiredAt: s.acquired_at,

    tenant: {
      name:             tenant.name,
      cnpj:             tenant.cpf_cnpj,
      ie:               fiscal?.inscricao_estadual ?? null,
      addressStreet:    fiscal?.endereco_logradouro ?? null,
      addressNumber:    fiscal?.endereco_numero ?? null,
      addressDistrict:  fiscal?.endereco_bairro ?? null,
      addressCity:      fiscal?.endereco_cidade ?? null,
      addressState:     fiscal?.endereco_uf ?? null,
      addressZip:       cepFmt,
      phone:            tenant.business_phone,
      email:            tenant.business_email,
      logoUrl:          tenant.logo_url,
    },

    seller,

    device: {
      productName:     s.products.name,
      productCode:     s.products.code,
      serial:          s.serial,
      serial2:         s.serial_2,
      manufacturerSn:  s.manufacturer_sn,
      condition:       s.condition,
      notes:           s.notes,
    },

    payment: {
      amountCents: s.cost_cents ?? 0,
      method:      s.payment_method,
    },
  }
}
