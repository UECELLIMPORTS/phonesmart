'use client'

import { useState, useTransition, useMemo } from 'react'
import {
  Building2, Plus, Pencil, Trash2, Loader2, X, Search,
  Phone, Mail, MapPin, Package, DollarSign, ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { createSupplier, updateSupplier, deleteSupplier, type SupplierRow } from '@/actions/suppliers'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

function fmtCpfCnpj(v: string | null): string {
  if (!v) return ''
  const d = v.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  return d
}

function fmtPhone(v: string | null): string {
  if (!v) return ''
  const d = v.replace(/\D/g, '')
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  return d
}

const CATEGORY_LABEL: Record<string, string> = {
  distribuidor:    'Distribuidor',
  pessoa_fisica:   'Pessoa Física',
  lote:            'Comprador de lotes',
  leilao:          'Leilão',
  outro:           'Outro',
}

type SupplierForm = Omit<SupplierRow, 'id' | 'createdAt' | 'acquisitionsCount' | 'totalAcquiredCents'> & { id?: string }

const EMPTY_FORM: SupplierForm = {
  name: '', tradeName: '', cpfCnpj: '', stateReg: '',
  whatsapp: '', phone: '', email: '', contactName: '',
  addressZip: '', addressStreet: '', addressNumber: '', addressComplement: '',
  addressDistrict: '', addressCity: '', addressState: '',
  category: '', notes: '', isActive: true,
}

export function FornecedoresClient({ initialSuppliers }: { initialSuppliers: SupplierRow[] }) {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>(initialSuppliers)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const [editing, setEditing] = useState<SupplierForm | null>(null)
  const [pending, startTransition] = useTransition()
  const [fetchingCep, setFetchingCep] = useState(false)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return suppliers.filter(s => {
      if (!showInactive && !s.isActive) return false
      if (q) {
        const hay = `${s.name} ${s.tradeName ?? ''} ${s.cpfCnpj ?? ''} ${s.contactName ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [suppliers, search, showInactive])

  const totals = useMemo(() => ({
    total:         suppliers.filter(s => s.isActive).length,
    acquisitions:  suppliers.reduce((sum, s) => sum + (s.acquisitionsCount ?? 0), 0),
    totalSpent:    suppliers.reduce((sum, s) => sum + (s.totalAcquiredCents ?? 0), 0),
  }), [suppliers])

  function openNew() {
    setEditing({ ...EMPTY_FORM })
  }

  function openEdit(s: SupplierRow) {
    setEditing({
      id:                s.id,
      name:              s.name,
      tradeName:         s.tradeName,
      cpfCnpj:           s.cpfCnpj,
      stateReg:          s.stateReg,
      whatsapp:          s.whatsapp,
      phone:             s.phone,
      email:             s.email,
      contactName:       s.contactName,
      addressZip:        s.addressZip,
      addressStreet:     s.addressStreet,
      addressNumber:     s.addressNumber,
      addressComplement: s.addressComplement,
      addressDistrict:   s.addressDistrict,
      addressCity:       s.addressCity,
      addressState:      s.addressState,
      category:          s.category,
      notes:             s.notes,
      isActive:          s.isActive,
    })
  }

  async function fetchCep(cep: string) {
    const d = cep.replace(/\D/g, '')
    if (d.length !== 8) return
    setFetchingCep(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const data = await r.json()
      if (!data.erro && editing) {
        setEditing(s => s ? {
          ...s,
          addressStreet: data.logradouro ?? s.addressStreet,
          addressDistrict: data.bairro ?? s.addressDistrict,
          addressCity: data.localidade ?? s.addressCity,
          addressState: data.uf ?? s.addressState,
        } : s)
      }
    } catch { /* silent */ } finally { setFetchingCep(false) }
  }

  function submit() {
    if (!editing) return
    if (!editing.name.trim()) {
      toast.error('Nome é obrigatório.')
      return
    }
    startTransition(async () => {
      const action = editing.id ? updateSupplier : createSupplier
      const res = await action(editing)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(editing.id ? 'Fornecedor atualizado!' : 'Fornecedor cadastrado!')
      setEditing(null)
      window.location.reload()
    })
  }

  function handleDelete(s: SupplierRow) {
    const ok = window.confirm(
      `Desativar "${s.name}"?\n\nFornecedores desativados não aparecem na busca da tela de Compra, mas o histórico fica preservado.`
    )
    if (!ok) return
    startTransition(async () => {
      const res = await deleteSupplier(s.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, isActive: false } : x))
      toast.success('Fornecedor desativado.')
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text">Fornecedores</h1>
          <p className="mt-1 text-sm text-muted">
            Cadastro recorrente de fornecedores. Vinculados às compras automaticamente.
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          Novo fornecedor
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <Building2 className="h-3.5 w-3.5" />
            Ativos
          </div>
          <p className="mt-1 text-2xl font-bold text-zinc-900">{totals.total}</p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-700">
            <Package className="h-3.5 w-3.5" />
            Aparelhos
          </div>
          <p className="mt-1 text-2xl font-bold text-blue-700">{totals.acquisitions}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
            <DollarSign className="h-3.5 w-3.5" />
            Total comprado
          </div>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{BRL(totals.totalSpent)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, CNPJ ou contato…"
            className="w-full rounded-lg border border-zinc-200 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-blue-500 focus:ring-blue-500"
          />
          Mostrar inativos
        </label>
      </div>

      {/* Lista */}
      <div className="rounded-2xl border bg-white shadow-sm ring-1 ring-zinc-200 overflow-hidden">
        {visible.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-zinc-500">
            <Building2 className="mx-auto mb-3 h-8 w-8 text-zinc-300" />
            {suppliers.length === 0
              ? 'Nenhum fornecedor cadastrado. Clique em "Novo fornecedor" pra começar.'
              : 'Nenhum fornecedor corresponde aos filtros.'}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {visible.map(s => (
              <li key={s.id} className={`px-5 py-4 hover:bg-zinc-50 transition ${!s.isActive ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-base font-semibold text-zinc-900">{s.name}</p>
                      {s.category && CATEGORY_LABEL[s.category] && (
                        <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          {CATEGORY_LABEL[s.category]}
                        </span>
                      )}
                      {!s.isActive && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                          Inativo
                        </span>
                      )}
                    </div>
                    {s.tradeName && <p className="text-xs text-zinc-500">{s.tradeName}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-600">
                      {s.cpfCnpj && <span>CNPJ: {fmtCpfCnpj(s.cpfCnpj)}</span>}
                      {s.contactName && <span>👤 {s.contactName}</span>}
                      {s.whatsapp && <span><Phone className="inline h-3 w-3 mr-0.5" />{fmtPhone(s.whatsapp)}</span>}
                      {s.email && <span><Mail className="inline h-3 w-3 mr-0.5" />{s.email}</span>}
                      {(s.addressCity || s.addressState) && (
                        <span><MapPin className="inline h-3 w-3 mr-0.5" />{[s.addressCity, s.addressState].filter(Boolean).join('/')}</span>
                      )}
                    </div>
                    {(s.acquisitionsCount ?? 0) > 0 && (
                      <p className="mt-1 text-xs">
                        <span className="text-zinc-500">Já forneceu</span>{' '}
                        <span className="font-semibold text-blue-600">{s.acquisitionsCount} aparelho{s.acquisitionsCount !== 1 ? 's' : ''}</span>
                        {s.totalAcquiredCents != null && s.totalAcquiredCents > 0 && (
                          <span className="text-zinc-500"> · Total: <span className="font-semibold text-emerald-600">{BRL(s.totalAcquiredCents)}</span></span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(s)}
                      disabled={pending}
                      className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                      title="Editar"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {s.isActive && (
                      <button
                        onClick={() => handleDelete(s)}
                        disabled={pending}
                        className="rounded-lg p-2 text-zinc-500 hover:bg-rose-50 hover:text-rose-600"
                        title="Desativar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={e => { if (e.target === e.currentTarget) setEditing(null) }}
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8">
            <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-5 py-3 rounded-t-2xl">
              <h3 className="text-base font-semibold text-zinc-900">
                {editing.id ? 'Editar fornecedor' : 'Novo fornecedor'}
              </h3>
              <button onClick={() => setEditing(null)} className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">Nome / Razão social *</label>
                  <input
                    value={editing.name}
                    onChange={e => setEditing(s => s ? { ...s, name: e.target.value } : s)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">Nome fantasia</label>
                  <input
                    value={editing.tradeName ?? ''}
                    onChange={e => setEditing(s => s ? { ...s, tradeName: e.target.value } : s)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">CPF/CNPJ</label>
                  <input
                    value={editing.cpfCnpj ?? ''}
                    onChange={e => setEditing(s => s ? { ...s, cpfCnpj: e.target.value } : s)}
                    placeholder="00.000.000/0000-00"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">IE</label>
                  <input
                    value={editing.stateReg ?? ''}
                    onChange={e => setEditing(s => s ? { ...s, stateReg: e.target.value } : s)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">Categoria</label>
                  <div className="relative">
                    <select
                      value={editing.category ?? ''}
                      onChange={e => setEditing(s => s ? { ...s, category: e.target.value } : s)}
                      className="w-full appearance-none rounded-lg border border-zinc-200 px-3 py-2 pr-9 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">—</option>
                      <option value="distribuidor">Distribuidor</option>
                      <option value="pessoa_fisica">Pessoa Física</option>
                      <option value="lote">Comprador de lotes</option>
                      <option value="leilao">Leilão</option>
                      <option value="outro">Outro</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">WhatsApp</label>
                  <input
                    value={editing.whatsapp ?? ''}
                    onChange={e => setEditing(s => s ? { ...s, whatsapp: e.target.value } : s)}
                    placeholder="(79) 99999-9999"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">Telefone fixo</label>
                  <input
                    value={editing.phone ?? ''}
                    onChange={e => setEditing(s => s ? { ...s, phone: e.target.value } : s)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">Email</label>
                  <input
                    type="email"
                    value={editing.email ?? ''}
                    onChange={e => setEditing(s => s ? { ...s, email: e.target.value } : s)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700">Pessoa de contato</label>
                  <input
                    value={editing.contactName ?? ''}
                    onChange={e => setEditing(s => s ? { ...s, contactName: e.target.value } : s)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Endereço */}
              <div className="border-t border-zinc-100 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Endereço</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">CEP</label>
                    <div className="relative">
                      <input
                        value={editing.addressZip ?? ''}
                        onChange={e => setEditing(s => s ? { ...s, addressZip: e.target.value } : s)}
                        onBlur={e => fetchCep(e.target.value)}
                        placeholder="00000-000"
                        className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      />
                      {fetchingCep && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-zinc-700">Logradouro</label>
                    <input
                      value={editing.addressStreet ?? ''}
                      onChange={e => setEditing(s => s ? { ...s, addressStreet: e.target.value } : s)}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">Número</label>
                    <input
                      value={editing.addressNumber ?? ''}
                      onChange={e => setEditing(s => s ? { ...s, addressNumber: e.target.value } : s)}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-zinc-700">Complemento</label>
                    <input
                      value={editing.addressComplement ?? ''}
                      onChange={e => setEditing(s => s ? { ...s, addressComplement: e.target.value } : s)}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">Bairro</label>
                    <input
                      value={editing.addressDistrict ?? ''}
                      onChange={e => setEditing(s => s ? { ...s, addressDistrict: e.target.value } : s)}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">Cidade</label>
                    <input
                      value={editing.addressCity ?? ''}
                      onChange={e => setEditing(s => s ? { ...s, addressCity: e.target.value } : s)}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-700">UF</label>
                    <input
                      value={editing.addressState ?? ''}
                      onChange={e => setEditing(s => s ? { ...s, addressState: e.target.value.toUpperCase().slice(0, 2) } : s)}
                      className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-700">Observação</label>
                <textarea
                  value={editing.notes ?? ''}
                  onChange={e => setEditing(s => s ? { ...s, notes: e.target.value } : s)}
                  rows={2}
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-zinc-100 bg-white px-5 py-3 rounded-b-2xl">
              <button
                onClick={() => setEditing(null)}
                disabled={pending}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
