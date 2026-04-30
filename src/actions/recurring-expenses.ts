'use server'

/**
 * Server actions de despesas recorrentes (custos fixos da loja).
 *
 * Substitui o campo único `tenants.fisica_fixed_cost_cents` por uma lista
 * detalhada por categoria. O total das despesas ativas vira o "custo fixo
 * mensal" usado pra cálculo de break-even no dashboard de Canais.
 *
 * Compatibilidade: se tenant não tem nenhuma despesa cadastrada, fallback
 * pro campo antigo `fisica_fixed_cost_cents` em tenants. (Tratado em
 * `getMonthlyFixedCostCents` abaixo.)
 */

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import type { ExpenseCategory, RecurringExpense } from '@/lib/expense-categories'

/** Lista todas as despesas (ativas e inativas) do tenant. */
export async function listRecurringExpenses(): Promise<RecurringExpense[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('recurring_expenses')
    .select('id, name, category, value_cents, active, created_at')
    .eq('tenant_id', tenantId)
    .order('active', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[listRecurringExpenses] erro:', error.message)
    return []
  }

  type Row = { id: string; name: string; category: string; value_cents: number; active: boolean; created_at: string }
  return ((data ?? []) as Row[]).map(r => ({
    id:         r.id,
    name:       r.name,
    category:   r.category as ExpenseCategory,
    valueCents: r.value_cents,
    active:     r.active,
    createdAt:  r.created_at,
  }))
}

/** Cria nova despesa. */
export async function createRecurringExpense(input: {
  name:     string
  category: ExpenseCategory
  valueCents: number
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const name = input.name.trim()
  if (name.length < 2)            return { ok: false, error: 'Nome muito curto.' }
  if (input.valueCents < 0)       return { ok: false, error: 'Valor não pode ser negativo.' }
  if (!input.category)            return { ok: false, error: 'Categoria obrigatória.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('recurring_expenses')
    .insert({
      tenant_id:   tenantId,
      name,
      category:    input.category,
      value_cents: input.valueCents,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  revalidatePath('/configuracoes')
  revalidatePath('/analytics/canais')
  return { ok: true, id: data.id }
}

/** Atualiza despesa existente. */
export async function updateRecurringExpense(input: {
  id:        string
  name?:     string
  category?: ExpenseCategory
  valueCents?: number
  active?:   boolean
}): Promise<{ ok: boolean; error?: string }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch: any = {}
  if (input.name !== undefined)       patch.name = input.name.trim()
  if (input.category !== undefined)   patch.category = input.category
  if (input.valueCents !== undefined) patch.value_cents = input.valueCents
  if (input.active !== undefined)     patch.active = input.active

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('recurring_expenses')
    .update(patch)
    .eq('id', input.id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/configuracoes')
  revalidatePath('/analytics/canais')
  return { ok: true }
}

/** Apaga despesa. */
export async function deleteRecurringExpense(id: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('recurring_expenses')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/configuracoes')
  revalidatePath('/analytics/canais')
  return { ok: true }
}

/**
 * Retorna o custo fixo mensal total em centavos:
 * - Se tenant tem despesas ativas cadastradas, soma delas.
 * - Senão, fallback pro campo antigo `fisica_fixed_cost_cents` em tenants.
 *
 * Usado pelo dashboard de Canais pra calcular break-even.
 */
export async function getMonthlyFixedCostCents(): Promise<number> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: expenses } = await sb
    .from('recurring_expenses')
    .select('value_cents')
    .eq('tenant_id', tenantId)
    .eq('active', true)

  type Row = { value_cents: number }
  const sum = ((expenses ?? []) as Row[]).reduce((s, r) => s + r.value_cents, 0)

  if (sum > 0) return sum

  // Fallback pro campo legado
  const { data: tenant } = await sb
    .from('tenants').select('fisica_fixed_cost_cents').eq('id', tenantId).maybeSingle()
  return (tenant?.fisica_fixed_cost_cents as number | null) ?? 0
}
