'use server'

/**
 * Diagnóstico de lucro inflado:
 *
 * 1. Pra cada VENDA do período: examina cada sale_item. Se snapshot é null/0,
 *    olha o produto referenciado pra saber se o custo atual existe (= dá pra
 *    backfillar) ou se o produto também está sem custo (= problema na origem).
 * 2. Pra cada OS finalizada do período: marca como suspeita se tem
 *    parts_sale_cents > 0 mas parts_cost_cents é null/0 (= peça vendida sem
 *    custo registrado). OSs só de serviço (parts_sale_cents=0) ficam de fora
 *    porque é normal não ter custo de peças.
 * 3. Lista produtos sem cost_cents que apareceram em vendas no período.
 *
 * Função `backfillSaleItemsCostSnapshot` preenche os snapshots null com o
 * cost_cents atual do produto — é a única correção 100% segura
 * (pra OS sem parts_cost_cents e produtos sem custo, o usuário precisa
 * preencher manualmente porque não temos o número certo).
 */

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'

export type DiagPeriod = '7d' | '30d' | '90d'

export type SuspiciousSaleItem = {
  name:               string
  productId:          string | null
  productName:        string | null
  productCostCents:   number | null
  snapshotCents:      number | null
  quantity:           number
  unitPriceCents:     number
  fixable:            boolean   // snapshot null mas product.cost_cents > 0
}

export type SuspiciousSale = {
  id:                   string
  createdAt:            string
  customerName:         string | null
  totalCents:           number
  itemsCount:           number
  itemsWithoutCost:     number    // # itens onde nem snapshot nem product.cost_cents tem valor > 0
  itemsFixable:         number    // # itens com snapshot null mas product.cost_cents > 0
  items:                SuspiciousSaleItem[]
  diagnosis:            'fixable' | 'product_missing_cost' | 'no_items'
}

export type SuspiciousOS = {
  id:                  string
  receivedAt:          string
  customerName:        string | null
  totalPriceCents:     number
  servicePriceCents:   number
  partsSaleCents:      number
  partsCostCents:      number | null
  diagnosis:           'parts_without_cost' | 'service_only_no_parts'
}

export type OrphanProduct = {
  id:               string
  name:             string
  costCents:        number    // 0 ou null mostrado como 0
  appearedInSales:  number    // quantas vendas no período
}

export type ProfitDiagnostics = {
  period:                  DiagPeriod
  totalSalesAnalyzed:      number
  totalOsAnalyzed:         number
  suspiciousSalesCount:    number
  suspiciousOsCount:       number
  orphanProductsCount:     number
  fixableSnapshotsCount:   number    // quantos sale_items podem ser backfilled com segurança
  suspiciousSales:         SuspiciousSale[]
  suspiciousOs:            SuspiciousOS[]
  orphanProducts:          OrphanProduct[]
}

