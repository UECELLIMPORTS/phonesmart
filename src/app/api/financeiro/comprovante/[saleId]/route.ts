/**
 * Rota privada — gera o PDF do comprovante de venda.
 * Auth: usuário logado, tenant_id no JWT. Só vê comprovante do próprio tenant.
 *
 * Suporta query param `?obs=<texto>` pra incluir observação no PDF
 * (passada pelo modal de envio email/WhatsApp).
 */

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { getComprovanteData } from '@/lib/comprovante-data'
import { renderComprovantePdf } from '@/lib/comprovante-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  ctx: { params: Promise<{ saleId: string }> },
) {
  let user
  try {
    const auth = await requireAuth()
    user = auth.user
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { saleId } = await ctx.params
  const tenantId = getTenantId(user)

  const url = new URL(request.url)
  const observation = url.searchParams.get('obs')?.slice(0, 1000) || undefined

  const data = await getComprovanteData(tenantId, saleId, observation)
  if (!data) {
    return NextResponse.json({ error: 'venda não encontrada' }, { status: 404 })
  }

  const pdfBuffer = await renderComprovantePdf(data)
  const filename = `comprovante-${data.saleNumber}.pdf`

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control':       'private, max-age=300',
    },
  })
}
