/**
 * Proxy de XML — download do XML autenticado da NFe.
 * Mesmo padrão do DANFE PDF mas com Content-Type application/xml.
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
    .select('id, type, focus_reference, ambiente, status, chave_acesso')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!emission) return NextResponse.json({ error: 'emission not found' }, { status: 404 })
  if (emission.status !== 'authorized' && emission.status !== 'cancelled') {
    return NextResponse.json({ error: 'not authorized yet' }, { status: 400 })
  }
  if (!emission.focus_reference) return NextResponse.json({ error: 'missing focus reference' }, { status: 400 })

  const baseUrl = process.env.FOCUS_NFE_BASE_URL || 'https://api.focusnfe.com.br'
  const token   = process.env.FOCUS_NFE_TOKEN
  if (!token) return NextResponse.json({ error: 'token not configured' }, { status: 500 })

  const focusUrl = `${baseUrl}/v2/${emission.type}/${emission.focus_reference}.xml?ambiente=${emission.ambiente}`
  const auth = 'Basic ' + Buffer.from(`${token}:`).toString('base64')

  const res = await fetch(focusUrl, {
    headers: { 'Authorization': auth, 'Accept': 'application/xml' },
    cache:  'no-store',
  })

  if (!res.ok) {
    return NextResponse.json({ error: `Focus NFe retornou ${res.status}` }, { status: res.status })
  }

  const xmlText = await res.text()
  const filename = emission.chave_acesso
    ? `${emission.chave_acesso}.xml`
    : `${emission.type}-${emission.id}.xml`

  return new Response(xmlText, {
    headers: {
      'Content-Type':        'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'private, max-age=3600',
    },
  })
}
