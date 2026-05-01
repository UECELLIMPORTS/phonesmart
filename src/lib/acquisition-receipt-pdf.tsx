/**
 * Geração do PDF de Recibo de Compra de Aparelho Usado (Termo de Cessão).
 *
 * Renderiza com @react-pdf/renderer. 1 página com:
 *   - Cabeçalho da loja
 *   - Dados do cedente (cliente vendedor / fornecedor)
 *   - Dados do aparelho (modelo, IMEI, condição)
 *   - Valor pago + forma de pagamento
 *   - Declaração jurídica (origem lícita, não há restrição)
 *   - Espaço pra assinaturas
 */

import {
  Document, Page, Text, View, StyleSheet, Image,
  renderToBuffer,
} from '@react-pdf/renderer'
import React from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────────────────────

export type AcquisitionReceiptData = {
  receiptNumber: string         // ex: "REC-A1B2C3D4"
  acquiredAt:    string         // ISO

  tenant: {
    name:              string
    cnpj:              string | null
    ie:                string | null
    addressStreet:     string | null
    addressNumber:     string | null
    addressDistrict:   string | null
    addressCity:       string | null
    addressState:      string | null
    addressZip:        string | null
    phone:             string | null
    email:             string | null
    logoUrl:           string | null
  }

  seller: {
    kind:              'customer' | 'supplier' | 'trade_in' | 'other'
    name:              string
    cpfCnpj:           string | null
    ieRg:              string | null
    whatsapp:          string | null
    email:             string | null
    contactName?:      string | null   // só pra supplier
    addressZip:        string | null
    addressStreet:     string | null
    addressNumber:     string | null
    addressComplement: string | null
    addressDistrict:   string | null
    addressCity:       string | null
    addressState:      string | null
  }

  device: {
    productName:    string
    productCode:    string | null
    serial:         string
    serial2:        string | null
    manufacturerSn: string | null
    condition:      'A' | 'B' | 'C' | 'defective' | null
    notes:          string | null
  }

  payment: {
    amountCents: number
    method:      string | null
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date(iso))
}

function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric',
  }).format(new Date(iso))
}

function formatCpfCnpj(v: string | null): string {
  if (!v) return '—'
  const d = v.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  return v
}

function formatPhone(v: string | null): string {
  if (!v) return '—'
  const d = v.replace(/\D/g, '')
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  return v
}

function paymentLabel(method: string | null): string {
  switch (method) {
    case 'cash':            return 'Dinheiro'
    case 'pix':             return 'PIX'
    case 'transfer':        return 'Transferência bancária'
    case 'card':            return 'Cartão'
    case 'trade_in_credit': return 'Crédito de troca (abatimento em venda futura)'
    case 'mixed':           return 'Pagamento misto'
    default:                return method ?? '—'
  }
}

const CONDITION_LABEL: Record<'A' | 'B' | 'C' | 'defective', string> = {
  A:         'A — Impecável (sem marcas)',
  B:         'B — Bom (pequenos sinais de uso)',
  C:         'C — Com sinais (marcas visíveis, funcionando)',
  defective: 'Com defeito',
}

const SELLER_KIND_LABEL: Record<string, string> = {
  customer: 'Pessoa Física (Cliente)',
  supplier: 'Pessoa Jurídica (Fornecedor)',
  trade_in: 'Troca / Permuta',
  other:    'Outro',
}

