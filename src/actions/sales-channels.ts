'use server'

/**
 * Server Actions pra registro e consulta de canal / modalidade de entrega
 * das vendas.
 *
 * Funções:
 *   - updateSaleChannel(saleId, patch)           → atualiza sale (from POS/Financeiro)
 *   - updateServiceOrderChannel(osId, patch)     → atualiza OS (from CheckSmart)
 *   - getChannelAnalytics(period)                → agrega pro dashboard
 */

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'
import {
  isValidChannel, isValidDelivery,
  type SaleChannel, type DeliveryType, type SaleChannelOption,
  SALE_CHANNEL_OPTIONS, DELIVERY_TYPE_OPTIONS,
} from '@/lib/sale-channels'
import { fetchMetaAdsInsights, type MetaAdsPeriod } from '@/actions/meta-ads'

export type ChannelPatch = {
  saleChannel?:  SaleChannel | null
  deliveryType?: DeliveryType | null
}

export async function updateSaleChannel(saleId: string, patch: ChannelPatch): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const updates: Record<string, unknown> = {}
  if (patch.saleChannel !== undefined) {
    if (patch.saleChannel !== null && !isValidChannel(patch.saleChannel)) {
      throw new Error(`Canal inválido: ${patch.saleChannel}`)
    }
    updates.sale_channel = patch.saleChannel
  }
  if (patch.deliveryType !== undefined) {
    if (patch.deliveryType !== null && !isValidDelivery(patch.deliveryType)) {
      throw new Error(`Tipo de entrega inválido: ${patch.deliveryType}`)
    }
    updates.delivery_type = patch.deliveryType
  }
  if (Object.keys(updates).length === 0) return { ok: true }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('sales')
    .update(updates)
    .eq('id', saleId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  revalidatePath('/pos')
  revalidatePath('/financeiro')
  revalidatePath('/analytics/canais')
  return { ok: true }
}

export async function updateServiceOrderChannel(osId: string, patch: ChannelPatch): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const updates: Record<string, unknown> = {}
  if (patch.saleChannel !== undefined) {
    if (patch.saleChannel !== null && !isValidChannel(patch.saleChannel)) {
      throw new Error(`Canal inválido: ${patch.saleChannel}`)
    }
    updates.sale_channel = patch.saleChannel
  }
  if (patch.deliveryType !== undefined) {
    if (patch.deliveryType !== null && !isValidDelivery(patch.deliveryType)) {
      throw new Error(`Tipo de entrega inválido: ${patch.deliveryType}`)
    }
    updates.delivery_type = patch.deliveryType
  }
  if (Object.keys(updates).length === 0) return { ok: true }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('service_orders')
    .update(updates)
    .eq('id', osId)
    .eq('tenant_id', tenantId)

  if (error) throw new Error(error.message)

  revalidatePath('/financeiro')
  revalidatePath('/analytics/canais')
  return { ok: true }
}

// ── Analytics agregado ─────────────────────────────────────────────────────

export type ChannelAnalyticsPeriod = '7d' | '30d' | '90d' | '180d' | '365d' | 'all'

export type ChannelMetric = {
  channel:           SaleChannel | 'nao_informado'
  label:             string
  color:             string
  group:             'online' | 'fisica' | 'outro'
  salesCount:        number
  osCount:           number
  // Faturamento separado por fonte (PhoneSmart=sales, CheckSmart=OS)
  salesRevenueCents: number
  osRevenueCents:    number
  totalCents:        number    // = salesRevenueCents + osRevenueCents
  // Lucro separado por fonte (receita − custo)
  salesProfitCents:  number
  osProfitCents:     number
  totalProfitCents:  number
  avgTicketCents:    number
}

export type ChannelDeliveryCell = {
  count:        number     // total de transações (sales + os) nessa célula
  revenueCents: number
  profitCents:  number
}

export type ChannelDeliveryRow = {
  channel:       string                            // 'whatsapp', 'fisica_balcao', etc, ou 'nao_informado'
  channelLabel:  string
  channelColor:  string
  channelGroup:  'online' | 'fisica' | 'outro'
  // Chave: 'counter' | 'pickup' | 'shipping' | 'nao_informado'
  cells:         Record<string, ChannelDeliveryCell>
  rowTotal:      ChannelDeliveryCell
}

