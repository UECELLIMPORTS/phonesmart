/**
 * Geração do PDF de Comprovante de Venda + Termo de Garantia.
 *
 * Renderiza com @react-pdf/renderer (declarativo, serverless-friendly).
 * Estrutura: 2 páginas — recibo na primeira, termo de garantia na segunda.
 */

import {
  Document, Page, Text, View, StyleSheet, Image,
  renderToBuffer,
} from '@react-pdf/renderer'
import React from 'react'

// ──────────────────────────────────────────────────────────────────────────
// Tipos do payload
// ──────────────────────────────────────────────────────────────────────────

export type ComprovanteItem = {
  name:           string
  quantity:       number
  unitPriceCents: number
  subtotalCents:  number
  warrantyDays:   number
}

export type ComprovanteData = {
  saleId:          string
  saleNumber:      string         // ex: "VND-A1B2C3"
  saleDate:        string         // ISO
  paymentMethod:   string | null
  observation?:    string         // observação manual do operador
  saleChannel?:    string | null  // whatsapp, fisica_balcao, etc
  deliveryType?:   string | null  // counter, pickup, shipping
  sellerName?:     string | null  // user_metadata.full_name de quem operou

  tenant: {
    name:              string
    tradeName?:        string | null
    cnpj:              string | null
    ie?:               string | null
    addressStreet?:    string | null
    addressNumber?:    string | null
    addressDistrict?:  string | null
    addressCity?:      string | null
    addressState?:     string | null
    addressZip?:       string | null
    phone?:            string | null
    email?:            string | null
    instagram?:        string | null
    logoUrl?:          string | null
    warrantyTerms?:    string | null
  }

  customer: {
    name:    string
    cpfCnpj: string | null
    phone:   string | null
    email:   string | null
  }

  items:          ComprovanteItem[]
  subtotalCents:  number
  discountCents:  number
  shippingCents:  number
  totalCents:     number

  defaultWarrantyDays: number
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone:  'America/Sao_Paulo',
  })
}

function formatCnpj(d: string | null | undefined): string {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 14) return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (s.length === 11) return s.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return s
}

function formatPhone(d: string | null | undefined): string {
  const s = (d ?? '').replace(/\D/g, '')
  if (s.length === 11) return s.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (s.length === 10) return s.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return s
}

function paymentLabel(method: string | null): string {
  switch ((method ?? '').toLowerCase()) {
    case 'cash':
    case 'dinheiro':       return 'Dinheiro'
    case 'pix':            return 'PIX'
    case 'card':
    case 'credito':
    case 'credit':         return 'Cartão de Crédito'
    case 'debito':
    case 'debit':          return 'Cartão de Débito'
    case 'mixed':          return 'Pagamento Misto'
    case 'boleto':         return 'Boleto'
    case 'transferencia':  return 'Transferência'
    default:               return method || '—'
  }
}

function channelLabel(c: string | null | undefined): string | null {
  switch ((c ?? '').toLowerCase()) {
    case 'whatsapp':         return 'WhatsApp'
    case 'instagram_dm':     return 'Instagram'
    case 'fisica_balcao':    return 'Loja Física (balcão)'
    case 'fisica_retirada':  return 'Loja Física (retirada)'
    case 'delivery_online':  return 'Delivery / Online'
    case 'outro':            return 'Outro'
    case '':
    case null:
    case undefined:          return null
    default:                 return c || null
  }
}

function deliveryLabel(d: string | null | undefined): string | null {
  switch ((d ?? '').toLowerCase()) {
    case 'counter':   return 'Retirada no balcão'
    case 'pickup':    return 'Retirada agendada'
    case 'shipping':  return 'Envio / entrega'
    case '':
    case null:
    case undefined:   return null
    default:          return d || null
  }
}