function fullAddress(s: AcquisitionReceiptData['seller']): string {
  const parts = [
    s.addressStreet,
    s.addressNumber,
    s.addressComplement,
    s.addressDistrict,
    s.addressCity && s.addressState ? `${s.addressCity}/${s.addressState}` : (s.addressCity ?? s.addressState),
    s.addressZip,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '—'
}

function tenantAddress(t: AcquisitionReceiptData['tenant']): string {
  const parts = [
    t.addressStreet,
    t.addressNumber,
    t.addressDistrict,
    t.addressCity && t.addressState ? `${t.addressCity}/${t.addressState}` : (t.addressCity ?? t.addressState),
    t.addressZip,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '—'
}

// ──────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: '#1f2937',
    lineHeight: 1.45,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: '#3b82f6',
    paddingBottom: 10,
    marginBottom: 12,
  },
  storeBlock: { flex: 1 },
  storeName: { fontSize: 13, fontWeight: 'bold', color: '#1e3a8a' },
  storeMeta: { fontSize: 8, color: '#475569', marginTop: 2 },
  logo: { width: 60, height: 60, objectFit: 'contain' },
  receiptHead: { alignItems: 'flex-end' },
  receiptTitle: { fontSize: 11, fontWeight: 'bold', color: '#1e3a8a' },
  receiptNumber: { fontSize: 9, color: '#475569', marginTop: 2 },

  title: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#1e3a8a',
    marginVertical: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#1e3a8a',
    backgroundColor: '#dbeafe',
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  label: {
    width: '32%',
    fontWeight: 'bold',
    color: '#475569',
  },
  value: {
    flex: 1,
    color: '#0f172a',
  },

  paymentBox: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#86efac',
    borderRadius: 4,
    padding: 10,
    marginVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paymentLabel: { fontSize: 9, color: '#166534', fontWeight: 'bold' },
  paymentValue: { fontSize: 16, fontWeight: 'bold', color: '#15803d' },

  declaration: {
    backgroundColor: '#fafafa',
    borderLeftWidth: 3,
    borderLeftColor: '#94a3b8',
    padding: 8,
    fontSize: 8,
    lineHeight: 1.5,
    color: '#475569',
    marginTop: 8,
    textAlign: 'justify',
  },

  signatures: {
    marginTop: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 24,
  },
  signatureBlock: {
    flex: 1,
    alignItems: 'center',
  },
  signatureLine: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 4,
    marginTop: 32,
  },
  signatureLabel: {
    fontSize: 8,
    color: '#475569',
    marginTop: 2,
    fontWeight: 'bold',
  },
  signatureName: {
    fontSize: 8,
    color: '#1f2937',
  },

  footer: {
    position: 'absolute',
    left: 32, right: 32, bottom: 24,
    fontSize: 7,
    color: '#94a3b8',
    textAlign: 'center',
  },
})

// ──────────────────────────────────────────────────────────────────────────
// Document
// ──────────────────────────────────────────────────────────────────────────