export type ChannelDeliveryMatrix = {
  deliveries:    { key: string; label: string }[]    // colunas (ordem fixa)
  rows:          ChannelDeliveryRow[]
  columnTotals:  Record<string, ChannelDeliveryCell>
  grandTotal:    ChannelDeliveryCell
}

export type ChannelAnalytics = {
  period:              ChannelAnalyticsPeriod
  sinceIso:            string
  untilIso:            string
  totalCents:          number
  totalTxCount:        number
  onlineCents:         number
  fisicaCents:         number
  outroCents:          number
  naoInformadoCents:   number
  naoInformadoCount:   number
  pctOnline:           number    // 0..1
  pctFisica:           number
  pctOutro:            number
  fisicaBalcaoCents:   number
  fisicaRetiradaCents: number
  pctSustento:         number    // % da física que é retirada
  // Quantos itens de venda usaram custo atual de products (snapshot ausente).
  // Útil pra avisar que o lucro de vendas antigas é estimado.
  salesItemsWithFallbackCount: number
  // Breakdown de modalidade de entrega (counter/pickup/shipping/nao_informado).
  // Útil pra ver quanto vai por balcão vs retirada vs delivery.
  deliveryBreakdown: { delivery: string; label: string; cents: number; count: number }[]
  channels:            ChannelMetric[]
  // Cruzamento canal × tipo de entrega — responde "do WhatsApp, quantos
  // vieram retirar na loja vs receberam por delivery vs balcão?"
  channelDeliveryMatrix: ChannelDeliveryMatrix
  daily:               {
    date: string
    onlineCents: number
    fisicaCents: number
    onlineProfitCents: number
    fisicaProfitCents: number
  }[]
}