function periodToSinceIso(period: DiagPeriod): string {
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
  const d = new Date()
  d.setDate(d.getDate() - days + 1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function getProfitDiagnostics(period: DiagPeriod = '30d'): Promise<ProfitDiagnostics> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const sinceIso = periodToSinceIso(period)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [salesRes, osRes] = await Promise.all([
    sb.from('sales')
      .select('id, total_cents, created_at, customers(full_name), sale_items(name, product_id, quantity, unit_price_cents, cost_snapshot_cents)')
      .eq('tenant_id', tenantId)
      .gte('created_at', sinceIso)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(500),
    sb.from('service_orders')
      .select('id, received_at, total_price_cents, service_price_cents, parts_sale_cents, parts_cost_cents, customers(full_name)')
      .eq('tenant_id', tenantId)
      .gte('received_at', sinceIso)
      .in('status', ['delivered', 'Entregue'])
      .order('received_at', { ascending: false })
      .limit(500),
  ])

  type SaleItemRaw = { name: string; product_id: string | null; quantity: number; unit_price_cents: number; cost_snapshot_cents: number | null }
  type SaleRaw     = { id: string; total_cents: number; created_at: string; customers: { full_name: string } | null; sale_items: SaleItemRaw[] | null }
  type OsRaw       = { id: string; received_at: string; total_price_cents: number | null; service_price_cents: number | null; parts_sale_cents: number | null; parts_cost_cents: number | null; customers: { full_name: string } | null }

  const sales = (salesRes.data ?? []) as SaleRaw[]
  const oss   = (osRes.data ?? [])    as OsRaw[]

  // Coleta product_ids dos itens pra puxar custo + nome atual.
  const productIds = new Set<string>()
  for (const s of sales) for (const it of (s.sale_items ?? [])) if (it.product_id) productIds.add(it.product_id)

  // Mapa product_id -> { cost_cents, name }
  const productMap = new Map<string, { cost: number; name: string }>()
  if (productIds.size > 0) {
    const { data: prods } = await sb
      .from('products')
      .select('id, name, cost_cents')
      .eq('tenant_id', tenantId)
      .in('id', Array.from(productIds))
    for (const p of (prods ?? []) as { id: string; name: string; cost_cents: number | null }[]) {
      productMap.set(p.id, { cost: p.cost_cents ?? 0, name: p.name })
    }
    // parts_catalog também — produtos podem ser peças.
    const { data: parts } = await sb
      .from('parts_catalog')
      .select('id, name, cost_cents')
      .eq('tenant_id', tenantId)
      .in('id', Array.from(productIds))
    for (const p of (parts ?? []) as { id: string; name: string; cost_cents: number | null }[]) {
      if (!productMap.has(p.id)) productMap.set(p.id, { cost: p.cost_cents ?? 0, name: p.name })
    }
  }

  // Conta apariçoes por produto pra "órfãos".
  const productAppearances = new Map<string, number>()

  // Vendas suspeitas
  const suspiciousSales: SuspiciousSale[] = []
  let fixableSnapshotsCount = 0
  for (const s of sales) {
    const items = s.sale_items ?? []
    const detailedItems: SuspiciousSaleItem[] = []
    let itemsWithoutCost = 0
    let itemsFixable     = 0

    for (const it of items) {
      const snap = it.cost_snapshot_cents
      const prod = it.product_id ? productMap.get(it.product_id) : null
      const productCost = prod?.cost ?? 0
      const productName = prod?.name ?? null

      // Conta apariçoes
      if (it.product_id) {
        productAppearances.set(it.product_id, (productAppearances.get(it.product_id) ?? 0) + 1)
      }

      // Snapshot ausente/zero?
      const snapMissing = snap == null || snap === 0
      // Tem custo no produto pra backfillar?
      const canBackfill = snapMissing && productCost > 0
      // Sem custo nenhum (snap zero E produto zero)
      const noCostAtAll = snapMissing && productCost === 0

      if (canBackfill) {
        itemsFixable++
        fixableSnapshotsCount++
      }
      if (noCostAtAll) {
        itemsWithoutCost++
      }

      // Só anexamos itens problemáticos pra não inchar payload
      if (snapMissing) {
        detailedItems.push({
          name:             it.name,
          productId:        it.product_id,
          productName,
          productCostCents: prod ? productCost : null,
          snapshotCents:    snap,
          quantity:         it.quantity,
          unitPriceCents:   it.unit_price_cents,
          fixable:          canBackfill,
        })
      }
    }

    // Decide se é "suspeita": tem item sem snapshot OU não tem items.
    const isSuspect = items.length === 0 || detailedItems.length > 0
    if (!isSuspect) continue

    let diagnosis: SuspiciousSale['diagnosis']
    if (items.length === 0)        diagnosis = 'no_items'
    else if (itemsWithoutCost > 0) diagnosis = 'product_missing_cost'
    else                           diagnosis = 'fixable'

    suspiciousSales.push({
      id:               s.id,
      createdAt:        s.created_at,
      customerName:     s.customers?.full_name ?? null,
      totalCents:       s.total_cents ?? 0,
      itemsCount:       items.length,
      itemsWithoutCost,
      itemsFixable,
      items:            detailedItems,
      diagnosis,
    })
  }

  // OSs suspeitas
  const suspiciousOs: SuspiciousOS[] = []
  for (const o of oss) {
    const total       = o.total_price_cents
                      ?? Math.max(0, (o.service_price_cents ?? 0) + (o.parts_sale_cents ?? 0))
    const partsSale   = o.parts_sale_cents ?? 0
    const partsCost   = o.parts_cost_cents ?? 0
    const noPartsCost = partsCost === 0

    if (partsSale > 0 && noPartsCost) {
      suspiciousOs.push({
        id:                 o.id,
        receivedAt:         o.received_at,
        customerName:       o.customers?.full_name ?? null,
        totalPriceCents:    total,
        servicePriceCents:  o.service_price_cents ?? 0,
        partsSaleCents:     partsSale,
        partsCostCents:     o.parts_cost_cents,
        diagnosis:          'parts_without_cost',
      })
    }
    // OSs só de serviço (sem peças) NÃO entram como suspeitas — é normal
    // o lucro ser igual ao total nesse caso (não tem custo de peça).
  }

  // Produtos órfãos (apareceram em venda no período mas não têm cost_cents)
  const orphanProducts: OrphanProduct[] = []
  for (const [pid, count] of productAppearances.entries()) {
    const prod = productMap.get(pid)
    if (!prod) continue
    if (prod.cost === 0) {
      orphanProducts.push({
        id:               pid,
        name:             prod.name,
        costCents:        0,
        appearedInSales:  count,
      })
    }
  }
  orphanProducts.sort((a, b) => b.appearedInSales - a.appearedInSales)

  return {
    period,
    totalSalesAnalyzed:    sales.length,
    totalOsAnalyzed:       oss.length,
    suspiciousSalesCount:  suspiciousSales.length,
    suspiciousOsCount:     suspiciousOs.length,
    orphanProductsCount:   orphanProducts.length,
    fixableSnapshotsCount,
    suspiciousSales:       suspiciousSales.slice(0, 100),
    suspiciousOs:          suspiciousOs.slice(0, 100),
    orphanProducts:        orphanProducts.slice(0, 100),
  }
}

// ── Vendas com prejuízo (custo > receita) ─────────────────────────────────
// Causa raiz: custo cadastrado no produto está errado (digitaram preço de venda
// no campo custo) OU o usuário vinculou a venda ao produto errado na correção.

export type LosingSaleItem = {
  saleItemId:        string
  name:              string
  productId:         string | null
  productName:       string | null
  quantity:          number
  unitPriceCents:    number     // preço de venda do item
  snapshotCents:     number | null
  totalRevenueCents: number     // qty × unitPrice
  totalCostCents:    number     // qty × snapshot (ou cost atual se snapshot null)
  itemProfitCents:   number     // revenue - cost
  isLosing:          boolean    // true se itemProfitCents < 0
}

export type LosingSale = {
  saleId:            string
  saleDate:          string
  customerName:      string | null
  totalCents:        number
  totalCostCents:    number
  profitCents:       number     // negativo
  items:             LosingSaleItem[]
}

export async function findLosingSales(period: DiagPeriod = '30d'): Promise<LosingSale[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const sinceIso = periodToSinceIso(period)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: sales, error } = await sb
    .from('sales')
    .select('id, total_cents, created_at, customers(full_name), sale_items(id, name, product_id, quantity, unit_price_cents, cost_snapshot_cents)')
    .eq('tenant_id', tenantId)
    .gte('created_at', sinceIso)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) throw new Error(error.message)

  type ItemRaw = { id: string; name: string; product_id: string | null; quantity: number; unit_price_cents: number; cost_snapshot_cents: number | null }
  type SaleRaw = { id: string; total_cents: number; created_at: string; customers: { full_name: string } | null; sale_items: ItemRaw[] | null }

  const data = (sales ?? []) as SaleRaw[]

  // Pra itens sem snapshot mas com product_id, busca cost_cents atual.
  const productIds = new Set<string>()
  for (const s of data) {
    for (const it of (s.sale_items ?? [])) {
      if ((it.cost_snapshot_cents == null || it.cost_snapshot_cents === 0) && it.product_id) {
        productIds.add(it.product_id)
      }
    }
  }
  const fallbackCost = new Map<string, { cost: number; name: string }>()
  if (productIds.size > 0) {
    const ids = Array.from(productIds)
    const [prodRes, partRes] = await Promise.all([
      sb.from('products').select('id, name, cost_cents').eq('tenant_id', tenantId).in('id', ids),
      sb.from('parts_catalog').select('id, name, cost_cents').eq('tenant_id', tenantId).in('id', ids),
    ])
    for (const p of (prodRes.data ?? []) as { id: string; name: string; cost_cents: number | null }[]) {
      fallbackCost.set(p.id, { cost: p.cost_cents ?? 0, name: p.name })
    }
    for (const p of (partRes.data ?? []) as { id: string; name: string; cost_cents: number | null }[]) {
      if (!fallbackCost.has(p.id)) fallbackCost.set(p.id, { cost: p.cost_cents ?? 0, name: p.name })
    }
  }

  const losing: LosingSale[] = []
  for (const s of data) {
    const items = s.sale_items ?? []
    const detailed: LosingSaleItem[] = items.map(it => {
      const qty       = it.quantity ?? 0
      const revenue   = qty * (it.unit_price_cents ?? 0)
      const fallback  = it.product_id ? fallbackCost.get(it.product_id) : null
      const unitCost  = it.cost_snapshot_cents != null && it.cost_snapshot_cents > 0
        ? it.cost_snapshot_cents
        : (fallback?.cost ?? 0)
      const cost      = qty * unitCost
      const profit    = revenue - cost
      return {
        saleItemId:        it.id,
        name:              it.name,
        productId:         it.product_id,
        productName:       fallback?.name ?? null,
        quantity:          qty,
        unitPriceCents:    it.unit_price_cents ?? 0,
        snapshotCents:     it.cost_snapshot_cents,
        totalRevenueCents: revenue,
        totalCostCents:    cost,
        itemProfitCents:   profit,
        isLosing:          profit < 0,
      }
    })

    const totalCost   = detailed.reduce((s, i) => s + i.totalCostCents, 0)
    const totalRev    = s.total_cents ?? 0
    const profit      = totalRev - totalCost

    if (profit < 0) {
      losing.push({
        saleId:         s.id,
        saleDate:       s.created_at,
        customerName:   s.customers?.full_name ?? null,
        totalCents:     totalRev,
        totalCostCents: totalCost,
        profitCents:    profit,
        items:          detailed,
      })
    }
  }

  return losing.sort((a, b) => a.profitCents - b.profitCents)   // mais negativos primeiro
}

