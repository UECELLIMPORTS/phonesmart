'use server'

/**
 * Server Actions de Comprovante de Venda.
 *
 * - getOrCreateShareToken: gera/recupera token público pra link wa.me
 * - sendComprovanteEmail: monta PDF e envia via Resend com anexo
 * - getCustomerContact: busca email/whatsapp do cliente da venda (pré-preenche modal)
 */

import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { createAdminClient } from '@/lib/supabase/admin'
import { getComprovanteData } from '@/lib/comprovante-data'
import { renderComprovantePdf } from '@/lib/comprovante-pdf'
import { sendEmailWithAttachment, escapeHtml } from '@/lib/email'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL
      || process.env.APP_URL
      || 'https://phonesmart.vercel.app'
}

// ──────────────────────────────────────────────────────────────────────────
// Pré-preenche modal: pega contato do cliente da venda
// ──────────────────────────────────────────────────────────────────────────

export async function getSaleContact(saleId: string): Promise<Result<{
  customerName: string
  email:        string | null
  whatsapp:     string | null
}>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data } = await sb
    .from('sales')
    .select('id, customers ( full_name, email, whatsapp )')
    .eq('id', saleId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data) return { ok: false, error: 'Venda não encontrada.' }

  const c = data.customers as { full_name: string; email: string | null; whatsapp: string | null } | null
  return {
    ok: true,
    data: {
      customerName: c?.full_name || 'Consumidor Final',
      email:        c?.email      ?? null,
      whatsapp:     c?.whatsapp   ?? null,
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Token compartilhável (pra WhatsApp wa.me)
// ──────────────────────────────────────────────────────────────────────────

export async function getOrCreateShareToken(saleId: string): Promise<Result<{ url: string }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: sale } = await sb
    .from('sales')
    .select('id')
    .eq('id', saleId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!sale) return { ok: false, error: 'Venda não encontrada.' }

  // Reutiliza token existente que ainda não expirou
  const nowIso = new Date().toISOString()
  const { data: existing } = await sb
    .from('sale_share_tokens')
    .select('token, expires_at')
    .eq('sale_id', saleId)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.token) {
    return { ok: true, data: { url: `${appUrl()}/api/comprovante-publico/${existing.token}` } }
  }

  const token = crypto.randomBytes(24).toString('base64url')
  const { error } = await sb.from('sale_share_tokens').insert({
    token,
    sale_id:   saleId,
    tenant_id: tenantId,
  })
  if (error) return { ok: false, error: error.message }

  return { ok: true, data: { url: `${appUrl()}/api/comprovante-publico/${token}` } }
}

// ──────────────────────────────────────────────────────────────────────────
// Envio por email
// ──────────────────────────────────────────────────────────────────────────

export async function sendComprovanteEmail(input: {
  saleId:      string
  toEmail:     string
  observation?: string
}): Promise<Result> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const email = input.toEmail.trim()
  if (!email || !/.+@.+\..+/.test(email)) {
    return { ok: false, error: 'E-mail inválido.' }
  }

  const data = await getComprovanteData(tenantId, input.saleId, input.observation)
  if (!data) return { ok: false, error: 'Venda não encontrada.' }

  const pdfBuffer = await renderComprovantePdf(data)
  const filename = `comprovante-${data.saleNumber}.pdf`

  const greeting = data.customer.name && data.customer.name !== 'Consumidor Final'
    ? `Olá ${escapeHtml(data.customer.name.split(' ')[0])},`
    : 'Olá!'

  // Gera/recupera token público pra link sempre-atualizado no email.
  // Cliente que abrir o link depois recebe o PDF com os dados atuais (se a
  // venda for editada, reflete automaticamente).
  const tokenRes = await getOrCreateShareTokenAdmin(tenantId, input.saleId)
  const publicUrl = tokenRes.ok ? tokenRes.data?.url : undefined

  // Timestamp do envio gerado server-side — operador não consegue alterar
  const sentAt = new Date()
  const html = await buildComprovanteEmailHtml(data, greeting, input.observation, sentAt, publicUrl)

  const result = await sendEmailWithAttachment({
    to:      email,
    subject: `Comprovante de Compra · ${data.saleNumber}`,
    html,
    attachments: [{ filename, content: pdfBuffer }],
  })

  if (!result.ok) return { ok: false, error: result.error || 'Falha ao enviar e-mail.' }
  return { ok: true }
}