function periodToSince(period: ChannelAnalyticsPeriod): string {
  if (period === 'all') return '1970-01-01T00:00:00.000Z'
  const d = new Date()
  const days = period === '7d' ? 7
             : period === '30d' ? 30
             : period === '90d' ? 90
             : period === '180d' ? 180
             : 365
  d.setDate(d.getDate() - days + 1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function getChannelAnalytics(period: ChannelAnalyticsPeriod = '30d'): Promise<ChannelAnalytics> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const sinceIso = periodToSince(period)
  const untilIso = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('id, total_cents, sale_channel, delivery_type, created_at, sale_items(quantity, product_id, cost_snapshot_cents)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .limit(20000),
    sb.from('service_orders')
      .select('id, total_price_cents, service_price_cents, parts_sale_cents, parts_cost_cents, discount_cents, sale_channel, delivery_type, received_at')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .limit(20000),
  ])

  type SaleItem = { quantity: number; product_id: string | null; cost_snapshot_cents: number | null }
  type SaleRow  = { id: string; total_cents: number; sale_channel: string | null; delivery_type: string | null; created_at: string; sale_items: SaleItem[] | null }
  type OsRow    = { id: string; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; parts_cost_cents: number|null; discount_cents: number|null; sale_channel: string | null; delivery_type: string | null; received_at: string }

  const salesData = (salesRes.data ?? []) as SaleRow[]
  const osData    = (osRes.data ?? [])    as OsRow[]

  // Pra calcular lucro de itens sem snapshot: buscar custo atual em products.
  const productIdsToFetch = new Set<string>()
  for (const s of salesData) {
    for (const it of (s.sale_items ?? [])) {
      if (it.cost_snapshot_cents == null && it.product_id) productIdsToFetch.add(it.product_id)
    }
  }
  const costMap = new Map<string, number>()
  if (productIdsToFetch.size > 0) {
    const { data: prodData } = await sb
      .from('products')
      .select('id, cost_cents')
      .eq('tenant_id', tenantId)
      .in('id', Array.from(productIdsToFetch))
    for (const p of (prodData ?? []) as { id: string; cost_cents: number | null }[]) {
      costMap.set(p.id, p.cost_cents ?? 0)
    }
  }

  type Bucket = {
    sales: number; os: number
    salesRevenue: number; osRevenue: number
    salesProfit:  number; osProfit:  number
  }
  const newBucket = (): Bucket => ({
    sales: 0, os: 0,
    salesRevenue: 0, osRevenue: 0,
    salesProfit: 0, osProfit: 0,
  })

  const byChannel = new Map<string, Bucket>()
  const bumpSale = (ch: string, revenue: number, profit: number) => {
    const key = ch || 'nao_informado'
    const b = byChannel.get(key) ?? newBucket()
    b.sales        += 1
    b.salesRevenue += revenue
    b.salesProfit  += profit
    byChannel.set(key, b)
  }
  const bumpOs = (ch: string, revenue: number, profit: number) => {
    const key = ch || 'nao_informado'
    const b = byChannel.get(key) ?? newBucket()
    b.os        += 1
    b.osRevenue += revenue
    b.osProfit  += profit
    byChannel.set(key, b)
  }

  const dailyMap = new Map<string, { online: number; fisica: number; onlineProfit: number; fisicaProfit: number }>()
  const bumpDaily = (iso: string, channel: string | null, revenue: number, profit: number) => {
    const date = iso.slice(0, 10)
    const d = dailyMap.get(date) ?? { online: 0, fisica: 0, onlineProfit: 0, fisicaProfit: 0 }
    const opt = SALE_CHANNEL_OPTIONS.find(o => o.value === channel)
    if (opt?.group === 'online') { d.online += revenue; d.onlineProfit += profit }
    if (opt?.group === 'fisica') { d.fisica += revenue; d.fisicaProfit += profit }
    dailyMap.set(date, d)
  }

  let totalCents                 = 0
  let totalTxCount               = 0
  let salesItemsWithFallbackCount = 0

  // Agrega faturamento por modalidade de entrega.
  const deliveryMap = new Map<string, { cents: number; count: number }>()
  const bumpDelivery = (delivery: string | null, cents: number) => {
    const key = delivery ?? 'nao_informado'
    const b = deliveryMap.get(key) ?? { cents: 0, count: 0 }
    b.cents += cents
    b.count += 1
    deliveryMap.set(key, b)
  }

  // Cruzamento canal × delivery (matriz)
  const matrixMap = new Map<string, ChannelDeliveryCell>()  // chave = `${channel}|${delivery}`
  const bumpMatrix = (channel: string | null, delivery: string | null, revenue: number, profit: number) => {
    const ch = channel || 'nao_informado'
    const dl = delivery || 'nao_informado'
    const key = `${ch}|${dl}`
    const cell = matrixMap.get(key) ?? { count: 0, revenueCents: 0, profitCents: 0 }
    cell.count        += 1
    cell.revenueCents += revenue
    cell.profitCents  += profit
    matrixMap.set(key, cell)
  }

  for (const s of salesData) {
    const v = s.total_cents ?? 0
    if (v <= 0) continue
    let cost = 0
    for (const it of (s.sale_items ?? [])) {
      const qty = it.quantity ?? 0
      let unit = it.cost_snapshot_cents
      if (unit == null) {
        unit = it.product_id ? (costMap.get(it.product_id) ?? 0) : 0
        salesItemsWithFallbackCount += 1
      }
      cost += qty * unit
    }
    const profit = v - cost
    bumpSale(s.sale_channel ?? '', v, profit)
    bumpDaily(s.created_at, s.sale_channel, v, profit)
    bumpDelivery(s.delivery_type, v)
    bumpMatrix(s.sale_channel, s.delivery_type, v, profit)
    totalCents   += v
    totalTxCount += 1
  }
  for (const o of osData) {
    const v = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    if (v <= 0) continue
    const partsCost = o.parts_cost_cents ?? 0
    const profit    = v - partsCost
    bumpOs(o.sale_channel ?? '', v, profit)
    bumpDaily(o.received_at, o.sale_channel, v, profit)
    bumpDelivery(o.delivery_type, v)
    bumpMatrix(o.sale_channel, o.delivery_type, v, profit)
    totalCents   += v
    totalTxCount += 1
  }

  const buildMetric = (
    channel: ChannelMetric['channel'],
    label:   string,
    color:   string,
    group:   ChannelMetric['group'],
    b:       Bucket,
  ): ChannelMetric => {
    const total      = b.salesRevenue + b.osRevenue
    const totalProfit = b.salesProfit + b.osProfit
    const count       = b.sales + b.os
    return {
      channel, label, color, group,
      salesCount:        b.sales,
      osCount:           b.os,
      salesRevenueCents: b.salesRevenue,
      osRevenueCents:    b.osRevenue,
      totalCents:        total,
      salesProfitCents:  b.salesProfit,
      osProfitCents:     b.osProfit,
      totalProfitCents:  totalProfit,
      avgTicketCents:    count > 0 ? Math.round(total / count) : 0,
    }
  }

  const channels: ChannelMetric[] = SALE_CHANNEL_OPTIONS.map(opt =>
    buildMetric(opt.value, opt.label, opt.color, opt.group, byChannel.get(opt.value) ?? newBucket())
  )
  const niRaw = byChannel.get('nao_informado') ?? newBucket()
  if (niRaw.sales + niRaw.os > 0) {
    channels.push(buildMetric('nao_informado', 'Não informado', '#5A7A9A', 'outro', niRaw))
  }

  const onlineCents = channels.filter(c => c.group === 'online').reduce((s, c) => s + c.totalCents, 0)
  const fisicaCents = channels.filter(c => c.group === 'fisica').reduce((s, c) => s + c.totalCents, 0)
  const outroCents  = channels.filter(c => c.group === 'outro' && c.channel !== 'nao_informado').reduce((s, c) => s + c.totalCents, 0)
  const fisicaBalcaoCents   = channels.find(c => c.channel === 'fisica_balcao')?.totalCents   ?? 0
  const fisicaRetiradaCents = channels.find(c => c.channel === 'fisica_retirada')?.totalCents ?? 0
  const totalKnownCents     = onlineCents + fisicaCents + outroCents
  const naoInformadoTotal   = niRaw.salesRevenue + niRaw.osRevenue

  const daily = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      onlineCents:       v.online,
      fisicaCents:       v.fisica,
      onlineProfitCents: v.onlineProfit,
      fisicaProfitCents: v.fisicaProfit,
    }))

  // ── Constrói matriz canal × delivery a partir do matrixMap ─────────────
  const emptyCell = (): ChannelDeliveryCell => ({ count: 0, revenueCents: 0, profitCents: 0 })
  const addCells = (a: ChannelDeliveryCell, b: ChannelDeliveryCell): ChannelDeliveryCell => ({
    count:        a.count        + b.count,
    revenueCents: a.revenueCents + b.revenueCents,
    profitCents:  a.profitCents  + b.profitCents,
  })

  const deliveryColumns: { key: string; label: string }[] = [
    ...DELIVERY_TYPE_OPTIONS.map(o => ({ key: o.value, label: o.label })),
    { key: 'nao_informado', label: 'Não informado' },
  ]

  // Linhas a mostrar: canais que aparecem nas opções pickable + 'nao_informado' se houver dados
  const channelKeys: { key: string; label: string; color: string; group: 'online' | 'fisica' | 'outro' }[] =
    SALE_CHANNEL_OPTIONS.filter(o => !o.deprecated).map(o => ({
      key: o.value, label: o.label, color: o.color, group: o.group,
    }))
  if (Array.from(matrixMap.keys()).some(k => k.startsWith('nao_informado|'))) {
    channelKeys.push({ key: 'nao_informado', label: 'Não informado', color: '#5A7A9A', group: 'outro' })
  }

  const matrixRows: ChannelDeliveryRow[] = channelKeys.map(ch => {
    const cells: Record<string, ChannelDeliveryCell> = {}
    let rowTotal = emptyCell()
    for (const col of deliveryColumns) {
      const cell = matrixMap.get(`${ch.key}|${col.key}`) ?? emptyCell()
      cells[col.key] = cell
      rowTotal = addCells(rowTotal, cell)
    }
    return {
      channel:       ch.key,
      channelLabel:  ch.label,
      channelColor:  ch.color,
      channelGroup:  ch.group,
      cells,
      rowTotal,
    }
  })

  // Filtra linhas sem dados pra não poluir
  const matrixRowsWithData = matrixRows.filter(r => r.rowTotal.count > 0)

  const columnTotals: Record<string, ChannelDeliveryCell> = {}
  let grandTotal = emptyCell()
  for (const col of deliveryColumns) {
    let total = emptyCell()
    for (const r of matrixRowsWithData) total = addCells(total, r.cells[col.key])
    columnTotals[col.key] = total
    grandTotal = addCells(grandTotal, total)
  }

  const channelDeliveryMatrix: ChannelDeliveryMatrix = {
    deliveries:   deliveryColumns,
    rows:         matrixRowsWithData,
    columnTotals,
    grandTotal,
  }

  return {
    period,
    sinceIso,
    untilIso,
    totalCents,
    totalTxCount,
    onlineCents,
    fisicaCents,
    outroCents,
    naoInformadoCents:  naoInformadoTotal,
    naoInformadoCount:  niRaw.sales + niRaw.os,
    pctOnline: totalKnownCents > 0 ? onlineCents / totalKnownCents : 0,
    pctFisica: totalKnownCents > 0 ? fisicaCents / totalKnownCents : 0,
    pctOutro:  totalKnownCents > 0 ? outroCents  / totalKnownCents : 0,
    fisicaBalcaoCents,
    fisicaRetiradaCents,
    pctSustento: (fisicaBalcaoCents + fisicaRetiradaCents) > 0
      ? fisicaRetiradaCents / (fisicaBalcaoCents + fisicaRetiradaCents)
      : 0,
    salesItemsWithFallbackCount,
    deliveryBreakdown: Array.from(deliveryMap.entries())
      .map(([delivery, b]) => ({
        delivery,
        label:  DELIVERY_TYPE_OPTIONS.find(o => o.value === delivery)?.label
                ?? (delivery === 'nao_informado' ? 'Não informado' : delivery),
        cents:  b.cents,
        count:  b.count,
      }))
      .sort((a, b) => b.cents - a.cents),
    channels,
    channelDeliveryMatrix,
    daily,
  }
}

