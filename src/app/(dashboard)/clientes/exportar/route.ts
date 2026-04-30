import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { redirect } from 'next/navigation'

export async function GET() {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const { supabase, user } = auth
  const tenantId = getTenantId(user)

  // Busca todos os clientes paginado
  const all: Record<string, unknown>[] = []
  let page = 0
  while (true) {
    const { data } = await supabase
      .from('customers')
      .select(`
        full_name, trade_name, person_type, cpf_cnpj, ie_rg, is_active,
        whatsapp, email, nfe_email, website,
        birth_date, gender, marital_status, profession,
        father_name, father_cpf, mother_name, mother_cpf,
        salesperson, contact_type, credit_limit_cents, notes,
        address_street, address_number, address_complement,
        address_district, address_zip, address_city, address_state,
        created_at
      `)
      .eq('tenant_id', tenantId)
      .order('full_name')
      .range(page * 1000, page * 1000 + 999)

    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < 1000) break
    page++
  }

  // Helpers
  function fmtDate(iso: string | null): string {
    if (!iso) return ''
    const d = iso.slice(0, 10)
    return `${d.slice(8,10)}/${d.slice(5,7)}/${d.slice(0,4)}`
  }
  function fmtCents(v: number | null): string {
    if (!v) return '0.00'
    return (v / 100).toFixed(2).replace('.', ',')
  }
  function personType(v: string | null): string {
    return v === 'juridica' ? 'Pessoa Jurídica' : 'Pessoa Física'
  }
  function genderLabel(v: string | null): string {
    if (v === 'M') return 'Masculino'
    if (v === 'F') return 'Feminino'
    return ''
  }
  function q(v: unknown): string {
    const s = v == null ? '' : String(v)
    return `"${s.replace(/"/g, '""')}"`
  }

  // Cabeçalho igual ao do Bling
  const headers = [
    'Nome', 'Fantasia', 'Endereço', 'Número', 'Complemento', 'Bairro',
    'CEP', 'Cidade', 'UF', 'Celular', 'E-mail', 'Web Site',
    'Tipo pessoa', 'CNPJ / CPF', 'IE / RG', 'Situação', 'Observações',
    'Estado civil', 'Profissão', 'Sexo', 'Data nascimento',
    'Nome pai', 'CPF pai', 'Nome mãe', 'CPF mãe',
    'Vendedor', 'Tipo contato', 'E-mail para envio NFe',
    'Limite de crédito', 'Cliente desde',
  ]

  const lines: string[] = [headers.map(h => `"${h}"`).join(';')]

  for (const r of all) {
    const row = [
      q(r.full_name),
      q(r.trade_name),
      q(r.address_street),
      q(r.address_number),
      q(r.address_complement),
      q(r.address_district),
      q(r.address_zip),
      q(r.address_city),
      q(r.address_state),
      q(r.whatsapp),
      q(r.email),
      q(r.website),
      q(personType(r.person_type as string)),
      q(r.cpf_cnpj),
      q(r.ie_rg),
      q(r.is_active ? 'Ativo' : 'Inativo'),
      q(r.notes),
      q(r.marital_status),
      q(r.profession),
      q(genderLabel(r.gender as string)),
      q(fmtDate(r.birth_date as string)),
      q(r.father_name),
      q(r.father_cpf),
      q(r.mother_name),
      q(r.mother_cpf),
      q(r.salesperson),
      q(r.contact_type),
      q(r.nfe_email),
      q(fmtCents(r.credit_limit_cents as number)),
      q(fmtDate(r.created_at as string)),
    ]
    lines.push(row.join(';'))
  }

  const csv = '﻿' + lines.join('\r\n') // BOM para Excel abrir com acentos corretos

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clientes_phonesmart_${new Date().toISOString().slice(0,10)}.csv"`,
    },
  })
}