const DEFAULT_WARRANTY_TERMS = `O presente termo regulamenta a garantia dos produtos adquiridos conforme Lei nº 8.078/90 (Código de Defesa do Consumidor).

1. PRAZO DE GARANTIA
A garantia tem início na data de emissão deste comprovante e vigora pelo prazo indicado para cada produto, conforme a tabela acima. Para acessórios eletrônicos, o prazo padrão é de 90 (noventa) dias. Para celulares novos lacrados, 365 (trezentos e sessenta e cinco) dias. Para celulares seminovos, 90 (noventa) dias.

2. COBERTURA
A garantia cobre defeitos de fabricação detectados em uso normal do produto, conforme manual do fabricante. Inclui peças e mão de obra durante o período de garantia.

3. EXCLUSÕES
Não estão cobertos por esta garantia:
a) Danos causados por mau uso, queda, impacto, contato com líquidos ou exposição a temperaturas extremas;
b) Defeitos resultantes de tentativas de reparo por terceiros não autorizados;
c) Desgaste natural de bateria após 6 meses de uso (limitação técnica, não defeito);
d) Películas, capas, fones e demais acessórios consumíveis após 30 dias do recebimento;
e) Produtos cujo lacre original tenha sido violado pelo cliente;
f) Falhas de software causadas por instalação de aplicativos de origem desconhecida ou desbloqueio do sistema operacional.

4. EXERCÍCIO DA GARANTIA
Para exercer a garantia, o cliente deve apresentar este comprovante original e o produto na loja onde efetuou a compra. O prazo de análise técnica é de até 30 (trinta) dias corridos a partir do recebimento do produto, conforme art. 18, §1º do CDC.

5. DIREITOS DO CONSUMIDOR
Caso o defeito não seja sanado no prazo legal de 30 dias, o consumidor poderá optar entre: (i) substituição do produto por outro da mesma espécie em perfeitas condições; (ii) restituição imediata da quantia paga, monetariamente atualizada; ou (iii) abatimento proporcional do preço.

6. FORO
Fica eleito o foro da comarca onde foi efetuada a compra para dirimir quaisquer questões oriundas deste termo, com renúncia expressa a qualquer outro, por mais privilegiado que seja.

Para dúvidas sobre garantia, entre em contato com a loja pelos canais informados no cabeçalho deste comprovante.`

