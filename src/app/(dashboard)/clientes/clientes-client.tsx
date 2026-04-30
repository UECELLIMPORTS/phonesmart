'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, X, Loader2, Phone, Mail, FileText, User, Pencil, Calendar, ChevronLeft, ChevronRight, Upload, Download } from 'lucide-react'
import { toast } from 'sonner'
import { createCustomer, updateCustomer } from '@/actions/pos'
import { importCustomersFromBling } from '@/actions/clientes'
import { AddressCityState } from '@/components/ui/address-fields'
import { CUSTOMER_ORIGIN_OPTIONS } from '@/lib/customer-origin'

// ── Types ──────────────────────────────────────────────────────────────────

export type CustomerRow = {
  id: string; full_name: string; trade_name: string | null
  cpf_cnpj: string | null; ie_rg: string | null; person_type: string | null
  is_active: boolean; whatsapp: string | null; phone: string | null
  email: string | null; nfe_email: string | null; website: string | null
  birth_date: string | null; gender: string | null
  marital_status: string | null; profession: string | null
  father_name: string | null; father_cpf: string | null
  mother_name: string | null; mother_cpf: string | null
  salesperson: string | null; contact_type: string | null
  credit_limit_cents: number
  notes: string | null
  address_zip: string | null; address_street: string | null
  address_district: string | null; address_number: string | null
  address_complement: string | null; address_city: string | null
  address_state: string | null; created_at: string
  origin: string | null
  campaign_code: string | null
}

type Props = {
  customers:       CustomerRow[]
  salesByCustomer: Record<string, number>
  osByCustomer:    Record<string, number>
  page:            number
  totalPages:      number
  total:           number
  q:               string
}

type FormState = {
  name: string; tradeName: string; personType: string
  cpf: string; ieRg: string; isActive: boolean
  whatsapp: string; phone: string; email: string; nfeEmail: string; website: string
  birthDate: string; gender: string; maritalStatus: string; profession: string
  fatherName: string; fatherCpf: string; motherName: string; motherCpf: string
  salesperson: string; contactType: string; creditLimitStr: string
  notes: string
  cep: string; addressStreet: string; addressDistrict: string
  addressNumber: string; addressComplement: string
  addressCity: string; addressState: string
  clienteSince: string
  origin: string
  campaignCode: string
}

const EMPTY_FORM: FormState = {
  name: '', tradeName: '', personType: 'fisica',
  cpf: '', ieRg: '', isActive: true,
  whatsapp: '', phone: '', email: '', nfeEmail: '', website: '',
  birthDate: '', gender: '', maritalStatus: '', profession: '',
  fatherName: '', fatherCpf: '', motherName: '', motherCpf: '',
  salesperson: '', contactType: '', creditLimitStr: '',
  notes: '',
  cep: '', addressStreet: '', addressDistrict: '',
  addressNumber: '', addressComplement: '', addressCity: '', addressState: '',
  clienteSince: '',
  origin: '',
  campaignCode: '',
}

// ── Formatters ─────────────────────────────────────────────────────────────

function fmtCpf(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
  if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`
  return v
}

function fmtPhone(v: string) {
  const d = v.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`
  return v
}

function fmtPhoneInput(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2)  return d
  if (d.length <= 7)  return `(${d.slice(0,2)}) ${d.slice(2)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}

function fmtCpfInput(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

function fmtCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0,5)}-${d.slice(5)}`
}

function fmtBirthDate(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const inputCls   = 'w-full rounded-lg border px-3.5 py-2.5 text-sm text-text outline-none transition-colors focus:border-accent/60 placeholder:text-muted'
const inputStyle = { background: '#1B2638', borderColor: '#2A3650' }

// ── Date text input — DD/MM/AAAA mask, no native calendar picker ───────────

function DateTextInput({
  value, onChange, className, style,
}: {
  value: string
  onChange: (ymd: string) => void
  className?: string
  style?: React.CSSProperties
}) {
  function ymdToDisplay(ymd: string) {
    if (!ymd) return ''
    const [y, m, d] = ymd.split('-')
    if (!y || !m || !d) return ''
    return `${d}/${m}/${y}`
  }

  const [display, setDisplay] = useState(() => ymdToDisplay(value))

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 8)
    let fmt = digits
    if (digits.length > 2) fmt = `${digits.slice(0, 2)}/${digits.slice(2)}`
    if (digits.length > 4) fmt = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    setDisplay(fmt)

    if (digits.length === 8) {
      const day = parseInt(digits.slice(0, 2), 10)
      const mon = parseInt(digits.slice(2, 4), 10)
      const yr  = parseInt(digits.slice(4), 10)
      if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12 && yr >= 1900 && yr <= 2100) {
        onChange(`${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`)
      }
    } else {
      onChange('')
    }
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={handleChange}
      placeholder="DD/MM/AAAA"
      maxLength={10}
      className={className}
      style={style}
    />
  )
}