/** Desvincula um sale_item (volta product_id pra null e snapshot pra null). Útil pra desfazer um vínculo errado. */
export async function unlinkSaleItem(saleItemId: string): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Confirma posse
  const { data: si, error: siErr } = await sb
    .from('sale_items')
    .select('id, sales!inner(tenant_id)')
    .eq('id', saleItemId)
    .eq('sales.tenant_id', tenantId)
    .maybeSingle()
  if (siErr || !si) throw new Error('Sale item não encontrado.')

  const { error } = await sb
    .from('sale_items')
    .update({ product_id: null, cost_snapshot_cents: null })
    .eq('id', saleItemId)
  if (error) throw new Error(error.message)

  revalidatePath('/erp-clientes')
  revalidatePath('/erp-clientes/diagnostico-lucro')
  revalidatePath('/analytics/canais')
  return { ok: true }
}

// ── Catálogo completo (pra UI de seleção manual) ──────────────────────────

export type CatalogItem = {
  id:        string
  name:      string
  costCents: number
  source:    'products' | 'parts_catalog'
}

export async function getAllCatalogItems(): Promise<CatalogItem[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [prodRes, partRes] = await Promise.all([
    sb.from('products').select('id, name, cost_cents').eq('tenant_id', tenantId).order('name').limit(10000),
    sb.from('parts_catalog').select('id, name, cost_cents').eq('tenant_id', tenantId).order('name').limit(10000),
  ])

  const items: CatalogItem[] = [
    ...((prodRes.data ?? []) as { id: string; name: string; cost_cents: number | null }[]).map(p => ({
      id: p.id, name: p.name, costCents: p.cost_cents ?? 0, source: 'products' as const,
    })),
    ...((partRes.data ?? []) as { id: string; name: string; cost_cents: number | null }[]).map(p => ({
      id: p.id, name: p.name, costCents: p.cost_cents ?? 0, source: 'parts_catalog' as const,
    })),
  ]

  return items.sort((a, b) => a.name.localeCompare(b.name))
}