export async function listSaleChannelOptions(): Promise<SaleChannelOption[]> {
  return SALE_CHANNEL_OPTIONS
}

// ── Origem dos clientes (cruzando com vendas/OS no período) ────────────────

export type OriginMetric = {
  origin:         string   // valor do enum customers.origin (ou 'nao_informado')
  label:          string
  color:          string
  customers:      number   // clientes únicos com transação no período
  transactions:   number   // total de vendas + OS
  totalCents:     number
  avgTicketCents: number
}

const ORIGIN_LABELS: Record<string, string> = {
  instagram_pago:     'Instagram Pago',
  instagram_organico: 'Instagram Orgânico',
  facebook:           'Facebook',
  google:             'Google',
  indicacao:          'Indicação',
  passou_na_porta:    'Passou na Porta',
  outros:             'Outros',
  nao_informado:      'Não informado',
}

const ORIGIN_COLORS: Record<string, string> = {
  instagram_pago:     '#E4405F',
  instagram_organico: '#C13584',
  facebook:           '#1877F2',
  google:             '#4285F4',
  indicacao:          '#00FF94',
  passou_na_porta:    '#FFAA00',
  outros:             '#9B6DFF',
  nao_informado:      '#5A7A9A',
}

export async function getOriginAnalytics(period: ChannelAnalyticsPeriod = '30d'): Promise<OriginMetric[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const sinceIso = periodToSince(period)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('customer_id, total_cents, customer_origin, customers(origin)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .limit(20000),
    sb.from('service_orders')
      .select('customer_id, total_price_cents, service_price_cents, parts_sale_cents, discount_cents, customers(origin)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .limit(20000),
  ])

  type SaleRow = { customer_id: string | null; total_cents: number; customer_origin: string | null; customers: { origin: string | null } | null }
  type OsRow   = { customer_id: string | null; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; discount_cents: number|null; customers: { origin: string | null } | null }

  const byOrigin = new Map<string, { customers: Set<string>; transactions: number; totalCents: number }>()
  const bump = (origin: string | null, customerId: string | null, value: number) => {
    if (value <= 0) return
    const key = origin ?? 'nao_informado'
    const b = byOrigin.get(key) ?? { customers: new Set<string>(), transactions: 0, totalCents: 0 }
    if (customerId) b.customers.add(customerId)
    b.transactions++
    b.totalCents += value
    byOrigin.set(key, b)
  }

  for (const s of (salesRes.data ?? []) as SaleRow[]) {
    // COALESCE: prioriza origem da venda (preenchida no PDV pra Consumidor
    // Final), fallback pro origin do cliente cadastrado.
    const origin = s.customer_origin ?? s.customers?.origin ?? null
    bump(origin, s.customer_id, s.total_cents ?? 0)
  }
  for (const o of (osRes.data ?? []) as OsRow[]) {
    const v = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    bump(o.customers?.origin ?? null, o.customer_id, v)
  }

  return Array.from(byOrigin.entries())
    .map(([origin, b]) => ({
      origin,
      label:          ORIGIN_LABELS[origin] ?? origin,
      color:          ORIGIN_COLORS[origin] ?? '#5A7A9A',
      customers:      b.customers.size,
      transactions:   b.transactions,
      totalCents:     b.totalCents,
      avgTicketCents: b.transactions > 0 ? Math.round(b.totalCents / b.transactions) : 0,
    }))
    .sort((a, b) => b.totalCents - a.totalCents)
}

