'use server'

/**
 * Sprint 9 — Server Actions do Recibo de Compra de Aparelho Usado.
 *
 * - getAcquisitionShareToken: gera/recupera token público pra link wa.me
 * - sendAcquisitionReceiptEmail: monta PDF e envia via Resend (precisa RESEND_API_KEY)
 * - getSellerContact: busca contato do cedente (cliente ou fornecedor) pra pré-preencher
 */

import crypto from 'node:crypto'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAcquisitionReceiptData } from '@/lib/acquisition-receipt-data'
import { renderAcquisitionReceiptPdf } from '@/lib/acquisition-receipt-pdf'
import { sendEmailWithAttachment, escapeHtml } from '@/lib/email'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL
      || process.env.APP_URL
      || 'https://phonesmart.vercel.app'
}

// ──────────────────────────────────────────────────────────────────────────
// Pré-preenche modal: pega contato do cedente (customer ou supplier)
// ──────────────────────────────────────────────────────────────────────────

export async function getSellerContact(serialId: string): Promise<Result<{
  name:     string
  email:    string | null
  whatsapp: string | null
}>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data } = await sb
    .from('product_serials')
    .select(`
      acquired_from_type,
      customers:acquired_customer_id (full_name, email, whatsapp),
      suppliers:supplier_id (name, trade_name, email, whatsapp)
    `)
    .eq('id', serialId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data) return { ok: false, error: 'Aquisição não encontrada.' }

  type Row = {
    acquired_from_type: string | null
    customers: { full_name: string; email: string | null; whatsapp: string | null } | null
    suppliers: { name: string; trade_name: string | null; email: string | null; whatsapp: string | null } | null
  }
  const r = data as Row
  if (r.acquired_from_type === 'customer' && r.customers) {
    return { ok: true, data: { name: r.customers.full_name, email: r.customers.email, whatsapp: r.customers.whatsapp } }
  }
  if (r.acquired_from_type === 'supplier' && r.suppliers) {
    return {
      ok: true,
      data: {
        name:     r.suppliers.trade_name || r.suppliers.name,
        email:    r.suppliers.email,
        whatsapp: r.suppliers.whatsapp,
      },
    }
  }
  return { ok: true, data: { name: '', email: null, whatsapp: null } }
}

// ──────────────────────────────────────────────────────────────────────────
// Token compartilhável (link público)
// ──────────────────────────────────────────────────────────────────────────

export async function getOrCreateAcquisitionShareToken(serialId: string): Promise<Result<{ url: string }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Confere que o serial existe e pertence ao tenant
  const { data: serial } = await sb
    .from('product_serials')
    .select('id, acquired_at')
    .eq('id', serialId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!serial) return { ok: false, error: 'IMEI não encontrado.' }
  if (!serial.acquired_at) return { ok: false, error: 'Esse IMEI não tem registro de compra.' }

  // Reutiliza token existente que ainda não expirou
  const nowIso = new Date().toISOString()
  const { data: existing } = await sb
    .from('acquisition_share_tokens')
    .select('token, expires_at')
    .eq('serial_id', serialId)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.token) {
    return { ok: true, data: { url: `${appUrl()}/api/recibo-compra-publico/${existing.token}` } }
  }

  const token = crypto.randomBytes(24).toString('base64url')
  const { error } = await sb.from('acquisition_share_tokens').insert({
    token,
    serial_id: serialId,
    tenant_id: tenantId,
  })
  if (error) return { ok: false, error: error.message }

  return { ok: true, data: { url: `${appUrl()}/api/recibo-compra-publico/${token}` } }
}

// ──────────────────────────────────────────────────────────────────────────
// Envio por email (precisa RESEND_API_KEY)
// ──────────────────────────────────────────────────────────────────────────

export async function sendAcquisitionReceiptEmail(input: {
  serialId: string
  toEmail:  string
}): Promise<Result> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const email = input.toEmail.trim()
  if (!email || !/.+@.+\..+/.test(email)) {
    return { ok: false, error: 'E-mail inválido.' }
  }

  const data = await getAcquisitionReceiptData(tenantId, input.serialId)
  if (!data) return { ok: false, error: 'Recibo não encontrado.' }

  const pdfBuffer = await renderAcquisitionReceiptPdf(data)
  const filename = `recibo-${data.receiptNumber}.pdf`

  const sellerName = escapeHtml(data.seller.name.split(' ')[0])
  const storeName  = escapeHtml(data.tenant.name)
  const html = `
    <div style="font-family:-apple-system,Helvetica Neue,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1f2937">
      <h2 style="color:#1e3a8a;margin:0 0 12px">Olá, ${sellerName}!</h2>
      <p>Segue em anexo o recibo da compra do seu aparelho.</p>
      <p>Guarde este documento — ele comprova a transação.</p>
      <p style="font-size:13px;color:#6b7280;margin-top:24px">— ${storeName}</p>
    </div>
  `

  const result = await sendEmailWithAttachment({
    to:      email,
    subject: `[${data.tenant.name}] Recibo ${data.receiptNumber}`,
    html,
    attachments: [{ filename, content: pdfBuffer }],
  })

  if (!result.ok) return { ok: false, error: result.error ?? 'Falha ao enviar email.' }
  return { ok: true }
}