// ──────────────────────────────────────────────────────────────────────────
// Estilos
// ──────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    padding:    32,
    fontSize:   10,
    fontFamily: 'Helvetica',
    color:      '#0F172A',
    lineHeight: 1.5,
  },
  // Header
  header: {
    flexDirection:   'row',
    justifyContent:  'space-between',
    alignItems:      'flex-start',
    borderBottom:    '2pt solid #059669',
    paddingBottom:   12,
    marginBottom:    16,
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center' },
  logo:        { width: 60, height: 60, marginRight: 12 },
  tenantName:  { fontSize: 16, fontWeight: 'bold', color: '#064E3B' },
  tenantInfo:  { fontSize: 8, color: '#475569', marginTop: 2 },
  docTitle:    { fontSize: 14, fontWeight: 'bold', color: '#059669', textAlign: 'right' },
  docMeta:     { fontSize: 9, color: '#475569', textAlign: 'right', marginTop: 4 },
  // Sections
  section:     { marginBottom: 14 },
  sectionTitle:{ fontSize: 10, fontWeight: 'bold', color: '#059669', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  twoCol:      { flexDirection: 'row', gap: 10, marginBottom: 14 },
  colHalf:     { flex: 1 },
  row:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  label:       { color: '#64748B', fontSize: 9 },
  value:       { fontSize: 9, fontWeight: 'bold' },
  // Customer box
  box:         { backgroundColor: '#F8FAFC', padding: 10, borderRadius: 4, border: '0.5pt solid #E2E8F0' },
  // Items table
  table:       { borderTop: '1pt solid #CBD5E1', borderBottom: '1pt solid #CBD5E1' },
  tableHead:   { flexDirection: 'row', backgroundColor: '#F1F5F9', padding: 6, fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase' },
  tableRow:    { flexDirection: 'row', padding: 6, borderTop: '0.25pt solid #E2E8F0', fontSize: 9 },
  colDescr:    { flex: 4 },
  colQty:      { flex: 1, textAlign: 'center' },
  colPrice:    { flex: 1.5, textAlign: 'right' },
  colTotal:    { flex: 1.5, textAlign: 'right', fontWeight: 'bold' },
  colWarr:     { flex: 1.2, textAlign: 'center', color: '#059669' },
  // Totals
  totals:      { marginTop: 12, alignItems: 'flex-end' },
  totalRow:    { flexDirection: 'row', width: 200, justifyContent: 'space-between', paddingVertical: 2 },
  totalLabel:  { fontSize: 9, color: '#475569' },
  totalValue:  { fontSize: 9, fontWeight: 'bold' },
  totalGrand:  { fontSize: 12, color: '#059669', fontWeight: 'bold' },
  // Observation
  obsBox:      { marginTop: 14, padding: 10, backgroundColor: '#FEF9C3', borderLeft: '3pt solid #EAB308', borderRadius: 2 },
  obsLabel:    { fontSize: 8, fontWeight: 'bold', color: '#854D0E', marginBottom: 2, textTransform: 'uppercase' },
  obsText:     { fontSize: 9, color: '#422006' },
  // Footer
  footer:      { position: 'absolute', bottom: 24, left: 32, right: 32, borderTop: '0.5pt solid #E2E8F0', paddingTop: 6 },
  // Termo de garantia (page 2)
  termsTitle:  { fontSize: 18, fontWeight: 'bold', color: '#064E3B', textAlign: 'center', marginBottom: 4 },
  termsSub:    { fontSize: 9, color: '#475569', textAlign: 'center', marginBottom: 18 },
  termsTable:  { marginBottom: 16 },
  termsBody:   { fontSize: 9, color: '#1E293B', lineHeight: 1.6, textAlign: 'justify' },
  signature:   { marginTop: 40, flexDirection: 'row', justifyContent: 'space-around' },
  sigBlock:    { width: 200, alignItems: 'center' },
  sigLine:     { borderTop: '0.5pt solid #0F172A', width: 200, marginBottom: 4 },
  sigLabel:    { fontSize: 8, color: '#475569' },
})

// ──────────────────────────────────────────────────────────────────────────
// Componente
// ──────────────────────────────────────────────────────────────────────────

function ComprovanteDoc({ data }: { data: ComprovanteData }) {
  const t = data.tenant
  const c = data.customer

  // Linha 1 do endereço: rua, número - bairro
  const addrLine1 = [
    [t.addressStreet, t.addressNumber].filter(Boolean).join(', '),
    t.addressDistrict,
  ].filter(Boolean).join(' - ')
  // Linha 2 do endereço: cidade/UF · CEP
  const cityState = [t.addressCity, t.addressState].filter(Boolean).join('/')
  const addrLine2 = [cityState, t.addressZip ? `CEP ${t.addressZip}` : null].filter(Boolean).join(' · ')

  const phoneFmt    = t.phone ? formatPhone(t.phone) : null
  const instagramFmt = t.instagram ? `@${t.instagram.replace(/^@/, '')}` : null
  const tenantContact = [phoneFmt, t.email, instagramFmt].filter(Boolean).join(' · ')

  const channel  = channelLabel(data.saleChannel)
  const delivery = deliveryLabel(data.deliveryType)

  const warrantyTerms = (t.warrantyTerms?.trim() || DEFAULT_WARRANTY_TERMS)

  return (
    <Document
      title={`Comprovante ${data.saleNumber}`}
      author={t.name}
      subject="Comprovante de Compra"
    >
      {/* ── Página 1: Comprovante ───────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {t.logoUrl ? <Image src={t.logoUrl} style={styles.logo} /> : null}
            <View>
              <Text style={styles.tenantName}>{t.tradeName || t.name}</Text>
              {t.cnpj         ? <Text style={styles.tenantInfo}>CNPJ: {formatCnpj(t.cnpj)}</Text> : null}
              {t.ie           ? <Text style={styles.tenantInfo}>IE: {t.ie}</Text> : null}
              {addrLine1      ? <Text style={styles.tenantInfo}>{addrLine1}</Text> : null}
              {addrLine2      ? <Text style={styles.tenantInfo}>{addrLine2}</Text> : null}
              {tenantContact  ? <Text style={styles.tenantInfo}>{tenantContact}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={styles.docTitle}>COMPROVANTE DE COMPRA</Text>
            <Text style={styles.docMeta}>Nº {data.saleNumber}</Text>
            <Text style={styles.docMeta}>{formatDate(data.saleDate)}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          {/* Detalhes da venda */}
          <View style={styles.colHalf}>
            <Text style={styles.sectionTitle}>Detalhes da venda</Text>
            <View style={styles.box}>
              <View style={styles.row}>
                <Text style={styles.label}>Número:</Text>
                <Text style={styles.value}>{data.saleNumber}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Data/hora:</Text>
                <Text style={styles.value}>{formatDate(data.saleDate)}</Text>
              </View>
              {data.sellerName ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Vendedor:</Text>
                  <Text style={styles.value}>{data.sellerName}</Text>
                </View>
              ) : null}
              {channel ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Canal:</Text>
                  <Text style={styles.value}>{channel}</Text>
                </View>
              ) : null}
              {delivery ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Entrega:</Text>
                  <Text style={styles.value}>{delivery}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Cliente */}
          <View style={styles.colHalf}>
            <Text style={styles.sectionTitle}>Cliente</Text>
            <View style={styles.box}>
              <View style={styles.row}>
                <Text style={styles.label}>Nome:</Text>
                <Text style={styles.value}>{c.name}</Text>
              </View>
              {c.cpfCnpj ? (
                <View style={styles.row}>
                  <Text style={styles.label}>CPF/CNPJ:</Text>
                  <Text style={styles.value}>{formatCnpj(c.cpfCnpj)}</Text>
                </View>
              ) : null}
              {c.phone ? (
                <View style={styles.row}>
                  <Text style={styles.label}>Telefone:</Text>
                  <Text style={styles.value}>{formatPhone(c.phone)}</Text>
                </View>
              ) : null}
              {c.email ? (
                <View style={styles.row}>
                  <Text style={styles.label}>E-mail:</Text>
                  <Text style={styles.value}>{c.email}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Itens</Text>
          <View style={styles.table}>
            <View style={styles.tableHead}>
              <Text style={styles.colDescr}>Descrição</Text>
              <Text style={styles.colQty}>Qtd</Text>
              <Text style={styles.colPrice}>Valor Unit.</Text>
              <Text style={styles.colTotal}>Subtotal</Text>
              <Text style={styles.colWarr}>Garantia</Text>
            </View>
            {data.items.map((it, idx) => (
              <View key={idx} style={styles.tableRow}>
                <Text style={styles.colDescr}>{it.name}</Text>
                <Text style={styles.colQty}>{it.quantity}</Text>
                <Text style={styles.colPrice}>{brl(it.unitPriceCents)}</Text>
                <Text style={styles.colTotal}>{brl(it.subtotalCents)}</Text>
                <Text style={styles.colWarr}>{it.warrantyDays} dias</Text>
              </View>
            ))}
          </View>

          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Subtotal:</Text>
              <Text style={styles.totalValue}>{brl(data.subtotalCents)}</Text>
            </View>
            {data.discountCents > 0 ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Desconto:</Text>
                <Text style={styles.totalValue}>− {brl(data.discountCents)}</Text>
              </View>
            ) : null}
            {data.shippingCents > 0 ? (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Frete:</Text>
                <Text style={styles.totalValue}>{brl(data.shippingCents)}</Text>
              </View>
            ) : null}
            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { fontWeight: 'bold' }]}>TOTAL:</Text>
              <Text style={styles.totalGrand}>{brl(data.totalCents)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Forma de pagamento:</Text>
              <Text style={styles.totalValue}>{paymentLabel(data.paymentMethod)}</Text>
            </View>
          </View>
        </View>

        {data.observation ? (
          <View style={styles.obsBox}>
            <Text style={styles.obsLabel}>Observação</Text>
            <Text style={styles.obsText}>{data.observation}</Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          <Text style={{ fontSize: 8, fontWeight: 'bold', color: '#475569', textAlign: 'center' }}>
            Obrigado pela preferência! Em caso de dúvidas sobre garantia, consulte a próxima página.
          </Text>
          {tenantContact ? (
            <Text style={{ fontSize: 7, color: '#94A3B8', textAlign: 'center', marginTop: 3 }}>
              {t.tradeName || t.name} · {tenantContact}
            </Text>
          ) : null}
          <Text style={{ fontSize: 7, color: '#94A3B8', textAlign: 'center', marginTop: 1 }}>
            Este comprovante não substitui documento fiscal (NF-e/NFC-e).
          </Text>
        </View>
      </Page>

      {/* ── Página 2: Termo de Garantia ─────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.termsTitle}>TERMO DE GARANTIA</Text>
        <Text style={styles.termsSub}>
          Referente ao Comprovante {data.saleNumber} · {formatDate(data.saleDate)}
        </Text>

        <View style={styles.termsTable}>
          <View style={styles.tableHead}>
            <Text style={styles.colDescr}>Produto</Text>
            <Text style={styles.colWarr}>Garantia</Text>
            <Text style={styles.colWarr}>Válida até</Text>
          </View>
          {data.items.map((it, idx) => {
            const validUntil = new Date(new Date(data.saleDate).getTime() + it.warrantyDays * 86400000)
            return (
              <View key={idx} style={styles.tableRow}>
                <Text style={styles.colDescr}>{it.name}</Text>
                <Text style={styles.colWarr}>{it.warrantyDays} dias</Text>
                <Text style={styles.colWarr}>{validUntil.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</Text>
              </View>
            )
          })}
        </View>

        <Text style={styles.termsBody}>{warrantyTerms}</Text>

        <View style={styles.signature}>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine} />
            <Text style={styles.sigLabel}>{c.name}</Text>
            <Text style={styles.sigLabel}>(Cliente)</Text>
          </View>
          <View style={styles.sigBlock}>
            <View style={styles.sigLine} />
            <Text style={styles.sigLabel}>{t.tradeName || t.name}</Text>
            <Text style={styles.sigLabel}>(Vendedor)</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={{ fontSize: 7, color: '#94A3B8', textAlign: 'center' }}>
            {t.tradeName || t.name} {t.cnpj ? `· CNPJ ${formatCnpj(t.cnpj)}` : ''} · Emitido em {formatDate(new Date().toISOString())}
          </Text>
        </View>
      </Page>
    </Document>
  )
}

export async function renderComprovantePdf(data: ComprovanteData): Promise<Buffer> {
  return renderToBuffer(<ComprovanteDoc data={data} />)
}
