/**
 * Helper compartilhado pra agendar mensagens WhatsApp.
 *
 * Não chama Evolution direto — só insere em scheduled_whatsapp_messages.
 * O cron /api/cron/whatsapp-dispatch processa a fila.
 *
 * Uso:
 *   await scheduleWhatsAppMessage({
 *     tenantId, type: 'post_sale', customerId,
 *     referenceId: saleId, vars: { aparelho: 'iPhone 12', valor: 'R$ 1.500,00' },
 *   })
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/evolution'

export type WhatsAppMessageType =
  | 'post_sale'
  | 'post_service'
  | 'post_acquisition'
  | 'installment_due'
  | 'warranty_expiring'
  | 'birthday_month'
  | 'birthday_day'
  | 'inactive_customer'

type ScheduleParams = {
  tenantId:    string
  type:        WhatsAppMessageType
  customerId:  string | null
  referenceId: string | null
  /** Variáveis pra interpolação dos placeholders. {nome}, {loja} são preenchidos automaticamente. */
  vars?:       Record<string, string | number | undefined | null>
  /** Override de telefone caso customer não tenha (ou queira mandar pra outro). */
  phoneOverride?: string | null
  /** Override de scheduled_for (ISO). Se omitido, usa now() + delay_hours do template. */
  scheduledFor?: string
}

export async function scheduleWhatsAppMessage(params: ScheduleParams): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // 1. Confere tenant tem WhatsApp conectado
  const { data: tenant } = await sb
    .from('tenants')
    .select('id, name, whatsapp_status')
    .eq('id', params.tenantId)
    .maybeSingle()

  if (!tenant) return { ok: false, error: 'Tenant não encontrado.' }
  if (tenant.whatsapp_status !== 'connected') {
    return { ok: true, skipped: 'tenant sem WhatsApp conectado' }
  }

  // 2. Pega template
  const { data: template } = await sb
    .from('whatsapp_templates')
    .select('enabled, delay_minutes, body, send_email, email_subject')
    .eq('tenant_id', params.tenantId)
    .eq('type', params.type)
    .maybeSingle()

  if (!template) return { ok: true, skipped: `template ${params.type} não encontrado` }
  if (!template.enabled) return { ok: true, skipped: `template ${params.type} desabilitado` }

  // 3. Pega telefone do destinatário
  let phone: string | null = null
  let customerName = 'cliente'

  if (params.phoneOverride) {
    phone = normalizePhone(params.phoneOverride)
  } else if (params.customerId) {
    const { data: cust } = await sb
      .from('customers')
      .select('full_name, whatsapp')
      .eq('id', params.customerId)
      .maybeSingle()
    if (cust) {
      customerName = (cust.full_name as string) ?? 'cliente'
      phone = normalizePhone(cust.whatsapp as string | null)
    }
  }

  if (!phone) return { ok: true, skipped: 'destinatário sem WhatsApp' }

  // 4. Renderiza placeholders
  const now = new Date()
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const baseVars: Record<string, string> = {
    nome:            customerName,
    loja:            (tenant.name as string) ?? 'sua loja',
    ano:             String(now.getFullYear()),
    ultimo_dia_mes:  String(lastDayOfMonth),
  }
  const allVars = { ...baseVars, ...(params.vars ?? {}) }

  let body = String(template.body)
  for (const [key, val] of Object.entries(allVars)) {
    if (val == null) continue
    body = body.replaceAll(`{${key}}`, String(val))
  }

  // 5. Calcula scheduled_for
  const delayMs = (template.delay_minutes as number) * 60 * 1000
  const scheduledFor = params.scheduledFor ?? new Date(Date.now() + delayMs).toISOString()

  // 6. Anti-duplicate: não cria msg igual (mesmo type + reference_id) já pendente/enviada nas últimas 12h
  if (params.referenceId) {
    const cutoff = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
    const { data: dup } = await sb
      .from('scheduled_whatsapp_messages')
      .select('id')
      .eq('tenant_id', params.tenantId)
      .eq('type', params.type)
      .eq('reference_id', params.referenceId)
      .gte('created_at', cutoff)
      .limit(1)
      .maybeSingle()
    if (dup) return { ok: true, skipped: 'duplicada (já agendada)' }
  }

  // 7. Insere na fila
  const { error } = await sb.from('scheduled_whatsapp_messages').insert({
    tenant_id:       params.tenantId,
    type:            params.type,
    reference_id:    params.referenceId,
    customer_id:     params.customerId,
    recipient_phone: phone,
    body,
    scheduled_for:   scheduledFor,
    status:          'pending',
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
