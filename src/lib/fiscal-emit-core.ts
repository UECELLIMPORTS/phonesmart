/**
 * Core de emissão fiscal — funções puras (sem 'use server') que aceitam tenantId
 * por parâmetro. Usadas por:
 *  - Server actions em src/actions/fiscal-emit.ts (com requireAuth)
 *  - Hook automático em createSale (via after())
 *  - Cron de lote /api/cron/emit-batch-nfce
 *  - Webhook /api/webhooks/focusnfe (applyFocusStatusUpdate)
 *
 * Não exportar essas funções via Server Actions diretas — tenant_id viria do
 * cliente e seria forjável.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  emitirNfce, getEmissao,
  FocusNfeError,
  type FocusNfceItem, type Ambiente,
} from '@/lib/focus-nfe'

export type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

export type EmitNfceResult = {
  emissionId: string
  status:     string
  ref:        string
  message?:   string
}

function mapPaymentToFocus(method: string | null): string {
  const m = (method ?? '').toLowerCase()
  if (m === 'dinheiro' || m === 'cash') return '01'
  if (m === 'pix')                       return '17'
  if (m === 'credito' || m === 'credit') return '03'
  if (m === 'debito'  || m === 'debit')  return '04'
  if (m === 'boleto')                    return '15'
  if (m === 'transferencia')             return '18'
  return '99'
}

function onlyDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

// ──────────────────────────────────────────────────────────────────────────
// Atualiza fiscal_emissions row a partir da resposta do Focus
// (usado tanto após emitir quanto pelo webhook)
// ──────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyFocusStatusUpdate(emissionId: string, focusRes: any) {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  let status: string = 'processing'
  switch (focusRes?.status) {
    case 'autorizado':                 status = 'authorized'; break
    case 'cancelado':                  status = 'cancelled';  break
    case 'inutilizado':                status = 'inutilizada';break
    case 'erro_autorizacao':
    case 'denegado':                   status = 'rejected';   break
    case 'processando_autorizacao':    status = 'processing'; break
  }

  const update = {
    status,
    focus_response:    focusRes,
    chave_acesso:      focusRes.chave_nfe ?? undefined,
    numero:            focusRes.numero ?? undefined,
    serie:             focusRes.serie ?? undefined,
    protocolo:         focusRes.protocolo ?? undefined,
    rejection_message: status === 'rejected' ? (focusRes.mensagem_sefaz || focusRes.mensagem_status) : null,
    emitted_at:        status === 'authorized' ? new Date().toISOString() : undefined,
    updated_at:        new Date().toISOString(),
  }

  await sb.from('fiscal_emissions').update(update).eq('id', emissionId)
}

// ──────────────────────────────────────────────────────────────────────────
// Core: emite NFC-e a partir de uma venda (sem requireAuth — tenantId vem
// como parâmetro). Retorna Result<EmitNfceResult>.
// ──────────────────────────────────────────────────────────────────────────

export async function emitNfceCore(tenantId: string, saleId: string): Promise<Result<EmitNfceResult>> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: config } = await sb
    .from('fiscal_configs')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!config) return { ok: false, error: 'Configuração fiscal não encontrada. Configure em /configuracoes/fiscal.' }
  if (!config.enabled) return { ok: false, error: 'Emissão fiscal desabilitada. Habilite em /configuracoes/fiscal.' }

  const { data: sale, error: saleErr } = await sb
    .from('sales')
    .select(`
      id, customer_id, total_cents, subtotal_cents, discount_cents, shipping_cents,
      payment_method, status, created_at,
      customers ( full_name, cpf_cnpj, email ),
      sale_items ( name, product_id, quantity, unit_price_cents, subtotal_cents )
    `)
    .eq('id', saleId)
    .eq('tenant_id', tenantId)
    .single()

  if (saleErr || !sale) return { ok: false, error: 'Venda não encontrada.' }
  if (sale.status === 'cancelled') return { ok: false, error: 'Não é possível emitir NFC-e pra venda cancelada.' }

  const productIds = sale.sale_items
    .map((i: { product_id: string | null }) => i.product_id)
    .filter(Boolean) as string[]
  type Prod = { id: string; ncm: string | null; cfop: string | null; cst_csosn: string | null; unidade: string | null; origem: string | null }
  const productMap = new Map<string, Prod>()
  if (productIds.length > 0) {
    const { data: prods } = await sb
      .from('products')
      .select('id, ncm, cfop, cst_csosn, unidade, origem')
      .in('id', productIds)
    for (const p of (prods ?? []) as Prod[]) productMap.set(p.id, p)
  }

  const { data: tenant } = await sb
    .from('tenants')
    .select('cpf_cnpj')
    .eq('id', tenantId)
    .single()

  const cnpjEmitente = onlyDigits(tenant?.cpf_cnpj)
  if (cnpjEmitente.length !== 14) {
    return { ok: false, error: 'CNPJ do emitente inválido. Atualize em Configurações > Empresa.' }
  }

  const { data: existing } = await sb
    .from('fiscal_emissions')
    .select('id, status')
    .eq('sale_id', saleId)
    .neq('status', 'rejected')
    .maybeSingle()

  if (existing && existing.status !== 'rejected') {
    return { ok: false, error: `Já existe NFC-e ${existing.status} pra essa venda.` }
  }

  type ItemRow = { name: string; product_id: string | null; quantity: number; unit_price_cents: number; subtotal_cents: number }
  type CustomerRow = { full_name: string; cpf_cnpj: string | null; email: string | null }
  const customer = sale.customers as CustomerRow | null
  const items = sale.sale_items as ItemRow[]

  const { data: emission, error: emErr } = await sb
    .from('fiscal_emissions')
    .insert({
      tenant_id:              tenantId,
      sale_id:                saleId,
      type:                   'nfce',
      status:                 'draft',
      ambiente:               config.ambiente,
      total_cents:            sale.total_cents,
      destinatario_nome:      customer?.full_name,
      destinatario_documento: customer?.cpf_cnpj ? onlyDigits(customer.cpf_cnpj) : null,
      destinatario_email:     customer?.email,
    })
    .select('id')
    .single()

  if (emErr || !emission) return { ok: false, error: `Erro ao criar emissão: ${emErr?.message ?? 'desconhecido'}` }
  const emissionId = emission.id as string
  const ref        = `nfce-${emissionId}`

  const focusItems: FocusNfceItem[] = items.map((it, idx) => {
    const prod = it.product_id ? productMap.get(it.product_id) : null
    const ncm = prod?.ncm || '00000000'
    const cfop = prod?.cfop || config.cfop_padrao || '5102'
    const cstCsosn = prod?.cst_csosn || config.cst_csosn_padrao || '102'
    const unidade  = prod?.unidade  || 'UN'
    const origem   = prod?.origem   || '0'

    const valorUnit = it.unit_price_cents / 100
    const valorTotal = (it.subtotal_cents ?? it.unit_price_cents * it.quantity) / 100

    return {
      numero_item:                  idx + 1,
      codigo_produto:               it.product_id ?? `manual-${idx + 1}`,
      descricao:                    it.name,
      cfop:                         cfop,
      unidade_comercial:            unidade,
      quantidade_comercial:         it.quantity,
      valor_unitario_comercial:     valorUnit,
      valor_bruto:                  valorTotal,
      unidade_tributavel:           unidade,
      quantidade_tributavel:        it.quantity,
      valor_unitario_tributario:    valorUnit,
      ncm:                          ncm,
      origem_mercadoria:            origem,
      icms_situacao_tributaria:     cstCsosn,
      icms_origem:                  origem,
    }
  })

  const valorTotal = sale.total_cents / 100

  const payload = {
    cnpj_emitente:        cnpjEmitente,
    natureza_operacao:    'Venda de mercadoria',
    data_emissao:         new Date(sale.created_at).toISOString(),
    presenca_comprador:   1,
    modalidade_frete:     9,
    local_destino:        1,
    nome_destinatario:    customer?.full_name,
    cpf_destinatario:     customer?.cpf_cnpj && onlyDigits(customer.cpf_cnpj).length === 11 ? onlyDigits(customer.cpf_cnpj) : undefined,
    cnpj_destinatario:    customer?.cpf_cnpj && onlyDigits(customer.cpf_cnpj).length === 14 ? onlyDigits(customer.cpf_cnpj) : undefined,
    formas_pagamento:     [{
      forma_pagamento: mapPaymentToFocus(sale.payment_method),
      valor_pagamento: valorTotal,
    }],
    items:                focusItems,
    valor_produtos:       valorTotal,
    valor_total:          valorTotal,
  }

  await sb.from('fiscal_emissions')
    .update({ status: 'processing', focus_reference: ref, updated_at: new Date().toISOString() })
    .eq('id', emissionId)

  try {
    const focusRes = await emitirNfce(ref, payload, config.ambiente as Ambiente)

    await sb.from('fiscal_emissions')
      .update({
        status:         'processing',
        focus_response: focusRes,
        updated_at:     new Date().toISOString(),
      })
      .eq('id', emissionId)

    try {
      const status = await getEmissao('nfce', ref, config.ambiente as Ambiente)
      await applyFocusStatusUpdate(emissionId, status)

      return {
        ok: true,
        data: {
          emissionId,
          status:  status.status,
          ref,
          message: status.mensagem_sefaz ?? undefined,
        },
      }
    } catch {
      return {
        ok: true,
        data: {
          emissionId,
          status:  'processing',
          ref,
          message: 'Emissão enviada. Aguarde autorização da SEFAZ (~30-90s).',
        },
      }
    }
  } catch (e) {
    const message = e instanceof FocusNfeError ? `Focus NFe: ${e.message}` : 'Erro ao chamar Focus NFe.'
    await sb.from('fiscal_emissions')
      .update({
        status:            'rejected',
        rejection_message: message,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        focus_response:    e instanceof FocusNfeError ? (e.payload as any) : null,
        updated_at:        new Date().toISOString(),
      })
      .eq('id', emissionId)

    return { ok: false, error: message }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Wrapper pro modo automático: checa config (enabled + emission_mode), só
// emite se for automatic. Não joga erros — só loga. Usado em after() do
// createSale pra não bloquear o PDV.
// ──────────────────────────────────────────────────────────────────────────

export async function tryAutoEmitNfceForSale(tenantId: string, saleId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = admin as any
    const { data: config } = await sb
      .from('fiscal_configs')
      .select('enabled, emission_mode')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!config?.enabled) return
    if (config.emission_mode !== 'automatic') return

    const result = await emitNfceCore(tenantId, saleId)
    if (!result.ok) {
      console.warn(`[auto-emit-nfce] tenant=${tenantId} sale=${saleId}: ${result.error}`)
    } else {
      console.log(`[auto-emit-nfce] tenant=${tenantId} sale=${saleId} status=${result.data?.status}`)
    }
  } catch (e) {
    console.error(`[auto-emit-nfce] tenant=${tenantId} sale=${saleId} fatal:`, e)
  }
}
