'use server'

/**
 * Sprint 16 — Cupons rastreáveis por cliente.
 *
 * Cupom é genérico (mesmo `code` pra muitos clientes via campanha) MAS tem
 * 1 row por (tenant, customer, code). Validação no PDV: só aceita se existe
 * row pra esse customer, não usado, dentro da validade.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type CouponValidation = {
  valid:        boolean
  message:      string
  couponId?:    string
  discountPct?: number
  validUntil?:  string
}

// ──────────────────────────────────────────────────────────────────────────
// validateCoupon — chamado pelo PDV antes de aplicar
// ──────────────────────────────────────────────────────────────────────────

export async function validateCoupon(input: {
  code:       string
  customerId: string
}): Promise<CouponValidation> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const code = input.code.trim().toUpperCase()
  if (code.length < 3) return { valid: false, message: 'Código de cupom inválido.' }
  if (!input.customerId) return { valid: false, message: 'Selecione um cliente cadastrado pra usar cupom.' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const today = new Date().toISOString().slice(0, 10)

  const { data } = await sb
    .from('customer_coupons')
    .select('id, discount_pct, valid_until, used_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', input.customerId)
    .eq('code', code)
    .order('valid_until', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return { valid: false, message: 'Cupom não encontrado pra este cliente.' }
  if (data.used_at) return { valid: false, message: 'Este cupom já foi utilizado.' }
  if (data.valid_until < today) {
    return { valid: false, message: `Cupom expirou em ${formatDate(data.valid_until)}.` }
  }

  return {
    valid:       true,
    message:     `Desconto de ${data.discount_pct}% aplicado.`,
    couponId:    data.id,
    discountPct: data.discount_pct,
    validUntil:  data.valid_until,
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// ──────────────────────────────────────────────────────────────────────────
// markCouponUsed — chamado pelo createSale após gravar venda
// ──────────────────────────────────────────────────────────────────────────

export async function markCouponUsed(input: {
  couponId: string
  saleId:   string
}): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('customer_coupons')
    .update({
      used_at:        new Date().toISOString(),
      used_in_sale_id: input.saleId,
    })
    .eq('id', input.couponId)
    .eq('tenant_id', tenantId)
    .is('used_at', null)  // anti race

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// createCoupon — usado pelo cron de reativação (e futuras campanhas)
// ──────────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  customerId:  z.string().uuid(),
  code:        z.string().min(3).max(40),
  type:        z.enum(['reactivation', 'birthday', 'manual']),
  discountPct: z.number().int().min(0).max(100),
  validDays:   z.number().int().min(1).max(365),
  notes:       z.string().max(500).optional().nullable(),
})

export async function createCoupon(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = CreateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data
  const code = v.code.trim().toUpperCase()

  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + v.validDays)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('customer_coupons')
    .insert({
      tenant_id:    tenantId,
      customer_id:  v.customerId,
      code,
      type:         v.type,
      discount_pct: v.discountPct,
      valid_until:  validUntil.toISOString().slice(0, 10),
      notes:        v.notes ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // Se UNIQUE INDEX falhou, é porque já tem cupom ativo do mesmo código pro mesmo cliente
    if (error.code === '23505') {
      return { ok: false, error: 'Cliente já tem cupom ativo desse código.' }
    }
    return { ok: false, error: error.message }
  }

  revalidatePath('/clientes')
  return { ok: true, data: { id: data.id } }
}

// ──────────────────────────────────────────────────────────────────────────
// listCustomerCoupons — pra UI mostrar histórico de cupons do cliente
// ──────────────────────────────────────────────────────────────────────────

export type CouponRow = {
  id:          string
  code:        string
  type:        string
  discountPct: number
  validUntil:  string
  usedAt:      string | null
  usedInSaleId: string | null
  createdAt:   string
}

export async function listCustomerCoupons(customerId: string): Promise<CouponRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('customer_coupons')
    .select('id, code, type, discount_pct, valid_until, used_at, used_in_sale_id, created_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(50)

  type Row = {
    id: string; code: string; type: string; discount_pct: number
    valid_until: string; used_at: string | null; used_in_sale_id: string | null
    created_at: string
  }
  return ((data ?? []) as Row[]).map(r => ({
    id:           r.id,
    code:         r.code,
    type:         r.type,
    discountPct:  r.discount_pct,
    validUntil:   r.valid_until,
    usedAt:       r.used_at,
    usedInSaleId: r.used_in_sale_id,
    createdAt:    r.created_at,
  }))
}
