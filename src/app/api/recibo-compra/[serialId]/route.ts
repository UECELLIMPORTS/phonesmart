/**
 * Rota privada — gera o PDF do recibo de compra direto pelo serialId.
 * Requer autenticação (admin do tenant).
 */

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { getAcquisitionReceiptData } from '@/lib/acquisition-receipt-data'
import { renderAcquisitionReceiptPdf } from '@/lib/acquisition-receipt-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ serialId: string }> },
) {
  let auth
  try { auth = await requireAuth() } catch {
    return NextResponse.json({ error: 'não autenticado' }, { status: 401 })
  }

  const { serialId } = await ctx.params
  const tenantId = getTenantId(auth.user)

  const data = await getAcquisitionReceiptData(tenantId, serialId)
  if (!data) {
    return NextResponse.json({ error: 'recibo não encontrado' }, { status: 404 })
  }

  const pdfBuffer = await renderAcquisitionReceiptPdf(data)
  const filename = `recibo-${data.receiptNumber}.pdf`

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control':       'private, no-cache',
    },
  })
}