function ReceiptDocument({ data }: { data: AcquisitionReceiptData }) {
  const { tenant, seller, device, payment } = data

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          {tenant.logoUrl ? (
            <Image src={tenant.logoUrl} style={styles.logo} />
          ) : null}
          <View style={styles.storeBlock}>
            <Text style={styles.storeName}>{tenant.name}</Text>
            <Text style={styles.storeMeta}>
              {tenant.cnpj ? `CNPJ ${formatCpfCnpj(tenant.cnpj)}` : ''}
              {tenant.ie ? `  ·  IE ${tenant.ie}` : ''}
            </Text>
            <Text style={styles.storeMeta}>{tenantAddress(tenant)}</Text>
            <Text style={styles.storeMeta}>
              {tenant.phone ? `Tel: ${formatPhone(tenant.phone)}` : ''}
              {tenant.phone && tenant.email ? '  ·  ' : ''}
              {tenant.email ?? ''}
            </Text>
          </View>
          <View style={styles.receiptHead}>
            <Text style={styles.receiptTitle}>RECIBO Nº {data.receiptNumber}</Text>
            <Text style={styles.receiptNumber}>Data: {formatDate(data.acquiredAt)}</Text>
          </View>
        </View>

        <Text style={styles.title}>Termo de Cessão de Aparelho Usado</Text>

        {/* Cedente */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dados do Cedente (vendedor)</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Nome / Razão Social:</Text>
            <Text style={styles.value}>{seller.name}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Tipo:</Text>
            <Text style={styles.value}>{SELLER_KIND_LABEL[seller.kind] ?? seller.kind}</Text>
          </View>
          {seller.cpfCnpj && (
            <View style={styles.row}>
              <Text style={styles.label}>CPF / CNPJ:</Text>
              <Text style={styles.value}>{formatCpfCnpj(seller.cpfCnpj)}</Text>
            </View>
          )}
          {seller.ieRg && (
            <View style={styles.row}>
              <Text style={styles.label}>RG / IE:</Text>
              <Text style={styles.value}>{seller.ieRg}</Text>
            </View>
          )}
          {seller.contactName && (
            <View style={styles.row}>
              <Text style={styles.label}>Pessoa de contato:</Text>
              <Text style={styles.value}>{seller.contactName}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Telefone / WhatsApp:</Text>
            <Text style={styles.value}>{formatPhone(seller.whatsapp)}</Text>
          </View>
          {seller.email && (
            <View style={styles.row}>
              <Text style={styles.label}>E-mail:</Text>
              <Text style={styles.value}>{seller.email}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Endereço:</Text>
            <Text style={styles.value}>{fullAddress(seller)}</Text>
          </View>
        </View>

        {/* Aparelho */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Aparelho Cedido</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Modelo / Descrição:</Text>
            <Text style={styles.value}>{device.productName}{device.productCode ? `  (Cód: ${device.productCode})` : ''}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>IMEI / Serial:</Text>
            <Text style={styles.value}>{device.serial}</Text>
          </View>
          {device.serial2 && (
            <View style={styles.row}>
              <Text style={styles.label}>IMEI 2 (dual-SIM):</Text>
              <Text style={styles.value}>{device.serial2}</Text>
            </View>
          )}
          {device.manufacturerSn && (
            <View style={styles.row}>
              <Text style={styles.label}>Nº de série do fabricante:</Text>
              <Text style={styles.value}>{device.manufacturerSn}</Text>
            </View>
          )}
          {device.condition && (
            <View style={styles.row}>
              <Text style={styles.label}>Condição:</Text>
              <Text style={styles.value}>{CONDITION_LABEL[device.condition]}</Text>
            </View>
          )}
          {device.notes && (
            <View style={styles.row}>
              <Text style={styles.label}>Observações:</Text>
              <Text style={styles.value}>{device.notes}</Text>
            </View>
          )}
        </View>

        {/* Valor */}
        <View style={styles.paymentBox}>
          <View>
            <Text style={styles.paymentLabel}>VALOR PAGO</Text>
            <Text style={{ fontSize: 8, color: '#166534', marginTop: 2 }}>
              Forma: {paymentLabel(payment.method)}
            </Text>
          </View>
          <Text style={styles.paymentValue}>{brl(payment.amountCents)}</Text>
        </View>

        {/* Declaração jurídica */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Declaração</Text>
          <Text style={styles.declaration}>
            Pelo presente instrumento, o CEDENTE acima qualificado declara, sob as penas da lei,
            ser legítimo proprietário do aparelho descrito acima, livre e desembaraçado de
            quaisquer ônus, dívidas, alienações, restrições, bloqueios ou qualquer outro tipo
            de gravame, não tendo origem em furto, roubo, apropriação indébita ou qualquer
            outro ato ilícito, assumindo total responsabilidade civil e criminal pela
            veracidade desta declaração e pela origem lícita do bem.{'\n\n'}
            O CESSIONÁRIO ({tenant.name}) recebe o aparelho mediante o pagamento do valor
            acima, ficando o CEDENTE quitado de qualquer obrigação relativa ao mesmo.{'\n\n'}
            E, por estarem assim justos e contratados, firmam o presente em{' '}
            {tenant.addressCity ?? '___________'}, {formatDateLong(data.acquiredAt)}.
          </Text>
        </View>

        {/* Assinaturas */}
        <View style={styles.signatures}>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureLine}>
              <Text style={styles.signatureLabel}>CEDENTE</Text>
              <Text style={styles.signatureName}>{seller.name}</Text>
              {seller.cpfCnpj && (
                <Text style={{ fontSize: 7, color: '#64748b' }}>CPF/CNPJ: {formatCpfCnpj(seller.cpfCnpj)}</Text>
              )}
            </View>
          </View>
          <View style={styles.signatureBlock}>
            <View style={styles.signatureLine}>
              <Text style={styles.signatureLabel}>CESSIONÁRIO</Text>
              <Text style={styles.signatureName}>{tenant.name}</Text>
              {tenant.cnpj && (
                <Text style={{ fontSize: 7, color: '#64748b' }}>CNPJ: {formatCpfCnpj(tenant.cnpj)}</Text>
              )}
            </View>
          </View>
        </View>

        <Text style={styles.footer}>
          {tenant.name} · Recibo {data.receiptNumber} · Documento gerado eletronicamente
        </Text>
      </Page>
    </Document>
  )
}

export async function renderAcquisitionReceiptPdf(data: AcquisitionReceiptData): Promise<Buffer> {
  return await renderToBuffer(<ReceiptDocument data={data} />)
}