// ── Customer Form Modal ────────────────────────────────────────────────────

function CustomerModal({
  mode, editId, initial, originalCreatedAt, onClose, onSaved,
}: {
  mode: 'create' | 'edit'
  editId?: string
  initial: FormState
  originalCreatedAt?: string
  onClose: () => void
  onSaved: (updated: CustomerRow, isEdit: boolean) => void
}) {
  const [form, setForm]            = useState<FormState>(initial)
  const [saving, setSaving]        = useState(false)
  const [fetchingCep, setFetching] = useState(false)

  const set = (patch: Partial<FormState>) => setForm(p => ({ ...p, ...patch }))

  async function fetchCep(val: string) {
    const d = val.replace(/\D/g, '')
    if (d.length !== 8) return
    setFetching(true)
    try {
      const r    = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const data = await r.json()
      if (!data.erro) set({
        addressStreet: data.logradouro ?? '',
        addressCity:   data.localidade ?? '',
        addressState:  data.uf ?? '',
      })
    } catch { /* silent */ }
    finally { setFetching(false) }
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return }
    if (!form.origin)      { toast.error('Informe como o cliente te conheceu'); return }

    setSaving(true)
    try {
      const result = mode === 'edit' && editId
        ? await updateCustomer({ ...form, id: editId, clienteSince: form.clienteSince })
        : await createCustomer(form)

      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const customer = result.customer

      const creditCents = Math.round(parseFloat(form.creditLimitStr.replace(',', '.') || '0') * 100) || 0
      const resolvedCreatedAt = mode === 'edit' && form.clienteSince
        ? form.clienteSince + 'T00:00:00.000Z'
        : (originalCreatedAt ?? new Date().toISOString())
      const row: CustomerRow = {
        id: customer.id, full_name: customer.full_name,
        trade_name: form.tradeName || null, person_type: form.personType,
        cpf_cnpj: customer.cpf_cnpj, ie_rg: form.ieRg || null,
        is_active: form.isActive,
        whatsapp: customer.whatsapp, phone: form.phone.replace(/\D/g, '') || null,
        email: customer.email, nfe_email: form.nfeEmail || null, website: form.website || null,
        birth_date: form.birthDate || null, gender: form.gender || null,
        marital_status: form.maritalStatus || null, profession: form.profession || null,
        father_name: form.fatherName || null, father_cpf: form.fatherCpf.replace(/\D/g, '') || null,
        mother_name: form.motherName || null, mother_cpf: form.motherCpf.replace(/\D/g, '') || null,
        salesperson: form.salesperson || null, contact_type: form.contactType || null,
        credit_limit_cents: creditCents, notes: form.notes || null,
        address_zip: form.cep.replace(/\D/g, '') || null,
        address_street: form.addressStreet || null, address_district: form.addressDistrict || null,
        address_number: form.addressNumber || null, address_complement: form.addressComplement || null,
        address_city: form.addressCity || null, address_state: form.addressState || null,
        created_at: resolvedCreatedAt,
        origin: form.origin || null,
        campaign_code: form.campaignCode.trim() || null,
      }

      onSaved(row, mode === 'edit')
      toast.success(mode === 'edit' ? 'Cliente atualizado!' : 'Cliente cadastrado!')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar cliente')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 space-y-4 overflow-y-auto max-h-[90vh]"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-semibold text-text">
              {mode === 'edit' ? 'Editar Cliente' : 'Novo Cliente'}
            </h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-coral transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Dados básicos ── */}
        <section className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Dados básicos</p>
          {mode === 'edit' && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                Cliente desde
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 pointer-events-none" style={{ color: '#94A3B8' }} />
                <DateTextInput
                  value={form.clienteSince}
                  onChange={v => set({ clienteSince: v })}
                  className={inputCls + ' pl-9'}
                  style={inputStyle}
                />
              </div>
            </div>
          )}
          <input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Nome completo *" className={inputCls} style={inputStyle} autoFocus />
          <input value={form.tradeName} onChange={e => set({ tradeName: e.target.value })} placeholder="Nome fantasia" className={inputCls} style={inputStyle} />
          <div className="grid grid-cols-2 gap-2">
            <select value={form.personType} onChange={e => set({ personType: e.target.value })} className={inputCls} style={{ ...inputStyle, appearance: 'none' }}>
              <option value="fisica">Pessoa Física</option>
              <option value="juridica">Pessoa Jurídica</option>
            </select>
            <div className="flex items-center gap-2 rounded-lg border px-3.5" style={inputStyle}>
              <input type="checkbox" id="isActive" checked={form.isActive} onChange={e => set({ isActive: e.target.checked })} className="h-3.5 w-3.5 accent-accent" />
              <label htmlFor="isActive" className="text-sm text-muted cursor-pointer">Ativo</label>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.cpf} onChange={e => set({ cpf: fmtCpfInput(e.target.value) })} placeholder="CPF / CNPJ" className={inputCls} style={inputStyle} />
            <input value={form.ieRg} onChange={e => set({ ieRg: e.target.value })} placeholder="RG / IE" className={inputCls} style={inputStyle} />
          </div>
        </section>

        {/* ── Contato ── */}
        <section className="border-t pt-3 space-y-2.5" style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Contato</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.whatsapp} onChange={e => set({ whatsapp: fmtPhoneInput(e.target.value) })} placeholder="WhatsApp" className={inputCls} style={inputStyle} />
            <input value={form.phone} onChange={e => set({ phone: fmtPhoneInput(e.target.value) })} placeholder="Celular / Fone" className={inputCls} style={inputStyle} />
          </div>
          <input type="email" value={form.email} onChange={e => set({ email: e.target.value })} placeholder="E-mail" className={inputCls} style={inputStyle} />
          <input type="email" value={form.nfeEmail} onChange={e => set({ nfeEmail: e.target.value })} placeholder="E-mail para envio de NF-e" className={inputCls} style={inputStyle} />
          <input value={form.website} onChange={e => set({ website: e.target.value })} placeholder="Web Site" className={inputCls} style={inputStyle} />
        </section>

        {/* ── Endereço ── */}
        <section className="border-t pt-3 space-y-2.5" style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Endereço</p>
          <div className="relative">
            <input
              value={form.cep}
              onChange={e => { const v = fmtCep(e.target.value); set({ cep: v }); fetchCep(v) }}
              placeholder="CEP (auto-preenche)"
              className={inputCls} style={inputStyle}
            />
            {fetchingCep && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted" />}
          </div>
          <input value={form.addressStreet} onChange={e => set({ addressStreet: e.target.value })} placeholder="Logradouro" className={inputCls} style={inputStyle} />
          <div className="grid grid-cols-2 gap-2">
            <input value={form.addressNumber} onChange={e => set({ addressNumber: e.target.value })} placeholder="Número" className={inputCls} style={inputStyle} />
            <input value={form.addressComplement} onChange={e => set({ addressComplement: e.target.value })} placeholder="Complemento" className={inputCls} style={inputStyle} />
          </div>
          <input value={form.addressDistrict} onChange={e => set({ addressDistrict: e.target.value })} placeholder="Bairro" className={inputCls} style={inputStyle} />

          <AddressCityState
            state={form.addressState}
            city={form.addressCity}
            onStateChange={v => set({ addressState: v, addressCity: '' })}
            onCityChange={v => set({ addressCity: v })}
            inputCls={inputCls}
            inputStyle={inputStyle}
          />
        </section>

        {/* ── Dados pessoais ── */}
        <section className="border-t pt-3 space-y-2.5" style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Dados pessoais</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#94A3B8' }}>Data de nascimento</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
                <DateTextInput
                  value={form.birthDate}
                  onChange={v => set({ birthDate: v })}
                  className={inputCls + ' pl-9'}
                  style={inputStyle}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#94A3B8' }}>Sexo</label>
              <select value={form.gender} onChange={e => set({ gender: e.target.value })} className={inputCls} style={{ ...inputStyle, appearance: 'none' }}>
                <option value="">Selecionar</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
                <option value="O">Outro</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={form.maritalStatus} onChange={e => set({ maritalStatus: e.target.value })} className={inputCls} style={{ ...inputStyle, appearance: 'none' }}>
              <option value="">Estado civil</option>
              <option value="solteiro">Solteiro(a)</option>
              <option value="casado">Casado(a)</option>
              <option value="divorciado">Divorciado(a)</option>
              <option value="viuvo">Viúvo(a)</option>
              <option value="uniao_estavel">União estável</option>
            </select>
            <input value={form.profession} onChange={e => set({ profession: e.target.value })} placeholder="Profissão" className={inputCls} style={inputStyle} />
          </div>
        </section>

        {/* ── Filiação ── */}
        <section className="border-t pt-3 space-y-2.5" style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Filiação</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.motherName} onChange={e => set({ motherName: e.target.value })} placeholder="Nome da mãe" className={inputCls} style={inputStyle} />
            <input value={form.motherCpf} onChange={e => set({ motherCpf: fmtCpfInput(e.target.value) })} placeholder="CPF da mãe" className={inputCls} style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.fatherName} onChange={e => set({ fatherName: e.target.value })} placeholder="Nome do pai" className={inputCls} style={inputStyle} />
            <input value={form.fatherCpf} onChange={e => set({ fatherCpf: fmtCpfInput(e.target.value) })} placeholder="CPF do pai" className={inputCls} style={inputStyle} />
          </div>
        </section>

        {/* ── Comercial ── */}
        <section className="border-t pt-3 space-y-2.5" style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Comercial</p>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.salesperson} onChange={e => set({ salesperson: e.target.value })} placeholder="Vendedor" className={inputCls} style={inputStyle} />
            <select value={form.contactType} onChange={e => set({ contactType: e.target.value })} className={inputCls} style={{ ...inputStyle, appearance: 'none' }}>
              <option value="">Tipo de contato</option>
              <option value="Cliente">Cliente</option>
              <option value="Fornecedor">Fornecedor</option>
              <option value="Transportadora">Transportadora</option>
              <option value="Outro">Outro</option>
            </select>
          </div>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>
            <input
              value={form.creditLimitStr}
              onChange={e => set({ creditLimitStr: e.target.value.replace(/[^0-9,]/g, '') })}
              placeholder="0,00"
              className={inputCls + ' pl-10'}
              style={inputStyle}
              title="Limite de crédito"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#F59E0B' }}>
              Como nos conheceu? *
            </label>
            <select
              value={form.origin}
              onChange={e => set({ origin: e.target.value })}
              className={inputCls}
              style={{ ...inputStyle, appearance: 'none' }}
            >
              <option value="">Selecione uma opção…</option>
              {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {(form.origin === 'instagram_pago' || form.origin === 'facebook') && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#22C55E' }}>
                Código da campanha
              </label>
              <input
                value={form.campaignCode}
                onChange={e => set({ campaignCode: e.target.value.toUpperCase() })}
                placeholder="Ex: HJ-VAI-1"
                className={inputCls + ' font-mono'}
                style={inputStyle}
                maxLength={40}
              />
              <p className="text-[10px]" style={{ color: '#94A3B8' }}>
                Veja na mensagem pré-preenchida que o cliente mandou no WhatsApp
              </p>
            </div>
          )}
        </section>

        {/* ── Observações ── */}
        <section className="border-t pt-3 space-y-2" style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Observações</p>
          <textarea
            value={form.notes}
            onChange={e => set({ notes: e.target.value })}
            placeholder="Anotações sobre o cliente..."
            rows={3}
            className={inputCls + ' resize-none'}
            style={inputStyle}
          />
        </section>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm font-medium text-muted hover:bg-card transition-colors"
            style={{ borderColor: '#2A3650' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim() || !form.origin}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {mode === 'edit' ? 'Salvar alterações' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main client component ──────────────────────────────────────────────────

type SuggestItem = { id: string; full_name: string; trade_name: string | null; cpf_cnpj: string | null; whatsapp: string | null; is_active: boolean }

export function ClientesClient({
  customers: initial, salesByCustomer, osByCustomer,
  page, totalPages, total, q,
}: Props) {
  const router                      = useRouter()
  const [customers, setCustomers]   = useState(initial)
  const [searchVal, setSearchVal]   = useState(q)
  const debounceRef                 = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Autocomplete
  const [suggestions, setSuggestions]   = useState<SuggestItem[]>([])
  const [showSuggest, setShowSuggest]   = useState(false)
  const [loadingSuggest, setLoadingSuggest] = useState(false)
  const suggestRef                      = useRef<HTMLDivElement>(null)
  const acDebounceRef                   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [modal, setModal] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; customer: CustomerRow }
    | null
  >(null)

  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) {
        setShowSuggest(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (importInputRef.current) importInputRef.current.value = ''

    setImporting(true)
    try {
      const text = await file.text()
      const result = await importCustomersFromBling(text)
      if (result.errors.length > 0) {
        toast.error(`Erro na importação: ${result.errors[0]}`)
      } else {
        toast.success(`Concluído! ${result.updated} atualizados, ${result.inserted} novos.`)
        router.refresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao importar')
    } finally {
      setImporting(false)
    }
  }

  // ── Server-side search with debounce ──────────────────────────────────

  const handleSearch = useCallback((val: string) => {
    setSearchVal(val)

    // Autocomplete: dispara após 200 ms com 3+ chars
    if (acDebounceRef.current) clearTimeout(acDebounceRef.current)
    if (val.trim().length >= 3) {
      setLoadingSuggest(true)
      acDebounceRef.current = setTimeout(async () => {
        try {
          const res  = await fetch(`/clientes/busca?q=${encodeURIComponent(val.trim())}`)
          const data = await res.json() as SuggestItem[]
          setSuggestions(data)
          setShowSuggest(true)
        } catch { /* ignore */ } finally {
          setLoadingSuggest(false)
        }
      }, 200)
    } else {
      setSuggestions([])
      setShowSuggest(false)
    }

    // Busca full-page: dispara após 600 ms (só se não clicar em sugestão)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams()
      if (val.trim()) params.set('q', val.trim())
      params.set('page', '1')
      router.push(`/clientes?${params.toString()}`)
    }, 600)
  }, [router])

  function selectSuggestion(item: SuggestItem) {
    setShowSuggest(false)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSearchVal(item.full_name)
    const params = new URLSearchParams()
    params.set('q', item.full_name)
    params.set('page', '1')
    router.push(`/clientes?${params.toString()}`)
  }

  // ── Pagination navigation ─────────────────────────────────────────────

  function goToPage(p: number) {
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    params.set('page', String(p))
    router.push(`/clientes?${params.toString()}`)
  }

  // ── Modal callbacks ────────────────────────────────────────────────────

  function handleSaved(row: CustomerRow, isEdit: boolean) {
    if (isEdit) {
      setCustomers(prev => prev.map(c => c.id === row.id ? { ...c, ...row } : c))
    } else {
      setCustomers(prev => [row, ...prev])
    }
  }

  function buildFormFromCustomer(c: CustomerRow): FormState {
    const cpf = c.cpf_cnpj
      ? (c.cpf_cnpj.length === 11
          ? `${c.cpf_cnpj.slice(0,3)}.${c.cpf_cnpj.slice(3,6)}.${c.cpf_cnpj.slice(6,9)}-${c.cpf_cnpj.slice(9)}`
          : c.cpf_cnpj)
      : ''
    const creditStr = c.credit_limit_cents
      ? (c.credit_limit_cents / 100).toFixed(2).replace('.', ',')
      : ''
    return {
      name: c.full_name, tradeName: c.trade_name ?? '', personType: c.person_type ?? 'fisica',
      cpf, ieRg: c.ie_rg ?? '', isActive: c.is_active ?? true,
      whatsapp: c.whatsapp ? fmtPhone(c.whatsapp) : '',
      phone: c.phone ? fmtPhone(c.phone) : '',
      email: c.email ?? '', nfeEmail: c.nfe_email ?? '', website: c.website ?? '',
      birthDate: c.birth_date ?? '', gender: c.gender ?? '',
      maritalStatus: c.marital_status ?? '', profession: c.profession ?? '',
      fatherName: c.father_name ?? '', fatherCpf: c.father_cpf ?? '',
      motherName: c.mother_name ?? '', motherCpf: c.mother_cpf ?? '',
      salesperson: c.salesperson ?? '', contactType: c.contact_type ?? '',
      creditLimitStr: creditStr, notes: c.notes ?? '',
      cep: c.address_zip ?? '', addressStreet: c.address_street ?? '',
      addressDistrict: c.address_district ?? '',
      addressNumber: c.address_number ?? '', addressComplement: c.address_complement ?? '',
      addressCity: c.address_city ?? '', addressState: c.address_state ?? '',
      clienteSince: c.created_at ? c.created_at.split('T')[0] : '',
      origin: c.origin ?? '',
      campaignCode: c.campaign_code ?? '',
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Search + New button */}
      <div className="flex gap-3">
        <div className="relative flex-1" ref={suggestRef}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={searchVal}
            onChange={e => handleSearch(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggest(true)}
            placeholder="Buscar por nome, CPF ou WhatsApp..."
            className="w-full rounded-xl border py-2.5 pl-9 pr-10 text-sm text-text outline-none transition-colors focus:border-accent/60 placeholder:text-muted"
            style={{ background: '#1B2638', borderColor: '#2A3650' }}
          />
          {loadingSuggest && (
            <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted" />
          )}
          {searchVal && !loadingSuggest && (
            <button
              onClick={() => { handleSearch(''); setSuggestions([]); setShowSuggest(false) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-text"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Autocomplete dropdown */}
          {showSuggest && suggestions.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border shadow-xl"
              style={{ background: '#131C2A', borderColor: '#2A3650' }}
            >
              {suggestions.map(item => (
                <button
                  key={item.id}
                  onMouseDown={e => { e.preventDefault(); selectSuggestion(item) }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-white/5"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text">{item.full_name}</p>
                    {item.trade_name && (
                      <p className="truncate text-xs text-muted">{item.trade_name}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted space-y-0.5">
                    {item.cpf_cnpj && <p>{item.cpf_cnpj.length === 11
                      ? `${item.cpf_cnpj.slice(0,3)}.${item.cpf_cnpj.slice(3,6)}.${item.cpf_cnpj.slice(6,9)}-${item.cpf_cnpj.slice(9)}`
                      : item.cpf_cnpj}
                    </p>}
                    {item.whatsapp && <p>{`(${item.whatsapp.slice(0,2)}) ${item.whatsapp.slice(2,7)}-${item.whatsapp.slice(7)}`}</p>}
                    {!item.is_active && <p className="text-orange-400">Inativo</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Exportar CSV */}
        <a
          href="/clientes/exportar"
          download
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
          style={{ background: '#2A3650', color: '#10B981', border: '1px solid #10B98133' }}
          title="Exportar todos os clientes em CSV"
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </a>

        <input
          ref={importInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleImportFile}
        />
        <button
          onClick={() => importInputRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 whitespace-nowrap disabled:opacity-50"
          style={{ background: '#2A3650', color: '#22C55E', border: '1px solid #22C55E33' }}
          title="Importar CSV do Bling"
        >
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {importing ? 'Importando...' : 'Importar Bling'}
        </button>
        <button
          onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
          style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
        >
          <Plus className="h-4 w-4" />
          Novo Cliente
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: '#2A3650' }}>
          <h2 className="text-sm font-semibold text-text">
            {q ? `Resultado para "${q}"` : 'Clientes'}
          </h2>
          <span className="text-xs text-muted">
            {total === 0
              ? 'Nenhum cliente'
              : `${((page - 1) * 100) + 1}–${Math.min(page * 100, total)} de ${total} clientes`}
          </span>
        </div>

        {customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16">
            <Search className="h-8 w-8" style={{ color: '#64748B' }} />
            <p className="text-sm text-muted">
              {q ? `Nenhum cliente encontrado para "${q}"` : 'Nenhum cliente cadastrado ainda'}
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div
              className="grid gap-3 px-5 py-3 border-b text-xs font-medium uppercase tracking-wider text-muted"
              style={{ borderColor: '#2A3650', gridTemplateColumns: '1fr 150px 190px 100px 100px 60px 60px 36px' }}
            >
              <span>Nome</span>
              <span>Documento</span>
              <span>Contato</span>
              <span>Aniversário</span>
              <span>Cliente desde</span>
              <span className="text-center">Vendas</span>
              <span className="text-center">OS</span>
              <span />
            </div>

            {customers.map(c => {
              const vendas   = salesByCustomer[c.id] ?? 0
              const os       = osByCustomer[c.id]    ?? 0
              const since    = new Date(c.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
              })
              const birthday = c.birth_date ? fmtBirthDate(c.birth_date) : null

              return (
                <div
                  key={c.id}
                  className="grid gap-3 px-5 py-3.5 border-b items-center last:border-0 group"
                  style={{ borderColor: '#2A3650', gridTemplateColumns: '1fr 150px 190px 100px 100px 60px 60px 36px' }}
                >
                  {/* Name */}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">{c.full_name}</p>
                    {(c.address_city || c.address_state) && (
                      <p className="mt-0.5 text-xs text-muted truncate">
                        {[c.address_city, c.address_state].filter(Boolean).join(' — ')}
                      </p>
                    )}
                  </div>

                  {/* Document */}
                  <div className="min-w-0">
                    {c.cpf_cnpj ? (
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3 w-3 shrink-0 text-muted" />
                        <p className="text-xs text-muted truncate">{fmtCpf(c.cpf_cnpj)}</p>
                      </div>
                    ) : <p className="text-xs text-muted">—</p>}
                  </div>

                  {/* Contact */}
                  <div className="space-y-0.5 min-w-0">
                    {c.whatsapp && (
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3 w-3 shrink-0 text-muted" />
                        <p className="text-xs text-muted truncate">{fmtPhone(c.whatsapp)}</p>
                      </div>
                    )}
                    {c.email && (
                      <div className="flex items-center gap-1.5">
                        <Mail className="h-3 w-3 shrink-0 text-muted" />
                        <p className="text-xs text-muted truncate">{c.email}</p>
                      </div>
                    )}
                    {!c.whatsapp && !c.email && <p className="text-xs text-muted">—</p>}
                  </div>

                  {/* Birthday */}
                  <div className="min-w-0">
                    {birthday ? (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 shrink-0 text-muted" />
                        <p className="text-xs text-muted">{birthday}</p>
                      </div>
                    ) : <p className="text-xs text-muted">—</p>}
                  </div>

                  {/* Since */}
                  <p className="text-xs text-muted">{since}</p>

                  {/* Sales */}
                  <p className="text-sm text-center font-medium" style={{ color: vendas > 0 ? '#10B981' : '#94A3B8' }}>
                    {vendas > 0 ? vendas : '—'}
                  </p>

                  {/* OS */}
                  <p className="text-sm text-center font-medium" style={{ color: os > 0 ? '#22C55E' : '#94A3B8' }}>
                    {os > 0 ? os : '—'}
                  </p>

                  {/* Edit */}
                  <button
                    onClick={() => setModal({ mode: 'edit', customer: c })}
                    className="flex items-center justify-center h-7 w-7 rounded-lg border opacity-0 group-hover:opacity-100 transition-opacity hover:bg-card"
                    style={{ borderColor: '#2A3650' }}
                    title="Editar cliente"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted" />
                  </button>
                </div>
              )
            })}
          </>
        )}

        {/* ── Paginação ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-3" style={{ borderColor: '#2A3650' }}>
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: '#2A3650' }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Página anterior
            </button>

            <span className="text-xs text-muted">
              Página {page} de {totalPages}
            </span>

            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: '#2A3650' }}
            >
              Próxima página
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {modal?.mode === 'create' && (
        <CustomerModal
          mode="create"
          initial={EMPTY_FORM}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
      {modal?.mode === 'edit' && (
        <CustomerModal
          mode="edit"
          editId={modal.customer.id}
          initial={buildFormFromCustomer(modal.customer)}
          originalCreatedAt={modal.customer.created_at}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  )
}
