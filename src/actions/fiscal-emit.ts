'use server'

/**
 * Server Actions de emissão fiscal — NFC-e, NF-e (futuro), NFS-e (futuro).
 *
 * O core (sem 'use server') vive em src/lib/fiscal-emit-core.ts pra poder ser
 * chamado de after() callbacks, route handlers e crons sem expor tenantId
 * como input forjável de RPC.
 */

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import {
  getEmissao, cancelarEmissao,
  FocusNfeError,
  type Ambiente,
} from '@/lib/focus-nfe'
import {
  emitNfceCore,
  applyFocusStatusUpdate as applyFocusStatusUpdateCore,
  type Result,
  type EmitNfceResult,
} from '@/lib/fiscal-emit-core'

// Re-export pra clientes que importam de '@/actions/fiscal-emit'
export type { EmitNfceResult } from '@/lib/fiscal-emit-core'

// ──────────────────────────────────────────────────────────────────────────
// Emite NFC-e a partir de uma venda (usuário logado)
// ──────────────────────────────────────────────────────────────────────────

export async function emitNfceFromSale(saleId: string): Promise<Result<EmitNfceResult>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const result = await emitNfceCore(tenantId, saleId)
  if (result.ok) {
    revalidatePath('/financeiro')
    revalidatePath('/notas-fiscais')
  }
  return result
}

// ──────────────────────────────────────────────────────────────────────────
// Wrapper de Server Action pro webhook (que precisa importar de algum lugar
// permitido). O webhook chama isso, mas internamente delega ao core.
// ──────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function applyFocusStatusUpdate(emissionId: string, focusRes: any) {
  return applyFocusStatusUpdateCore(emissionId, focusRes)
}

// ──────────────────────────────────────────────────────────────────────────
// Consulta status atualizado de uma emissão (refresh manual)
// ──────────────────────────────────────────────────────────────────────────

export async function refreshEmissionStatus(emissionId: string): Promise<Result<{ status: string }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data: emission } = await sb
    .from('fiscal_emissions')
    .select('id, type, focus_reference, ambiente')
    .eq('id', emissionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!emission || !emission.focus_reference) {
    return { ok: false, error: 'Emissão não encontrada.' }
  }

  try {
    const focusRes = await getEmissao(
      emission.type as 'nfce' | 'nfe' | 'nfse',
      emission.focus_reference,
      emission.ambiente as Ambiente,
    )
    await applyFocusStatusUpdateCore(emission.id, focusRes)
    revalidatePath('/notas-fiscais')
    return { ok: true, data: { status: focusRes.status } }
  } catch (e) {
    if (e instanceof FocusNfeError) return { ok: false, error: `Focus NFe: ${e.message}` }
    return { ok: false, error: 'Erro ao consultar status.' }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Cancelamento de NFC-e (até 30min após autorização)
// ──────────────────────────────────────────────────────────────────────────

export async function cancelEmission(emissionId: string, reason: string): Promise<Result> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (reason.trim().length < 15) {
    return { ok: false, error: 'Justificativa precisa ter pelo menos 15 caracteres (regra SEFAZ).' }
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data: emission } = await sb
    .from('fiscal_emissions')
    .select('id, type, focus_reference, ambiente, status')
    .eq('id', emissionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!emission) return { ok: false, error: 'Emissão não encontrada.' }
  if (emission.status !== 'authorized') return { ok: false, error: 'Só é possível cancelar nota autorizada.' }
  if (!emission.focus_reference)        return { ok: false, error: 'Reference Focus ausente.' }

  try {
    await cancelarEmissao(
      emission.type as 'nfce' | 'nfe' | 'nfse',
      emission.focus_reference,
      emission.ambiente as Ambiente,
      reason,
    )

    await sb.from('fiscal_emissions')
      .update({
        status:                'cancelled',
        cancelled_at:          new Date().toISOString(),
        cancellation_reason:   reason,
        updated_at:            new Date().toISOString(),
      })
      .eq('id', emissionId)

    revalidatePath('/notas-fiscais')
    revalidatePath('/financeiro')
    return { ok: true }
  } catch (e) {
    const message = e instanceof FocusNfeError ? `Focus NFe: ${e.message}` : 'Erro ao cancelar.'
    return { ok: false, error: message }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Listagem de emissões pra página /notas-fiscais
// ──────────────────────────────────────────────────────────────────────────

export type EmissionListItem = {
  id:                  string
  type:                'nfce' | 'nfe' | 'nfse'
  status:              string
  numero:              number | null
  serie:               number | null
  chaveAcesso:         string | null
  totalCents:          number
  destinatarioNome:    string | null
  destinatarioDoc:     string | null
  ambiente:            'homologacao' | 'producao'
  emittedAt:           string | null
  cancelledAt:         string | null
  rejectionMessage:    string | null
  saleId:              string | null
  serviceOrderId:      string | null
  createdAt:           string
}

export async function listEmissions(filters?: {
  status?:  string
  type?:    'nfce' | 'nfe' | 'nfse'
  startISO?: string
  endISO?:   string
}): Promise<EmissionListItem[]> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  let q = sb
    .from('fiscal_emissions')
    .select('id, type, status, numero, serie, chave_acesso, total_cents, destinatario_nome, destinatario_documento, ambiente, emitted_at, cancelled_at, rejection_message, sale_id, service_order_id, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500)

  if (filters?.status)   q = q.eq('status', filters.status)
  if (filters?.type)     q = q.eq('type', filters.type)
  if (filters?.startISO) q = q.gte('created_at', filters.startISO)
  if (filters?.endISO)   q = q.lte('created_at', filters.endISO)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  type Row = {
    id: string; type: 'nfce' | 'nfe' | 'nfse'; status: string
    numero: number | null; serie: number | null; chave_acesso: string | null
    total_cents: number; destinatario_nome: string | null; destinatario_documento: string | null
    ambiente: 'homologacao' | 'producao'; emitted_at: string | null; cancelled_at: string | null
    rejection_message: string | null; sale_id: string | null; service_order_id: string | null
    created_at: string
  }

  return ((data ?? []) as Row[]).map(r => ({
    id:                 r.id,
    type:               r.type,
    status:             r.status,
    numero:             r.numero,
    serie:              r.serie,
    chaveAcesso:        r.chave_acesso,
    totalCents:         r.total_cents,
    destinatarioNome:   r.destinatario_nome,
    destinatarioDoc:    r.destinatario_documento,
    ambiente:           r.ambiente,
    emittedAt:          r.emitted_at,
    cancelledAt:        r.cancelled_at,
    rejectionMessage:   r.rejection_message,
    saleId:             r.sale_id,
    serviceOrderId:     r.service_order_id,
    createdAt:          r.created_at,
  }))
}
