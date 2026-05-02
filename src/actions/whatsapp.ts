'use server'

/**
 * Sprint 12 — Conexão e gerenciamento de WhatsApp via Evolution API.
 *
 * Cada tenant tem 1 instância única na Evolution. Lojista escaneia QR dentro
 * do app pra conectar. Mensagens automáticas vão usar a instância dele.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import {
  createInstance, getInstanceQr, getInstanceState,
  logoutInstance, deleteInstance,
  isEvolutionConfigured,
} from '@/lib/evolution'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type WhatsAppStatus = {
  configured:   boolean   // env vars setadas no Vercel
  hasInstance:  boolean   // tenant já tem instância criada
  instanceName: string | null
  state:        'disconnected' | 'connecting' | 'connected' | 'error'
  phone:        string | null
  connectedAt:  string | null
  lastError:    string | null
}

// ──────────────────────────────────────────────────────────────────────────
// getWhatsAppStatus — chamado pela página /configuracoes/whatsapp
// ──────────────────────────────────────────────────────────────────────────

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('tenants')
    .select('whatsapp_instance_name, whatsapp_status, whatsapp_phone, whatsapp_connected_at, whatsapp_last_error')
    .eq('id', tenantId)
    .maybeSingle()

  type Row = {
    whatsapp_instance_name: string | null
    whatsapp_status:        string | null
    whatsapp_phone:         string | null
    whatsapp_connected_at:  string | null
    whatsapp_last_error:    string | null
  }
  const r = (data ?? {}) as Row

  const state: WhatsAppStatus['state'] =
    r.whatsapp_status === 'connected'  ? 'connected'
  : r.whatsapp_status === 'connecting' ? 'connecting'
  : r.whatsapp_status === 'error'      ? 'error'
  :                                       'disconnected'

  return {
    configured:   isEvolutionConfigured(),
    hasInstance:  Boolean(r.whatsapp_instance_name),
    instanceName: r.whatsapp_instance_name,
    state,
    phone:        r.whatsapp_phone,
    connectedAt:  r.whatsapp_connected_at,
    lastError:    r.whatsapp_last_error,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// connectWhatsApp — cria instância na Evolution (ou retorna existente)
// ──────────────────────────────────────────────────────────────────────────

export async function connectWhatsApp(): Promise<Result<{ instanceName: string }>> {
  if (!isEvolutionConfigured()) {
    return { ok: false, error: 'Sistema sem WhatsApp configurado. Contate o administrador.' }
  }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: tenant } = await sb
    .from('tenants')
    .select('whatsapp_instance_name')
    .eq('id', tenantId)
    .maybeSingle()

  // Reusa instância se já existir
  let instanceName: string = (tenant as { whatsapp_instance_name: string | null } | null)?.whatsapp_instance_name ?? ''
  if (!instanceName) {
    instanceName = `tenant-${tenantId.slice(0, 8)}-${Date.now().toString(36)}`
    const created = await createInstance(instanceName)
    if (!created.ok) return { ok: false, error: `Erro ao criar instância: ${created.error}` }
  }

  await sb
    .from('tenants')
    .update({
      whatsapp_instance_name: instanceName,
      whatsapp_status:        'connecting',
      whatsapp_last_error:    null,
    })
    .eq('id', tenantId)

  revalidatePath('/configuracoes/whatsapp')
  return { ok: true, data: { instanceName } }
}

// ──────────────────────────────────────────────────────────────────────────
// getQrCode — pra exibir no modal de conexão
// ──────────────────────────────────────────────────────────────────────────

export async function getWhatsAppQr(): Promise<Result<{ qrBase64: string | null; pairingCode: string | null }>> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: tenant } = await sb
    .from('tenants')
    .select('whatsapp_instance_name')
    .eq('id', tenantId)
    .maybeSingle()

  const instance = (tenant as { whatsapp_instance_name: string | null } | null)?.whatsapp_instance_name
  if (!instance) return { ok: false, error: 'Instância não criada. Clique em Conectar primeiro.' }

  const res = await getInstanceQr(instance)
  if (!res.ok) return res
  return { ok: true, data: res.data! }
}

// ──────────────────────────────────────────────────────────────────────────
// refreshWhatsAppStatus — checa Evolution e atualiza tenants.whatsapp_*
// (chamado por polling enquanto user vê o QR)
// ──────────────────────────────────────────────────────────────────────────

export async function refreshWhatsAppStatus(): Promise<Result<WhatsAppStatus>> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: tenant } = await sb
    .from('tenants')
    .select('whatsapp_instance_name')
    .eq('id', tenantId)
    .maybeSingle()

  const instance = (tenant as { whatsapp_instance_name: string | null } | null)?.whatsapp_instance_name
  if (!instance) {
    return { ok: true, data: await getWhatsAppStatus() }
  }

  const stateRes = await getInstanceState(instance)
  if (!stateRes.ok) {
    await sb
      .from('tenants')
      .update({ whatsapp_status: 'error', whatsapp_last_error: stateRes.error })
      .eq('id', tenantId)
    return { ok: true, data: await getWhatsAppStatus() }
  }

  const { state, phone } = stateRes.data!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = { whatsapp_last_error: null }
  if (state === 'open') {
    update.whatsapp_status = 'connected'
    if (phone) update.whatsapp_phone = phone
    update.whatsapp_connected_at = new Date().toISOString()
  } else if (state === 'connecting') {
    update.whatsapp_status = 'connecting'
  } else if (state === 'close') {
    update.whatsapp_status = 'disconnected'
  }

  await sb.from('tenants').update(update).eq('id', tenantId)

  revalidatePath('/configuracoes/whatsapp')
  return { ok: true, data: await getWhatsAppStatus() }
}

// ──────────────────────────────────────────────────────────────────────────
// disconnectWhatsApp — logout + (opcional) delete da instância
// ──────────────────────────────────────────────────────────────────────────

export async function disconnectWhatsApp(opts: { hard?: boolean } = {}): Promise<Result> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: tenant } = await sb
    .from('tenants')
    .select('whatsapp_instance_name')
    .eq('id', tenantId)
    .maybeSingle()

  const instance = (tenant as { whatsapp_instance_name: string | null } | null)?.whatsapp_instance_name
  if (instance) {
    // Best effort — se Evolution já tá fora, ignora erros
    if (opts.hard) {
      await deleteInstance(instance).catch(() => null)
    } else {
      await logoutInstance(instance).catch(() => null)
    }
  }

  await sb
    .from('tenants')
    .update({
      whatsapp_status:        'disconnected',
      whatsapp_phone:         null,
      whatsapp_connected_at:  null,
      ...(opts.hard ? { whatsapp_instance_name: null } : {}),
    })
    .eq('id', tenantId)

  revalidatePath('/configuracoes/whatsapp')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// Templates
// ──────────────────────────────────────────────────────────────────────────

export type TemplateRow = {
  id:           string
  type:         string
  enabled:      boolean
  delayMinutes: number
  body:         string
  sendEmail:    boolean
  emailSubject: string | null
  inactivityDays?:    number | null
  couponCode?:        string | null
  couponDiscountPct?: number | null
  couponValidDays?:   number | null
}

// Templates default por tipo (criados na primeira leitura se faltarem)
const DEFAULT_TEMPLATES: Record<string, {
  delayMinutes: number
  body: string
  sendEmail: boolean
  emailSubject?: string
  inactivityDays?: number
  couponCode?: string
  couponDiscountPct?: number
  couponValidDays?: number
}> = {
  post_sale: {
    delayMinutes: 24 * 60,
    sendEmail:    false,
    body: `Olá {nome}, tudo bem? 😊

Aqui é a {loja}, passando pra agradecer pela compra! Como tá sendo a experiência com o produto?

Se precisar de qualquer coisa, é só chamar.`,
  },
  post_service: {
    delayMinutes: 7 * 24 * 60,
    sendEmail:    false,
    body: `Olá {nome}! 🛠️

Aqui é a {loja}. Faz uma semana que você retirou seu aparelho — está funcionando bem?

Lembrando que sua garantia segue ativa. Qualquer problema, é só voltar.`,
  },
  birthday_month: {
    delayMinutes: 0,
    sendEmail:    true,
    emailSubject: '🎁 Seu mês de aniversário começou!',
    body: `🎁 Olá {nome}! Seu mês de aniversário começou!

Aqui na {loja} preparamos um cupom especial pra você usar até o fim do mês: *ANIV{ano}*

Aproveite! 🎉`,
  },
  post_acquisition: {
    delayMinutes: 0,
    sendEmail:    false,
    body: `Olá {nome}, tudo certo? 📱

Aqui da {loja} confirmando que recebemos seu aparelho ({aparelho}) e o pagamento de {valor} foi efetuado.

O recibo da compra será enviado em seguida. Obrigado pela confiança!`,
  },
  installment_due: {
    delayMinutes: 0,
    sendEmail:    false,
    body: `Oi {nome}! 💰

Sua parcela {parcela_n}/{parcela_total} no valor de {valor} vence amanhã ({data_vencimento}).

Pra facilitar, aqui está nosso PIX. Qualquer dúvida me chama!`,
  },
  warranty_expiring: {
    delayMinutes: 0,
    sendEmail:    false,
    body: `Olá {nome}, tudo bem? 🛡️

Sua garantia do {aparelho} (IMEI {imei}) vence em 7 dias.

Se notou qualquer problema, traz pra revisarmos AGORA — depois do prazo só com pagamento.`,
  },
  birthday_day: {
    delayMinutes: 0,
    sendEmail:    true,
    emailSubject: '🎂 Parabéns!',
    body: `🎂 Parabéns, {nome}!

Hoje é seu dia! Aqui da {loja} desejamos muita felicidade e saúde.

Lembrando que seu cupom *ANIV{ano}* segue ativo até dia {ultimo_dia_mes}. 🎁`,
  },
  inactive_customer: {
    delayMinutes:      0,
    sendEmail:         true,
    emailSubject:      'Sentimos sua falta! 🎁',
    inactivityDays:    90,
    couponCode:        'VOLTA15',
    couponDiscountPct: 15,
    couponValidDays:   15,
    body: `Oi {nome}, faz tempo! 😢

Faz {dias_sem_comprar} dias que você não passa aqui na {loja}. Senti sua falta!

Pra te receber de volta com carinho, preparei:

🎁 Cupom *{cupom}* — {desconto}% de desconto
📅 Válido até {valido_ate}

Te espero, viu?`,
  },
}

async function ensureDefaults(tenantId: string, sb: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = sb as any
  const { data: existing } = await client
    .from('whatsapp_templates')
    .select('type')
    .eq('tenant_id', tenantId)
  const existingTypes = new Set(((existing ?? []) as { type: string }[]).map(r => r.type))

  const missing = Object.entries(DEFAULT_TEMPLATES)
    .filter(([type]) => !existingTypes.has(type))
    .map(([type, cfg]) => ({
      tenant_id:           tenantId,
      type,
      enabled:             true,
      delay_minutes:       cfg.delayMinutes,
      body:                cfg.body,
      send_email:          cfg.sendEmail,
      email_subject:       cfg.emailSubject ?? null,
      inactivity_days:     cfg.inactivityDays ?? null,
      coupon_code:         cfg.couponCode ?? null,
      coupon_discount_pct: cfg.couponDiscountPct ?? null,
      coupon_valid_days:   cfg.couponValidDays ?? null,
    }))

  if (missing.length > 0) {
    await client.from('whatsapp_templates').insert(missing)
  }
}

export async function listTemplates(): Promise<TemplateRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  await ensureDefaults(tenantId, sb)

  const { data } = await sb
    .from('whatsapp_templates')
    .select('id, type, enabled, delay_minutes, body, send_email, email_subject, inactivity_days, coupon_code, coupon_discount_pct, coupon_valid_days')
    .eq('tenant_id', tenantId)
    .order('type')

  type Row = {
    id: string; type: string; enabled: boolean; delay_minutes: number; body: string
    send_email: boolean; email_subject: string | null
    inactivity_days: number | null; coupon_code: string | null
    coupon_discount_pct: number | null; coupon_valid_days: number | null
  }
  return ((data ?? []) as Row[]).map(r => ({
    id:                r.id,
    type:              r.type,
    enabled:           r.enabled,
    delayMinutes:      r.delay_minutes,
    body:              r.body,
    sendEmail:         r.send_email,
    emailSubject:      r.email_subject,
    inactivityDays:    r.inactivity_days,
    couponCode:        r.coupon_code,
    couponDiscountPct: r.coupon_discount_pct,
    couponValidDays:   r.coupon_valid_days,
  }))
}

const UpdateTemplateSchema = z.object({
  id:                z.string().uuid(),
  enabled:           z.boolean().optional(),
  delayMinutes:      z.number().int().min(0).max(43200).optional(),
  body:              z.string().min(5).max(2000).optional(),
  sendEmail:         z.boolean().optional(),
  emailSubject:      z.string().max(200).optional().nullable(),
  inactivityDays:    z.number().int().min(7).max(365).optional().nullable(),
  couponCode:        z.string().max(40).optional().nullable(),
  couponDiscountPct: z.number().int().min(0).max(100).optional().nullable(),
  couponValidDays:   z.number().int().min(1).max(365).optional().nullable(),
})

export async function updateTemplate(input: unknown): Promise<Result> {
  const parsed = UpdateTemplateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Dados inválidos.' }

  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)
  const v = parsed.data

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {}
  if (v.enabled !== undefined)           update.enabled = v.enabled
  if (v.delayMinutes !== undefined)      update.delay_minutes = v.delayMinutes
  if (v.body !== undefined)              update.body = v.body.trim()
  if (v.sendEmail !== undefined)         update.send_email = v.sendEmail
  if (v.emailSubject !== undefined)      update.email_subject = v.emailSubject?.trim() || null
  if (v.inactivityDays !== undefined)    update.inactivity_days = v.inactivityDays
  if (v.couponCode !== undefined)        update.coupon_code = v.couponCode?.trim().toUpperCase() || null
  if (v.couponDiscountPct !== undefined) update.coupon_discount_pct = v.couponDiscountPct
  if (v.couponValidDays !== undefined)   update.coupon_valid_days = v.couponValidDays

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('whatsapp_templates')
    .update(update)
    .eq('id', v.id)
    .eq('tenant_id', tenantId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/configuracoes/whatsapp')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// Histórico de mensagens (últimas N enviadas)
// ──────────────────────────────────────────────────────────────────────────

export type SentMessageRow = {
  id:          string
  type:        string
  recipient:   string
  body:        string
  status:      string
  scheduledFor: string
  sentAt:      string | null
  lastError:   string | null
  customerName: string | null
}

export async function listRecentMessages(limit = 50): Promise<SentMessageRow[]> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('scheduled_whatsapp_messages')
    .select(`
      id, type, recipient_phone, body, status, scheduled_for, sent_at, last_error,
      customers:customer_id (full_name)
    `)
    .eq('tenant_id', tenantId)
    .order('scheduled_for', { ascending: false })
    .limit(limit)

  type Row = {
    id: string; type: string; recipient_phone: string; body: string
    status: string; scheduled_for: string; sent_at: string | null; last_error: string | null
    customers: { full_name: string } | null
  }
  return ((data ?? []) as Row[]).map(r => ({
    id:           r.id,
    type:        r.type,
    recipient:   r.recipient_phone,
    body:        r.body,
    status:      r.status,
    scheduledFor: r.scheduled_for,
    sentAt:      r.sent_at,
    lastError:   r.last_error,
    customerName: r.customers?.full_name ?? null,
  }))
}
