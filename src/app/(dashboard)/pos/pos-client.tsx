'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Search, Plus, X, Loader2, ShoppingBag,
  CheckCircle, User, Pencil, UserCheck, Calendar, Cake, Gift,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  searchProducts, searchCustomers, createCustomer, createSale, updateCustomerOrigin,
  type Product, type Customer,
} from '@/actions/pos'
import type { StockControlMode } from '@/actions/settings'
import { AddressCityState } from '@/components/ui/address-fields'
import { CUSTOMER_ORIGIN_OPTIONS, originLabel } from '@/lib/customer-origin'
import { CampaignCodePicker } from '@/components/meta-ads/campaign-code-picker'
import { SALE_CHANNEL_OPTIONS_PICKABLE, DELIVERY_TYPE_OPTIONS, type SaleChannel, type DeliveryType } from '@/lib/sale-channels'
import { validateBirthdayCoupon, markBirthdayCouponUsed } from '@/actions/birthdays'

// ── Types ──────────────────────────────────────────────────────────────────────

type CartItem = {
  key: string
  productId: string | null
  source?: 'products' | 'parts_catalog'
  name: string
  quantity: number
  unitPriceCents: number
}

type PaymentMethod = 'cash' | 'pix' | 'card' | 'mixed'

// ── Helpers ────────────────────────────────────────────────────────────────────

const BRL = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)

function parseCents(value: string): number {
  const clean = value.replace(/[^\d,]/g, '').replace(',', '.')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : Math.round(n * 100)
}

function fmtCpf(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}

function fmtPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}

