'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import {
  Search, Loader2, ShoppingCart, Smartphone, Plus, X,
  CheckCircle2, ArrowRight, User, Building2, Repeat, ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import { acquireDevice, type AcquisitionRow } from '@/actions/product-serials'
import { searchProducts, searchCustomers, type Product, type Customer } from '@/actions/pos'
import { searchSuppliers, type SupplierRow } from '@/actions/suppliers'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRL = (c: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((c ?? 0) / 100)

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function parseBRLToCents(s: string): number | null {
  const cleaned = s.replace(/\s/g, '').replace(/[R$]/g, '').trim()
  if (!cleaned) return null
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  const v = Number(normalized)
  if (!Number.isFinite(v) || v < 0) return null
  return Math.round(v * 100)
}

const CONDITION_LABEL: Record<'A' | 'B' | 'C' | 'defective', { label: string; desc: string; color: string }> = {
  A:         { label: 'A — Impecável',     desc: 'Sem marcas, parece novo',       color: 'bg-emerald-500' },
  B:         { label: 'B — Bom',           desc: 'Pequenos sinais de uso',        color: 'bg-blue-500' },
  C:         { label: 'C — Com sinais',    desc: 'Marcas visíveis, funciona ok',  color: 'bg-amber-500' },
  defective: { label: 'Defeito',           desc: 'Não funciona / com problema',   color: 'bg-rose-500' },
}

const FROM_LABEL: Record<'customer' | 'supplier' | 'trade_in' | 'other', { label: string; icon: typeof User }> = {
  customer:  { label: 'Cliente vendeu',         icon: User },
  supplier:  { label: 'Fornecedor/Distribuidor', icon: Building2 },
  trade_in:  { label: 'Troca (entrou na venda)', icon: Repeat },
  other:     { label: 'Outro',                   icon: ShoppingCart },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ComprarClient({ initialAcquisitions }: { initialAcquisitions: AcquisitionRow[] }) {
  const [acqs, setAcqs] = useState<AcquisitionRow[]>(initialAcquisitions)

  // Form state
  const [productQuery, setProductQuery] = useState('')
  const [productResults, setProductResults] = useState<Product[]>([])
  const [productDrop, setProductDrop] = useState(false)
  const [searchingProduct, setSearchingProduct] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const productDropRef = useRef<HTMLDivElement>(null)

  const [serial, setSerial]               = useState('')
  const [serial2, setSerial2]             = useState('')
  const [costStr, setCostStr]             = useState('')
  const [condition, setCondition]         = useState<'A' | 'B' | 'C' | 'defective'>('B')
  const [fromType, setFromType]           = useState<'customer' | 'supplier' | 'trade_in' | 'other'>('customer')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'pix' | 'transfer' | 'card' | 'trade_in_credit' | 'mixed' | ''>('')
  const [notes, setNotes]                 = useState('')

  // Customer search (when fromType=customer)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [customerDrop, setCustomerDrop] = useState(false)
  const [searchingCustomer, setSearchingCustomer] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const customerDropRef = useRef<HTMLDivElement>(null)

  // Supplier autocomplete (Sprint 7)
  const [supplierQuery, setSupplierQuery]     = useState('')
  const [supplierResults, setSupplierResults] = useState<SupplierRow[]>([])
  const [supplierDrop, setSupplierDrop]       = useState(false)
  const [searchingSupplier, setSearchingSupplier] = useState(false)
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierRow | null>(null)
  const supplierDropRef = useRef<HTMLDivElement>(null)

  const [pending, startTransition] = useTransition()

  // ── Product search debounce ──
  useEffect(() => {
    if (selectedProduct) return
    if (productQuery.trim().length < 2) { setProductResults([]); setProductDrop(false); return }
    const t = setTimeout(async () => {
      setSearchingProduct(true)
      try {
        const r = await searchProducts(productQuery)
        // Só produtos (não peças nem serials)
        const onlyProducts = r.filter(p => p.source === 'products')
        setProductResults(onlyProducts)
        setProductDrop(onlyProducts.length > 0)
      } finally { setSearchingProduct(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [productQuery, selectedProduct])

  // ── Customer search debounce ──
  useEffect(() => {
    if (selectedCustomer) return
    if (customerQuery.trim().length < 2) { setCustomerResults([]); setCustomerDrop(false); return }
    const t = setTimeout(async () => {
      setSearchingCustomer(true)
      try {
        const r = await searchCustomers(customerQuery)
        setCustomerResults(r)
        setCustomerDrop(r.length > 0)
      } finally { setSearchingCustomer(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [customerQuery, selectedCustomer])

  // ── Supplier search debounce ──
  useEffect(() => {
    if (selectedSupplier) return
    if (supplierQuery.trim().length < 2) { setSupplierResults([]); setSupplierDrop(false); return }
    const t = setTimeout(async () => {
      setSearchingSupplier(true)
      try {
        const r = await searchSuppliers(supplierQuery)
        setSupplierResults(r)
        setSupplierDrop(r.length > 0)
      } finally { setSearchingSupplier(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [supplierQuery, selectedSupplier])

  // ── Outside click handlers ──
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (productDropRef.current && !productDropRef.current.contains(e.target as Node)) setProductDrop(false)
      if (customerDropRef.current && !customerDropRef.current.contains(e.target as Node)) setCustomerDrop(false)
      if (supplierDropRef.current && !supplierDropRef.current.contains(e.target as Node)) setSupplierDrop(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  function pickProduct(p: Product) {
    setSelectedProduct(p)
    setProductQuery(p.name)
    setProductDrop(false)
  }

  function clearProduct() {
    setSelectedProduct(null)
    setProductQuery('')
  }

  function pickCustomer(c: Customer) {
    setSelectedCustomer(c)
    setCustomerQuery(c.full_name)
    setCustomerDrop(false)
  }

  function clearCustomer() {
    setSelectedCustomer(null)
    setCustomerQuery('')
  }

  function pickSupplier(s: SupplierRow) {
    setSelectedSupplier(s)
    setSupplierQuery(s.name)
    setSupplierDrop(false)
  }

  function clearSupplier() {
    setSelectedSupplier(null)
    setSupplierQuery('')
  }

  function resetForm() {
    setSelectedProduct(null); setProductQuery('')
    setSerial(''); setSerial2(''); setCostStr('')
    setCondition('B'); setFromType('customer'); setPaymentMethod('')
    setNotes('')
    setCustomerQuery(''); setSelectedCustomer(null)
    setSupplierQuery(''); setSelectedSupplier(null)
  }

  function submit() {
    if (!selectedProduct) {
      toast.error('Selecione o modelo do aparelho.')
      return
    }
    if (serial.trim().length < 4) {
      toast.error('IMEI/Serial inválido (mínimo 4 caracteres).')
      return
    }
    const costCents = parseBRLToCents(costStr)
    if (costCents === null) {
      toast.error('Valor pago inválido.')
      return
    }
    if (fromType === 'customer' && !selectedCustomer) {
      toast.error('Selecione o cliente vendedor (ou troque a origem).')
      return
    }
    if (fromType === 'supplier' && !selectedSupplier) {
      toast.error('Selecione um fornecedor cadastrado (ou cadastre um novo em Fornecedores).')
      return
    }

    startTransition(async () => {
      const res = await acquireDevice({
        productId:          selectedProduct.id,
        serial:             serial.trim(),
        serial2:            serial2.trim() || null,
        costCents,
        condition,
        acquiredFromType:   fromType,
        acquiredCustomerId: fromType === 'customer' ? selectedCustomer?.id ?? null : null,
        supplierId:         fromType === 'supplier' ? selectedSupplier?.id ?? null : null,
        paymentMethod:      paymentMethod || null,
        notes:              notes.trim() || null,
      })

      if (!res.ok) {
        toast.error(res.error)
        return
      }

      toast.success(`Aparelho ${serial} adicionado ao estoque!`)
      // Adiciona à lista otimista
      setAcqs(prev => [{
        serialId:           res.data!.serialId,
        serial:             serial.trim().toUpperCase(),
        productId:          selectedProduct.id,
        productName:        selectedProduct.name,
        costCents,
        status:             'available' as const,
        condition,
        acquiredAt:         new Date().toISOString(),
        acquiredFromType:   fromType,
        acquiredCustomerId: fromType === 'customer' ? selectedCustomer?.id ?? null : null,
        customerName:       fromType === 'customer' ? selectedCustomer?.full_name ?? null : null,
        supplierName:       fromType === 'supplier' ? selectedSupplier?.name ?? null : null,
        paymentMethod:      paymentMethod || null,
        notes:              notes.trim() || null,
      }, ...prev])
      resetForm()
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Comprar Aparelho</h1>
        <p className="mt-1 text-sm text-muted">
          Registra a entrada de um aparelho usado, troca ou novo via fornecedor.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        {/* ── LEFT: form ── */}
        <div className="rounded-2xl border bg-white p-6 shadow-sm ring-1 ring-zinc-200 space-y-5">
          <h2 className="text-base font-semibold text-zinc-900">Dados da compra</h2>

          {/* Produto/Modelo */}
          <div ref={productDropRef} className="relative">
            <label className="mb-1 block text-sm font-medium text-zinc-700">Modelo do aparelho</label>
            {selectedProduct ? (
              <div className="flex items-center justify-between rounded-lg border border-blue-300 bg-blue-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 truncate">{selectedProduct.name}</p>
                  {selectedProduct.code && (
                    <p className="text-xs text-zinc-500">Cód: {selectedProduct.code}</p>
                  )}
                </div>
                <button onClick={clearProduct} className="text-zinc-500 hover:text-rose-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={productQuery}
                  onChange={e => setProductQuery(e.target.value)}
                  placeholder="iPhone 12, Samsung A54, etc..."
                  className="w-full rounded-lg border border-zinc-200 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
                />
                {searchingProduct && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />
                )}
                {productDrop && (
                  <div className="absolute z-30 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                    {productResults.map(p => (
                      <button
                        key={p.id}
                        onMouseDown={() => pickProduct(p)}
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-blue-50"
                      >
                        <div className="text-left min-w-0">
                          <p className="font-medium text-zinc-900 truncate">{p.name}</p>
                          {p.code && <p className="text-xs text-zinc-500">Cód: {p.code}</p>}
                        </div>
                        <p className="text-xs text-zinc-500 ml-2 shrink-0">
                          {p.stock_qty ?? 0} em estoque
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-zinc-500">
              Não achou o modelo? Cadastre primeiro em <a href="/estoque" className="text-blue-600 hover:underline">Estoque</a>.
            </p>
          </div>

          {/* IMEI */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">IMEI / Serial</label>
              <input
                value={serial}
                onChange={e => setSerial(e.target.value)}
                placeholder="356938035643809"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                IMEI 2 <span className="text-zinc-400 font-normal">opcional</span>
              </label>
              <input
                value={serial2}
                onChange={e => setSerial2(e.target.value)}
                placeholder="dual-SIM"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Valor pago */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Valor pago (R$)</label>
            <input
              value={costStr}
              onChange={e => setCostStr(e.target.value)}
              placeholder="1500,00"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Condição */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Condição do aparelho</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['A', 'B', 'C', 'defective'] as const).map(c => {
                const cfg = CONDITION_LABEL[c]
                const active = condition === c
                return (
                  <button
                    key={c}
                    onClick={() => setCondition(c)}
                    className={`rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                        : 'border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${cfg.color}`} />
                      <span className="text-sm font-semibold">{cfg.label.split(' — ')[0]}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-500">{cfg.desc}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Origem */}
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">Origem da compra</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(['customer', 'supplier', 'trade_in', 'other'] as const).map(t => {
                const cfg = FROM_LABEL[t]
                const Icon = cfg.icon
                const active = fromType === t
                return (
                  <button
                    key={t}
                    onClick={() => setFromType(t)}
                    className={`rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                        : 'border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    <Icon className="h-4 w-4 text-zinc-600" />
                    <p className="mt-1 text-xs font-medium text-zinc-900">{cfg.label}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Cliente (se origem=customer) */}
          {fromType === 'customer' && (
            <div ref={customerDropRef} className="relative">
              <label className="mb-1 block text-sm font-medium text-zinc-700">Cliente vendedor</label>
              {selectedCustomer ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{selectedCustomer.full_name}</p>
                    {selectedCustomer.whatsapp && (
                      <p className="text-xs text-zinc-500">WhatsApp: {selectedCustomer.whatsapp}</p>
                    )}
                  </div>
                  <button onClick={clearCustomer} className="text-zinc-500 hover:text-rose-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={customerQuery}
                    onChange={e => setCustomerQuery(e.target.value)}
                    placeholder="Nome, CPF ou WhatsApp"
                    className="w-full rounded-lg border border-zinc-200 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  {searchingCustomer && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />
                  )}
                  {customerDrop && (
                    <div className="absolute z-30 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                      {customerResults.map(c => (
                        <button
                          key={c.id}
                          onMouseDown={() => pickCustomer(c)}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                        >
                          <p className="font-medium text-zinc-900">{c.full_name}</p>
                          {c.whatsapp && <p className="text-xs text-zinc-500">{c.whatsapp}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Fornecedor (se origem=supplier) — Sprint 7: autocomplete em vez de texto livre */}
          {fromType === 'supplier' && (
            <div ref={supplierDropRef} className="relative">
              <label className="mb-1 block text-sm font-medium text-zinc-700">Fornecedor</label>
              {selectedSupplier ? (
                <div className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 truncate">{selectedSupplier.name}</p>
                    <div className="text-xs text-zinc-500 flex flex-wrap gap-x-2">
                      {selectedSupplier.tradeName && <span>{selectedSupplier.tradeName}</span>}
                      {selectedSupplier.cpfCnpj && <span>CNPJ: {selectedSupplier.cpfCnpj}</span>}
                      {selectedSupplier.contactName && <span>Contato: {selectedSupplier.contactName}</span>}
                    </div>
                  </div>
                  <button onClick={clearSupplier} className="text-zinc-500 hover:text-rose-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    value={supplierQuery}
                    onChange={e => setSupplierQuery(e.target.value)}
                    placeholder="Nome, CNPJ ou nome fantasia"
                    className="w-full rounded-lg border border-zinc-200 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                  {searchingSupplier && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" />
                  )}
                  {supplierDrop && (
                    <div className="absolute z-30 mt-1 w-full rounded-lg border border-zinc-200 bg-white shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                      {supplierResults.map(s => (
                        <button
                          key={s.id}
                          onMouseDown={() => pickSupplier(s)}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-blue-50"
                        >
                          <p className="font-medium text-zinc-900">{s.name}</p>
                          <p className="text-xs text-zinc-500">
                            {[s.tradeName, s.cpfCnpj].filter(Boolean).join(' · ')}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <p className="mt-1 text-xs text-zinc-500">
                Não achou? <a href="/fornecedores" className="text-blue-600 hover:underline">Cadastre o fornecedor</a> primeiro.
              </p>
            </div>
          )}

          {/* Forma de pagamento + observação */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">Forma de pagamento</label>
              <div className="relative">
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value as typeof paymentMethod)}
                  className="w-full appearance-none rounded-lg border border-zinc-200 px-3 py-2.5 pr-9 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Selecione…</option>
                  <option value="cash">Dinheiro</option>
                  <option value="pix">PIX</option>
                  <option value="transfer">Transferência</option>
                  <option value="card">Cartão</option>
                  <option value="trade_in_credit">Crédito de troca</option>
                  <option value="mixed">Misto</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700">
                Observação <span className="text-zinc-400 font-normal">opcional</span>
              </label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Ex: tela com leve risco"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
            <button
              onClick={resetForm}
              disabled={pending}
              className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              Limpar
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-600 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Registrar compra
            </button>
          </div>
        </div>

        {/* ── RIGHT: lista de compras recentes ── */}
        <div className="rounded-2xl border bg-white p-5 shadow-sm ring-1 ring-zinc-200">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-zinc-900">
            <ShoppingCart className="h-4 w-4 text-blue-500" />
            Compras recentes
          </h2>

          {acqs.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              Nenhuma compra registrada ainda.
            </p>
          ) : (
            <ul className="space-y-3 max-h-[600px] overflow-y-auto">
              {acqs.map(a => {
                const condCfg = a.condition ? CONDITION_LABEL[a.condition] : null
                const fromCfg = a.acquiredFromType ? FROM_LABEL[a.acquiredFromType] : null
                return (
                  <li key={a.serialId} className="rounded-lg border border-zinc-200 p-3 hover:bg-zinc-50 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-zinc-900 truncate">{a.productName}</p>
                        <p className="font-mono text-xs text-zinc-600">{a.serial}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-blue-600">{BRL(a.costCents)}</p>
                        <p className="text-[10px] text-zinc-400">{fmtDate(a.acquiredAt)}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {condCfg && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-medium">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${condCfg.color}`} />
                          {condCfg.label.split(' — ')[0]}
                        </span>
                      )}
                      {fromCfg && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600">
                          {fromCfg.label}
                        </span>
                      )}
                      {a.customerName && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
                          {a.customerName}
                        </span>
                      )}
                      {a.supplierName && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
                          {a.supplierName}
                        </span>
                      )}
                      {a.status === 'sold' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Vendido
                        </span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
