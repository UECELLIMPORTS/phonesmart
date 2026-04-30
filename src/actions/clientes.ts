'use server'

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'

export type ImportResult = {
  updated:  number
  inserted: number
  errors:   string[]
}

function cleanDigits(s: string) { return s.replace(/\D/g, '') }
function toDate(s: string): string | null {
  s = s.trim()
  if (!s) return null
  const [d, m, y] = s.split('/')
  if (!d || !m || !y) return null
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
}
function toCents(s: string): number {
  const n = parseFloat(s.trim().replace(',', '.'))
  return isNaN(n) ? 0 : Math.round(n * 100)
}
function toPersonType(s: string) {
  return s.toLowerCase().includes('jur') ? 'juridica' : 'fisica'
}
function toGender(s: string): string | null {
  const l = s.trim().toLowerCase()
  if (l === 'masculino') return 'M'
  if (l === 'feminino')  return 'F'
  return null
}
function nv(s: string | undefined): string | null {
  return s?.trim() || null
}

function parseBlingCsv(csv: string): Record<string, string>[] {
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length < 2) return []

  function parseLine(line: string): string[] {
    const result: string[] = []
    let cur = ''
    let inQ  = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { inQ = !inQ; continue }
      if (c === ';' && !inQ) { result.push(cur); cur = ''; continue }
      cur += c
    }
    result.push(cur)
    return result
  }

  const headers = parseLine(lines[0])
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const vals = parseLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => { row[h] = vals[idx] ?? '' })
    rows.push(row)
  }
  return rows
}

function buildRecord(r: Record<string, string>, tenantId: string): Record<string, unknown> {
  const cpf   = cleanDigits(r['CNPJ / CPF'] ?? '')
  const since = toDate(r['Cliente desde'] ?? '')
  const bd    = toDate(r['Data nascimento'] ?? '')
  const gnd   = toGender(r['Sexo'] ?? '')
  const cep   = cleanDigits(r['CEP'] ?? '')

  return {
    tenant_id:           tenantId,
    full_name:           r['Nome'].trim(),
    trade_name:          nv(r['Fantasia']),
    person_type:         toPersonType(r['Tipo pessoa'] ?? ''),
    cpf_cnpj:            cpf || null,
    ie_rg:               nv(r['IE / RG']),
    is_active:           (r['Situação'] ?? '').trim().toLowerCase() === 'ativo',
    email:               nv(r['E-mail']),
    nfe_email:           nv(r['E-mail para envio NFe']),
    website:             nv(r['Web Site']),
    birth_date:          bd,
    gender:              gnd,
    marital_status:      nv(r['Estado civil']),
    profession:          nv(r['Profissão']),
    father_name:         nv(r['Nome pai']),
    father_cpf:          cleanDigits(r['CPF pai'] ?? '') || null,
    mother_name:         nv(r['Nome mãe']),
    mother_cpf:          cleanDigits(r['CPF mãe'] ?? '') || null,
    salesperson:         nv(r['Vendedor']),
    contact_type:        nv(r['Tipo contato']),
    credit_limit_cents:  toCents(r['Limite de crédito'] ?? '0'),
    notes:               nv(r['Observações']),
    address_street:      nv(r['Endereço']),
    address_number:      nv(r['Número']),
    address_complement:  nv(r['Complemento']),
    address_district:    nv(r['Bairro']),
    address_zip:         cep || null,
    address_city:        nv(r['Cidade']),
    address_state:       nv(r['UF']),
    created_at:          since ? `${since}T12:00:00+00:00` : null,
  }
}

export async function importCustomersFromBling(csvText: string): Promise<ImportResult> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const rows = parseBlingCsv(csvText)
  if (!rows.length) return { updated: 0, inserted: 0, errors: ['Arquivo vazio ou formato inválido'] }

  // Carrega todos os clientes existentes (paginado)
  const existing: { id: string; cpf_cnpj: string | null; whatsapp: string | null; full_name: string }[] = []
  let page = 0
  while (true) {
    const { data } = await supabase
      .from('customers')
      .select('id, cpf_cnpj, whatsapp, full_name')
      .eq('tenant_id', tenantId)
      .range(page * 1000, page * 1000 + 999)
    if (!data || data.length === 0) break
    existing.push(...(data as typeof existing))
    if (data.length < 1000) break
    page++
  }

  const byCpf   = new Map(existing.filter(r => r.cpf_cnpj).map(r => [r.cpf_cnpj!, r.id]))
  const byWhats = new Map(existing.filter(r => r.whatsapp).map(r => [r.whatsapp!, r.id]))
  const byName  = new Map(existing.map(r => [r.full_name.toLowerCase(), r.id]))
  const usedWhats = new Set(existing.map(r => r.whatsapp).filter(Boolean))

  let updated  = 0
  let inserted = 0
  const errors: string[] = []

  for (const r of rows) {
    const nome = r['Nome']?.trim()
    if (!nome) continue

    const cpf   = cleanDigits(r['CNPJ / CPF'] ?? '')
    const whats = cleanDigits(r['Celular'] ?? '')
    const rec   = buildRecord(r, tenantId)

    // Remove nulls para não sobrescrever campos com null desnecessariamente
    const payload = Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== null))

    // Encontra cliente existente
    const existingId = (cpf ? byCpf.get(cpf) : undefined)
      ?? byWhats.get(whats)
      ?? byName.get(nome.toLowerCase())

    if (existingId) {
      // UPDATE
      const { error } = await supabase
        .from('customers')
        .update(payload)
        .eq('id', existingId)
        .eq('tenant_id', tenantId)
      if (error) errors.push(`Atualizar [${nome}]: ${error.message}`)
      else updated++
    } else {
      // INSERT — só adiciona whatsapp se não estiver em uso
      if (whats && !usedWhats.has(whats)) {
        payload.whatsapp = whats
        usedWhats.add(whats)
      }
      const { error } = await supabase.from('customers').insert(payload)
      if (error) errors.push(`Inserir [${nome}]: ${error.message}`)
      else {
        inserted++
        if (cpf) byCpf.set(cpf, 'new')
        byName.set(nome.toLowerCase(), 'new')
      }
    }
  }

  return { updated, inserted, errors }
}
