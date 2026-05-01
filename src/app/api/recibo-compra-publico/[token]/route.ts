/**
 * Rota pública — gera o PDF do recibo via token compartilhável.
 * Cliente vendedor abre o link sem login. Token expira em 30 dias.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAcquisitionReceiptData } from '@/lib/acquisition-receipt-data'
import { renderAcquisitionReceiptPdf } from '@/lib/acquisition-receipt-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params

  if (!token || token.length < 16 || token.length > 128) {
    return NextResponse.json({ error: 'token inválido' }, { status: 400 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: row } = await sb
    .from('acquisition_share_tokens')
    .select('serial_id, tenant_id, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ error: 'link inválido ou expirado' }, { status: 404 })
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'link expirado' }, { status: 410 })
  }

  const data = await getAcquisitionReceiptData(row.tenant_id, row.serial_id)
  if (!data) {
    return NextResponse.json({ error: 'recibo não encontrado' }, { status: 404 })
  }

  const pdfBuffer = await renderAcquisitionReceiptPdf(data)
  const filename = `recibo-${data.receiptNumber}.pdf`

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control':       'public, max-age=300',
    },
  })
}