// Versão admin (sem requireAuth) — usada internamente pelo sendComprovanteEmail
async function getOrCreateShareTokenAdmin(tenantId: string, saleId: string): Promise<Result<{ url: string }>> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const nowIso = new Date().toISOString()
  const { data: existing } = await sb
    .from('sale_share_tokens')
    .select('token, expires_at')
    .eq('sale_id', saleId)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.token) {
    return { ok: true, data: { url: `${appUrl()}/api/comprovante-publico/${existing.token}` } }
  }

  const token = crypto.randomBytes(24).toString('base64url')
  const { error } = await sb.from('sale_share_tokens').insert({
    token, sale_id: saleId, tenant_id: tenantId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { url: `${appUrl()}/api/comprovante-publico/${token}` } }
}

// ──────────────────────────────────────────────────────────────────────────
// Configuração de Branding (logo + termo + garantia padrão)
// ──────────────────────────────────────────────────────────────────────────

export type BrandingSettings = {
  logoUrl:           string | null
  warrantyDays:      number
  warrantyTerms:     string | null
  businessPhone:     string | null
  businessEmail:     string | null
  instagramHandle:   string | null
}

export async function getBrandingSettings(): Promise<BrandingSettings> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data } = await sb
    .from('tenants')
    .select('logo_url, warranty_days, warranty_terms, business_phone, business_email, instagram_handle')
    .eq('id', tenantId)
    .maybeSingle()

  return {
    logoUrl:         data?.logo_url ?? null,
    warrantyDays:    data?.warranty_days ?? 90,
    warrantyTerms:   data?.warranty_terms ?? null,
    businessPhone:   data?.business_phone ?? null,
    businessEmail:   data?.business_email ?? null,
    instagramHandle: data?.instagram_handle ?? null,
  }
}

export async function saveBrandingSettings(input: {
  warrantyDays:    number
  warrantyTerms:   string | null
  businessPhone:   string | null
  businessEmail:   string | null
  instagramHandle: string | null
}): Promise<Result> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (!Number.isFinite(input.warrantyDays) || input.warrantyDays < 0 || input.warrantyDays > 3650) {
    return { ok: false, error: 'Garantia padrão deve ser entre 0 e 3650 dias.' }
  }

  const phoneDigits  = input.businessPhone?.replace(/\D/g, '') || null
  const emailTrim    = input.businessEmail?.trim() || null
  if (emailTrim && !/.+@.+\..+/.test(emailTrim)) {
    return { ok: false, error: 'E-mail institucional inválido.' }
  }
  const instagram    = input.instagramHandle?.trim().replace(/^@/, '').replace(/\s+/g, '') || null

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { error } = await sb
    .from('tenants')
    .update({
      warranty_days:    Math.round(input.warrantyDays),
      warranty_terms:   input.warrantyTerms?.trim() || null,
      business_phone:   phoneDigits,
      business_email:   emailTrim,
      instagram_handle: instagram,
    })
    .eq('id', tenantId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/configuracoes')
  return { ok: true }
}

export async function uploadTenantLogo(formData: FormData): Promise<Result<{ url: string }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const file = formData.get('file') as File | null
  if (!file) return { ok: false, error: 'Arquivo não enviado.' }
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: 'Logo até 2MB.' }
  if (!file.type.startsWith('image/')) return { ok: false, error: 'Arquivo deve ser uma imagem.' }

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().slice(0, 5)
  const path = `${tenantId}/logo-${Date.now()}.${ext}`

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: uploadErr } = await sb.storage
    .from('tenant-logos')
    .upload(path, buffer, { contentType: file.type, upsert: false })

  if (uploadErr) return { ok: false, error: `Upload: ${uploadErr.message}` }

  const { data: urlData } = sb.storage.from('tenant-logos').getPublicUrl(path)
  const publicUrl = urlData?.publicUrl as string | undefined
  if (!publicUrl) return { ok: false, error: 'URL pública não disponível.' }

  const { error: updateErr } = await sb
    .from('tenants')
    .update({ logo_url: publicUrl })
    .eq('id', tenantId)
  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath('/configuracoes')
  return { ok: true, data: { url: publicUrl } }
}

