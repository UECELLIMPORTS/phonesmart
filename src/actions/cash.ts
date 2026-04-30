'use server'

/**
 * Server Actions de gestão de sessões de caixa (POS).
 *
 * Fluxo:
 * 1. Operador abre caixa com valor inicial (`openCashSession`).
 * 2. Vendas feitas no /pos ficam associadas via sales.cash_session_id.
 * 3. Operador fecha caixa (`closeCashSession`) informando valor contado.
 *    Sistema calcula breakdown por forma de pagamento e diferença
 *    (esperado vs contado).
 * 4. Se 23:59 BRT chega e caixa não foi fechado, cron `auto-close-cash`
 *    fecha automaticamente com status='auto_closed'.
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

export type CashSession = {
  id:                   string
  openedAt:             string
  closedAt:             string | null
  openedByUserId:       string
  closedByUserId:       string | null
  openingBalanceCents:  number
  closingCountedCents:  number | null
  status:               'open' | 'closed' | 'auto_closed'
  notes:                string | null
}

export type PaymentBreakdown = {
  paymentMethod: string
  totalCents:    number
  count:         number
}

export type CashSessionSummary = {
  session:           CashSession
  salesCount:        number
  totalSalesCents:   number      // soma de total_cents
  cashSalesCents:    number      // total das vendas em dinheiro
  expectedCashCents: number      // opening_balance + cash_sales
  differenceCents:   number | null  // expected - counted (null se sessão aberta)
  breakdown:         PaymentBreakdown[]
}

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

// ──────────────────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────────────────

/** Sessão atualmente aberta no tenant (ou null se nenhuma). */
export async function getActiveCashSession(): Promise<CashSession | null> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data } = await sb
    .from('cash_sessions')
    .select('id, opened_at, closed_at, opened_by_user_id, closed_by_user_id, opening_balance_cents, closing_counted_cents, status, notes')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .maybeSingle()

  if (!data) return null
  return mapSession(data)
}

/**
 * Última sessão fechada/auto-fechada. Útil pra mostrar resultado do dia
 * anterior na tela de "abrir caixa", e avisar se foi auto-fechada.
 */
export async function getLastClosedSession(): Promise<CashSessionSummary | null> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data } = await sb
    .from('cash_sessions')
    .select('id, opened_at, closed_at, opened_by_user_id, closed_by_user_id, opening_balance_cents, closing_counted_cents, status, notes')
    .eq('tenant_id', tenantId)
    .in('status', ['closed', 'auto_closed'])
    .order('closed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return computeSummary(mapSession(data), tenantId)
}

/** Resumo da sessão (sales + breakdown). Funciona pra sessão aberta ou fechada. */
export async function getCashSessionSummary(sessionId: string): Promise<CashSessionSummary | null> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data } = await sb
    .from('cash_sessions')
    .select('id, opened_at, closed_at, opened_by_user_id, closed_by_user_id, opening_balance_cents, closing_counted_cents, status, notes')
    .eq('id', sessionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data) return null
  return computeSummary(mapSession(data), tenantId)
}

// ──────────────────────────────────────────────────────────────────────────
// Actions
// ──────────────────────────────────────────────────────────────────────────

export async function openCashSession(input: {
  openingBalanceCents: number
  notes?:              string
}): Promise<Result<{ id: string }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (input.openingBalanceCents < 0) {
    return { ok: false, error: 'Valor inicial não pode ser negativo.' }
  }
  if (input.openingBalanceCents > 100_000_00) {
    return { ok: false, error: 'Valor inicial absurdamente alto. Confira.' }
  }

  // Garante que não tem outra sessão aberta (UNIQUE index já protege, mas
  // dá erro mais amigável)
  const existing = await getActiveCashSession()
  if (existing) {
    return { ok: false, error: 'Já existe um caixa aberto. Feche o atual antes de abrir outro.' }
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data, error } = await sb
    .from('cash_sessions')
    .insert({
      tenant_id:             tenantId,
      opened_by_user_id:     user.id,
      opening_balance_cents: input.openingBalanceCents,
      notes:                 input.notes ?? null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: `Erro ao abrir caixa: ${error.message}` }

  revalidatePath('/pos')
  return { ok: true, data: { id: data.id } }
}

export async function closeCashSession(input: {
  countedCents: number
  notes?:       string
}): Promise<Result<{ summary: CashSessionSummary }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (input.countedCents < 0) {
    return { ok: false, error: 'Valor contado não pode ser negativo.' }
  }

  const session = await getActiveCashSession()
  if (!session) return { ok: false, error: 'Nenhum caixa aberto pra fechar.' }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { error } = await sb
    .from('cash_sessions')
    .update({
      status:                'closed',
      closed_at:             new Date().toISOString(),
      closed_by_user_id:     user.id,
      closing_counted_cents: input.countedCents,
      notes:                 input.notes ?? session.notes,
    })
    .eq('id', session.id)

  if (error) return { ok: false, error: `Erro ao fechar caixa: ${error.message}` }

  // Pega summary final (com status='closed' já)
  const summary = await getCashSessionSummary(session.id)
  if (!summary) return { ok: false, error: 'Sessão fechada mas summary não encontrado.' }

  revalidatePath('/pos')
  return { ok: true, data: { summary } }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────────────────

type SessionRow = {
  id:                       string
  opened_at:                string
  closed_at:                string | null
  opened_by_user_id:        string
  closed_by_user_id:        string | null
  opening_balance_cents:    number
  closing_counted_cents:    number | null
  status:                   'open' | 'closed' | 'auto_closed'
  notes:                    string | null
}

function mapSession(row: SessionRow): CashSession {
  return {
    id:                  row.id,
    openedAt:            row.opened_at,
    closedAt:            row.closed_at,
    openedByUserId:      row.opened_by_user_id,
    closedByUserId:      row.closed_by_user_id,
    openingBalanceCents: row.opening_balance_cents,
    closingCountedCents: row.closing_counted_cents,
    status:              row.status,
    notes:               row.notes,
  }
}

async function computeSummary(session: CashSession, tenantId: string): Promise<CashSessionSummary> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: sales } = await sb
    .from('sales')
    .select('total_cents, payment_method, status')
    .eq('cash_session_id', session.id)
    .eq('tenant_id', tenantId)
    .neq('status', 'cancelled')

  type SaleRow = { total_cents: number; payment_method: string | null; status: string }
  const rows = (sales ?? []) as SaleRow[]

  const breakdownMap = new Map<string, PaymentBreakdown>()
  let totalSales = 0
  let cashSales  = 0

  for (const r of rows) {
    const method = (r.payment_method ?? 'outros').toLowerCase()
    totalSales += r.total_cents
    if (method === 'dinheiro' || method === 'cash') {
      cashSales += r.total_cents
    }
    const existing = breakdownMap.get(method) ?? { paymentMethod: method, totalCents: 0, count: 0 }
    existing.totalCents += r.total_cents
    existing.count++
    breakdownMap.set(method, existing)
  }

  const expectedCash = session.openingBalanceCents + cashSales
  const counted = session.closingCountedCents
  const difference = counted !== null ? counted - expectedCash : null

  return {
    session,
    salesCount:        rows.length,
    totalSalesCents:   totalSales,
    cashSalesCents:    cashSales,
    expectedCashCents: expectedCash,
    differenceCents:   difference,
    breakdown:         Array.from(breakdownMap.values())
      .sort((a, b) => b.totalCents - a.totalCents),
  }
}