// ── Sale items órfãos (sem product_id) ─────────────────────────────────────
// Causa raiz: usuário usou "adicionar item manual" no POS em vez de selecionar
// do estoque. Resultado: a venda nunca teve product_id, então nunca conseguiu
// gravar snapshot nem puxar custo. Aqui a gente tenta encontrar o produto
// certo por nome (exato ou fuzzy) pra vincular retroativamente.

export type OrphanItemMatch = {
  productId:    string
  productName:  string
  costCents:    number
  source:       'products' | 'parts_catalog'
  matchType:    'exact' | 'fuzzy' | 'tokens'
  score:        number   // 0..1 — útil pra debug e ordenação
}

export type OrphanSaleItem = {
  saleItemId:      string
  saleId:          string
  saleDate:        string
  customerName:    string | null
  itemName:        string
  quantity:        number
  unitPriceCents:  number
  matches:         OrphanItemMatch[]
  bestMatch:       OrphanItemMatch | null   // melhor candidato (ou null se nenhum)
  hasUniqueExact:  boolean                  // true se tem 1 e só 1 match exato
  catalogStats?:   { products: number; parts: number }   // só anexa no primeiro item, pra debug
}

function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
    .replace(/[^a-z0-9 ]/gi, ' ')             // tira pontuação/símbolos
    .replace(/\s+/g, ' ')
    .trim()
}