// ── Origem INFERIDA (vendas sem cliente cadastrado / sem origem) ──────────
// Pra Consumidor Final ou clientes sem origem cadastrada, usa o sale_channel
// como aproximação de origem. NÃO mistura com getOriginAnalytics — fica
// numa seção separada na UI pra deixar claro que é estimativa.

export type InferredOriginMetric = {
  channel:        string   // chave do sale_channel (ou 'nao_informado')
  label:          string   // label legível com sufixo "(sem cadastro)" quando faz sentido
  color:          string
  transactions:   number
  totalCents:     number
  avgTicketCents: number
}

const INFERRED_LABEL_OVERRIDE: Record<string, string> = {
  fisica_balcao:   'Passou na porta (anônimo)',
  whatsapp:        'WhatsApp (sem cadastro)',
  instagram_dm:    'Instagram (sem cadastro)',
  delivery_online: 'Marketplace / Site (sem cadastro)',
  fisica_retirada: 'Retirada (sem cadastro)',
  outro:           'Outro (sem cadastro)',
  nao_informado:   'Sem canal informado',
}

export async function getInferredOriginAnalytics(period: ChannelAnalyticsPeriod = '30d'): Promise<InferredOriginMetric[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const sinceIso = periodToSince(period)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('customer_id, total_cents, sale_channel, customer_origin, customers(origin)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .limit(20000),
    sb.from('service_orders')
      .select('customer_id, total_price_cents, service_price_cents, parts_sale_cents, discount_cents, sale_channel, customers(origin)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .limit(20000),
  ])

  type SaleRow = { customer_id: string | null; total_cents: number; sale_channel: string | null; customer_origin: string | null; customers: { origin: string | null } | null }
  type OsRow   = { customer_id: string | null; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; discount_cents: number|null; sale_channel: string | null; customers: { origin: string | null } | null }

  const byChannel = new Map<string, { transactions: number; totalCents: number }>()

  const bump = (channel: string | null, value: number) => {
    if (value <= 0) return
    const key = channel ?? 'nao_informado'
    const b = byChannel.get(key) ?? { transactions: 0, totalCents: 0 }
    b.transactions += 1
    b.totalCents   += value
    byChannel.set(key, b)
  }

  for (const s of (salesRes.data ?? []) as SaleRow[]) {
    // Só conta se NÃO tiver origem real (do cliente OU declarada na venda)
    if (s.customers?.origin || s.customer_origin) continue
    bump(s.sale_channel, s.total_cents ?? 0)
  }
  for (const o of (osRes.data ?? []) as OsRow[]) {
    if (o.customers?.origin) continue
    const v = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    bump(o.sale_channel, v)
  }

  return Array.from(byChannel.entries())
    .map(([channel, b]) => {
      const opt = SALE_CHANNEL_OPTIONS.find(o => o.value === channel)
      return {
        channel,
        label:          INFERRED_LABEL_OVERRIDE[channel] ?? opt?.label ?? channel,
        color:          opt?.color ?? '#5A7A9A',
        transactions:   b.transactions,
        totalCents:     b.totalCents,
        avgTicketCents: b.transactions > 0 ? Math.round(b.totalCents / b.transactions) : 0,
      }
    })
    .sort((a, b) => b.totalCents - a.totalCents)
}

