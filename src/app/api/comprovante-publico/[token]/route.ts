/**
 * Rota pública — gera o PDF do comprovante via token compartilhável.
 * Cliente abre o link sem login. Token expira em 30 dias.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getComprovanteData } from '@/lib/comprovante-data'
import { renderComprovantePdf } from '@/lib/comprovante-pdf'

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
    .from('sale_share_tokens')
    .select('sale_id, tenant_id, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ error: 'link inválido ou expirado' }, { status: 404 })
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'link expirado' }, { status: 410 })
  }

  const data = await getComprovanteData(row.tenant_id, row.sale_id)
  if (!data) {
    return NextResponse.json({ error: 'venda não encontrada' }, { status: 404 })
  }

  const pdfBuffer = await renderComprovantePdf(data)
  const filename = `comprovante-${data.saleNumber}.pdf`

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control':       'public, max-age=300',
    },
  })
}