const STOPWORDS = new Set(['de', 'do', 'da', 'para', 'com', 'sem', 'e', 'a', 'o', 'os', 'as', 'um', 'uma', 'gb', 'ram', 'g'])

function tokens(normName: string): string[] {
  return normName.split(' ').filter(t => t.length >= 2 && !STOPWORDS.has(t))
}

/** Jaccard sobre tokens significativos: |A∩B| / |A∪B|. */
function tokenScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  const union = setA.size + setB.size - inter
  return union > 0 ? inter / union : 0
}

export async function findOrphanSaleItems(period: DiagPeriod = '30d'): Promise<OrphanSaleItem[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const sinceIso = periodToSinceIso(period)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // 1) Sale items do período sem product_id, da venda não-cancelada
  const { data: items, error } = await sb
    .from('sale_items')
    .select('id, name, quantity, unit_price_cents, sale_id, sales!inner(id, created_at, status, tenant_id, customers(full_name))')
    .eq('sales.tenant_id', tenantId)
    .gte('sales.created_at', sinceIso)
    .neq('sales.status', 'cancelled')
    .is('product_id', null)
    .limit(2000)

  if (error) throw new Error(error.message)

  type Row = {
    id: string; name: string; quantity: number; unit_price_cents: number; sale_id: string
    sales: { id: string; created_at: string; status: string; tenant_id: string; customers: { full_name: string } | null } | null
  }
  const rows = (items ?? []) as Row[]

  if (rows.length === 0) return []

  // 2) Pega TODOS os produtos e peças do tenant (geralmente algumas centenas).
  const [prodRes, partRes] = await Promise.all([
    sb.from('products').select('id, name, cost_cents').eq('tenant_id', tenantId).limit(5000),
    sb.from('parts_catalog').select('id, name, cost_cents').eq('tenant_id', tenantId).limit(5000),
  ])

  type Cat = { id: string; name: string; cost_cents: number | null; source: 'products' | 'parts_catalog' }
  const catalog: Cat[] = [
    ...((prodRes.data ?? []) as { id: string; name: string; cost_cents: number | null }[]).map(p => ({ ...p, source: 'products' as const })),
    ...((partRes.data ?? []) as { id: string; name: string; cost_cents: number | null }[]).map(p => ({ ...p, source: 'parts_catalog' as const })),
  ]
  const catalogStats = {
    products: (prodRes.data ?? []).length,
    parts:    (partRes.data ?? []).length,
  }

  // Pre-normaliza pra match rápido
  const normalized = catalog.map(c => {
    const normName = normalize(c.name)
    return { ...c, normName, normTokens: tokens(normName) }
  })

  const result: OrphanSaleItem[] = rows.map((r, idx) => {
    const itemNorm   = normalize(r.name)
    const itemTokens = tokens(itemNorm)

    // 1) Match exato (após normalização)
    const exact = normalized
      .filter(c => c.normName === itemNorm)
      .map<OrphanItemMatch>(c => ({
        productId:   c.id,
        productName: c.name,
        costCents:   c.cost_cents ?? 0,
        source:      c.source,
        matchType:   'exact',
        score:       1,
      }))

    let fuzzy:  OrphanItemMatch[] = []
    let token:  OrphanItemMatch[] = []

    if (exact.length === 0) {
      // 2) Fuzzy (substring nos dois sentidos)
      fuzzy = normalized
        .filter(c => {
          if (itemNorm.length < 4 || c.normName.length < 4) return false
          return c.normName.includes(itemNorm) || itemNorm.includes(c.normName)
        })
        .map<OrphanItemMatch>(c => {
          const overlap = Math.min(c.normName.length, itemNorm.length)
          const total   = Math.max(c.normName.length, itemNorm.length)
          return {
            productId:   c.id,
            productName: c.name,
            costCents:   c.cost_cents ?? 0,
            source:      c.source,
            matchType:   'fuzzy',
            score:       total > 0 ? overlap / total : 0,
          }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)

      // 3) Token-based (Jaccard sobre palavras significativas)
      // Threshold baixíssimo (10%) — preferimos mostrar candidatos fracos
      // do que esconder e deixar o usuário sem opção.
      token = normalized
        .map<OrphanItemMatch>(c => ({
          productId:   c.id,
          productName: c.name,
          costCents:   c.cost_cents ?? 0,
          source:      c.source,
          matchType:   'tokens',
          score:       tokenScore(itemTokens, c.normTokens),
        }))
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
    }

    // Merge dedupado por productId, preservando ordem (exact > fuzzy > tokens)
    const seen = new Set<string>()
    const matches: OrphanItemMatch[] = []
    for (const m of [...exact, ...fuzzy, ...token]) {
      if (seen.has(m.productId)) continue
      seen.add(m.productId)
      matches.push(m)
    }

    const bestMatch = matches[0] ?? null
    const hasUniqueExact = exact.length === 1

    return {
      saleItemId:     r.id,
      saleId:         r.sale_id,
      saleDate:       r.sales?.created_at ?? '',
      customerName:   r.sales?.customers?.full_name ?? null,
      itemName:       r.name,
      quantity:       r.quantity,
      unitPriceCents: r.unit_price_cents,
      matches,
      bestMatch,
      hasUniqueExact,
      catalogStats:   idx === 0 ? catalogStats : undefined,
    }
  })

  return result.sort((a, b) => b.saleDate.localeCompare(a.saleDate))
}

/** Vincula 1 sale_item ao produto escolhido + preenche cost_snapshot_cents. */
export async function linkOrphanSaleItem(
  saleItemId: string,
  productId:  string,
): Promise<{ ok: true }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Confirma que o produto pertence ao tenant (segurança).
  const [prodRes, partRes] = await Promise.all([
    sb.from('products').select('id, cost_cents').eq('id', productId).eq('tenant_id', tenantId).maybeSingle(),
    sb.from('parts_catalog').select('id, cost_cents').eq('id', productId).eq('tenant_id', tenantId).maybeSingle(),
  ])
  const prod = prodRes.data ?? partRes.data
  if (!prod) throw new Error('Produto não encontrado neste tenant.')

  const cost = (prod as { cost_cents: number | null }).cost_cents ?? 0

  // Confirma que o sale_item pertence a uma venda do tenant.
  const { data: si, error: siErr } = await sb
    .from('sale_items')
    .select('id, sale_id, sales!inner(tenant_id)')
    .eq('id', saleItemId)
    .eq('sales.tenant_id', tenantId)
    .maybeSingle()
  if (siErr || !si) throw new Error('Sale item não encontrado.')

  const { error: upErr } = await sb
    .from('sale_items')
    .update({
      product_id:          productId,
      cost_snapshot_cents: cost > 0 ? cost : null,
    })
    .eq('id', saleItemId)

  if (upErr) throw new Error(upErr.message)

  revalidatePath('/erp-clientes')
  revalidatePath('/erp-clientes/diagnostico-lucro')
  revalidatePath('/analytics/canais')
  return { ok: true }
}