// ── Matriz Origem × Canal ──────────────────────────────────────────────────
// Cruza onde o cliente conheceu a loja (origem) com onde fechou a venda (canal).
// Útil pra responder: "cliente que vem do Instagram fecha mais no WhatsApp ou no balcão?"

export type OriginChannelCell = {
  origin:       string
  channel:      string
  totalCents:   number
  transactions: number
}

export type OriginChannelMatrix = {
  origins:    { key: string; label: string; color: string }[]
  channels:   { key: string; label: string; color: string }[]
  cells:      OriginChannelCell[]
  rowTotals:  Record<string, number>
  colTotals:  Record<string, number>
  grandTotal: number
}

export async function getOriginChannelMatrix(period: ChannelAnalyticsPeriod = '30d'): Promise<OriginChannelMatrix> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const sinceIso = periodToSince(period)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('total_cents, sale_channel, customer_origin, customers(origin)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .limit(20000),
    sb.from('service_orders')
      .select('total_price_cents, service_price_cents, parts_sale_cents, discount_cents, sale_channel, customers(origin)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .limit(20000),
  ])

  type SaleRow = { total_cents: number; sale_channel: string | null; customer_origin: string | null; customers: { origin: string | null } | null }
  type OsRow   = { total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; discount_cents: number|null; sale_channel: string | null; customers: { origin: string | null } | null }

  const cellMap = new Map<string, { totalCents: number; transactions: number }>()
  const rowTotals: Record<string, number> = {}
  const colTotals: Record<string, number> = {}
  let grandTotal = 0

  const bump = (origin: string | null, channel: string | null, value: number) => {
    if (value <= 0) return
    const o   = origin  ?? 'nao_informado'
    const c   = channel ?? 'nao_informado'
    const key = `${o}|${c}`
    const cell = cellMap.get(key) ?? { totalCents: 0, transactions: 0 }
    cell.totalCents   += value
    cell.transactions += 1
    cellMap.set(key, cell)
    rowTotals[o] = (rowTotals[o] ?? 0) + value
    colTotals[c] = (colTotals[c] ?? 0) + value
    grandTotal  += value
  }

  for (const s of (salesRes.data ?? []) as SaleRow[]) {
    // COALESCE: origem da venda > origem do cliente
    bump(s.customer_origin ?? s.customers?.origin ?? null, s.sale_channel, s.total_cents ?? 0)
  }
  for (const o of (osRes.data ?? []) as OsRow[]) {
    const v = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    bump(o.customers?.origin ?? null, o.sale_channel, v)
  }

  // Ordena origens por faturamento desc, ignorando origens sem nenhuma transação.
  const origins = Object.entries(rowTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => ({
      key,
      label: ORIGIN_LABELS[key] ?? key,
      color: ORIGIN_COLORS[key] ?? '#5A7A9A',
    }))

  // Idem pra canais — usa cores/labels do SALE_CHANNEL_OPTIONS.
  const channels = Object.entries(colTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => {
      const opt = SALE_CHANNEL_OPTIONS.find(o => o.value === key)
      return {
        key,
        label: opt?.label ?? (key === 'nao_informado' ? 'Não informado' : key),
        color: opt?.color ?? '#5A7A9A',
      }
    })

  const cells: OriginChannelCell[] = []
  for (const [key, v] of cellMap.entries()) {
    const [origin, channel] = key.split('|')
    cells.push({ origin, channel, totalCents: v.totalCents, transactions: v.transactions })
  }

  return { origins, channels, cells, rowTotals, colTotals, grandTotal }
}

