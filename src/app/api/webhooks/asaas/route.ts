/**
 * Webhook do Asaas — recebe eventos de pagamento.
 *
 * Configuração no painel do Asaas (Configurações → Integrações → Webhooks):
 * - URL: https://phonesmart-theta.vercel.app/api/webhooks/asaas
 * - Token: o mesmo valor de ASAAS_WEBHOOK_TOKEN
 * - Eventos: PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_DELETED,
 *            PAYMENT_REFUNDED, SUBSCRIPTION_DELETED
 *
 * Idempotência: cada evento tem um `id` único; salvamos em
 * `asaas_webhook_events` e ignoramos se já foi processado.
 *
 * Segurança: Asaas envia o header `asaas-access-token`. Comparamos com o
 * env `ASAAS_WEBHOOK_TOKEN`. Se não bater → 401.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createNotification } from '@/lib/notifications'

// Force dynamic — webhook não pode ser cacheado
export const dynamic = 'force-dynamic'

type AsaasPayment = {
  id:                string
  subscription:      string | null  // id da subscription Asaas, se for de sub
  customer:          string         // customer id
  value:             number
  netValue:          number
  status:            string
  dueDate:           string
  paymentDate?:      string
  externalReference?: string
}

type AsaasWebhookBody = {
  id:        string                 // event id (idempotency key)
  event:     string                 // PAYMENT_RECEIVED, etc
  dateCreated: string
  payment?:  AsaasPayment
  // outros campos dependendo do evento
}

export async function POST(request: Request) {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN

  // Validação de token (só se configurado — em sandbox pode rodar sem)
  if (expectedToken) {
    const got = request.headers.get('asaas-access-token')
    if (got !== expectedToken) {
      console.warn('[asaas webhook] token inválido')
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  let body: AsaasWebhookBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!body.id || !body.event) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // ── Idempotência: registra evento, ignora duplicado ────────────────────
  const { data: existing } = await sb
    .from('asaas_webhook_events')
    .select('id, processed')
    .eq('event_id', body.id)
    .maybeSingle()

  if (existing?.processed) {
    return NextResponse.json({ ok: true, duplicate: true })
  }

  if (!existing) {
    await sb.from('asaas_webhook_events').insert({
      event_id:   body.id,
      event_type: body.event,
      payload:    body,
    })
  }

  // ── Processa evento ────────────────────────────────────────────────────
  let processError: string | null = null

  try {
    switch (body.event) {
      case 'PAYMENT_RECEIVED':
      case 'PAYMENT_CONFIRMED':
        await handlePaymentReceived(sb, body.payment)
        break

      case 'PAYMENT_OVERDUE':
        await handlePaymentOverdue(sb, body.payment)
        break

      case 'PAYMENT_DELETED':
      case 'PAYMENT_REFUNDED':
      case 'PAYMENT_REFUND_REQUESTED':
        await handlePaymentRefunded(sb, body.payment)
        break

      case 'SUBSCRIPTION_DELETED':
        // subscription foi cancelada do lado do Asaas
        await handleSubscriptionDeleted(sb, body)
        break

      default:
        // Evento que não tratamos — só loga e marca como processado
        console.log('[asaas webhook] evento ignorado:', body.event)
    }

    await sb.from('asaas_webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('event_id', body.id)
  } catch (e) {
    processError = e instanceof Error ? e.message : String(e)
    console.error('[asaas webhook] erro ao processar:', e)
    await sb.from('asaas_webhook_events')
      .update({ error: processError })
      .eq('event_id', body.id)
  }

  return NextResponse.json({ ok: !processError, error: processError })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentReceived(sb: any, payment?: AsaasPayment): Promise<void> {
  if (!payment?.subscription) return

  // Acha a subscription local pelo asaas_subscription_id
  const { data: sub } = await sb
    .from('subscriptions')
    .select('id, tenant_id, product, plan_name, status, billing_cycle, pending_plan, pending_price_cents')
    .eq('asaas_subscription_id', payment.subscription)
    .maybeSingle()

  if (!sub) {
    console.warn('[handlePaymentReceived] sub local não encontrada para', payment.subscription)
    return
  }

  // Calcula próxima cobrança (+1 mês ou +12 meses dependendo do cycle)
  const next = new Date()
  if (sub.billing_cycle === 'YEARLY') {
    next.setFullYear(next.getFullYear() + 1)
  } else {
    next.setMonth(next.getMonth() + 1)
  }
  const nextDate = next.toISOString().slice(0, 10)

  // Aplica downgrade pendente se houver — cliente esperou o ciclo expirar
  // pra fazer efeito, agora vira o novo plano (com novo plan_name e preço).
  const update: Record<string, unknown> = {
    status:        'active',
    next_due_date: nextDate,
    trial_ends_at: null,
  }
  let appliedDowngrade = false
  if (sub.pending_plan && sub.pending_price_cents) {
    update.plan_name           = sub.pending_plan
    update.price_cents         = sub.pending_price_cents
    update.pending_plan        = null
    update.pending_price_cents = null
    appliedDowngrade = true
  }

  await sb.from('subscriptions')
    .update(update)
    .eq('id', sub.id)

  // Notifica o owner do tenant
  const { data: tenant } = await sb
    .from('tenants')
    .select('owner_user_id')
    .eq('id', sub.tenant_id)
    .maybeSingle()

  if (tenant?.owner_user_id) {
    void createNotification({
      userId:   tenant.owner_user_id,
      tenantId: sub.tenant_id,
      type:     'subscription_active',
      title:    appliedDowngrade ? 'Plano atualizado' : 'Pagamento confirmado!',
      body:     appliedDowngrade
                  ? `Você agora está no plano ${sub.pending_plan} de ${sub.product}.`
                  : `Sua assinatura de ${sub.product} (${sub.plan_name}) está ativa.`,
      link:     '/configuracoes/assinatura',
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentOverdue(sb: any, payment?: AsaasPayment): Promise<void> {
  if (!payment?.subscription) return

  const { data: sub } = await sb
    .from('subscriptions')
    .select('id, tenant_id, product, plan_name')
    .eq('asaas_subscription_id', payment.subscription)
    .maybeSingle()

  if (!sub) return

  await sb.from('subscriptions')
    .update({ status: 'late' })
    .eq('id', sub.id)

  const { data: tenant } = await sb
    .from('tenants')
    .select('owner_user_id')
    .eq('id', sub.tenant_id)
    .maybeSingle()

  if (tenant?.owner_user_id) {
    void createNotification({
      userId:   tenant.owner_user_id,
      tenantId: sub.tenant_id,
      type:     'trial_ending',
      title:    'Pagamento em atraso',
      body:     `Sua assinatura de ${sub.product} venceu. Regularize pra não perder acesso.`,
      link:     '/configuracoes/assinatura',
    })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePaymentRefunded(sb: any, payment?: AsaasPayment): Promise<void> {
  if (!payment?.subscription) return

  await sb.from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('asaas_subscription_id', payment.subscription)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleSubscriptionDeleted(sb: any, body: AsaasWebhookBody): Promise<void> {
  // Asaas avisa que sub foi deletada. Marca local como cancelada.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subId = (body as any).subscription?.id ?? (body as any).id
  if (!subId) return

  await sb.from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('asaas_subscription_id', subId)
}