export async function removeTenantLogo(): Promise<Result> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { error } = await sb
    .from('tenants')
    .update({ logo_url: null })
    .eq('id', tenantId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/configuracoes')
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────
// Template de email do comprovante (helper local, não exportado).
// ──────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildComprovanteEmailHtml(data: any, greeting: string, observation: string | undefined, sentAt: Date, publicUrl?: string): Promise<string> {
  const t = data.tenant
  const totalBRL = (data.totalCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  // Data/hora de envio (gerada no servidor — não-manipulável)
  const sentDateBR = sentAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const sentTimeBR = sentAt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

  const phoneFmt = t.phone
    ? t.phone.replace(/\D/g, '').replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3').replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
    : null
  const insta = t.instagram ? `@${(t.instagram as string).replace(/^@/, '')}` : null

  const cnpjFmt = t.cnpj
    ? (t.cnpj as string).replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
    : null

  const addrLine1 = [
    [t.addressStreet, t.addressNumber].filter(Boolean).join(', '),
    t.addressDistrict,
  ].filter(Boolean).join(' - ')
  const addrLine2 = [
    [t.addressCity, t.addressState].filter(Boolean).join('/'),
    t.addressZip ? `CEP ${t.addressZip}` : null,
  ].filter(Boolean).join(' · ')

  const footerLines: string[] = []
  if (cnpjFmt) footerLines.push(`CNPJ ${cnpjFmt}`)
  if (addrLine1) footerLines.push(addrLine1)
  if (addrLine2) footerLines.push(addrLine2)
  const footerContact = [phoneFmt, t.email, insta].filter(Boolean).join(' · ')
  if (footerContact) footerLines.push(footerContact)

  return `
<!doctype html>
<html><body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);max-width:600px;width:100%;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#059669,#10B981);padding:32px 32px 24px;text-align:center;">
          ${t.logoUrl ? `<img src="${escapeHtml(t.logoUrl)}" alt="Logo" style="max-height:64px;border-radius:8px;background:#FFFFFF;padding:6px;margin-bottom:12px;" />` : ''}
          <div style="color:#FFFFFF;font-size:18px;font-weight:bold;letter-spacing:.5px;">${escapeHtml(t.tradeName || t.name)}</div>
          <div style="color:rgba(255,255,255,.85);font-size:12px;margin-top:4px;">Comprovante de Compra · ${escapeHtml(data.saleNumber)}</div>
          <div style="color:rgba(255,255,255,.95);font-size:11px;margin-top:10px;background:rgba(0,0,0,.18);display:inline-block;padding:4px 10px;border-radius:999px;">
            Enviado em ${sentDateBR} às ${sentTimeBR}
          </div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 12px;font-size:16px;">${greeting}</p>
          <p style="margin:0 0 16px;line-height:1.55;color:#334155;">
            Segue em anexo o <strong>comprovante</strong> da sua compra na
            <strong>${escapeHtml(t.tradeName || t.name)}</strong>, junto com o
            <strong>termo de garantia</strong> dos produtos.
          </p>

          <!-- Total destacado -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;margin:20px 0;">
            <tr>
              <td style="padding:14px 18px;color:#065F46;font-size:13px;">Total da compra</td>
              <td align="right" style="padding:14px 18px;color:#059669;font-size:22px;font-weight:bold;">${totalBRL}</td>
            </tr>
          </table>

          ${publicUrl ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;border:1px solid #CBD5E1;border-radius:8px;margin:0 0 16px;">
              <tr><td style="padding:14px 18px;">
                <div style="font-size:11px;font-weight:bold;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Versão online · sempre atualizada</div>
                <div style="font-size:13px;color:#334155;line-height:1.45;margin-bottom:10px;">
                  Se houver qualquer correção na compra, o link abaixo sempre traz a versão mais recente do comprovante:
                </div>
                <a href="${escapeHtml(publicUrl)}" style="display:inline-block;padding:9px 16px;background:#0F172A;color:#FFFFFF;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">
                  Abrir comprovante online
                </a>
                <div style="font-size:11px;color:#64748B;margin-top:8px;word-break:break-all;">${escapeHtml(publicUrl)}</div>
              </td></tr>
            </table>` : ''}

          ${observation ? `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FEF9C3;border-left:3px solid #EAB308;border-radius:4px;margin:0 0 16px;">
              <tr><td style="padding:12px 14px;">
                <div style="font-size:11px;font-weight:bold;color:#854D0E;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Observação</div>
                <div style="font-size:14px;color:#422006;">${escapeHtml(observation)}</div>
              </td></tr>
            </table>` : ''}

          <p style="margin:18px 0 0;font-size:13px;color:#64748B;line-height:1.5;">
            Em caso de dúvidas sobre garantia, basta responder este e-mail ou entrar em contato com a loja pelos canais abaixo.
          </p>
        </td></tr>

        <!-- Footer com dados da loja -->
        <tr><td style="border-top:1px solid #E2E8F0;padding:20px 32px;background:#F8FAFC;text-align:center;">
          ${footerLines.map(l => `<div style="font-size:11px;color:#64748B;line-height:1.6;">${escapeHtml(l)}</div>`).join('')}
        </td></tr>
      </table>

      <p style="margin:16px 0 0;font-size:11px;color:#94A3B8;text-align:center;">
        Este comprovante não substitui documento fiscal (NF-e/NFC-e).
      </p>
    </td></tr>
  </table>
</body></html>`
}
