/**
 * Proxy de DANFE PDF — baixa o PDF da Focus NFe e devolve pro browser.
 *
 * Não expomos o token da Focus nem a URL direta — o user navega via nossa API,
 * que valida tenant + permissão e proxy o conteúdo.
 *
 * Doc Focus: cada emissão autorizada tem `caminho_danfe` na resposta.
 * Acessar: GET https://api.focusnfe.com.br/v2/{tipo}/{ref}.pdf?ambiente=...
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let user
  try {
    const auth = await requireAuth()
    user = auth.user
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data: emission } = await sb
    .from('fiscal_emissions')
    .select('id, type, focus_reference, ambiente, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!emission) {
    return NextResponse.json({ error: 'emission not found' }, { status: 404 })
  }
  if (emission.status !== 'authorized' && emission.status !== 'cancelled') {
    return NextResponse.json({ error: 'emission not authorized yet' }, { status: 400 })
  }
  if (!emission.focus_reference) {
    return NextResponse.json({ error: 'missing focus reference' }, { status: 400 })
  }

  const baseUrl = process.env.FOCUS_NFE_BASE_URL || 'https://api.focusnfe.com.br'
  const token   = process.env.FOCUS_NFE_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'token not configured' }, { status: 500 })
  }

  const focusUrl = `${baseUrl}/v2/${emission.type}/${emission.focus_reference}.pdf?ambiente=${emission.ambiente}`
  const auth = 'Basic ' + Buffer.from(`${token}:`).toString('base64')

  const res = await fetch(focusUrl, {
    headers: { 'Authorization': auth, 'Accept': 'application/pdf' },
    cache:  'no-store',
  })

  if (!res.ok) {
    return NextResponse.json({ error: `Focus NFe retornou ${res.status}` }, { status: res.status })
  }

  const pdfBuffer = await res.arrayBuffer()
  return new Response(pdfBuffer, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="danfe-${emission.id}.pdf"`,
      'Cache-Control':       'private, max-age=3600',
    },
  })
}