// ── CAC e ROAS por canal (cruzando Meta Ads spend × vendas com campaign_code) ──
//
// Limitação conhecida: Meta API só suporta períodos 7d/30d/90d aqui. Pra
// períodos maiores devolvemos `available: false` (sem como buscar gasto histórico).
//
// Atribuição: cliente com `campaign_code` preenchido conta como vindo de Meta.
// O code é texto livre (não tem FK pra meta_campaign_id), então não dá pra
// separar gasto por campanha — mostramos CAC global Meta e quebra de receita
// atribuída por canal de fechamento.

export type CacByChannel = {
  available:                  boolean
  unavailableReason?:         string
  spendCents:                 number
  metaCustomerCount:          number   // clientes únicos com campaign_code que tiveram tx no período
  cacCents:                   number   // spend ÷ metaCustomerCount
  totalAttributedRevenueCents: number
  globalRoas:                 number   // receita atribuída ÷ spend
  byChannel: Array<{
    channel:      string
    label:        string
    color:        string
    customers:    number
    revenueCents: number
    pctCustomers: number
    roas:         number   // receitaCanal ÷ spend (lembrando que spend é total)
  }>
}

const CHANNEL_PERIOD_TO_META: Partial<Record<ChannelAnalyticsPeriod, MetaAdsPeriod>> = {
  '7d':  '7d',
  '30d': '30d',
  '90d': '90d',
}

