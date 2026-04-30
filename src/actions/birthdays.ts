'use server'

/**
 * Server Actions de aniversariantes.
 *
 * - listBirthdayCustomers (filtros: 'today' | 'week' | 'month')
 * - markBirthdayContacted: registra que cliente foi parabenizado este ano
 * - getBirthdayMessage: gera mensagem renderizada pra um cliente específico
 * - getBirthdayConfig + saveBirthdayConfig: template + desconto editáveis
 * - validateBirthdayCoupon: valida cupom no PDV (cliente tem aniversário no
 *   mês? não usou ainda este ano?)
 * - countTodayBirthdays: contagem rápida pro badge do dashboard
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  parseBirthDate, renderBirthdayMessage, birthMonthDay,
  DEFAULT_BIRTHDAY_TEMPLATE, birthdayCouponCode,
} from '@/lib/birthday-utils'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type BirthdayCustomer = {
  id:           string
  fullName:     string
  whatsapp:     string | null
  phone:        string | null
  email:        string | null
  birthDate:    string
  // Computed
  dateBR:       string
  whenLabel:    string
  age:          number | null
  isToday:      boolean
  daysUntil:    number
  // Tracking
  lastContactYear: number | null
  alreadyContactedThisYear: boolean
  alreadyUsedCouponThisYear: boolean
}

// ──────────────────────────────────────────────────────────────────────────
// List
// ──────────────────────────────────────────────────────────────────────────

export type BirthdayFilter = 'today' | 'week' | 'month' | 'all'

export async function listBirthdayCustomers(filter: BirthdayFilter = 'month'): Promise<BirthdayCustomer[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('customers')
    .select('id, full_name, whatsapp, phone, email, birth_date, last_birthday_contact_year, birth_discount_used_year')
    .eq('tenant_id', tenantId)
    .not('birth_date', 'is', null)
    .order('full_name')
    .limit(2000)

  type Row = {
    id: string; full_name: string; whatsapp: string | null; phone: string | null
    email: string | null; birth_date: string
    last_birthday_contact_year: number | null
    birth_discount_used_year: number | null
  }

  const today = new Date()
  const todayYear = today.getFullYear()
  const rows = (data ?? []) as Row[]

  // Decora cada cliente com info de aniversário
  const decorated = rows
    .map(r => {
      const info = parseBirthDate(r.birth_date, today)
      if (!info) return null
      return {
        id:                         r.id,
        fullName:                   r.full_name,
        whatsapp:                   r.whatsapp,
        phone:                      r.phone,
        email:                      r.email,
        birthDate:                  r.birth_date,
        dateBR:                     info.dateBR,
        whenLabel:                  info.whenLabel,
        age:                        info.age,
        isToday:                    info.isToday,
        daysUntil:                  info.daysUntil,
        lastContactYear:            r.last_birthday_contact_year ?? null,
        alreadyContactedThisYear:   r.last_birthday_contact_year === todayYear,
        alreadyUsedCouponThisYear:  r.birth_discount_used_year === todayYear,
      } as BirthdayCustomer
    })
    .filter((x): x is BirthdayCustomer => x !== null)

  // Filtra por janela
  const todayMonth = today.getMonth() + 1
  const filtered = decorated.filter(c => {
    if (filter === 'all') return true
    if (filter === 'today') return c.isToday
    if (filter === 'week')  return c.daysUntil <= 7
    if (filter === 'month') {
      const md = birthMonthDay(c.birthDate)
      return md ? md.month === todayMonth : false
    }
    return true
  })

  // Ordena: hoje primeiro, depois daysUntil ascendente
  return filtered.sort((a, b) => {
    if (a.isToday && !b.isToday) return -1
    if (b.isToday && !a.isToday) return 1
    return a.daysUntil - b.daysUntil
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Mark contacted
// ──────────────────────────────────────────────────────────────────────────

export async function markBirthdayContacted(customerId: string): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const year = new Date().getFullYear()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('customers')
    .update({ last_birthday_contact_year: year })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/aniversariantes')
  return { ok: true }
}

export async function unmarkBirthdayContacted(customerId: string): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('customers')
    .update({ last_birthday_contact_year: null })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/aniversariantes')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// Mensagem renderizada
// ──────────────────────────────────────────────────────────────────────────

export async function getBirthdayMessage(customerId: string): Promise<Result<{ message: string; couponCode: string }>> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [custRes, tenantRes] = await Promise.all([
    sb.from('customers')
      .select('full_name, birth_date')
      .eq('id', customerId).eq('tenant_id', tenantId).maybeSingle(),
    sb.from('tenants')
      .select('name, birthday_message_template, birthday_discount_percent')
      .eq('id', tenantId).maybeSingle(),
  ])

  const cust = custRes.data as { full_name: string; birth_date: string } | null
  const tenant = tenantRes.data as { name: string; birthday_message_template: string | null; birthday_discount_percent: number | null } | null

  if (!cust || !cust.birth_date) return { ok: false, error: 'Cliente sem data de aniversário cadastrada.' }

  const birthInfo = parseBirthDate(cust.birth_date)
  if (!birthInfo) return { ok: false, error: 'Data de aniversário inválida.' }

  const template        = tenant?.birthday_message_template?.trim() || DEFAULT_BIRTHDAY_TEMPLATE
  const discountPercent = tenant?.birthday_discount_percent ?? 10

  const message = renderBirthdayMessage({
    template,
    customerName: cust.full_name,
    birthInfo,
    discountPercent,
    tenantName: tenant?.name ?? 'Loja',
  })

  return { ok: true, data: { message, couponCode: birthdayCouponCode() } }
}

// ──────────────────────────────────────────────────────────────────────────
// Config de aniversários (template + desconto)
// ──────────────────────────────────────────────────────────────────────────

export type BirthdayConfig = {
  template:         string | null  // null = usa default
  discountPercent:  number
}

export async function getBirthdayConfig(): Promise<BirthdayConfig> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('tenants')
    .select('birthday_message_template, birthday_discount_percent')
    .eq('id', tenantId)
    .maybeSingle()

  return {
    template:        data?.birthday_message_template ?? null,
    discountPercent: data?.birthday_discount_percent ?? 10,
  }
}

const ConfigSchema = z.object({
  template:        z.string().max(2000).nullable(),
  discountPercent: z.number().int().min(0).max(100),
})

export async function saveBirthdayConfig(input: unknown): Promise<Result> {
  const parsed = ConfigSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { error } = await sb
    .from('tenants')
    .update({
      birthday_message_template: parsed.data.template?.trim() || null,
      birthday_discount_percent: parsed.data.discountPercent,
    })
    .eq('id', tenantId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/configuracoes')
  revalidatePath('/aniversariantes')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// Cupom de aniversário no PDV
// ──────────────────────────────────────────────────────────────────────────

export type BirthdayCouponValidation =
  | { ok: true;  discountPercent: number; customerName: string }
  | { ok: false; error: string }

/**
 * Valida o cupom de aniversário pra um cliente específico.
 *   - Cliente tem aniversário no mês corrente?
 *   - Cliente já não usou esse ano?
 *   - Código bate com ANIVER{ANO}?
 */