/** Auto-vincula TODOS os órfãos do período que tem 1 match exato único. */
export async function autoLinkExactMatches(period: DiagPeriod = '30d'): Promise<{ linked: number; skipped: number }> {
  const orphans = await findOrphanSaleItems(period)
  let linked = 0
  let skipped = 0
  for (const o of orphans) {
    if (!o.hasUniqueExact || !o.bestMatch) { skipped++; continue }
    try {
      await linkOrphanSaleItem(o.saleItemId, o.bestMatch.productId)
      linked++
    } catch {
      skipped++
    }
  }
  return { linked, skipped }
}

/**
 * Backfilla `cost_snapshot_cents` em sale_items que estão null/0,
 * usando o `cost_cents` atual do produto (ou parts_catalog) referenciado.
 *
 * Limitação conhecida: usa o custo ATUAL, não o custo no momento da venda.
 * Mais correto que zero, mas pode super/subestimar lucro se o custo do
 * produto mudou desde a venda. Por isso só rodamos quando o usuário
 * confirma na UI.
 *
 * Só toca itens onde:
 *  - snapshot é null OU 0
 *  - product_id existe
 *  - products.cost_cents (ou parts_catalog.cost_cents) > 0
 */
export async function backfillSaleItemsCostSnapshot(): Promise<{ updated: number; skipped: number }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // 1) Pega TODOS os sale_items do tenant com snapshot null/0 e product_id preenchido.
  const { data: items, error: itemsErr } = await sb
    .from('sale_items')
    .select('id, product_id, cost_snapshot_cents, sales!inner(tenant_id)')
    .eq('sales.tenant_id', tenantId)
    .or('cost_snapshot_cents.is.null,cost_snapshot_cents.eq.0')
    .not('product_id', 'is', null)
    .limit(20000)

  if (itemsErr) throw new Error(itemsErr.message)
  type ItemRow = { id: string; product_id: string; cost_snapshot_cents: number | null }
  const rows = (items ?? []) as ItemRow[]

  if (rows.length === 0) return { updated: 0, skipped: 0 }

  // 2) Pega cost_cents de products + parts_catalog pros product_ids referenciados.
  const productIds = Array.from(new Set(rows.map(r => r.product_id)))
  const costMap = new Map<string, number>()
  const [prodRes, partRes] = await Promise.all([
    sb.from('products').select('id, cost_cents').eq('tenant_id', tenantId).in('id', productIds),
    sb.from('parts_catalog').select('id, cost_cents').eq('tenant_id', tenantId).in('id', productIds),
  ])
  for (const p of (prodRes.data ?? []) as { id: string; cost_cents: number | null }[]) {
    if ((p.cost_cents ?? 0) > 0) costMap.set(p.id, p.cost_cents as number)
  }
  for (const p of (partRes.data ?? []) as { id: string; cost_cents: number | null }[]) {
    if (!costMap.has(p.id) && (p.cost_cents ?? 0) > 0) costMap.set(p.id, p.cost_cents as number)
  }

  // 3) Atualiza item a item — usar batch update pelos IDs com mesmo custo
  // ficaria complicado, então fazemos updates individuais. Para 100 vendas
  // é tranquilo (poucos roundtrips).
  let updated = 0
  let skipped = 0

  for (const r of rows) {
    const cost = costMap.get(r.product_id)
    if (!cost) { skipped++; continue }
    const { error: upErr } = await sb
      .from('sale_items')
      .update({ cost_snapshot_cents: cost })
      .eq('id', r.id)
    if (upErr) skipped++
    else       updated++
  }

  revalidatePath('/erp-clientes')
  revalidatePath('/erp-clientes/diagnostico-lucro')
  revalidatePath('/analytics/canais')
  revalidatePath('/relatorios')

  return { updated, skipped }
}