export async function getCacByChannel(period: ChannelAnalyticsPeriod = '30d'): Promise<CacByChannel> {
  const empty: CacByChannel = {
    available: false,
    spendCents: 0, metaCustomerCount: 0, cacCents: 0,
    totalAttributedRevenueCents: 0, globalRoas: 0,
    byChannel: [],
  }

  const metaPeriod = CHANNEL_PERIOD_TO_META[period]
  if (!metaPeriod) {
    return { ...empty, unavailableReason: 'Meta Ads suporta apenas períodos de 7, 30 ou 90 dias.' }
  }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const sinceIso = periodToSince(period)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // 1) Spend Meta no período
  let spendCents = 0
  try {
    const insights = await fetchMetaAdsInsights(metaPeriod)
    if (!insights) {
      return { ...empty, unavailableReason: 'Conta Meta Ads não configurada — conecte em /meta-ads.' }
    }
    spendCents = insights.spendCents
  } catch (e) {
    return { ...empty, unavailableReason: e instanceof Error ? e.message : 'Erro ao buscar Meta Ads.' }
  }

  // 2) Vendas + OS atribuídas a clientes com campaign_code preenchido
  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('customer_id, total_cents, sale_channel, customers!inner(campaign_code)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .not('customers.campaign_code', 'is', null)
      .limit(20000),
    sb.from('service_orders')
      .select('customer_id, total_price_cents, service_price_cents, parts_sale_cents, discount_cents, sale_channel, customers!inner(campaign_code)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .not('customers.campaign_code', 'is', null)
      .limit(20000),
  ])

  type SaleRow = { customer_id: string | null; total_cents: number; sale_channel: string | null; customers: { campaign_code: string | null } | null }
  type OsRow   = { customer_id: string | null; total_price_cents: number|null; service_price_cents: number|null; parts_sale_cents: number|null; discount_cents: number|null; sale_channel: string | null; customers: { campaign_code: string | null } | null }

  const allCustomers = new Set<string>()
  const byCh = new Map<string, { customers: Set<string>; revenue: number }>()

  const bump = (ch: string | null, customerId: string | null, value: number) => {
    if (value <= 0) return
    const key = ch || 'nao_informado'
    const b = byCh.get(key) ?? { customers: new Set<string>(), revenue: 0 }
    if (customerId) {
      b.customers.add(customerId)
      allCustomers.add(customerId)
    }
    b.revenue += value
    byCh.set(key, b)
  }

  for (const s of (salesRes.data ?? []) as SaleRow[]) {
    bump(s.sale_channel, s.customer_id, s.total_cents ?? 0)
  }
  for (const o of (osRes.data ?? []) as OsRow[]) {
    const v = o.total_price_cents
      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0) - (o.discount_cents ?? 0))
    bump(o.sale_channel, o.customer_id, v)
  }

  const metaCustomerCount = allCustomers.size
  const totalAttributedRevenueCents = Array.from(byCh.values()).reduce((s, b) => s + b.revenue, 0)
  const cacCents   = metaCustomerCount > 0 ? Math.round(spendCents / metaCustomerCount) : 0
  const globalRoas = spendCents > 0 ? totalAttributedRevenueCents / spendCents : 0

  const byChannel = Array.from(byCh.entries())
    .map(([ch, b]) => {
      const opt = SALE_CHANNEL_OPTIONS.find(o => o.value === ch)
      return {
        channel:      ch,
        label:        opt?.label ?? (ch === 'nao_informado' ? 'Não informado' : ch),
        color:        opt?.color ?? '#5A7A9A',
        customers:    b.customers.size,
        revenueCents: b.revenue,
        pctCustomers: metaCustomerCount > 0 ? b.customers.size / metaCustomerCount : 0,
        roas:         spendCents > 0 ? b.revenue / spendCents : 0,
      }
    })
    .sort((a, b) => b.revenueCents - a.revenueCents)

  return {
    available: true,
    spendCents,
    metaCustomerCount,
    cacCents,
    totalAttributedRevenueCents,
    globalRoas,
    byChannel,
  }
}
