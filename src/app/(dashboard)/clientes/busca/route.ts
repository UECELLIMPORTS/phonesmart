import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { redirect } from 'next/navigation'

export async function GET(req: Request) {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { supabase, user } = auth
  const tenantId = getTenantId(user)

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() ?? ''
  if (q.length < 3) return Response.json([])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data } = await sb
    .from('customers')
    .select('id, full_name, trade_name, cpf_cnpj, whatsapp, is_active')
    .eq('tenant_id', tenantId)
    .or(`full_name.ilike.%${q}%,whatsapp.ilike.%${q}%,cpf_cnpj.ilike.%${q}%`)
    .order('full_name', { ascending: true })
    .limit(8)

  return Response.json(data ?? [])
}