export async function validateBirthdayCoupon(input: {
  customerId: string
  couponCode: string
}): Promise<BirthdayCouponValidation> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const today = new Date()
  const expectedCoupon = birthdayCouponCode(today.getFullYear())
  const code = input.couponCode.trim().toUpperCase()

  if (code !== expectedCoupon) return { ok: false, error: `Cupom inválido. O cupom de aniversário deste ano é "${expectedCoupon}".` }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const [custRes, tenantRes] = await Promise.all([
    sb.from('customers')
      .select('full_name, birth_date, birth_discount_used_year')
      .eq('id', input.customerId).eq('tenant_id', tenantId).maybeSingle(),
    sb.from('tenants')
      .select('birthday_discount_percent').eq('id', tenantId).maybeSingle(),
  ])

  const cust = custRes.data as { full_name: string; birth_date: string | null; birth_discount_used_year: number | null } | null
  if (!cust) return { ok: false, error: 'Cliente não encontrado.' }
  if (!cust.birth_date) return { ok: false, error: 'Cliente sem data de aniversário cadastrada.' }

  const md = birthMonthDay(cust.birth_date)
  if (!md) return { ok: false, error: 'Data de aniversário inválida.' }

  if (md.month !== today.getMonth() + 1) {
    return { ok: false, error: `Cupom só é válido no mês de aniversário do cliente (${md.month.toString().padStart(2, '0')}).` }
  }

  if (cust.birth_discount_used_year === today.getFullYear()) {
    return { ok: false, error: 'Cliente já usou o cupom de aniversário este ano.' }
  }

  const discountPercent = (tenantRes.data as { birthday_discount_percent: number | null } | null)?.birthday_discount_percent ?? 10
  return { ok: true, discountPercent, customerName: cust.full_name }
}

/** Marca o cupom como usado pelo cliente (chamado após criar a venda no PDV). */
export async function markBirthdayCouponUsed(customerId: string): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const year = new Date().getFullYear()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('customers')
    .update({ birth_discount_used_year: year })
    .eq('id', customerId)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// Contagem pra badge do dashboard
// ──────────────────────────────────────────────────────────────────────────

export async function countTodayBirthdays(): Promise<number> {
  const today = await listBirthdayCustomers('today')
  return today.length
}