function fmtCep(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0,5)}-${d.slice(5)}`
}

function randKey() {
  return Math.random().toString(36).slice(2)
}

// ── Shared styles ──────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border px-3.5 py-2.5 text-sm text-text outline-none transition-colors focus:border-accent/60 placeholder:text-muted'
const inputStyle = { background: '#1B2638', borderColor: '#2A3650' }

// ── Component ──────────────────────────────────────────────────────────────────

export function PosClient({ consumidorFinal, stockControlMode }: { consumidorFinal: Customer; stockControlMode: StockControlMode }) {
  // ── Cart ──
  const [cart, setCart] = useState<CartItem[]>([])

  // ── Product search ──
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<Product[]>([])
  const [searching, setSearching] = useState(false)
  const [showDrop, setShowDrop]   = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // ── Manual item modal ──
  const [showManual, setShowManual] = useState(false)
  const [mName, setMName]           = useState('')
  const [mPrice, setMPrice]         = useState('')
  const [mQty, setMQty]             = useState('1')

  // ── Adjustments ──
  const [shipping, setShipping] = useState('')
  const [discount, setDiscount] = useState('')
  // Cupom de aniversário (estado: input + aplicado/inválido + percentual)
  const [couponInput, setCouponInput]   = useState('')
  const [couponApplied, setCouponApplied] = useState<{ percent: number; customerName: string } | null>(null)
  const [validatingCoupon, setValidatingCoupon] = useState(false)

  // ── Payment ──
  const [method, setMethod] = useState<PaymentMethod>('pix')
  const [saleChannel, setSaleChannel]   = useState<SaleChannel | ''>('')
  const [deliveryType, setDeliveryType] = useState<DeliveryType | ''>('')
  // Origem da venda — só usado quando cliente é Consumidor Final (vendas
  // anônimas precisam declarar origem na sale, pq o cliente padrão é compartilhado).
  // Default 'passou_na_porta' porque é 99% dos casos em loja física.
  const [consumerOrigin, setConsumerOrigin] = useState<string>('passou_na_porta')
  const [mxCash, setMxCash] = useState('')
  const [mxPix, setMxPix]   = useState('')
  const [mxCard, setMxCard] = useState('')

  // ── Customer ──
  const [customer, setCustomer]               = useState<Customer>(consumidorFinal)
  const [searchQuery, setSearchQuery]         = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [searchingCustomer, setSearchingCust] = useState(false)
  const [showCustomerDrop, setShowCustomerDrop] = useState(false)
  const [showForm, setShowForm]               = useState(false)
  const [nc, setNc] = useState({
    name: '', tradeName: '', personType: 'fisica',
    cpf: '', ieRg: '', isActive: true,
    whatsapp: '', phone: '', email: '', nfeEmail: '', website: '',
    birthDate: '', gender: '', maritalStatus: '', profession: '',
    fatherName: '', fatherCpf: '', motherName: '', motherCpf: '',
    salesperson: '', contactType: '', creditLimitStr: '',
    notes: '',
    cep: '', addressStreet: '', addressDistrict: '',
    addressNumber: '', addressComplement: '', addressCity: '', addressState: '',
    origin: '',
  })
  const [fetchingCep, setFetchingCep]       = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [savingOrigin, setSavingOrigin]     = useState(false)

  // whether the current customer is the default consumidor final
  const isDefault = customer.id === consumidorFinal.id

  // ── Finalize ──
  const [finalizing, setFinalizing] = useState(false)

  // ── Computed ──
  const subtotal = cart.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0)
  const total    = Math.max(0, subtotal + parseCents(shipping) - parseCents(discount))

  // ── Product search debounce ──
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setShowDrop(false); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await searchProducts(query)
        setResults(r)
        setShowDrop(r.length > 0)
      } finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  // ── Close product dropdown on outside click ──
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // ── Cart helpers ──
  function addProduct(p: Product) {
    // Verifica estoque apenas para produtos (não peças do CheckSmart)
    if (p.source === 'products' && p.stock_qty !== null && p.stock_qty <= 0) {
      if (stockControlMode === 'block') {
        toast.error(`Produto sem estoque: "${p.name}" (${p.stock_qty} ${p.stock_qty === 0 ? 'un.' : 'un.'})`, {
          description: 'Venda bloqueada. Ajuste o estoque antes de continuar.',
        })
        return
      }
      if (stockControlMode === 'warn') {
        toast.warning(`Estoque insuficiente: "${p.name}"`, {
          description: `Quantidade disponível: ${p.stock_qty}. A venda será registrada mesmo assim.`,
        })
      }
    }

    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === p.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 }
        return next
      }
      return [...prev, { key: randKey(), productId: p.id, source: p.source, name: p.name, quantity: 1, unitPriceCents: p.price_cents }]
    })
    setQuery('')
    setShowDrop(false)
  }

  function addManual() {
    if (!mName.trim() || !mPrice) return
    setCart(prev => [...prev, {
      key: randKey(), productId: null,
      name: mName.trim(),
      quantity: Math.max(1, parseInt(mQty) || 1),
      unitPriceCents: parseCents(mPrice),
    }])
    setMName(''); setMPrice(''); setMQty('1'); setShowManual(false)
  }

  function setQty(key: string, q: number) {
    if (q <= 0) { setCart(prev => prev.filter(i => i.key !== key)); return }
    setCart(prev => prev.map(i => i.key === key ? { ...i, quantity: q } : i))
  }

  function setPrice(key: string, val: string) {
    setCart(prev => prev.map(i => i.key === key ? { ...i, unitPriceCents: parseCents(val) } : i))
  }

  function remove(key: string) {
    setCart(prev => prev.filter(i => i.key !== key))
  }

  // ── Customer search ──
  async function handleCustomerSearch() {
    if (searchQuery.trim().length < 2) { toast.error('Digite ao menos 2 caracteres'); return }
    setSearchingCust(true); setShowForm(false); setShowCustomerDrop(false)
    try {
      const found = await searchCustomers(searchQuery.trim())
      if (found.length === 1) {
        setCustomer(found[0]); setSearchQuery(''); toast.success('Cliente encontrado!')
      } else if (found.length > 1) {
        setCustomerResults(found); setShowCustomerDrop(true)
      } else {
        const digits = searchQuery.replace(/\D/g, '')
        setNc(p => ({ ...p, cpf: digits.length === 11 ? fmtCpf(searchQuery) : '' }))
        setShowForm(true)
        toast.info('Cliente não encontrado — preencha os dados para cadastrar')
      }
    } finally { setSearchingCust(false) }
  }

  function selectCustomer(c: Customer) {
    setCustomer(c); setShowCustomerDrop(false); setCustomerResults([])
    setSearchQuery(''); toast.success('Cliente selecionado!')
  }

  function resetToDefault() {
    setCustomer(consumidorFinal)
    setSearchQuery(''); setShowForm(false); setShowCustomerDrop(false); setCustomerResults([])
  }

  // ── CEP lookup ──
  async function fetchCep(val: string) {
    const d = val.replace(/\D/g, '')
    if (d.length !== 8) return
    setFetchingCep(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const data = await r.json()
      if (!data.erro) setNc(p => ({
        ...p,
        addressStreet: data.logradouro ?? '',
        addressCity:   data.localidade ?? '',
        addressState:  data.uf ?? '',
      }))
    } catch { /* silent */ } finally { setFetchingCep(false) }
  }

  // ── Save new customer ──
  async function handleSaveCustomer() {
    if (!nc.name.trim()) { toast.error('Nome é obrigatório'); return }
    if (!nc.origin)      { toast.error('Informe como o cliente te conheceu'); return }
    setSavingCustomer(true)
    try {
      const result = await createCustomer(nc)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setCustomer(result.customer); setShowForm(false); setSearchQuery('')
      toast.success('Cliente cadastrado!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cadastrar cliente')
    } finally { setSavingCustomer(false) }
  }

  // ── Aplicar cupom de aniversário ──
  // Valida no servidor: cliente tem aniv. no mês corrente? não usou ainda?
  // Se ok, calcula desconto sobre o subtotal e seta no campo `discount`.
  async function applyBirthdayCoupon() {
    if (isDefault) {
      toast.error('Selecione um cliente cadastrado pra usar o cupom de aniversário.')
      return
    }
    if (!couponInput.trim()) {
      toast.error('Digite o código do cupom.')
      return
    }
    setValidatingCoupon(true)
    try {
      const res = await validateBirthdayCoupon({
        customerId: customer.id,
        couponCode: couponInput.trim(),
      })
      if (!res.ok) { toast.error(res.error); return }

      // Calcula desconto absoluto sobre o subtotal e preenche o campo
      const discountCents = Math.round((subtotal * res.discountPercent) / 100)
      const reais = (discountCents / 100).toFixed(2).replace('.', ',')
      setDiscount(reais)
      setCouponApplied({ percent: res.discountPercent, customerName: res.customerName })
      toast.success(`🎂 Cupom aplicado: ${res.discountPercent}% de desconto!`)
    } finally {
      setValidatingCoupon(false)
    }
  }

  function clearCoupon() {
    setCouponApplied(null)
    setCouponInput('')
    setDiscount('')
  }

  // ── Set origin for an existing customer selected in POS ──
  async function handleSetOrigin(origin: string) {
    if (!origin || isDefault) return
    setSavingOrigin(true)
    try {
      const c = await updateCustomerOrigin(customer.id, origin)
      setCustomer(c)
      toast.success('Origem registrada!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar origem')
    } finally { setSavingOrigin(false) }
  }

  // ── Finalize sale ──
  async function handleFinalize() {
    if (cart.length === 0) { toast.error('Adicione ao menos um item'); return }
    if (!isDefault && !customer.origin) {
      toast.error('Informe como o cliente te conheceu antes de finalizar')
      return
    }
    if (method === 'mixed') {
      const sum = parseCents(mxCash) + parseCents(mxPix) + parseCents(mxCard)
      if (Math.abs(sum - total) > 1) {
        toast.error(`Soma dos pagamentos (${BRL(sum)}) ≠ total (${BRL(total)})`)
        return
      }
    }
    setFinalizing(true)
    try {
      await createSale({
        customerId:     customer.id,
        subtotalCents:  subtotal,
        discountCents:  parseCents(discount),
        shippingCents:  parseCents(shipping),
        totalCents:     total,
        paymentMethod:  method,
        paymentDetails: method === 'mixed'
          ? { cash: parseCents(mxCash), pix: parseCents(mxPix), card: parseCents(mxCard) }
          : null,
        saleChannel:    saleChannel  || null,
        deliveryType:   deliveryType || null,
        customerOrigin: isDefault ? (consumerOrigin || null) : null,
        items: cart.map(i => ({
          productId:      i.productId,
          source:         i.source,
          name:           i.name,
          quantity:       i.quantity,
          unitPriceCents: i.unitPriceCents,
          subtotalCents:  i.unitPriceCents * i.quantity,
        })),
      })
      // Marca cupom de aniversário como usado (se aplicado nessa venda)
      if (couponApplied && customer.id) {
        await markBirthdayCouponUsed(customer.id).catch(() => null)
      }
      toast.success('Venda finalizada com sucesso!')
      setCart([]); setShipping(''); setDiscount('')
      setMethod('pix'); setMxCash(''); setMxPix(''); setMxCard('')
      setSaleChannel(''); setDeliveryType('')
      setConsumerOrigin('passou_na_porta')
      setCouponInput(''); setCouponApplied(null)
      setCustomer(consumidorFinal)
    } catch { toast.error('Erro ao finalizar venda') }
    finally { setFinalizing(false) }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text">Frente de Caixa</h1>
        <p className="mt-1 text-sm text-muted capitalize">
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Grid — 2 colunas a partir de lg (≥1024px), empilha em telas menores.
           Padding-bottom em mobile pra dar espaço pra sticky bar de finalizar. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px] pb-24 lg:pb-0">

        {/* ── LEFT: search + cart ── */}
        <div className="space-y-4">

          {/* Product search */}
          <div ref={dropRef} className="relative">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Buscar produto por nome ou código..."
                  className="w-full rounded-xl border py-2.5 pl-9 pr-10 text-sm text-text outline-none transition-colors focus:border-accent/60 placeholder:text-muted"
                  style={inputStyle}
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
                )}
              </div>
              <button
                onClick={() => setShowManual(true)}
                className="flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-card text-accent whitespace-nowrap"
                style={{ borderColor: '#2A3650' }}
              >
                <Plus className="h-4 w-4" />
                Item / Serviço
              </button>
            </div>

            {/* Product dropdown */}
            {showDrop && (
              <div
                className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl overflow-hidden"
                style={{ background: '#1B2638', borderColor: '#2A3650' }}
              >
                {results.map(p => (
                  <button
                    key={`${p.source}-${p.id}`}
                    onMouseDown={() => addProduct(p)}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm hover:bg-card transition-colors"
                  >
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-text">{p.name}</p>
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={p.source === 'parts_catalog'
                            ? { background: '#F59E0B18', color: '#F59E0B' }
                            : { background: '#22C55E18', color: '#22C55E' }}
                        >
                          {p.source === 'parts_catalog' ? 'Peça' : 'Produto'}
                        </span>
                      </div>
                      {p.code && <p className="text-xs text-muted">Cód: {p.code}</p>}
                    </div>
                    <div className="text-right ml-4 shrink-0">
                      <p className="font-semibold text-accent">{BRL(p.price_cents)}</p>
                      {p.stock_qty != null && (
                        <p className="text-xs text-muted">Estoque: {p.stock_qty}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart */}
          <div className="rounded-xl border overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-20">
                <ShoppingBag className="h-10 w-10" style={{ color: '#64748B' }} />
                <p className="text-sm text-muted">Nenhum item adicionado</p>
                <p className="text-xs" style={{ color: '#64748B' }}>Busque um produto ou clique em "Item / Serviço"</p>
              </div>
            ) : (
              <>
                {/* Cart header */}
                <div
                  className="grid items-center gap-3 px-4 py-3 border-b text-xs font-medium uppercase tracking-wider text-muted"
                  style={{ borderColor: '#2A3650', gridTemplateColumns: '1fr 88px 120px 100px 28px' }}
                >
                  <span>Produto</span>
                  <span className="text-center">Qtd</span>
                  <span className="text-right">Preço Unit.</span>
                  <span className="text-right">Subtotal</span>
                  <span />
                </div>

                {/* Cart items */}
                {cart.map(item => (
                  <div
                    key={item.key}
                    className="grid items-center gap-3 px-4 py-3 border-b"
                    style={{ borderColor: '#2A3650', gridTemplateColumns: '1fr 88px 120px 100px 28px' }}
                  >
                    <p className="text-sm font-medium text-text truncate">{item.name}</p>

                    {/* Qty stepper */}
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setQty(item.key, item.quantity - 1)}
                        className="h-6 w-6 rounded border flex items-center justify-center text-xs text-muted hover:bg-card transition-colors"
                        style={{ borderColor: '#2A3650' }}
                      >−</button>
                      <span className="w-6 text-center text-sm text-text">{item.quantity}</span>
                      <button
                        onClick={() => setQty(item.key, item.quantity + 1)}
                        className="h-6 w-6 rounded border flex items-center justify-center text-xs text-muted hover:bg-card transition-colors"
                        style={{ borderColor: '#2A3650' }}
                      >+</button>
                    </div>

                    {/* Editable unit price */}
                    <input
                      key={`price-${item.key}`}
                      defaultValue={(item.unitPriceCents / 100).toFixed(2).replace('.', ',')}
                      onBlur={e => setPrice(item.key, e.target.value)}
                      className="w-full rounded-lg border px-2.5 py-1 text-sm text-right text-text outline-none focus:border-accent/60 transition-colors"
                      style={inputStyle}
                    />

                    <p className="text-sm font-semibold text-right text-green">
                      {BRL(item.unitPriceCents * item.quantity)}
                    </p>

                    <button onClick={() => remove(item.key)} className="text-muted hover:text-coral transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {/* Cart footer */}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-muted">{cart.length} {cart.length === 1 ? 'item' : 'itens'}</span>
                  <span className="text-base font-bold text-green">{BRL(subtotal)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── RIGHT: customer + summary + payment ── */}
        <div className="space-y-4">

          {/* ── Customer section ── */}
          <div className="rounded-xl border p-5 space-y-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
              <User className="h-4 w-4 text-accent" />
              Cliente
            </h3>

            {/* Selected customer card */}
            <div
              className="flex items-start justify-between rounded-lg border p-3"
              style={{
                background: '#131C2A',
                borderColor: isDefault ? '#2A3650' : '#22C55E30',
              }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                {isDefault
                  ? <UserCheck className="h-4 w-4 mt-0.5 shrink-0 text-muted" />
                  : <User className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#22C55E' }} />
                }
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-text truncate">{customer.full_name}</p>
                    {isDefault && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: '#94A3B818', color: '#94A3B8' }}>
                        Padrão
                      </span>
                    )}
                  </div>
                  {customer.cpf_cnpj && (
                    <p className="mt-0.5 text-xs text-muted">CPF: {fmtCpf(customer.cpf_cnpj)}</p>
                  )}
                  {customer.whatsapp && (
                    <p className="text-xs text-muted">WhatsApp: {customer.whatsapp}</p>
                  )}
                  {customer.email && (
                    <p className="text-xs text-muted truncate">{customer.email}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => {
                  setCustomer(consumidorFinal)
                  setSearchQuery(''); setShowForm(false); setShowCustomerDrop(false); setCustomerResults([])
                }}
                className="ml-2 shrink-0 text-muted hover:text-accent transition-colors"
                title="Alterar cliente"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* ── Origem (só para cliente real, não para Consumidor Final) ── */}
            {!isDefault && (
              customer.origin ? (
                <div className="flex items-center justify-between rounded-lg border px-3 py-2"
                  style={{ background: '#131C2A', borderColor: '#2A3650' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0" style={{ color: '#94A3B8' }}>
                      Origem
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-bold truncate"
                      style={{ background: 'rgba(34,197,94,.12)', color: '#22C55E' }}>
                      {originLabel(customer.origin)}
                    </span>
                  </div>
                  <select
                    value={customer.origin}
                    onChange={e => handleSetOrigin(e.target.value)}
                    disabled={savingOrigin}
                    className="text-xs bg-transparent text-muted hover:text-accent transition-colors outline-none cursor-pointer"
                    title="Alterar origem"
                  >
                    {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value} style={{ background: '#131C2A' }}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="rounded-lg border px-3 py-2.5 space-y-1.5"
                  style={{ background: 'rgba(255,170,0,.06)', borderColor: 'rgba(255,170,0,.35)' }}>
                  <label className="text-[10px] font-semibold uppercase tracking-wider block" style={{ color: '#F59E0B' }}>
                    Como nos conheceu? * (obrigatório)
                  </label>
                  <select
                    value=""
                    onChange={e => handleSetOrigin(e.target.value)}
                    disabled={savingOrigin}
                    className={inputCls}
                    style={{ ...inputStyle, appearance: 'none' }}
                  >
                    <option value="">Selecione uma opção…</option>
                    {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )
            )}

            {/* ── Código da campanha (só pra origens Meta) ── */}
            {!isDefault && customer.origin && (customer.origin === 'instagram_pago' || customer.origin === 'facebook') && (
              <div className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2"
                style={{ background: '#131C2A', borderColor: '#2A3650' }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0" style={{ color: '#94A3B8' }}>
                  Campanha
                </span>
                <CampaignCodePicker
                  customerId={customer.id}
                  currentCode={customer.campaign_code}
                  origin={customer.origin}
                  onUpdated={code => setCustomer({ ...customer, campaign_code: code })}
                  compact
                />
              </div>
            )}

            {/* Customer search + cadastrar (only when not showing form and not in dropdown) */}
            {!showForm && !showCustomerDrop && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCustomerSearch()}
                    placeholder="Buscar por nome, CPF ou WhatsApp..."
                    className={inputCls + ' flex-1'}
                    style={inputStyle}
                  />
                  <button
                    onClick={handleCustomerSearch}
                    disabled={searchingCustomer}
                    className="rounded-lg border px-3.5 py-2.5 text-sm font-medium text-accent hover:bg-card transition-colors disabled:opacity-60 shrink-0"
                    style={{ borderColor: '#2A3650' }}
                  >
                    {searchingCustomer ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Buscar'}
                  </button>
                </div>

                {/* Direct register button */}
                <button
                  onClick={() => { setShowForm(true); setSearchQuery('') }}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors hover:bg-card"
                  style={{ borderColor: '#22C55E40', color: '#22C55E' }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Cadastrar novo cliente
                </button>

                {!isDefault && (
                  <button
                    onClick={resetToDefault}
                    className="w-full rounded-lg border py-2 text-xs font-medium text-muted hover:bg-card transition-colors"
                    style={{ borderColor: '#2A3650' }}
                  >
                    ↩ Voltar ao Consumidor Final
                  </button>
                )}
              </div>
            )}

            {/* Multiple customer results */}
            {showCustomerDrop && customerResults.length > 0 && (
              <div className="rounded-xl border overflow-hidden" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
                {customerResults.map(c => (
                  <button
                    key={c.id}
                    onClick={() => selectCustomer(c)}
                    className="flex w-full items-start justify-between px-4 py-3 text-sm hover:bg-card transition-colors border-b last:border-0"
                    style={{ borderColor: '#2A3650' }}
                  >
                    <div className="text-left">
                      <p className="font-medium text-text">{c.full_name}</p>
                      {c.cpf_cnpj && <p className="text-xs text-muted">CPF: {fmtCpf(c.cpf_cnpj)}</p>}
                    </div>
                    {c.whatsapp && <p className="text-xs text-muted shrink-0 ml-2">{c.whatsapp}</p>}
                  </button>
                ))}
                <button
                  onClick={() => setShowCustomerDrop(false)}
                  className="w-full py-2 text-xs text-muted hover:bg-card transition-colors"
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* ── New customer form (full, matching clientes module) ── */}
            {showForm && (
              <div className="space-y-3 border-t pt-4" style={{ borderColor: '#2A3650' }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-amber">Cadastro rápido</p>

                {/* Name */}
                <input
                  value={nc.name}
                  onChange={e => setNc(p => ({ ...p, name: e.target.value }))}
                  placeholder="Nome completo *"
                  className={inputCls}
                  style={inputStyle}
                />

                {/* CPF + Birthday */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={nc.cpf}
                    onChange={e => setNc(p => ({ ...p, cpf: fmtCpf(e.target.value) }))}
                    placeholder="CPF"
                    className={inputCls}
                    style={inputStyle}
                  />
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
                    <input
                      type="date"
                      value={nc.birthDate}
                      onChange={e => setNc(p => ({ ...p, birthDate: e.target.value }))}
                      className={inputCls + ' pl-9'}
                      style={inputStyle}
                      title="Data de aniversário"
                    />
                  </div>
                </div>

                {/* WhatsApp */}
                <input
                  value={nc.whatsapp}
                  onChange={e => setNc(p => ({ ...p, whatsapp: fmtPhone(e.target.value) }))}
                  placeholder="WhatsApp"
                  className={inputCls}
                  style={inputStyle}
                />

                {/* Email */}
                <input
                  type="email"
                  value={nc.email}
                  onChange={e => setNc(p => ({ ...p, email: e.target.value }))}
                  placeholder="E-mail"
                  className={inputCls}
                  style={inputStyle}
                />

                {/* Address section */}
                <div className="border-t pt-3 space-y-2" style={{ borderColor: '#2A3650' }}>
                  <p className="text-xs font-medium text-muted">Endereço (opcional)</p>

                  {/* CEP — optional, auto-fills others */}
                  <div className="relative">
                    <input
                      value={nc.cep}
                      onChange={e => {
                        const v = fmtCep(e.target.value)
                        setNc(p => ({ ...p, cep: v }))
                        fetchCep(v)
                      }}
                      placeholder="CEP (auto-preenche)"
                      className={inputCls}
                      style={inputStyle}
                    />
                    {fetchingCep && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted" />
                    )}
                  </div>

                  {/* Street — always visible */}
                  <input
                    value={nc.addressStreet}
                    onChange={e => setNc(p => ({ ...p, addressStreet: e.target.value }))}
                    placeholder="Logradouro"
                    className={inputCls}
                    style={inputStyle}
                  />

                  {/* Number + Complement */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={nc.addressNumber}
                      onChange={e => setNc(p => ({ ...p, addressNumber: e.target.value }))}
                      placeholder="Número"
                      className={inputCls}
                      style={inputStyle}
                    />
                    <input
                      value={nc.addressComplement}
                      onChange={e => setNc(p => ({ ...p, addressComplement: e.target.value }))}
                      placeholder="Complemento"
                      className={inputCls}
                      style={inputStyle}
                    />
                  </div>

                  {/* City + State — select from IBGE */}
                  <AddressCityState
                    state={nc.addressState}
                    city={nc.addressCity}
                    onStateChange={v => setNc(p => ({ ...p, addressState: v }))}
                    onCityChange={v => setNc(p => ({ ...p, addressCity: v }))}
                    inputCls={inputCls}
                    inputStyle={inputStyle}
                  />
                </div>

                {/* Origem — obrigatório */}
                <div className="flex flex-col gap-1 border-t pt-3" style={{ borderColor: '#2A3650' }}>
                  <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#F59E0B' }}>
                    Como nos conheceu? *
                  </label>
                  <select
                    value={nc.origin}
                    onChange={e => setNc(p => ({ ...p, origin: e.target.value }))}
                    className={inputCls}
                    style={{ ...inputStyle, appearance: 'none' }}
                  >
                    <option value="">Selecione uma opção…</option>
                    {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Form actions */}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => { setShowForm(false); setSearchQuery('') }}
                    className="flex-1 rounded-lg border py-2.5 text-sm font-medium text-muted hover:bg-card transition-colors"
                    style={{ borderColor: '#2A3650' }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveCustomer}
                    disabled={savingCustomer || !nc.name.trim() || !nc.origin}
                    className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
                  >
                    {savingCustomer && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Salvar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Order summary */}
          <div className="rounded-xl border p-5 space-y-3" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <h3 className="text-sm font-semibold text-text">Resumo do Pedido</h3>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="text-text font-medium">{BRL(subtotal)}</span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Frete (R$)</span>
              <input
                value={shipping}
                onChange={e => setShipping(e.target.value)}
                placeholder="0,00"
                className="w-28 rounded-lg border px-2.5 py-1 text-sm text-right text-text outline-none focus:border-accent/60 transition-colors placeholder:text-muted"
                style={inputStyle}
              />
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Desconto (R$)</span>
              <input
                value={discount}
                onChange={e => setDiscount(e.target.value)}
                placeholder="0,00"
                className="w-28 rounded-lg border px-2.5 py-1 text-sm text-right text-text outline-none focus:border-accent/60 transition-colors placeholder:text-muted"
                style={inputStyle}
              />
            </div>

            {/* Cupom de aniversário — só pra cliente real */}
            {!isDefault && !couponApplied && (
              <div className="rounded-lg border p-2 space-y-1.5" style={{ borderColor: '#2A3650', background: 'rgba(228,64,95,.03)' }}>
                <div className="flex items-center gap-1.5">
                  <Cake className="h-3 w-3" style={{ color: '#E4405F' }} />
                  <span className="text-[11px] uppercase tracking-wider" style={{ color: '#E4405F' }}>Cupom de aniversário</span>
                </div>
                <div className="flex gap-2">
                  <input
                    value={couponInput}
                    onChange={e => setCouponInput(e.target.value.toUpperCase())}
                    placeholder={`ANIVER${new Date().getFullYear()}`}
                    className="flex-1 rounded-lg border px-2.5 py-1 text-xs text-text outline-none focus:border-accent/60 placeholder:text-muted uppercase tracking-wider"
                    style={inputStyle}
                  />
                  <button
                    onClick={applyBirthdayCoupon}
                    disabled={validatingCoupon || !couponInput.trim()}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                    style={{ background: '#E4405F', color: '#FFFFFF' }}
                  >
                    {validatingCoupon ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Aplicar'}
                  </button>
                </div>
              </div>
            )}

            {couponApplied && (
              <div className="rounded-lg border p-2 flex items-center justify-between"
                style={{ background: 'rgba(228,64,95,.08)', borderColor: '#E4405F' }}>
                <div className="flex items-center gap-2">
                  <Gift className="h-3.5 w-3.5" style={{ color: '#E4405F' }} />
                  <div>
                    <p className="text-[11px] font-bold" style={{ color: '#E4405F' }}>
                      Cupom aplicado: {couponApplied.percent}% OFF
                    </p>
                    <p className="text-[10px] text-muted">Aniversariante: {couponApplied.customerName}</p>
                  </div>
                </div>
                <button onClick={clearCoupon} className="text-muted hover:text-text">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: '#2A3650' }}>
              <span className="text-sm font-bold text-text">TOTAL</span>
              <span className="text-xl font-bold text-green">{BRL(total)}</span>
            </div>
          </div>

          {/* Payment method */}
          <div className="rounded-xl border p-5 space-y-3" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <h3 className="text-sm font-semibold text-text">Forma de Pagamento</h3>

            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { id: 'cash',  label: 'Dinheiro', color: '#10B981' },
                  { id: 'pix',   label: 'PIX',      color: '#22C55E' },
                  { id: 'card',  label: 'Cartão',   color: '#F59E0B' },
                  { id: 'mixed', label: 'Misto',    color: '#EF4444' },
                ] as { id: PaymentMethod; label: string; color: string }[]
              ).map(({ id, label, color }) => {
                const active = method === id
                return (
                  <button
                    key={id}
                    onClick={() => setMethod(id)}
                    className="rounded-lg border py-2 text-xs font-medium transition-all"
                    style={active
                      ? { background: `${color}18`, borderColor: color, color }
                      : { borderColor: '#2A3650', color: '#94A3B8' }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {/* Mixed breakdown */}
            {method === 'mixed' && (
              <div className="space-y-2 border-t pt-3" style={{ borderColor: '#2A3650' }}>
                {(
                  [
                    { label: 'Dinheiro', value: mxCash, set: setMxCash, color: '#10B981' },
                    { label: 'PIX',      value: mxPix,  set: setMxPix,  color: '#22C55E' },
                    { label: 'Cartão',   value: mxCard, set: setMxCard, color: '#F59E0B' },
                  ]
                ).map(({ label, value, set, color }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="w-14 text-xs font-medium shrink-0" style={{ color }}>{label}</span>
                    <input
                      value={value}
                      onChange={e => set(e.target.value)}
                      placeholder="0,00"
                      className="flex-1 rounded-lg border px-2.5 py-1.5 text-sm text-right text-text outline-none focus:border-accent/60 transition-colors placeholder:text-muted"
                      style={inputStyle}
                    />
                  </div>
                ))}

                {(() => {
                  const filled    = parseCents(mxCash) + parseCents(mxPix) + parseCents(mxCard)
                  const remaining = total - filled
                  return (
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-muted">Restante</span>
                      <span style={{ color: remaining === 0 ? '#10B981' : '#EF4444' }}>
                        {remaining === 0 ? '✓ OK' : BRL(Math.abs(remaining))}
                      </span>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>

          {/* ── Canal da venda + Entrega ── */}
          <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: '#2A3650', background: '#131C2A' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Canal da venda
            </p>
            <select
              value={saleChannel}
              onChange={e => setSaleChannel(e.target.value as SaleChannel | '')}
              className={inputCls + ' text-xs'}
              style={{ ...inputStyle, appearance: 'none' }}
            >
              <option value="">Não informar</option>
              {SALE_CHANNEL_OPTIONS_PICKABLE.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <select
              value={deliveryType}
              onChange={e => setDeliveryType(e.target.value as DeliveryType | '')}
              className={inputCls + ' text-xs'}
              style={{ ...inputStyle, appearance: 'none' }}
            >
              <option value="">Entrega — não informar</option>
              {DELIVERY_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Origem da venda — só pra Consumidor Final (vendas anônimas) */}
            {isDefault && (
              <>
                <div className="pt-2 border-t" style={{ borderColor: '#2A3650' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#94A3B8' }}>
                    Onde nos conheceu?
                  </p>
                  <select
                    value={consumerOrigin}
                    onChange={e => setConsumerOrigin(e.target.value)}
                    className={inputCls + ' text-xs'}
                    style={{ ...inputStyle, appearance: 'none' }}
                  >
                    {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px]" style={{ color: '#64748B' }}>
                    Ajuda a saber quantos clientes vêm de cada canal — entra nos relatórios de origem mesmo sem cadastrar o cliente.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Finalize */}
          <button
            onClick={handleFinalize}
            disabled={finalizing || cart.length === 0}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-opacity disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
          >
            {finalizing
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Finalizando...</>
              : <><CheckCircle className="h-4 w-4" /> Finalizar Venda</>
            }
          </button>
        </div>
      </div>

      {/* ── Manual item modal ── */}
      {showManual && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowManual(false) }}
        >
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Adicionar Item ou Serviço</h3>
              <button onClick={() => setShowManual(false)} className="text-muted hover:text-coral transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <input
              value={mName}
              onChange={e => setMName(e.target.value)}
              placeholder="Ex: Troca de tela, Película 3D, Conserto..."
              className={inputCls}
              style={inputStyle}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && addManual()}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-xs text-muted">Preço Unit. (R$)</p>
                <input
                  value={mPrice}
                  onChange={e => setMPrice(e.target.value)}
                  placeholder="0,00"
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted">Quantidade</p>
                <input
                  type="number"
                  min="1"
                  value={mQty}
                  onChange={e => setMQty(e.target.value)}
                  className={inputCls}
                  style={inputStyle}
                />
              </div>
            </div>

            {mName && mPrice && (
              <p className="text-xs text-center text-muted">
                Subtotal: <span className="font-semibold text-green">{BRL(parseCents(mPrice) * (parseInt(mQty) || 1))}</span>
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowManual(false)}
                className="flex-1 rounded-lg border py-2.5 text-sm font-medium text-muted hover:bg-card transition-colors"
                style={{ borderColor: '#2A3650' }}
              >
                Cancelar
              </button>
              <button
                onClick={addManual}
                disabled={!mName.trim() || !mPrice}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Sticky bottom bar (mobile only) — sempre acessível pra finalizar ── */}
      {cart.length > 0 && (
        <div
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t p-3"
          style={{
            background: '#131C2A',
            borderColor: '#2A3650',
            boxShadow: '0 -4px 16px rgba(0,0,0,0.5)',
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                {cart.length} item{cart.length !== 1 ? 's' : ''}
              </p>
              <p className="text-base font-bold text-text font-mono">{BRL(subtotal - parseCents(discount) + parseCents(shipping))}</p>
            </div>
            <button
              onClick={handleFinalize}
              disabled={finalizing || cart.length === 0}
              className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-opacity disabled:opacity-50 shrink-0"
              style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
            >
              {finalizing
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Finalizando...</>
                : <><CheckCircle className="h-4 w-4" /> Finalizar</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
