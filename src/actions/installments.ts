'use server'

/**
 * Sprint 4 — Crediário interno.
 *
 * - createInstallmentPlan: cria plan + N installments de uma vez (após sale gravada)
 * - listPendingInstallments: parcelas vencendo + atrasadas (kanban)
 * - markInstallmentPaid: marca parcela como paga; se todas pagas → plan='completed'
 * - listPlansByCustomer: histórico de crediário do cliente (pra score)
 * - getCustomerCreditScore: % parcelas pagas no prazo
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type InstallmentRow = {
  id:                string
  planId:            string
  installmentNumber: number
  amountCents:       number
  dueDate:           string
  status:            'pending' | 'paid' | 'late' | 'cancelled'
  paidAt:            string | null
  paidAmountCents:   number | null
  paymentMethod:     string | null
  notes:             string | null
  // Joins
  customerId:        string
  customerName:      string
  customerWhatsapp:  string | null
  saleId:            string
  totalInstallments: number
}

export type InstallmentPlanRow = {
  id:                  string
  saleId:              string
  customerId:          string
  customerName:        string
  customerWhatsapp:    string | null
  totalCents:          number
  downPaymentCents:    number
  installmentsCount:   number
  installmentValueCents: number
  firstDueDate:        string
  status:              'active' | 'completed' | 'cancelled'
  paidCount:           number
  pendingCount:        number
  lateCount:           number
  createdAt:           string
  notes:               string | null
}

// ──────────────────────────────────────────────────────────────────────────
// createInstallmentPlan — chamado após createSale com paymentMethod='crediario'
// ──────────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  saleId:              z.string().uuid(),
  customerId:          z.string().uuid(),
  totalCents:          z.number().int().min(0),
  downPaymentCents:    z.number().int().min(0).default(0),
  installmentsCount:   z.number().int().min(1).max(36),
  firstDueDate:        z.string(),  // YYYY-MM-DD
  frequency:           z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
  notes:               z.string().max(500).optional().nullable(),
})

export async function createInstallmentPlan(input: unknown): Promise<Result<{ planId: string }>> {
  const parsed = CreateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const financedCents = v.totalCents - v.downPaymentCents
  if (financedCents < v.installmentsCount) {
    return { ok: false, error: 'Valor financiado menor que o número de parcelas.' }
  }

  // Rateio de centavos: divide por N, e a 1ª parcela absorve a sobra
  const baseValue = Math.floor(financedCents / v.installmentsCount)
  const remainder = financedCents - (baseValue * v.installmentsCount)

  const { data: plan, error: planError } = await sb
    .from('installment_plans')
    .insert({
      tenant_id:                tenantId,
      sale_id:                  v.saleId,
      customer_id:              v.customerId,
      total_cents:              v.totalCents,
      down_payment_cents:       v.downPaymentCents,
      installments_count:       v.installmentsCount,
      installment_value_cents:  baseValue,
      first_due_date:           v.firstDueDate,
      frequency:                v.frequency,
      status:                   'active',
      notes:                    v.notes?.trim() || null,
    })
    .select('id')
    .single()

  if (planError) return { ok: false, error: planError.message }

  // Cria N installments
  const start = new Date(v.firstDueDate + 'T00:00:00')
  const stepDays = v.frequency === 'weekly' ? 7 : v.frequency === 'biweekly' ? 14 : 30
  const rows = Array.from({ length: v.installmentsCount }, (_, i) => {
    const due = v.frequency === 'monthly'
      ? addMonths(start, i)
      : new Date(start.getTime() + stepDays * i * 86400000)
    return {
      tenant_id:           tenantId,
      plan_id:             plan.id,
      installment_number:  i + 1,
      amount_cents:        i === 0 ? baseValue + remainder : baseValue,
      due_date:            due.toISOString().slice(0, 10),
      status:              'pending',
    }
  })

  const { error: instError } = await sb.from('installments').insert(rows)
  if (instError) return { ok: false, error: instError.message }

  revalidatePath('/financeiro/parcelas')
  return { ok: true, data: { planId: plan.id } }
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d)
  r.setMonth(r.getMonth() + n)
  return r
}

// ──────────────────────────────────────────────────────────────────────────
// listPendingInstallments — pra tela de cobrança
// ──────────────────────────────────────────────────────────────────────────

export async function listPendingInstallments(): Promise<InstallmentRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('installments')
    .select(`
      id, plan_id, installment_number, amount_cents, due_date, status,
      paid_at, paid_amount_cents, payment_method, notes,
      installment_plans!inner(
        id, sale_id, customer_id, installments_count,
        customers(id, full_name, whatsapp)
      )
    `)
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'late'])
    .order('due_date', { ascending: true })
    .limit(500)

  if (error) throw new Error(error.message)

  type Row = {
    id: string; plan_id: string; installment_number: number; amount_cents: number
    due_date: string; status: 'pending' | 'paid' | 'late' | 'cancelled'
    paid_at: string | null; paid_amount_cents: number | null; payment_method: string | null
    notes: string | null
    installment_plans: {
      id: string; sale_id: string; customer_id: string; installments_count: number
      customers: { id: string; full_name: string; whatsapp: string | null } | null
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  return ((data ?? []) as Row[])
    .filter(r => r.installment_plans?.customers)
    .map(r => {
      const isLate = r.status === 'pending' && r.due_date < today
      return {
        id:                r.id,
        planId:            r.plan_id,
        installmentNumber: r.installment_number,
        amountCents:       r.amount_cents,
        dueDate:           r.due_date,
        status:            isLate ? 'late' as const : r.status,
        paidAt:            r.paid_at,
        paidAmountCents:   r.paid_amount_cents,
        paymentMethod:     r.payment_method,
        notes:             r.notes,
        customerId:        r.installment_plans.customers!.id,
        customerName:      r.installment_plans.customers!.full_name,
        customerWhatsapp:  r.installment_plans.customers!.whatsapp,
        saleId:            r.installment_plans.sale_id,
        totalInstallments: r.installment_plans.installments_count,
      }
    })
}

// ──────────────────────────────────────────────────────────────────────────
// markInstallmentPaid
// ──────────────────────────────────────────────────────────────────────────

const MarkPaidSchema = z.object({
  id:             z.string().uuid(),
  paidAmountCents: z.number().int().min(0),
  paymentMethod:  z.enum(['cash', 'pix', 'card', 'transfer', 'mixed']),
  paidAt:         z.string().optional(),  // ISO; default = now
  notes:          z.string().max(500).optional().nullable(),
})

export async function markInstallmentPaid(input: unknown): Promise<Result> {
  const parsed = MarkPaidSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: existing } = await sb
    .from('installments')
    .select('id, plan_id, status')
    .eq('id', v.id).eq('tenant_id', tenantId).maybeSingle()

  if (!existing) return { ok: false, error: 'Parcela não encontrada.' }

  const { error } = await sb
    .from('installments')
    .update({
      status:            'paid',
      paid_at:           v.paidAt || new Date().toISOString(),
      paid_amount_cents: v.paidAmountCents,
      payment_method:    v.paymentMethod,
      notes:             v.notes?.trim() || null,
    })
    .eq('id', v.id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }

  // Se todas as parcelas do plano estão pagas, marca plan como completed
  const { count: pendingCount } = await sb
    .from('installments')
    .select('id', { count: 'exact', head: true })
    .eq('plan_id', existing.plan_id)
    .in('status', ['pending', 'late'])

  if ((pendingCount ?? 0) === 0) {
    await sb
      .from('installment_plans')
      .update({ status: 'completed' })
      .eq('id', existing.plan_id)
      .eq('tenant_id', tenantId)
  }

  revalidatePath('/financeiro/parcelas')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// getCustomerCreditScore — % de parcelas pagas no prazo (heurística simples)
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// setRemindersEnabled / getRemindersEnabled (Sprint 8)
// ──────────────────────────────────────────────────────────────────────────

export async function getRemindersEnabled(): Promise<boolean> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('tenants')
    .select('installment_reminders_enabled')
    .eq('id', tenantId)
    .maybeSingle()

  return (data as { installment_reminders_enabled: boolean } | null)?.installment_reminders_enabled ?? true
}

export async function setRemindersEnabled(enabled: boolean): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('tenants')
    .update({ installment_reminders_enabled: enabled })
    .eq('id', tenantId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/financeiro/parcelas')
  return { ok: true }
}

export type CreditScore = {
  totalInstallments:  number
  paidOnTime:         number
  paidLate:           number
  pending:            number
  scorePct:           number  // 0-100; 100 = todas pagas no prazo
  level:              'excellent' | 'good' | 'regular' | 'poor' | 'no_history'
}

export async function getCustomerCreditScore(customerId: string): Promise<CreditScore> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: plans } = await sb
    .from('installment_plans')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)

  const planIds = ((plans ?? []) as { id: string }[]).map(p => p.id)
  if (planIds.length === 0) {
    return { totalInstallments: 0, paidOnTime: 0, paidLate: 0, pending: 0, scorePct: 0, level: 'no_history' }
  }

  const { data: insts } = await sb
    .from('installments')
    .select('status, due_date, paid_at')
    .in('plan_id', planIds)

  type Inst = { status: string; due_date: string; paid_at: string | null }
  const list = (insts ?? []) as Inst[]
  let paidOnTime = 0, paidLate = 0, pending = 0
  for (const i of list) {
    if (i.status === 'paid') {
      const due = new Date(i.due_date + 'T23:59:59')
      const paid = i.paid_at ? new Date(i.paid_at) : null
      if (paid && paid.getTime() <= due.getTime() + 86400000) paidOnTime++  // 1 dia de tolerância
      else paidLate++
    } else if (i.status === 'pending' || i.status === 'late') {
      pending++
    }
  }

  const total = paidOnTime + paidLate
  const scorePct = total > 0 ? Math.round((paidOnTime / total) * 100) : 0

  const level: CreditScore['level'] =
    total === 0      ? 'no_history' :
    scorePct >= 95   ? 'excellent'  :
    scorePct >= 80   ? 'good'       :
    scorePct >= 60   ? 'regular'    :
                       'poor'

  return {
    totalInstallments: list.length,
    paidOnTime,
    paidLate,
    pending,
    scorePct,
    level,
  }
}
