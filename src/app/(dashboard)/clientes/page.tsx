import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { redirect } from 'next/navigation'
import { Users, Wrench, List } from 'lucide-react'
import { ClientesClient, type CustomerRow } from './clientes-client'

export const metadata = { title: 'Clientes — Phone Smart' }

const PAGE_SIZE = 100

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { supabase, user } = auth
  const tenantId = getTenantId(user)
  const { page: pageStr, q = '' } = await searchParams
  const page   = Math.max(1, parseInt(pageStr ?? '1') || 1)
  const offset = (page - 1) * PAGE_SIZE
  const term   = q.trim()

  // ── Busca paginada ────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [customersRes, countRes, totalCountRes, totalOsRes] = await Promise.all([
    term
      ? sb.from('customers')
          .select('id, full_name, trade_name, person_type, cpf_cnpj, ie_rg, is_active, whatsapp, phone, email, nfe_email, website, birth_date, gender, marital_status, profession, father_name, father_cpf, mother_name, mother_cpf, salesperson, contact_type, credit_limit_cents, notes, address_zip, address_street, address_district, address_number, address_complement, address_city, address_state, created_at, origin, campaign_code')
          .eq('tenant_id', tenantId)
          .or(`full_name.ilike.%${term}%,whatsapp.ilike.%${term}%,cpf_cnpj.ilike.%${term}%,email.ilike.%${term}%`)
          .order('full_name', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1)
      : sb.from('customers')
          .select('id, full_name, trade_name, person_type, cpf_cnpj, ie_rg, is_active, whatsapp, phone, email, nfe_email, website, birth_date, gender, marital_status, profession, father_name, father_cpf, mother_name, mother_cpf, salesperson, contact_type, credit_limit_cents, notes, address_zip, address_street, address_district, address_number, address_complement, address_city, address_state, created_at, origin, campaign_code')
          .eq('tenant_id', tenantId)
          .order('full_name', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1),

    term
      ? sb.from('customers').select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .or(`full_name.ilike.%${term}%,whatsapp.ilike.%${term}%,cpf_cnpj.ilike.%${term}%,email.ilike.%${term}%`)
      : sb.from('customers').select('*', { count: 'exact', head: true })
          .eq('tenant_id', tenantId),

    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    supabase.from('service_orders').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ])

  const customers     = (customersRes.data ?? []) as CustomerRow[]
  const total         = (countRes.count ?? 0) as number
  const totalPages    = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const totalClientes = (totalCountRes.count ?? 0) as number
  const totalOs       = (totalOsRes.count    ?? 0) as number

  // Conta vendas/OS apenas para os clientes visíveis na página
  const ids = customers.map(c => c.id)
  const [salesRows, osRows] = ids.length > 0
    ? await Promise.all([
        supabase.from('sales').select('customer_id').eq('tenant_id', tenantId).in('customer_id', ids),
        supabase.from('service_orders').select('customer_id').eq('tenant_id', tenantId).in('customer_id', ids),
      ])
    : [{ data: [] as { customer_id: string }[] }, { data: [] as { customer_id: string }[] }]

  const salesByCustomer = ((salesRows.data ?? []) as { customer_id: string }[])
    .reduce<Record<string, number>>((acc, r) => { acc[r.customer_id] = (acc[r.customer_id] ?? 0) + 1; return acc }, {})

  const osByCustomer = ((osRows.data ?? []) as { customer_id: string }[])
    .reduce<Record<string, number>>((acc, r) => { acc[r.customer_id] = (acc[r.customer_id] ?? 0) + 1; return acc }, {})

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Clientes</h1>
        <p className="mt-1 text-sm text-muted">Cadastro unificado — Phone Smart e CheckSmart</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
        {[
          { label: 'Total de Clientes', value: String(totalClientes), icon: Users, color: '#10B981' },
          { label: 'OS no CheckSmart',  value: String(totalOs),       icon: Wrench, color: '#22C55E' },
          { label: 'Nesta página',      value: String(customers.length), icon: List, color: '#F59E0B' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border p-5" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
                <p className="mt-2 text-2xl font-bold text-text">{value}</p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${color}18` }}>
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <ClientesClient
        key={`${page}-${q}`}
        customers={customers}
        salesByCustomer={salesByCustomer}
        osByCustomer={osByCustomer}
        page={page}
        totalPages={totalPages}
        total={total}
        q={q}
      />
    </div>
  )
}
