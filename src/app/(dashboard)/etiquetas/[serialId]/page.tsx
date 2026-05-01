import { requireAuth } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { getTenantId } from '@/lib/tenant'
import { EtiquetaClient } from './etiqueta-client'

export const metadata = { title: 'Imprimir etiqueta — Phone Smart' }

export default async function EtiquetaPage({
  params,
  searchParams,
}: {
  params: Promise<{ serialId: string }>
  searchParams: Promise<{ qty?: string }>
}) {
  let auth
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { serialId } = await params
  const { qty: qtyStr } = await searchParams
  const qty = Math.min(20, Math.max(1, parseInt(qtyStr ?? '1') || 1))

  const tenantId = getTenantId(auth.user)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = auth.supabase as any
  const { data: serial } = await sb
    .from('product_serials')
    .select(`
      id, serial, condition, acquired_at, cost_cents,
      products!inner(id, name, price_cents)
    `)
    .eq('id', serialId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!serial) notFound()

  const { data: tenant } = await sb
    .from('tenants').select('name').eq('id', tenantId).maybeSingle()

  type SerialRow = {
    id: string; serial: string; condition: 'A' | 'B' | 'C' | 'defective' | null
    acquired_at: string | null; cost_cents: number | null
    products: { id: string; name: string; price_cents: number } | null
  }
  const s = serial as SerialRow

  return (
    <EtiquetaClient
      qty={qty}
      data={{
        serial:      s.serial,
        productName: s.products?.name ?? '—',
        storeName:   (tenant as { name: string } | null)?.name ?? 'Phone Smart',
        priceCents:  s.products?.price_cents ?? undefined,
        condition:   s.condition,
        acquiredAt:  s.acquired_at,
      }}
    />
  )
}
