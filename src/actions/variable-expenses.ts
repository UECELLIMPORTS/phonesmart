'use server'

/**
 * Server Actions de gastos variáveis (módulo /gastos).
 *
 * - createVariableExpense, updateVariableExpense, deleteVariableExpense
 * - listVariableExpenses (com filtros e paginação)
 * - getVariableExpensesAnalytics (KPIs, daily, by category, by weekday)
 * - exportVariableExpensesCsv
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { categoryLabel, isValidCategory } from '@/lib/variable-expense-categories'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type VariableExpense = {
  id:            string
  occurredAt:    string         // ISO date (YYYY-MM-DD)
  amountCents:   number
  category:      string
  categoryLabel: string
  description:   string | null
  paymentMethod: string | null
  createdAt:     string
}

const InputSchema = z.object({
  occurredAt:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD).'),
  amountCents:   z.number().int().positive('Valor deve ser maior que zero.'),
  category:      z.string().refine(isValidCategory, 'Categoria inválida.'),
  description:   z.string().max(500).optional().nullable(),
  paymentMethod: z.enum(['cash', 'pix', 'card']).optional().nullable(),
})

// ──────────────────────────────────────────────────────────────────────────
// Create / Update / Delete
// ──────────────────────────────────────────────────────────────────────────

export async function createVariableExpense(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }
  }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('variable_expenses')
    .insert({
      tenant_id:      tenantId,
      occurred_at:    v.occurredAt,
      amount_cents:   v.amountCents,
      category:       v.category,
      description:    v.description?.trim() || null,
      payment_method: v.paymentMethod || null,
      created_by:     user.id,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }
  revalidatePath('/gastos')
  revalidatePath('/relatorios')
  return { ok: true, data: { id: data.id as string } }
}

export async function updateVariableExpense(id: string, input: unknown): Promise<Result> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('variable_expenses')
    .update({
      occurred_at:    v.occurredAt,
      amount_cents:   v.amountCents,
      category:       v.category,
      description:    v.description?.trim() || null,
      payment_method: v.paymentMethod || null,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/gastos')
  revalidatePath('/relatorios')
  return { ok: true }
}

export async function deleteVariableExpense(id: string): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('variable_expenses')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/gastos')
  revalidatePath('/relatorios')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// List (filtros)
// ──────────────────────────────────────────────────────────────────────────

export type ListFilters = {
  startISO?:  string  // YYYY-MM-DD
  endISO?:    string
  category?:  string
  search?:    string
}

export async function listVariableExpenses(filters?: ListFilters): Promise<VariableExpense[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  let q = sb
    .from('variable_expenses')
    .select('id, occurred_at, amount_cents, category, description, payment_method, created_at')
    .eq('tenant_id', tenantId)
    .order('occurred_at', { ascending: false })
    .order('created_at',  { ascending: false })
    .limit(2000)

  if (filters?.startISO) q = q.gte('occurred_at', filters.startISO)
  if (filters?.endISO)   q = q.lte('occurred_at', filters.endISO)
  if (filters?.category) q = q.eq('category', filters.category)
  if (filters?.search?.trim()) q = q.ilike('description', `%${filters.search.trim()}%`)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  type Row = {
    id: string; occurred_at: string; amount_cents: number; category: string
    description: string | null; payment_method: string | null; created_at: string
  }
  return ((data ?? []) as Row[]).map(r => ({
    id:            r.id,
    occurredAt:    r.occurred_at,
    amountCents:   r.amount_cents,
    category:      r.category,
    categoryLabel: categoryLabel(r.category),
    description:   r.description,
    paymentMethod: r.payment_method,
    createdAt:     r.created_at,
  }))
}

// ──────────────────────────────────────────────────────────────────────────
// Analytics (KPIs + agregações pros gráficos)
// ──────────────────────────────────────────────────────────────────────────

export type ExpenseAnalytics = {
  totalCents:      number
  count:           number
  avgPerDayCents:  number
  topCategory:     { key: string; label: string; cents: number } | null
  topWeekday:      { dayIndex: number; label: string; cents: number } | null
  byCategory:      { key: string; label: string; cents: number; count: number; pct: number }[]
  daily:           { date: string; cents: number }[]
  byWeekday:       { dayIndex: number; label: string; cents: number; count: number }[]
}

const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

export async function getVariableExpensesAnalytics(filters?: ListFilters): Promise<ExpenseAnalytics> {
  const all = await listVariableExpenses(filters)

  let totalCents = 0
  const byCat = new Map<string, { cents: number; count: number }>()
  const byDay = new Map<string, number>()
  const byWd  = new Map<number, { cents: number; count: number }>()

  for (const e of all) {
    totalCents += e.amountCents
    const ec = byCat.get(e.category) ?? { cents: 0, count: 0 }
    ec.cents += e.amountCents; ec.count++
    byCat.set(e.category, ec)

    const dayCents = byDay.get(e.occurredAt) ?? 0
    byDay.set(e.occurredAt, dayCents + e.amountCents)

    // dayIndex 0=Domingo … 6=Sábado. Note: occurredAt é YYYY-MM-DD; usamos meio-dia
    // BRT pra garantir o dia certo independente do timezone.
    const wdIdx = new Date(e.occurredAt + 'T12:00:00').getDay()
    const wd = byWd.get(wdIdx) ?? { cents: 0, count: 0 }
    wd.cents += e.amountCents; wd.count++
    byWd.set(wdIdx, wd)
  }

  const byCategory = Array.from(byCat.entries())
    .map(([key, v]) => ({
      key,
      label: categoryLabel(key),
      cents: v.cents,
      count: v.count,
      pct:   totalCents > 0 ? v.cents / totalCents : 0,
    }))
    .sort((a, b) => b.cents - a.cents)

  const daily = Array.from(byDay.entries())
    .map(([date, cents]) => ({ date, cents }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const byWeekday = Array.from({ length: 7 }, (_, i) => {
    const v = byWd.get(i) ?? { cents: 0, count: 0 }
    return { dayIndex: i, label: WEEKDAY_LABELS[i], cents: v.cents, count: v.count }
  })

  const distinctDays = byDay.size || 1
  const topCategory = byCategory[0] ? { key: byCategory[0].key, label: byCategory[0].label, cents: byCategory[0].cents } : null
  const topWeekday  = [...byWeekday].sort((a, b) => b.cents - a.cents)[0]
  const topWd = topWeekday && topWeekday.cents > 0
    ? { dayIndex: topWeekday.dayIndex, label: topWeekday.label, cents: topWeekday.cents }
    : null

  return {
    totalCents,
    count:          all.length,
    avgPerDayCents: Math.round(totalCents / distinctDays),
    topCategory,
    topWeekday:     topWd,
    byCategory,
    daily,
    byWeekday,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Export CSV (pra Google Sheets)
// ──────────────────────────────────────────────────────────────────────────

export async function exportVariableExpensesCsv(filters?: ListFilters): Promise<{ ok: true; csv: string }> {
  const all = await listVariableExpenses(filters)

  const header = ['Data', 'Categoria', 'Descrição', 'Forma de pagamento', 'Valor (R$)']
  const lines = [header.join(',')]

  const PM_LABEL: Record<string, string> = { cash: 'Dinheiro', pix: 'PIX', card: 'Cartão' }

  for (const e of all) {
    const dateBR = new Date(e.occurredAt + 'T12:00:00').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    const valor = (e.amountCents / 100).toFixed(2).replace('.', ',')
    const desc  = (e.description ?? '').replace(/"/g, '""')
    const pm    = e.paymentMethod ? (PM_LABEL[e.paymentMethod] ?? e.paymentMethod) : ''
    lines.push([
      dateBR,
      `"${e.categoryLabel}"`,
      `"${desc}"`,
      `"${pm}"`,
      valor,
    ].join(','))
  }

  return { ok: true, csv: lines.join('\n') }
}

// ──────────────────────────────────────────────────────────────────────────
// Total no período (usado pelo /relatorios pra calcular Lucro Líquido)
// ──────────────────────────────────────────────────────────────────────────

export async function getVariableExpensesTotalCents(startISO: string, endISO: string): Promise<number> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('variable_expenses')
    .select('amount_cents')
    .eq('tenant_id', tenantId)
    .gte('occurred_at', startISO)
    .lte('occurred_at', endISO)
    .limit(20000)

  return ((data ?? []) as { amount_cents: number }[]).reduce((s, r) => s + r.amount_cents, 0)
}
