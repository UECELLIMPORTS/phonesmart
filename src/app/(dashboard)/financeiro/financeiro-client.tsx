'use client'

import { useState, useMemo, useTransition, useEffect, useRef } from 'react'
import {
  Receipt, TrendingUp, ShoppingCart, CreditCard, Wrench,
  XCircle, RefreshCw, Plus, Loader2, X, AlertTriangle, Search,
  Trash2, UserPlus, Calendar, CalendarDays, MoreVertical, Filter, Pencil, FileText,
  Download, Mail, MessageCircle, Copy, Link as LinkIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  cancelSale, reactivateSale,
  cancelServiceOrder, reactivateServiceOrder,
  createManualSale, updateSaleDate, deleteSale,
  updateServiceOrderPayment, bulkCancel, bulkDeleteSales, bulkDeleteServiceOrders,
  updateCancelledSale,
  updateServiceOrder, getServiceOrderParts,
  type ManualSaleItem,
  type EditSaleInput,
  type OrderPartView,
} from '@/actions/financeiro'
import {
  searchCustomers, searchProducts, createCustomer, updateCustomerOrigin,
  type Customer, type Product,
} from '@/actions/pos'
import { AddressCityState } from '@/components/ui/address-fields'
import { CUSTOMER_ORIGIN_OPTIONS, originLabel } from '@/lib/customer-origin'
import { CampaignCodePicker } from '@/components/meta-ads/campaign-code-picker'
import { SALE_CHANNEL_OPTIONS_PICKABLE, DELIVERY_TYPE_OPTIONS, channelLabel, channelColor, deliveryLabel, type SaleChannel, type DeliveryType } from '@/lib/sale-channels'
import { updateServiceOrderChannel, updateSaleChannel } from '@/actions/sales-channels'
import { emitNfceFromSale } from '@/actions/fiscal-emit'
import {
  getSaleContact, getOrCreateShareToken, sendComprovanteEmail,
} from '@/actions/comprovante'

// ── Types ─────────────────────────────────────────────────────────────────────

type PeriodKey = 'all' | 'today' | 'week' | 'month' | 'custom'

export type FinanceiroRow = {
  id: string; rawId: string; source: 'erp' | 'checksmart'
  date: Date; dateStr: string; customerName: string; description: string
  payment: string | null; osStatus: string | null; cancelled: boolean
  discount: number; total: number
  profit: number    // total - custo (snapshot dos itens / parts_cost_cents)
  clienteType: 'novo' | 'recorrente' | null
  // ERP-only (for edit modal)
  customerId?: string | null
  saleItems?: { name: string; quantity: number; unitPriceCents: number }[]
  saleChannel?: string | null
  deliveryType?: string | null
  customerOrigin?: string | null
}

type CartItem = {
  key: string; productId: string | null; source?: 'products' | 'parts_catalog'
  name: string; quantity: number; unitPriceCents: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const parseCents = (v: string) => {
  const n = parseFloat(v.replace(/[^\d,]/g, '').replace(',', '.'))
  return isNaN(n) ? 0 : Math.round(n * 100)
}

const fmtBRL = (c: number) => (c / 100).toFixed(2).replace('.', ',')

// ── MenuItem ───────────────────────────────────────────────────────────────
// Botão padrão do dropdown de ações (⋯). Grande, clicável em qualquer área,
// com borda lateral colorida no hover.
function MenuItem({
  icon, label, accentColor, labelColor, onClick,
}: {
  icon: React.ReactNode
  label: string
  accentColor: string          // cor da borda lateral no hover + background
  labelColor?: string           // cor do texto (default E8F0FE)
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      className="flex w-full items-center gap-3 px-5 py-4 text-sm font-semibold
                 border-l-4 border-transparent transition-all cursor-pointer
                 hover:bg-white/[0.03]"
      style={{ color: labelColor ?? '#F8FAFC' }}
      onMouseEnter={e => {
        e.currentTarget.style.borderLeftColor = accentColor
        e.currentTarget.style.background = `${accentColor}14`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderLeftColor = 'transparent'
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {icon}
      <span className="pointer-events-none">{label}</span>
    </button>
  )
}

const fmtCpf = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`
}
const fmtPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 7) return `(${d.slice(0,2)}) ${d.slice(2)}`
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`
}
const fmtCep = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0,5)}-${d.slice(5)}`
}
const randKey = () => Math.random().toString(36).slice(2)

function getDateRange(period: PeriodKey, from: string, to: string): [Date, Date] | null {
  const now = new Date()
  if (period === 'today') {
    return [
      new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59),
    ]
  }
  if (period === 'week') {
    const day = now.getDay()
    return [
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - day),
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - day), 23, 59, 59),
    ]
  }
  if (period === 'month') {
    return [
      new Date(now.getFullYear(), now.getMonth(), 1),
      new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
    ]
  }
  if (period === 'custom' && from && to) {
    return [new Date(from + 'T00:00:00'), new Date(to + 'T23:59:59')]
  }
  return null
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Dinheiro', pix: 'PIX', card: 'Cartão', mixed: 'Misto',
  credit_card: 'Crédito', debit_card: 'Débito', transfer: 'Transferência', pending: 'Pendente',
}
const METHOD_COLOR: Record<string, string> = {
  cash: '#10B981', pix: '#22C55E', card: '#F59E0B', mixed: '#EF4444',
  credit_card: '#F59E0B', debit_card: '#F59E0B', transfer: '#22C55E', pending: '#EF4444',
}
const OS_STATUS_LABEL: Record<string, string> = {
  open: 'Aberta', in_progress: 'Em andamento', ready: 'Pronta',
  delivered: 'Entregue', cancelled: 'Cancelada', received: 'Recebida',
}

const INP = 'w-full rounded-lg border bg-transparent px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent'
const INP_S: React.CSSProperties = { borderColor: '#2A3650' }

const EMPTY_NC = {
  name: '', tradeName: '', personType: 'fisica',
  cpf: '', ieRg: '', isActive: true,
  whatsapp: '', phone: '', email: '', nfeEmail: '', website: '',
  birthDate: '', gender: '', maritalStatus: '', profession: '',
  fatherName: '', fatherCpf: '', motherName: '', motherCpf: '',
  salesperson: '', contactType: '', creditLimitStr: '',
  notes: '',
  cep: '', addressStreet: '', addressDistrict: '',
  addressNumber: '', addressComplement: '', addressCity: '', addressState: '',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FinanceiroClient({ initialRows }: { initialRows: FinanceiroRow[] }) {
  const [rows, setRows]           = useState<FinanceiroRow[]>(initialRows)
  const [actioning, startAction]  = useTransition()

  // Modais de cancelar / reativar
  const [confirmCancel, setConfirmCancel]         = useState<FinanceiroRow | null>(null)
  const [confirmReactivate, setConfirmReactivate] = useState<FinanceiroRow | null>(null)

  // Filtros
  const [period, setPeriod]             = useState<PeriodKey>('all')
  const [fromDate, setFromDate]         = useState('')
  const [toDate, setToDate]             = useState('')
  const [filterCustomer, setFilterCustomer] = useState('')
  // Multi-select de canais e tipos de entrega (vazio = todos)
  const [filterChannels, setFilterChannels]    = useState<string[]>([])
  const [filterDeliveries, setFilterDeliveries] = useState<string[]>([])

  function toggleChannel(c: string) {
    setFilterChannels(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])
  }
  function toggleDelivery(d: string) {
    setFilterDeliveries(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  // Modal editar venda cancelada (ERP) — formulário completo
  const [esRow, setEsRow]                     = useState<FinanceiroRow | null>(null)
  const [esDate, setEsDate]                   = useState('')
  const [esDiscountStr, setEsDiscountStr]     = useState('')
  const [esPayMethod, setEsPayMethod]         = useState<string>('pix')
  const [esSaleChannel, setEsSaleChannel]     = useState<SaleChannel | ''>('')
  const [esDeliveryType, setEsDeliveryType]   = useState<DeliveryType | ''>('')
  // Origem da venda — só editável quando cliente é Consumidor Final (ou sem cliente)
  const [esConsumerOrigin, setEsConsumerOrigin] = useState<string>('passou_na_porta')

  // Reclassify channel modal (works for ERP sales AND CheckSmart OS)
  const [rcRow, setRcRow]                     = useState<FinanceiroRow | null>(null)
  const [rcChannel, setRcChannel]             = useState<SaleChannel | ''>('')
  const [rcDelivery, setRcDelivery]           = useState<DeliveryType | ''>('')
  const [rcSaving, startRcSave]               = useTransition()

  function openReclassify(row: FinanceiroRow) {
    setRcChannel((row.saleChannel as SaleChannel | undefined) ?? '')
    setRcDelivery((row.deliveryType as DeliveryType | undefined) ?? '')
    setRcRow(row)
  }

  // ── Editar OS (CheckSmart) ─────────────────────────────────────────────────
  const [eosRow, setEosRow]                       = useState<FinanceiroRow | null>(null)
  const [eosCustomerId, setEosCustomerId]         = useState<string | null>(null)
  const [eosCustomerName, setEosCustomerName]     = useState('')
  const [eosCustQuery, setEosCustQuery]           = useState('')
  const [eosCustResults, setEosCustResults]       = useState<Customer[]>([])
  const [eosCustSearching, setEosCustSearching]   = useState(false)
  const [eosShowCustDrop, setEosShowCustDrop]     = useState(false)
  const [eosDate, setEosDate]                     = useState('')
  const [eosServicePrice, setEosServicePrice]     = useState('')
  const [eosDiscount, setEosDiscount]             = useState('')
  const [eosPayMethod, setEosPayMethod]           = useState('')
  const [eosInstallments, setEosInstallments]     = useState('1')
  const [eosParts, setEosParts]                   = useState<OrderPartView[]>([])
  const [eosLoadingParts, setEosLoadingParts]     = useState(false)
  const [eosSaving, startEosSave]                 = useTransition()

  async function openEditOS(row: FinanceiroRow) {
    setEosRow(row)
    setEosCustomerId(row.customerId ?? null)
    setEosCustomerName(row.customerName)
    setEosCustQuery('')
    setEosCustResults([])
    setEosShowCustDrop(false)
    // Date: row.date pode vir como Date ou string (Server Component → Client)
    const dateObj = row.date instanceof Date ? row.date : new Date(row.date as unknown as string)
    const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj
    // input type=datetime-local precisa de YYYY-MM-DDTHH:mm
    const pad = (n: number) => String(n).padStart(2, '0')
    setEosDate(`${validDate.getFullYear()}-${pad(validDate.getMonth() + 1)}-${pad(validDate.getDate())}T${pad(validDate.getHours())}:${pad(validDate.getMinutes())}`)
    setEosServicePrice('')
    setEosDiscount(((row.discount ?? 0) / 100).toFixed(2).replace('.', ','))
    setEosPayMethod(row.payment ?? '')
    setEosInstallments('1')
    // Carrega peças (read-only)
    setEosParts([])
    setEosLoadingParts(true)
    try {
      const parts = await getServiceOrderParts(row.rawId)
      setEosParts(parts)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar peças.')
    } finally {
      setEosLoadingParts(false)
    }
  }

  function doSaveEditOS() {
    if (!eosRow) return
    const row = eosRow

    // Guard: valida data antes de chamar toISOString (evita RangeError)
    const dateObj = new Date(eosDate)
    if (!eosDate || isNaN(dateObj.getTime())) {
      toast.error('Data inválida. Confira o campo Data/Hora.')
      return
    }

    startEosSave(async () => {
      try {
        await updateServiceOrder(row.rawId, {
          customer_id:         eosCustomerId,
          received_at:         dateObj.toISOString(),
          service_price_cents: eosServicePrice ? parseCents(eosServicePrice) : undefined,
          discount_cents:      parseCents(eosDiscount),
          payment_method:      eosPayMethod || null,
          payment_installments: Math.max(1, parseInt(eosInstallments) || 1),
        })
        toast.success('OS atualizada.')
        setEosRow(null)
        // Atualiza row local com os novos dados (otimização — refresh teria mesmo efeito)
        setRows(rs => rs.map(r => r.id === row.id ? {
          ...r,
          customerId:   eosCustomerId,
          customerName: eosCustomerName,
          date:         dateObj,
          discount:     parseCents(eosDiscount),
          payment:      eosPayMethod || null,
        } : r))
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao salvar OS.')
      }
    })
  }

  // Busca de clientes do modal Editar OS
  useEffect(() => {
    if (!eosShowCustDrop || eosCustQuery.trim().length < 2) {
      setEosCustResults([])
      return
    }
    let cancelled = false
    setEosCustSearching(true)
    const t = setTimeout(async () => {
      try {
        const results = await searchCustomers(eosCustQuery.trim())
        if (!cancelled) setEosCustResults(results)
      } catch { /* ignore */ }
      finally { if (!cancelled) setEosCustSearching(false) }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [eosCustQuery, eosShowCustDrop])

  function doReclassify() {
    if (!rcRow) return
    const row = rcRow
    startRcSave(async () => {
      try {
        const patch = {
          saleChannel:  rcChannel  || null,
          deliveryType: rcDelivery || null,
        }
        if (row.source === 'erp') {
          await updateSaleChannel(row.rawId, patch)
        } else {
          await updateServiceOrderChannel(row.rawId, patch)
        }
        setRows(rs => rs.map(r => r.id === row.id ? {
          ...r,
          saleChannel:  patch.saleChannel,
          deliveryType: patch.deliveryType,
        } : r))
        toast.success('Canal reclassificado.')
        setRcRow(null)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao reclassificar.')
      }
    })
  }
  const [esCart, setEsCart]                   = useState<CartItem[]>([])
  const [esCustomerId, setEsCustomerId]       = useState<string | null>(null)
  const [esCustomerName, setEsCustomerName]   = useState('')
  const [esCustQuery, setEsCustQuery]         = useState('')
  const [esCustResults, setEsCustResults]     = useState<Customer[]>([])
  const [esCustSearching, setEsCustSearching] = useState(false)
  const [esCustDrop, setEsCustDrop]           = useState(false)
  // Cadastro inline de cliente novo durante edição da venda
  const [esShowCustForm, setEsShowCustForm]   = useState(false)
  const [esNc, setEsNc]                       = useState(EMPTY_NC)
  const [savingEsCust, setSavingEsCust]       = useState(false)
  const [esFetchingCep, setEsFetchingCep]     = useState(false)
  const [esPQuery, setEsPQuery]               = useState('')
  const [esPResults, setEsPResults]           = useState<Product[]>([])
  const [esPSearching, setEsPSearching]       = useState(false)
  const [esPDrop, setEsPDrop]                 = useState(false)
  const [esShowManual, setEsShowManual]       = useState(false)
  const [esMName, setEsMName]                 = useState('')
  const [esMPrice, setEsMPrice]               = useState('')
  const [esMQty, setEsMQty]                   = useState('1')
  const [savingEs, startEsSave]               = useTransition()

  // Modal alterar data
  const [editDateRow, setEditDateRow]   = useState<FinanceiroRow | null>(null)
  const [editDateVal, setEditDateVal]   = useState('')
  const [savingDate, startSaveDate]     = useTransition()

  // Seleção em massa
  const [selected, setSelected]             = useState<Set<string>>(new Set())
  const [bulkCancelling, startBulkCancel]   = useTransition()
  const [bulkDeleting, startBulkDelete]     = useTransition()
  const [confirmBulkCancel, setConfirmBulkCancel] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  const filteredRows = useMemo(() => {
    let result = rows
    const range = getDateRange(period, fromDate, toDate)
    if (range) {
      const [from, to] = range
      result = result.filter(r => r.date >= from && r.date <= to)
    }
    if (filterCustomer.trim()) {
      const q = filterCustomer.trim().toLowerCase()
      result = result.filter(r =>
        r.customerName.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
      )
    }
    if (filterChannels.length > 0) {
      result = result.filter(r => filterChannels.includes(r.saleChannel ?? '__none__'))
    }
    if (filterDeliveries.length > 0) {
      result = result.filter(r => filterDeliveries.includes(r.deliveryType ?? '__none__'))
    }
    return result
  }, [rows, period, fromDate, toDate, filterCustomer, filterChannels, filterDeliveries])

  const selectedRows      = rows.filter(r => selected.has(r.id))
  const selectedErpIds    = selectedRows.filter(r => r.source === 'erp').map(r => r.rawId)
  const selectedOsIds     = selectedRows.filter(r => r.source === 'checksmart').map(r => r.rawId)
  const allSelected       = filteredRows.length > 0 && filteredRows.every(r => selected.has(r.id))
  const someSelected      = selected.size > 0
  const canBulkDelete     = someSelected && selectedRows.every(r => r.cancelled)

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); filteredRows.forEach(r => n.delete(r.id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); filteredRows.forEach(r => n.add(r.id)); return n })
    }
  }

  function doBulkCancel() {
    setConfirmBulkCancel(false)
    startBulkCancel(async () => {
      try {
        const erpIds = selectedRows.filter(r => r.source === 'erp' && !r.cancelled).map(r => r.rawId)
        const osIds  = selectedRows.filter(r => r.source === 'checksmart' && !r.cancelled).map(r => r.rawId)
        await bulkCancel(erpIds, osIds)
        setRows(rs => rs.map(r => selected.has(r.id) ? { ...r, cancelled: true } : r))
        toast.success(`${erpIds.length + osIds.length} transação(ões) cancelada(s).`)
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao cancelar.') }
    })
  }

  function doBulkDelete() {
    setConfirmBulkDelete(false)
    startBulkDelete(async () => {
      try {
        await Promise.all([
          bulkDeleteSales(selectedErpIds),
          bulkDeleteServiceOrders(selectedOsIds),
        ])
        setRows(rs => rs.filter(r => !selected.has(r.id)))
        setSelected(new Set())
        const total = selectedErpIds.length + selectedOsIds.length
        toast.success(`${total} registro(s) excluído(s).`)
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao excluir.') }
    })
  }

  // Menu 3 pontos
  const [openMenu, setOpenMenu]         = useState<string | null>(null)
  const menuRef                         = useRef<HTMLDivElement>(null)
  const esRef                           = useRef<HTMLDivElement>(null)

  // Modal excluir
  const [confirmDelete, setConfirmDelete] = useState<FinanceiroRow | null>(null)
  const [deleting, startDelete]           = useTransition()

  // Modal editar pagamento OS
  const [editPayRow, setEditPayRow]     = useState<FinanceiroRow | null>(null)
  const [editPayVal, setEditPayVal]     = useState('')
  const [savingPay, startSavePay]       = useTransition()

  // Modal enviar comprovante por EMAIL
  const [emailRow, setEmailRow]         = useState<FinanceiroRow | null>(null)
  const [emailTo, setEmailTo]           = useState('')
  const [emailObs, setEmailObs]         = useState('')
  const [sendingEmail, startSendEmail]  = useTransition()

  // Modal enviar comprovante por WHATSAPP
  const [waRow, setWaRow]               = useState<FinanceiroRow | null>(null)
  const [waTo, setWaTo]                 = useState('')
  const [waObs, setWaObs]               = useState('')
  const [waLoadingLink, setWaLoadingLink] = useState(false)

  // Link público compartilhável (gerado quando abre modal email/whatsapp)
  const [shareUrl, setShareUrl]           = useState<string>('')
  const [loadingShareUrl, setLoadingShareUrl] = useState(false)

  async function fetchShareUrl(saleId: string) {
    setLoadingShareUrl(true)
    setShareUrl('')
    try {
      const res = await getOrCreateShareToken(saleId)
      if (res.ok) setShareUrl(res.data?.url ?? '')
    } finally {
      setLoadingShareUrl(false)
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast.success('Link copiado!')
    } catch {
      toast.error('Não consegui copiar — selecione e copie manualmente.')
    }
  }

  async function openEmailModal(row: FinanceiroRow) {
    setEmailRow(row)
    setEmailObs('')
    setEmailTo('')
    fetchShareUrl(row.rawId)
    const res = await getSaleContact(row.rawId)
    if (res.ok) setEmailTo(res.data?.email ?? '')
  }

  async function openWaModal(row: FinanceiroRow) {
    setWaRow(row)
    setWaObs('')
    setWaTo('')
    fetchShareUrl(row.rawId)
    const res = await getSaleContact(row.rawId)
    if (res.ok) setWaTo(res.data?.whatsapp ?? '')
  }

  function handleSendComprovanteEmail() {
    if (!emailRow) return
    if (!/.+@.+\..+/.test(emailTo.trim())) {
      toast.error('Informe um e-mail válido.')
      return
    }
    startSendEmail(async () => {
      const res = await sendComprovanteEmail({
        saleId:      emailRow.rawId,
        toEmail:     emailTo.trim(),
        observation: emailObs.trim() || undefined,
      })
      if (res.ok) {
        toast.success(`Comprovante enviado pra ${emailTo.trim()}.`)
        setEmailRow(null)
      } else {
        toast.error(res.error)
      }
    })
  }

  async function handleSendComprovanteWhatsapp() {
    if (!waRow) return
    const digits = waTo.replace(/\D/g, '')
    if (digits.length < 10) {
      toast.error('Informe um WhatsApp válido (DDD + número).')
      return
    }
    setWaLoadingLink(true)
    try {
      // Reusa shareUrl se já carregou; senão busca agora
      let url = shareUrl
      if (!url) {
        const res = await getOrCreateShareToken(waRow.rawId)
        if (!res.ok) { toast.error(res.error); return }
        url = res.data?.url ?? ''
        setShareUrl(url)
      }
      const phone = digits.startsWith('55') ? digits : `55${digits}`
      const customer = waRow.customerName?.split(' ')[0] || 'cliente'
      const obsLine = waObs.trim() ? `\n\n${waObs.trim()}` : ''
      const msg = `Olá ${customer}, segue o comprovante da sua compra com termo de garantia:\n${url}${obsLine}`
      const wa = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      window.open(wa, '_blank', 'noopener,noreferrer')
      toast.success('WhatsApp aberto com o link do comprovante.')
      setWaRow(null)
    } finally {
      setWaLoadingLink(false)
    }
  }

  function handleDownloadComprovante(row: FinanceiroRow) {
    window.open(`/api/financeiro/comprovante/${row.rawId}`, '_blank', 'noopener,noreferrer')
  }

  // ── Nova Venda state ──────────────────────────────────────────────────────
  const [novaVendaOpen, setNovaVendaOpen] = useState(false)
  const [saleDate, setSaleDate]           = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod]         = useState<'cash'|'pix'|'card'|'mixed'>('pix')
  const [nvSaleChannel, setNvSaleChannel] = useState<SaleChannel | ''>('')
  const [nvDeliveryType, setNvDeliveryType] = useState<DeliveryType | ''>('')
  const [discountStr, setDiscountStr]     = useState('')
  const [nvSaving, startNvSave]           = useTransition()
  const [nvError, setNvError]             = useState('')

  // Cart
  const [cart, setCart]     = useState<CartItem[]>([])
  const subtotal = cart.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0)
  const discount = parseCents(discountStr)
  const total    = Math.max(0, subtotal - discount)

  // Product search
  const [pQuery, setPQuery]       = useState('')
  const [pResults, setPResults]   = useState<Product[]>([])
  const [pSearching, setPSearching] = useState(false)
  const [pDrop, setPDrop]         = useState(false)
  const pRef = useRef<HTMLDivElement>(null)
  const pInputRef = useRef<HTMLInputElement>(null)

  // Manual item
  const [showManual, setShowManual] = useState(false)
  const [mName, setMName]           = useState('')
  const [mPrice, setMPrice]         = useState('')
  const [mQty, setMQty]             = useState('1')

  // Customer
  const [customer, setCustomer]             = useState<Customer | null>(null)
  const [custQuery, setCustQuery]           = useState('')
  const [custResults, setCustResults]       = useState<Customer[]>([])
  const [custSearching, setCustSearching]   = useState(false)
  const [custDrop, setCustDrop]             = useState(false)
  const [showCustForm, setShowCustForm]     = useState(false)
  const [savingOrigin, setSavingOrigin]     = useState(false)

  async function handleSetCustomerOrigin(origin: string) {
    if (!customer || !origin) return
    setSavingOrigin(true)
    try {
      const c = await updateCustomerOrigin(customer.id, origin)
      setCustomer(c)
      toast.success('Origem registrada!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar origem')
    } finally { setSavingOrigin(false) }
  }
  const [nc, setNc]                         = useState(EMPTY_NC)
  const [fetchingCep, setFetchingCep]       = useState(false)
  const [savingCust, setSavingCust]         = useState(false)

  // Product search debounce
  useEffect(() => {
    if (pQuery.trim().length < 2) { setPResults([]); setPDrop(false); return }
    // Abre o dropdown já com o loader enquanto espera o debounce
    setPDrop(true)
    const t = setTimeout(async () => {
      setPSearching(true)
      try {
        const r = await searchProducts(pQuery)
        setPResults(r)
        setPDrop(true) // mantém aberto mesmo com 0 resultados (mostra "nenhum")
      }
      finally { setPSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [pQuery])

  // Close product dropdown on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (pRef.current && !pRef.current.contains(e.target as Node)) setPDrop(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  // Close row menu on outside click.
  // NOTA: listener usa 'click' (não 'mousedown') pra evitar race condition
  // com os onClick dos botões do menu — antes o mousedown global fechava
  // o menu ANTES do click dos botões registrar, impedindo a ação.
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('click', fn)
    return () => document.removeEventListener('click', fn)
  }, [])

  // Edit modal — product search debounce
  useEffect(() => {
    if (esPQuery.trim().length < 2) { setEsPResults([]); setEsPDrop(false); return }
    const t = setTimeout(async () => {
      setEsPSearching(true)
      try { const r = await searchProducts(esPQuery); setEsPResults(r); setEsPDrop(r.length > 0) }
      finally { setEsPSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [esPQuery])

  // Edit modal — close product dropdown on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (esRef.current && !esRef.current.contains(e.target as Node)) setEsPDrop(false)
    }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  function resetNovaVenda() {
    setCart([]); setPQuery(''); setDiscountStr(''); setSaleDate(new Date().toISOString().slice(0, 10))
    setPayMethod('pix'); setCustomer(null); setCustQuery(''); setShowCustForm(false)
    setNc(EMPTY_NC); setNvError(''); setShowManual(false)
    setNvSaleChannel(''); setNvDeliveryType('')
    setEsSaleChannel(''); setEsDeliveryType('')
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const activeRows    = useMemo(() => filteredRows.filter(r => !r.cancelled), [filteredRows])
  const totalFaturado = useMemo(() => activeRows.reduce((s, r) => s + r.total, 0), [activeRows])
  const totalVendas   = useMemo(() => activeRows.filter(r => r.source === 'erp').length, [activeRows])
  const totalOS       = useMemo(() => activeRows.filter(r => r.source === 'checksmart').length, [activeRows])
  const ticketMedio   = useMemo(() => activeRows.length > 0 ? Math.round(totalFaturado / activeRows.length) : 0, [activeRows, totalFaturado])
  const totalDesconto = useMemo(() => activeRows.reduce((s, r) => s + r.discount, 0), [activeRows])

  // ── Cancel / Reactivate ───────────────────────────────────────────────────
  function doCancel() {
    if (!confirmCancel) return
    const row = confirmCancel; setConfirmCancel(null)
    startAction(async () => {
      try {
        if (row.source === 'erp') await cancelSale(row.rawId)
        else await cancelServiceOrder(row.rawId)
        setRows(rs => rs.map(r => r.id === row.id ? { ...r, cancelled: true } : r))
        toast.success('Transação cancelada.')
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao cancelar.') }
    })
  }

  function doReactivate() {
    if (!confirmReactivate) return
    const row = confirmReactivate; setConfirmReactivate(null)
    startAction(async () => {
      try {
        if (row.source === 'erp') await reactivateSale(row.rawId)
        else await reactivateServiceOrder(row.rawId)
        setRows(rs => rs.map(r => r.id === row.id ? { ...r, cancelled: false } : r))
        toast.success('Transação reativada.')
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao reativar.') }
    })
  }

  // ── Emitir NFC-e (a partir de venda ERP) ──────────────────────────────────
  function handleEmitNfce(row: FinanceiroRow) {
    if (row.source !== 'erp') {
      toast.error('Emissão de NFC-e disponível apenas pra vendas do ERP.')
      return
    }
    if (row.cancelled) {
      toast.error('Não é possível emitir NFC-e pra venda cancelada.')
      return
    }
    if (!confirm(`Emitir NFC-e pra venda de ${row.customerName}? (${row.dateStr})`)) return

    startAction(async () => {
      const res = await emitNfceFromSale(row.rawId)
      if (!res.ok) { toast.error(res.error); return }
      const status = res.data?.status
      if (status === 'authorized') toast.success('NFC-e autorizada!')
      else if (status === 'processing') toast.success(res.data?.message ?? 'NFC-e em processamento. Veja em /notas-fiscais.')
      else toast.success(`NFC-e: ${status}`)
    })
  }

  // ── Edit OS payment ───────────────────────────────────────────────────────
  function doEditPay() {
    if (!editPayRow || !editPayVal) return
    const row = editPayRow; setEditPayRow(null)
    startSavePay(async () => {
      try {
        await updateServiceOrderPayment(row.rawId, editPayVal)
        setRows(rs => rs.map(r => r.id === row.id ? { ...r, payment: editPayVal } : r))
        toast.success('Pagamento atualizado.')
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao atualizar pagamento.') }
    })
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  function doDelete() {
    if (!confirmDelete) return
    const row = confirmDelete; setConfirmDelete(null)
    startDelete(async () => {
      try {
        await deleteSale(row.rawId)
        setRows(rs => rs.filter(r => r.id !== row.id))
        toast.success('Venda excluída.')
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao excluir.') }
    })
  }

  // ── Edit date ─────────────────────────────────────────────────────────────
  function openEditDate(row: FinanceiroRow) {
    const dateObj = row.date instanceof Date ? row.date : new Date(row.date as unknown as string)
    const iso = !isNaN(dateObj.getTime())
      ? dateObj.toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
    setEditDateVal(iso)
    setEditDateRow(row)
  }

  function doEditDate() {
    if (!editDateRow || !editDateVal) return
    const row = editDateRow; setEditDateRow(null)
    startSaveDate(async () => {
      try {
        await updateSaleDate(row.rawId, editDateVal)
        const newDate = new Date(editDateVal + 'T12:00:00')
        const newDateStr = newDate.toLocaleString('pt-BR', {
          day: '2-digit', month: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })
        setRows(rs => rs.map(r => r.id === row.id ? { ...r, date: newDate, dateStr: newDateStr, cancelled: false } : r))
        toast.success('Data da venda atualizada.')
        window.location.reload()
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao alterar data.') }
    })
  }

  // ── Edit ERP sale (cancelada ou ativa) ────────────────────────────────────
  function openEditSale(row: FinanceiroRow) {
    // row.date pode chegar como Date (estado local) ou string (vindo do server via JSON).
    // Normaliza pra Date antes de .toISOString() (BUG-015).
    const dateObj = row.date instanceof Date ? row.date : new Date(row.date as unknown as string)
    setEsDate(!isNaN(dateObj.getTime()) ? dateObj.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10))
    setEsDiscountStr(row.discount > 0 ? fmtBRL(row.discount) : '')
    setEsPayMethod(row.payment ?? 'pix')
    setEsCustomerId(row.customerId ?? null)
    setEsCustomerName(row.customerName !== 'Sem cliente' ? row.customerName : '')
    setEsCart((row.saleItems ?? []).map(i => ({
      key: randKey(), productId: null,
      name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents,
    })))
    setEsSaleChannel((row.saleChannel as SaleChannel | undefined) ?? '')
    setEsDeliveryType((row.deliveryType as DeliveryType | undefined) ?? '')
    setEsConsumerOrigin(row.customerOrigin ?? 'passou_na_porta')
    setEsPQuery(''); setEsMName(''); setEsMPrice(''); setEsMQty('1')
    setEsShowManual(false); setEsCustQuery(''); setEsCustDrop(false)
    setEsRow(row)
  }

  async function handleEsCustSearch() {
    if (esCustQuery.trim().length < 2) return
    setEsCustSearching(true); setEsCustDrop(false)
    try {
      const res = await searchCustomers(esCustQuery.trim())
      if (res.length === 1) {
        setEsCustomerId(res[0].id); setEsCustomerName(res[0].full_name); setEsCustQuery('')
        setEsShowCustForm(false)
      } else if (res.length > 1) {
        setEsCustResults(res); setEsCustDrop(true)
      } else {
        // Nenhum cliente — abre form pra cadastrar com o nome digitado pré-preenchido
        setEsNc({ ...EMPTY_NC, name: esCustQuery.trim() })
        setEsShowCustForm(true)
        toast.info('Cliente não encontrado — cadastre abaixo')
      }
    } finally { setEsCustSearching(false) }
  }

  async function handleEsCepBlur(val: string) {
    const d = val.replace(/\D/g, '')
    if (d.length !== 8) return
    setEsFetchingCep(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const data = await r.json()
      if (!data.erro) {
        setEsNc(p => ({ ...p, addressStreet: data.logradouro ?? '', addressCity: data.localidade ?? '', addressState: data.uf ?? '' }))
      }
    } catch { /* silent */ } finally { setEsFetchingCep(false) }
  }

  async function handleSaveEsCust() {
    if (!esNc.name.trim()) { toast.error('Nome é obrigatório'); return }
    setSavingEsCust(true)
    try {
      const result = await createCustomer(esNc)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const c = result.customer
      setEsCustomerId(c.id); setEsCustomerName(c.full_name)
      setEsShowCustForm(false); setEsCustQuery(''); setEsNc(EMPTY_NC)
      toast.success('Cliente cadastrado e vinculado!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cadastrar')
    } finally { setSavingEsCust(false) }
  }

  function addEsProduct(p: Product) {
    if (p.source === 'serial') {
      toast.info('Pra editar vendas com IMEI específico, use o PDV. Aqui só rolam itens normais.')
      return
    }
    const src: 'products' | 'parts_catalog' = p.source
    setEsCart(prev => {
      const idx = prev.findIndex(i => i.productId === p.id)
      if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], quantity: n[idx].quantity + 1 }; return n }
      return [...prev, { key: randKey(), productId: p.id, source: src, name: p.name, quantity: 1, unitPriceCents: p.price_cents }]
    })
    setEsPQuery(''); setEsPDrop(false)
  }

  function addEsManualItem() {
    if (!esMName.trim() || !esMPrice) return
    setEsCart(prev => [...prev, { key: randKey(), productId: null, name: esMName.trim(), quantity: Math.max(1, parseInt(esMQty) || 1), unitPriceCents: parseCents(esMPrice) }])
    setEsMName(''); setEsMPrice(''); setEsMQty('1'); setEsShowManual(false)
  }

  function setEsItemQty(key: string, q: number) {
    if (q <= 0) { setEsCart(prev => prev.filter(i => i.key !== key)); return }
    setEsCart(prev => prev.map(i => i.key === key ? { ...i, quantity: q } : i))
  }

  function doEditSale() {
    if (!esRow) return
    const row = esRow; setEsRow(null)
    // Considera "Consumidor Final" pelo nome literal — esse é o registro fixo
    // compartilhado. Em outros clientes, usa customer.origin direto.
    const isConsumerFinal = (esCustomerName === 'Consumidor Final') || !esCustomerId
    startEsSave(async () => {
      try {
        const discountCents = parseCents(esDiscountStr)
        const input: EditSaleInput = {
          customerId:    esCustomerId,
          items:         esCart.map(i => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
          discountCents,
          paymentMethod: esPayMethod,
          saleDate:      esDate,
          saleChannel:   esSaleChannel  || null,
          deliveryType:  esDeliveryType || null,
          customerOrigin: isConsumerFinal ? (esConsumerOrigin || null) : null,
        }
        await updateCancelledSale(row.rawId, input)
        const subtotal   = esCart.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0)
        const newTotal   = Math.max(0, subtotal - discountCents)
        const newDate    = new Date(esDate + 'T12:00:00')
        const newDateStr = newDate.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
        setRows(rs => rs.map(r => r.id === row.id ? {
          ...r,
          date:           newDate,
          dateStr:        newDateStr,
          customerName:   esCustomerName || 'Sem cliente',
          description:    esCart.map(i => `${i.quantity}× ${i.name}`).join(', '),
          payment:        esPayMethod,
          discount:       discountCents,
          total:          newTotal,
          customerId:     esCustomerId,
          saleItems:      esCart.map(i => ({ name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
          saleChannel:    esSaleChannel  || null,
          deliveryType:   esDeliveryType || null,
          customerOrigin: isConsumerFinal ? (esConsumerOrigin || null) : null,
        } : r))
        toast.success('Venda atualizada.')
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro ao editar venda.') }
    })
  }

  // ── Cart helpers ──────────────────────────────────────────────────────────
  function addProduct(p: Product) {
    if (p.source === 'serial') {
      toast.info('Pra vender por IMEI, use o PDV.')
      return
    }
    const src: 'products' | 'parts_catalog' = p.source
    setCart(prev => {
      const idx = prev.findIndex(i => i.productId === p.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 }
        return next
      }
      return [...prev, { key: randKey(), productId: p.id, source: src, name: p.name, quantity: 1, unitPriceCents: p.price_cents }]
    })
    setPQuery(''); setPResults([]); setPDrop(false)
    // Re-foca o campo pra facilitar buscar o próximo produto
    setTimeout(() => pInputRef.current?.focus(), 50)
  }

  function addManualItem() {
    if (!mName.trim() || !mPrice) return
    setCart(prev => [...prev, { key: randKey(), productId: null, name: mName.trim(), quantity: Math.max(1, parseInt(mQty) || 1), unitPriceCents: parseCents(mPrice) }])
    setMName(''); setMPrice(''); setMQty('1'); setShowManual(false)
  }

  function setItemQty(key: string, q: number) {
    if (q <= 0) { setCart(prev => prev.filter(i => i.key !== key)); return }
    setCart(prev => prev.map(i => i.key === key ? { ...i, quantity: q } : i))
  }

  // ── Customer search ───────────────────────────────────────────────────────
  async function handleCustSearch() {
    if (custQuery.trim().length < 2) return
    setCustSearching(true); setCustDrop(false)
    try {
      const res = await searchCustomers(custQuery.trim())
      if (res.length === 1) { setCustomer(res[0]); setCustQuery(''); toast.success('Cliente encontrado!') }
      else if (res.length > 1) { setCustResults(res); setCustDrop(true) }
      else { setShowCustForm(true); toast.info('Cliente não encontrado — cadastre abaixo') }
    } finally { setCustSearching(false) }
  }

  // ── CEP lookup ────────────────────────────────────────────────────────────
  async function handleCepBlur(val: string) {
    const d = val.replace(/\D/g, '')
    if (d.length !== 8) return
    setFetchingCep(true)
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`)
      const data = await r.json()
      if (!data.erro) setNc(p => ({ ...p, addressStreet: data.logradouro ?? '', addressCity: data.localidade ?? '', addressState: data.uf ?? '' }))
    } catch { /* silent */ } finally { setFetchingCep(false) }
  }

  // ── Save customer ─────────────────────────────────────────────────────────
  async function handleSaveCust() {
    if (!nc.name.trim()) { toast.error('Nome é obrigatório'); return }
    setSavingCust(true)
    try {
      const result = await createCustomer(nc)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setCustomer(result.customer); setShowCustForm(false); setCustQuery(''); toast.success('Cliente cadastrado!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao cadastrar')
    } finally { setSavingCust(false) }
  }

  // ── Save nova venda ───────────────────────────────────────────────────────
  function doNovaVenda() {
    setNvError('')
    startNvSave(async () => {
      try {
        const items: ManualSaleItem[] = cart.map(i => ({
          productId: i.productId, source: i.source,
          name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents,
        }))
        await createManualSale({
          saleDate,
          customerId:    customer?.id ?? null,
          items,
          discountCents: discount,
          paymentMethod: payMethod,
          saleChannel:   nvSaleChannel  || null,
          deliveryType:  nvDeliveryType || null,
        })
        toast.success('Venda registrada com sucesso!')
        setNovaVendaOpen(false)
        resetNovaVenda()
        window.location.reload()
      } catch (e) { setNvError(e instanceof Error ? e.message : 'Erro ao registrar venda.') }
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Financeiro</h1>
          <p className="mt-1 text-sm text-muted">Vendas (Phone Smart) + Ordens de Serviço (CheckSmart)</p>
        </div>
        <button onClick={() => { setNovaVendaOpen(true); resetNovaVenda() }}
          className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black"
          style={{ background: '#10B981' }}>
          <Plus className="h-4 w-4" /> Nova Venda
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: 'Total Faturado', value: BRL(totalFaturado), icon: TrendingUp,   color: '#10B981' },
          { label: 'Vendas ERP',     value: String(totalVendas), icon: ShoppingCart, color: '#22C55E' },
          { label: 'OS CheckSmart',  value: String(totalOS),    icon: Wrench,       color: '#F59E0B' },
          { label: 'Ticket Médio',   value: BRL(ticketMedio),   icon: CreditCard,   color: '#22C55E' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border p-5" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
                <p className="mt-2 text-xl font-bold text-text">{value}</p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${color}18` }}>
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {totalDesconto > 0 && (
        <div className="flex items-center gap-3 rounded-xl border px-5 py-3" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <Receipt className="h-4 w-4 shrink-0 pointer-events-none" style={{ color: '#EF4444' }} />
          <p className="text-sm text-muted">
            Total de descontos: <span className="font-semibold" style={{ color: '#EF4444' }}>{BRL(totalDesconto)}</span>
          </p>
        </div>
      )}

      {/* Filter bar */}
      <div className="rounded-xl border p-4 space-y-3" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 shrink-0 text-muted" />
          {([
            { key: 'all',   label: 'Todos' },
            { key: 'today', label: 'Hoje' },
            { key: 'week',  label: 'Esta semana' },
            { key: 'month', label: 'Este mês' },
            { key: 'custom',label: 'Personalizado' },
          ] as { key: PeriodKey; label: string }[]).map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-all"
              style={period === p.key
                ? { background: '#10B98118', borderColor: '#10B981', color: '#10B981' }
                : { borderColor: '#2A3650', color: '#94A3B8' }}>
              {p.label}
            </button>
          ))}
          <div className="relative ml-auto w-52">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={filterCustomer}
              onChange={e => setFilterCustomer(e.target.value)}
              placeholder="Buscar cliente…"
              className={INP} style={{ ...INP_S, paddingLeft: '2rem', paddingTop: '0.375rem', paddingBottom: '0.375rem', fontSize: '0.75rem' }}
            />
            {filterCustomer && (
              <button onClick={() => setFilterCustomer('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className={INP} style={{ ...INP_S, paddingLeft: '2.25rem', paddingTop: '0.375rem', paddingBottom: '0.375rem', fontSize: '0.75rem' }} />
            </div>
            <span className="text-xs text-muted">até</span>
            <div className="relative flex-1">
              <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className={INP} style={{ ...INP_S, paddingLeft: '2.25rem', paddingTop: '0.375rem', paddingBottom: '0.375rem', fontSize: '0.75rem' }} />
            </div>
          </div>
        )}

        {/* Filtros: Canal de venda */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted mr-1">Canal:</span>
          {SALE_CHANNEL_OPTIONS_PICKABLE.map(opt => {
            const active = filterChannels.includes(opt.value)
            return (
              <button key={opt.value} onClick={() => toggleChannel(opt.value)}
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all flex items-center gap-1"
                style={active
                  ? { background: `${opt.color}22`, borderColor: opt.color, color: opt.color }
                  : { borderColor: '#2A3650', color: '#94A3B8' }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: opt.color }} />
                {opt.label}
              </button>
            )
          })}
          <button onClick={() => toggleChannel('__none__')}
            className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all"
            style={filterChannels.includes('__none__')
              ? { background: 'rgba(148,163,184,.18)', borderColor: '#94A3B8', color: '#94A3B8' }
              : { borderColor: '#2A3650', color: '#64748B' }}>
            Sem canal
          </button>
          {filterChannels.length > 0 && (
            <button onClick={() => setFilterChannels([])}
              className="ml-1 text-[10px] uppercase tracking-wider text-muted hover:text-text">
              limpar
            </button>
          )}
        </div>

        {/* Filtros: Tipo de entrega */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted mr-1">Entrega:</span>
          {DELIVERY_TYPE_OPTIONS.map(opt => {
            const active = filterDeliveries.includes(opt.value)
            return (
              <button key={opt.value} onClick={() => toggleDelivery(opt.value)}
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all"
                style={active
                  ? { background: 'rgba(6,182,212,.15)', borderColor: '#06B6D4', color: '#06B6D4' }
                  : { borderColor: '#2A3650', color: '#94A3B8' }}>
                {opt.label}
              </button>
            )
          })}
          <button onClick={() => toggleDelivery('__none__')}
            className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all"
            style={filterDeliveries.includes('__none__')
              ? { background: 'rgba(148,163,184,.18)', borderColor: '#94A3B8', color: '#94A3B8' }
              : { borderColor: '#2A3650', color: '#64748B' }}>
            Sem entrega
          </button>
          {filterDeliveries.length > 0 && (
            <button onClick={() => setFilterDeliveries([])}
              className="ml-1 text-[10px] uppercase tracking-wider text-muted hover:text-text">
              limpar
            </button>
          )}
        </div>

        {/* Resumo: total + lucro das vendas atualmente exibidas (sempre visível
            quando há ao menos uma transação — atualiza com filtros). */}
        {filteredRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-4 rounded-lg border px-4 py-2.5"
               style={{ background: 'rgba(16,185,129,.05)', borderColor: 'rgba(16,185,129,.25)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-muted">Resultado:</span>
              <span className="text-sm font-bold text-text">
                {filteredRows.filter(r => !r.cancelled).length} venda(s)
              </span>
            </div>
            <span className="text-zinc-600">·</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-muted">Faturamento:</span>
              <span className="text-sm font-bold" style={{ color: '#10B981' }}>
                {BRL(filteredRows.filter(r => !r.cancelled).reduce((s, r) => s + r.total, 0))}
              </span>
            </div>
            <span className="text-zinc-600">·</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-muted">Lucro:</span>
              {(() => {
                const profit = filteredRows.filter(r => !r.cancelled).reduce((s, r) => s + (r.profit || 0), 0)
                return (
                  <span className="text-sm font-bold" style={{ color: profit >= 0 ? '#10B981' : '#EF4444' }}>
                    {BRL(profit)}
                  </span>
                )
              })()}
            </div>
            {/* Ticket médio só aparece quando há mais de 1 venda — útil pra ver
                média sem precisar dividir mentalmente. */}
            {(() => {
              const activeRows = filteredRows.filter(r => !r.cancelled)
              if (activeRows.length < 2) return null
              const total = activeRows.reduce((s, r) => s + r.total, 0)
              const avg   = Math.round(total / activeRows.length)
              return (
                <>
                  <span className="text-zinc-600">·</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wider text-muted">Ticket médio:</span>
                    <span className="text-sm font-bold text-text">{BRL(avg)}</span>
                  </div>
                </>
              )
            })()}
          </div>
        )}
      </div>

      {/* Table — sem overflow-hidden no wrapper pra não cortar o dropdown
           do menu de 3 pontinhos quando ele abre pra baixo da última row. */}
      <div className="rounded-xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center justify-between border-b px-5 py-4 rounded-t-xl" style={{ borderColor: '#2A3650' }}>
          <h2 className="text-sm font-semibold text-text">Todas as Transações</h2>
          <div className="flex items-center gap-3">
            {someSelected && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">{selected.size} selecionado(s)</span>
                <button onClick={() => setConfirmBulkCancel(true)} disabled={bulkCancelling}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/5"
                  style={{ borderColor: '#EF444440', color: '#EF4444' }}>
                  <XCircle className="h-3.5 w-3.5" /> Cancelar seleção
                </button>
                <button onClick={() => setConfirmBulkDelete(true)} disabled={bulkDeleting || !canBulkDelete}
                  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
                  style={canBulkDelete ? { borderColor: '#EF4444', background: '#EF444418', color: '#EF4444' } : { borderColor: '#2A3650', color: '#94A3B8' }}
                  title={!canBulkDelete ? 'Selecione apenas registros já cancelados' : ''}>
                  <Trash2 className="h-3.5 w-3.5" /> Excluir seleção
                </button>
                <button onClick={() => setSelected(new Set())} className="text-xs text-muted hover:text-text">Limpar</button>
              </div>
            )}
            <span className="text-xs text-muted">{filteredRows.length} {filteredRows.length === 1 ? 'registro' : 'registros'}{filteredRows.length !== rows.length ? ` de ${rows.length}` : ''}</span>
          </div>
        </div>
        {filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20">
            <Receipt className="h-10 w-10" style={{ color: '#64748B' }} />
            <p className="text-sm text-muted">{rows.length === 0 ? 'Nenhuma transação registrada ainda' : 'Nenhum resultado para os filtros selecionados'}</p>
          </div>
        ) : (
          <>
            {/* Header: só desktop (mobile usa cards) */}
            <div className="hidden md:grid gap-4 px-5 py-3 border-b text-xs font-medium uppercase tracking-wider text-muted"
              style={{ borderColor: '#2A3650', gridTemplateColumns: '32px 90px 1fr 130px 140px 100px 100px 100px 40px' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                className="h-4 w-4 rounded accent-accent cursor-pointer" />
              <span>Origem</span><span>Cliente / Descrição</span><span>Data</span>
              <span>Canal · Entrega</span>
              <span>Pagamento</span>
              <span className="text-right">Total</span>
              <span className="text-right">Lucro</span>
              <span />
            </div>
            {/* Mobile: header simples com seleção em massa */}
            <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: '#2A3650' }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                className="h-4 w-4 rounded accent-accent cursor-pointer" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted">
                {filteredRows.length} transaç{filteredRows.length === 1 ? 'ão' : 'ões'}
              </span>
            </div>
            {filteredRows.map(row => {
              const isERP    = row.source === 'erp'
              const srcColor = row.cancelled ? '#94A3B8' : isERP ? '#10B981' : '#22C55E'
              const pmColor  = row.payment ? (METHOD_COLOR[row.payment] ?? '#94A3B8') : '#94A3B8'
              return (
                <div key={row.id}
                  ref={openMenu === row.id ? menuRef : undefined}
                  className="relative border-b last:border-0"
                  style={{ borderColor: '#2A3650' }}>

                  {/* ── Mobile card view ── (opacity aplicada AQUI, não no wrapper externo,
                       pra não atingir o popup do menu — vide BUG-020 em _docs/bugs.md) */}
                  <div className={`md:hidden flex flex-col gap-2 px-4 py-3 transition-opacity ${row.cancelled ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)}
                        className="h-4 w-4 mt-1 rounded accent-accent cursor-pointer shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ background: `${srcColor}18`, color: srcColor }}>
                            {isERP ? 'ERP' : 'CheckSmart'}
                          </span>
                          {row.cancelled && (
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: '#EF444418', color: '#EF4444' }}>Cancelada</span>
                          )}
                          {!row.cancelled && row.clienteType && (
                            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                              style={row.clienteType === 'recorrente'
                                ? { background: 'rgba(16,185,129,.12)', color: '#10B981' }
                                : { background: 'rgba(155,109,255,.15)', color: '#8B5CF6' }
                              }>
                              {row.clienteType === 'recorrente' ? 'Recorrente' : 'Novo'}
                            </span>
                          )}
                        </div>
                        <p className={`text-sm font-medium truncate mt-1 ${row.cancelled ? 'line-through text-muted' : 'text-text'}`}>
                          {row.customerName}
                        </p>
                        <p className="text-xs text-muted truncate">{row.description}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <p className={`text-base font-bold ${row.cancelled ? 'line-through text-muted' : 'text-green'}`}>{BRL(row.total)}</p>
                        {!row.cancelled && (
                          <p className="text-[10px]" style={{ color: row.profit >= 0 ? '#10B981' : '#EF4444' }}>
                            Lucro {BRL(row.profit ?? 0)}
                          </p>
                        )}
                        {row.discount > 0 && (
                          <p className="text-[10px] text-[#EF4444]">-{BRL(row.discount)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-muted">{row.dateStr}</span>
                        {row.payment ? (
                          <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ background: `${pmColor}18`, color: pmColor }}>
                            {METHOD_LABEL[row.payment] ?? row.payment}
                          </span>
                        ) : row.osStatus ? (
                          <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ background: '#94A3B818', color: '#94A3B8' }}>
                            {OS_STATUS_LABEL[row.osStatus] ?? row.osStatus}
                          </span>
                        ) : null}
                        {row.saleChannel && (
                          <span className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                            style={{ background: `${channelColor(row.saleChannel)}1A`, color: channelColor(row.saleChannel) }}>
                            <span className="h-1 w-1 rounded-full" style={{ background: channelColor(row.saleChannel) }} />
                            {channelLabel(row.saleChannel)}
                          </span>
                        )}
                        {row.deliveryType && (
                          <span className="text-[10px]" style={{ color: '#06B6D4' }}>
                            → {deliveryLabel(row.deliveryType)}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === row.id ? null : row.id) }}
                        className="rounded p-1.5 text-muted hover:text-text transition-colors hover:bg-white/5 cursor-pointer">
                        <MoreVertical className="h-4 w-4 pointer-events-none" />
                      </button>
                    </div>
                  </div>

                  {/* ── Desktop grid view ── (opacity individual pelo mesmo motivo) */}
                  <div className={`hidden md:grid gap-4 px-5 py-3.5 items-center transition-opacity ${row.cancelled ? 'opacity-60' : ''}`}
                    style={{ gridTemplateColumns: '32px 90px 1fr 130px 140px 100px 100px 100px 40px' }}>
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)}
                    className="h-4 w-4 rounded accent-accent cursor-pointer" />
                  <div className="flex flex-col gap-1">
                    <span className="inline-flex w-fit items-center rounded-md px-2 py-1 text-xs font-semibold"
                      style={{ background: `${srcColor}18`, color: srcColor }}>
                      {isERP ? 'ERP' : 'CheckSmart'}
                    </span>
                    {row.cancelled && (
                      <span className="inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                        style={{ background: '#EF444418', color: '#EF4444' }}>Cancelada</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-medium truncate ${row.cancelled ? 'line-through text-muted' : 'text-text'}`}>{row.customerName}</p>
                      {!row.cancelled && row.clienteType && (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={row.clienteType === 'recorrente'
                            ? { background: 'rgba(16,185,129,.12)', color: '#10B981' }
                            : { background: 'rgba(155,109,255,.15)', color: '#8B5CF6' }
                          }
                        >
                          {row.clienteType === 'recorrente' ? 'Recorrente' : 'Novo'}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted truncate">{row.description}</p>
                  </div>
                  <p className="text-xs text-muted">{row.dateStr}</p>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    {row.saleChannel ? (
                      <span className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ background: `${channelColor(row.saleChannel)}1A`, color: channelColor(row.saleChannel) }}>
                        <span className="h-1 w-1 rounded-full" style={{ background: channelColor(row.saleChannel) }} />
                        {channelLabel(row.saleChannel)}
                      </span>
                    ) : <span className="text-[10px] text-muted">—</span>}
                    {row.deliveryType && (
                      <span className="text-[10px] truncate" style={{ color: '#06B6D4' }}>
                        → {deliveryLabel(row.deliveryType)}
                      </span>
                    )}
                  </div>
                  {row.payment ? (
                    <span className="inline-flex w-fit items-center rounded-md px-2 py-1 text-xs font-semibold"
                      style={{ background: `${pmColor}18`, color: pmColor }}>
                      {METHOD_LABEL[row.payment] ?? row.payment}
                    </span>
                  ) : row.osStatus ? (
                    <span className="inline-flex w-fit items-center rounded-md px-2 py-1 text-xs font-medium"
                      style={{ background: '#94A3B818', color: '#94A3B8' }}>
                      {OS_STATUS_LABEL[row.osStatus] ?? row.osStatus}
                    </span>
                  ) : <span className="text-xs text-muted">—</span>}
                  <p className={`text-sm font-bold text-right ${row.cancelled ? 'line-through text-muted' : 'text-green'}`}>{BRL(row.total)}</p>
                  <p className={`text-sm font-bold text-right ${row.cancelled ? 'line-through text-muted' : ''}`}
                    style={!row.cancelled ? { color: row.profit >= 0 ? '#10B981' : '#EF4444' } : {}}>
                    {row.cancelled ? '—' : BRL(row.profit ?? 0)}
                  </p>
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === row.id ? null : row.id) }}
                      className="rounded p-2 text-muted hover:text-text transition-colors hover:bg-white/5 cursor-pointer">
                      <MoreVertical className="h-4 w-4 pointer-events-none" />
                    </button>
                  </div>
                  </div>

                  {/* Popup do menu — único, posicionado em relação ao wrapper externo */}
                  {openMenu === row.id && (
                    <div
                      className="absolute right-2 top-12 md:right-5 md:top-14 z-[60] w-60 rounded-xl border overflow-hidden"
                      style={{
                        background: '#1B2638',
                        borderColor: '#3A4868',
                        boxShadow: '0 12px 36px rgba(0,0,0,0.65), 0 0 0 1px rgba(34,197,94,0.08)',
                        backdropFilter: 'none',
                      }}
                      onClick={e => e.stopPropagation()}>
                        {/* Emitir NFC-e — só ERP ativo */}
                        {row.source === 'erp' && !row.cancelled && (
                          <MenuItem
                            icon={<FileText className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#3B82F6' }} />}
                            label="Emitir NFC-e"
                            accentColor="#3B82F6"
                            onClick={() => { setOpenMenu(null); handleEmitNfce(row) }}
                          />
                        )}
                        {/* Comprovante — ERP (qualquer status, mesmo cancelada vê histórico) */}
                        {row.source === 'erp' && (
                          <>
                            <MenuItem
                              icon={<Download className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#A78BFA' }} />}
                              label="Baixar comprovante"
                              accentColor="#A78BFA"
                              onClick={() => { setOpenMenu(null); handleDownloadComprovante(row) }}
                            />
                            <MenuItem
                              icon={<Mail className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#06B6D4' }} />}
                              label="Enviar por e-mail"
                              accentColor="#06B6D4"
                              onClick={() => { setOpenMenu(null); openEmailModal(row) }}
                            />
                            <MenuItem
                              icon={<MessageCircle className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#22C55E' }} />}
                              label="Enviar por WhatsApp"
                              accentColor="#22C55E"
                              onClick={() => { setOpenMenu(null); openWaModal(row) }}
                            />
                          </>
                        )}
                        {/* Editar venda — ERP (qualquer status) */}
                        {row.source === 'erp' && (
                          <MenuItem
                            icon={<Pencil className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#22C55E' }} />}
                            label="Editar venda"
                            accentColor="#22C55E"
                            onClick={() => { setOpenMenu(null); openEditSale(row) }}
                          />
                        )}
                        {/* Alterar data — só ERP ativo */}
                        {row.source === 'erp' && !row.cancelled && (
                          <MenuItem
                            icon={<CalendarDays className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#22C55E' }} />}
                            label="Alterar data"
                            accentColor="#22C55E"
                            onClick={() => { setOpenMenu(null); openEditDate(row) }}
                          />
                        )}
                        {/* Editar pagamento — OS CheckSmart */}
                        {row.source === 'checksmart' && !row.cancelled && (
                          <MenuItem
                            icon={<CreditCard className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#F59E0B' }} />}
                            label="Editar pagamento"
                            accentColor="#F59E0B"
                            onClick={() => { setOpenMenu(null); setEditPayVal(row.payment ?? ''); setEditPayRow(row) }}
                          />
                        )}
                        {/* Editar OS — CheckSmart (não-cancelada) */}
                        {row.source === 'checksmart' && !row.cancelled && (
                          <MenuItem
                            icon={<Pencil className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#22C55E' }} />}
                            label="Editar OS"
                            accentColor="#22C55E"
                            onClick={() => { setOpenMenu(null); openEditOS(row) }}
                          />
                        )}
                        {/* Reclassificar canal — OS CheckSmart */}
                        {row.source === 'checksmart' && (
                          <MenuItem
                            icon={<Pencil className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#22C55E' }} />}
                            label="Reclassificar canal"
                            accentColor="#22C55E"
                            onClick={() => { setOpenMenu(null); openReclassify(row) }}
                          />
                        )}
                        {/* Cancelar / Reativar */}
                        {row.cancelled ? (
                          <MenuItem
                            icon={<RefreshCw className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#10B981' }} />}
                            label="Reativar"
                            accentColor="#10B981"
                            onClick={() => { setOpenMenu(null); setConfirmReactivate(row) }}
                          />
                        ) : (
                          <MenuItem
                            icon={<XCircle className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#EF4444' }} />}
                            label="Cancelar"
                            accentColor="#EF4444"
                            onClick={() => { setOpenMenu(null); setConfirmCancel(row) }}
                          />
                        )}
                        {/* Excluir — só ERP cancelado */}
                        {row.source === 'erp' && row.cancelled && (
                          <>
                            <div className="mx-3 h-px" style={{ background: '#3A4868' }} />
                            <MenuItem
                              icon={<Trash2 className="h-5 w-5 shrink-0 pointer-events-none" style={{ color: '#EF4444' }} />}
                              label="Excluir venda"
                              accentColor="#EF4444"
                              labelColor="#EF4444"
                              onClick={() => { setOpenMenu(null); setConfirmDelete(row) }}
                            />
                          </>
                        )}
                      </div>
                    )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* ── Modal Cancelar ────────────────────────────────────────────────────── */}
      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#EF444418' }}>
              <XCircle className="h-6 w-6" style={{ color: '#EF4444' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Cancelar transação?</h3>
              <p className="mt-1 text-sm text-muted"><span className="font-medium text-text">{confirmCancel.customerName}</span> — {BRL(confirmCancel.total)}</p>
              {confirmCancel.source === 'erp' && (
                <p className="mt-2 text-xs text-yellow-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />O estoque dos produtos será restaurado.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmCancel(null)} className="flex-1 rounded-lg border py-2 text-sm text-muted" style={INP_S}>Voltar</button>
              <button onClick={doCancel} disabled={actioning}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white"
                style={{ background: '#EF4444' }}>
                {actioning && <Loader2 className="h-4 w-4 animate-spin" />} Cancelar venda
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Reativar ────────────────────────────────────────────────────── */}
      {confirmReactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#10B98118' }}>
              <RefreshCw className="h-6 w-6" style={{ color: '#10B981' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Reativar transação?</h3>
              <p className="mt-1 text-sm text-muted"><span className="font-medium text-text">{confirmReactivate.customerName}</span> — {BRL(confirmReactivate.total)}</p>
              {confirmReactivate.source === 'erp' && (
                <p className="mt-2 text-xs text-yellow-400 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />O estoque será decrementado novamente.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmReactivate(null)} className="flex-1 rounded-lg border py-2 text-sm text-muted" style={INP_S}>Voltar</button>
              <button onClick={doReactivate} disabled={actioning}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-black"
                style={{ background: '#10B981' }}>
                {actioning && <Loader2 className="h-4 w-4 animate-spin" />} Reativar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Cancelar em Massa ──────────────────────────────────────────── */}
      {confirmBulkCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#EF444418' }}>
              <XCircle className="h-6 w-6" style={{ color: '#EF4444' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Cancelar {selected.size} transação(ões)?</h3>
              <p className="mt-1 text-sm text-muted">
                {selectedErpIds.length > 0 && <span className="block">• {selectedErpIds.length} venda(s) ERP — estoque será restaurado</span>}
                {selectedOsIds.length > 0 && <span className="block">• {selectedOsIds.length} OS CheckSmart</span>}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmBulkCancel(false)} className="flex-1 rounded-lg border py-2 text-sm text-muted" style={INP_S}>Voltar</button>
              <button onClick={doBulkCancel} disabled={bulkCancelling}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#EF4444' }}>
                {bulkCancelling && <Loader2 className="h-4 w-4 animate-spin" />} Cancelar tudo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Excluir em Massa ────────────────────────────────────────────── */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#EF444418' }}>
              <Trash2 className="h-6 w-6" style={{ color: '#EF4444' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Excluir {selectedErpIds.length} venda(s) permanentemente?</h3>
              <p className="mt-2 text-xs flex items-center gap-1.5" style={{ color: '#EF4444' }}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Esta ação não pode ser desfeita.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmBulkDelete(false)} className="flex-1 rounded-lg border py-2 text-sm text-muted" style={INP_S}>Voltar</button>
              <button onClick={doBulkDelete} disabled={bulkDeleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#EF4444' }}>
                {bulkDeleting && <Loader2 className="h-4 w-4 animate-spin" />} Excluir tudo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Editar Pagamento OS ─────────────────────────────────────────── */}
      {editPayRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#F59E0B18' }}>
              <CreditCard className="h-6 w-6" style={{ color: '#F59E0B' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Editar forma de pagamento</h3>
              <p className="mt-1 text-sm text-muted">
                <span className="font-medium text-text">{editPayRow.customerName}</span> — {BRL(editPayRow.total)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'pix',         label: 'PIX' },
                { value: 'cash',        label: 'Dinheiro' },
                { value: 'credit_card', label: 'Crédito' },
                { value: 'debit_card',  label: 'Débito' },
                { value: 'transfer',    label: 'Transferência' },
                { value: 'pending',     label: 'A Receber' },
              ] as const).map(opt => (
                <button key={opt.value} onClick={() => setEditPayVal(opt.value)}
                  className="rounded-lg border py-2.5 text-sm font-medium transition-all"
                  style={editPayVal === opt.value
                    ? { background: '#F59E0B18', borderColor: '#F59E0B', color: '#F59E0B' }
                    : { borderColor: '#2A3650', color: '#94A3B8' }}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditPayRow(null)} className="flex-1 rounded-lg border py-2 text-sm text-muted" style={INP_S}>
                Cancelar
              </button>
              <button onClick={doEditPay} disabled={savingPay || !editPayVal}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-black disabled:opacity-50"
                style={{ background: '#F59E0B' }}>
                {savingPay && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Excluir ────────────────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#EF444418' }}>
              <Trash2 className="h-6 w-6" style={{ color: '#EF4444' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Excluir venda permanentemente?</h3>
              <p className="mt-1 text-sm text-muted">
                <span className="font-medium text-text">{confirmDelete.customerName}</span> — {BRL(confirmDelete.total)}
              </p>
              <p className="mt-2 text-xs flex items-center gap-1.5" style={{ color: '#EF4444' }}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Esta ação não pode ser desfeita.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-lg border py-2 text-sm text-muted" style={INP_S}>Voltar</button>
              <button onClick={doDelete} disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: '#EF4444' }}>
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />} Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Alterar Data ───────────────────────────────────────────────── */}
      {editDateRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#22C55E18' }}>
              <CalendarDays className="h-6 w-6" style={{ color: '#22C55E' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Alterar data da venda</h3>
              <p className="mt-1 text-sm text-muted">
                <span className="font-medium text-text">{editDateRow.customerName}</span> — {BRL(editDateRow.total)}
              </p>
              <p className="mt-2 text-xs text-yellow-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                O estoque será cancelado e relançado automaticamente.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Nova data</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted pointer-events-none" />
                <input type="date" value={editDateVal} onChange={e => setEditDateVal(e.target.value)}
                  className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditDateRow(null)} className="flex-1 rounded-lg border py-2 text-sm text-muted" style={INP_S}>
                Voltar
              </button>
              <button onClick={doEditDate} disabled={savingDate || !editDateVal}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-black disabled:opacity-50"
                style={{ background: '#22C55E' }}>
                {savingDate && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Editar Venda Cancelada ─────────────────────────────────────── */}
      {esRow && (() => {
        const esSubtotal = esCart.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0)
        const esDiscount = parseCents(esDiscountStr)
        const esTotal    = Math.max(0, esSubtotal - esDiscount)
        return (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
            <div className="relative w-full max-w-2xl rounded-2xl border my-8" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
                <div className="flex items-center gap-3">
                  <Pencil className="h-4 w-4" style={{ color: '#22C55E' }} />
                  <h2 className="text-base font-semibold text-text">{esRow.cancelled ? 'Editar Venda Cancelada' : 'Editar Venda'}</h2>
                </div>
                <button onClick={() => setEsRow(null)} className="text-muted hover:text-text"><X className="h-5 w-5" /></button>
              </div>

              <div className="space-y-5 px-6 py-5">
                {/* Data */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Data da venda *</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted pointer-events-none" />
                    <input type="date" value={esDate} onChange={e => setEsDate(e.target.value)}
                      className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }} />
                  </div>
                </div>

                {/* Cliente */}
                <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: '#2A3650' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">Cliente (opcional)</p>
                  {esCustomerName ? (
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2.5" style={{ borderColor: '#22C55E30', background: '#22C55E08' }}>
                      <p className="text-sm font-medium text-text">{esCustomerName}</p>
                      <button onClick={() => { setEsCustomerId(null); setEsCustomerName('') }} className="text-muted hover:text-text">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input value={esCustQuery} onChange={e => setEsCustQuery(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleEsCustSearch()}
                          placeholder="Buscar por nome, CPF ou WhatsApp…"
                          className={INP + ' flex-1'} style={INP_S} />
                        <button onClick={handleEsCustSearch} disabled={esCustSearching}
                          className="rounded-lg border px-3 text-sm text-accent hover:bg-white/5" style={INP_S}>
                          {esCustSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </button>
                      </div>
                      {esCustDrop && esCustResults.length > 0 && (
                        <div className="rounded-lg border overflow-hidden" style={{ ...INP_S, background: '#1B2638' }}>
                          {esCustResults.map(c => (
                            <button key={c.id} onClick={() => { setEsCustomerId(c.id); setEsCustomerName(c.full_name); setEsCustDrop(false); setEsCustQuery('') }}
                              className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-white/5 border-b last:border-0" style={{ borderColor: '#2A3650' }}>
                              <span className="text-text">{c.full_name}</span>
                              {c.whatsapp && <span className="text-xs text-muted">{c.whatsapp}</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {!esShowCustForm && (
                        <button onClick={() => { setEsNc({ ...EMPTY_NC, name: esCustQuery.trim() }); setEsShowCustForm(true) }}
                          className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-xs text-muted hover:text-text transition-colors"
                          style={{ borderColor: '#2A3650' }}>
                          <UserPlus className="h-3.5 w-3.5" /> Cadastrar novo cliente
                        </button>
                      )}

                      {esShowCustForm && (
                        <div className="space-y-3 border-t pt-3" style={{ borderColor: '#2A3650' }}>
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#FBBF24' }}>Cadastro de cliente</p>
                            <button onClick={() => setEsShowCustForm(false)} className="text-xs text-muted hover:text-text">Cancelar</button>
                          </div>
                          <input value={esNc.name} onChange={e => setEsNc(p => ({ ...p, name: e.target.value }))}
                            placeholder="Nome completo *" className={INP} style={INP_S} />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input value={esNc.cpf} onChange={e => setEsNc(p => ({ ...p, cpf: fmtCpf(e.target.value) }))}
                              placeholder="CPF" className={INP} style={INP_S} />
                            <div className="relative">
                              <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
                              <input type="date" value={esNc.birthDate} onChange={e => setEsNc(p => ({ ...p, birthDate: e.target.value }))}
                                className={INP + ' pl-9'} style={INP_S} title="Data de aniversário" />
                            </div>
                          </div>
                          <input value={esNc.whatsapp} onChange={e => setEsNc(p => ({ ...p, whatsapp: fmtPhone(e.target.value) }))}
                            placeholder="WhatsApp" className={INP} style={INP_S} />
                          <input type="email" value={esNc.email} onChange={e => setEsNc(p => ({ ...p, email: e.target.value }))}
                            placeholder="E-mail" className={INP} style={INP_S} />
                          <div className="relative">
                            <input value={esNc.cep} onChange={e => setEsNc(p => ({ ...p, cep: fmtCep(e.target.value) }))}
                              onBlur={e => handleEsCepBlur(e.target.value)} placeholder="CEP (opcional)"
                              className={INP} style={INP_S} />
                            {esFetchingCep && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted" />}
                          </div>
                          <input value={esNc.addressStreet} onChange={e => setEsNc(p => ({ ...p, addressStreet: e.target.value }))}
                            placeholder="Logradouro" className={INP} style={INP_S} />
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input value={esNc.addressNumber} onChange={e => setEsNc(p => ({ ...p, addressNumber: e.target.value }))}
                              placeholder="Número" className={INP} style={INP_S} />
                            <input value={esNc.addressComplement} onChange={e => setEsNc(p => ({ ...p, addressComplement: e.target.value }))}
                              placeholder="Complemento" className={INP} style={INP_S} />
                          </div>
                          <AddressCityState state={esNc.addressState} city={esNc.addressCity}
                            onStateChange={v => setEsNc(p => ({ ...p, addressState: v }))}
                            onCityChange={v => setEsNc(p => ({ ...p, addressCity: v }))}
                            inputCls={INP} inputStyle={INP_S} />
                          <button onClick={handleSaveEsCust} disabled={savingEsCust || !esNc.name.trim()}
                            className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-black disabled:opacity-60"
                            style={{ background: '#10B981' }}>
                            {savingEsCust && <Loader2 className="h-4 w-4 animate-spin" />} Cadastrar e vincular
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Itens */}
                <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: '#2A3650' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">Itens do pedido *</p>
                  <div ref={esRef} className="relative">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                        <input value={esPQuery} onChange={e => setEsPQuery(e.target.value)}
                          placeholder="Buscar produto por nome ou código…"
                          className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }} />
                        {esPSearching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />}
                      </div>
                      <button onClick={() => setEsShowManual(true)}
                        className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-accent hover:bg-white/5 whitespace-nowrap" style={INP_S}>
                        <Plus className="h-4 w-4" /> Manual
                      </button>
                    </div>
                    {esPDrop && esPResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
                        {esPResults.map(p => (
                          <button key={`${p.source}-${p.id}`} onMouseDown={() => addEsProduct(p)}
                            className="flex w-full items-center justify-between px-4 py-3 text-sm hover:bg-white/5 transition-colors border-b last:border-0" style={{ borderColor: '#2A3650' }}>
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-text">{p.name}</p>
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                  style={p.source === 'parts_catalog' ? { background: '#F59E0B18', color: '#F59E0B' } : { background: '#22C55E18', color: '#22C55E' }}>
                                  {p.source === 'parts_catalog' ? 'Peça' : 'Produto'}
                                </span>
                              </div>
                            </div>
                            <p className="font-semibold text-accent ml-4 shrink-0">{BRL(p.price_cents)}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {esShowManual && (
                    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: '#2A3650', background: '#1B2638' }}>
                      <input value={esMName} onChange={e => setEsMName(e.target.value)} placeholder="Descrição do item / serviço *"
                        className={INP} style={INP_S} autoFocus onKeyDown={e => e.key === 'Enter' && addEsManualItem()} />
                      <div className="grid grid-cols-3 gap-2">
                        <input value={esMPrice} onChange={e => setEsMPrice(e.target.value)} placeholder="Preço (R$)"
                          className={INP} style={INP_S} />
                        <input type="number" min="1" value={esMQty} onChange={e => setEsMQty(e.target.value)} placeholder="Qtd"
                          className={INP} style={INP_S} />
                        <div className="flex gap-2">
                          <button onClick={addEsManualItem} disabled={!esMName.trim() || !esMPrice}
                            className="flex-1 rounded-lg py-2 text-sm font-semibold text-black disabled:opacity-50" style={{ background: '#10B981' }}>
                            Adicionar
                          </button>
                          <button onClick={() => setEsShowManual(false)} className="rounded-lg border px-2 text-muted hover:text-text" style={INP_S}>
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {esCart.length > 0 ? (
                    <div className="space-y-1">
                      {esCart.map(item => (
                        <div key={item.key} className="flex items-center gap-3 rounded-lg border px-3 py-2" style={{ borderColor: '#2A3650', background: '#1B2638' }}>
                          <p className="flex-1 text-sm text-text truncate">{item.name}</p>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => setEsItemQty(item.key, item.quantity - 1)}
                              className="h-6 w-6 rounded border flex items-center justify-center text-xs text-muted hover:bg-white/5" style={INP_S}>−</button>
                            <span className="w-6 text-center text-sm text-text">{item.quantity}</span>
                            <button onClick={() => setEsItemQty(item.key, item.quantity + 1)}
                              className="h-6 w-6 rounded border flex items-center justify-center text-xs text-muted hover:bg-white/5" style={INP_S}>+</button>
                          </div>
                          <p className="text-sm font-semibold text-accent shrink-0 w-24 text-right">{BRL(item.unitPriceCents * item.quantity)}</p>
                          <button onClick={() => setEsCart(prev => prev.filter(i => i.key !== item.key))} className="text-muted hover:text-red-400 shrink-0">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-xs text-muted py-4">Busque um produto ou clique em "Manual"</p>
                  )}
                </div>

                {/* Pagamento + Desconto */}
                <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Forma de Pagamento</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(['cash','pix','card','mixed'] as const).map(m => {
                        const colors = { cash:'#10B981', pix:'#22C55E', card:'#F59E0B', mixed:'#EF4444' }
                        const labels = { cash:'Dinheiro', pix:'PIX', card:'Cartão', mixed:'Misto' }
                        const active = esPayMethod === m; const c = colors[m]
                        return (
                          <button key={m} onClick={() => setEsPayMethod(m)}
                            className="rounded-lg border py-2 text-xs font-medium transition-all"
                            style={active ? { background:`${c}18`, borderColor:c, color:c } : { borderColor:'#2A3650', color:'#94A3B8' }}>
                            {labels[m]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="min-w-32">
                    <label className="mb-1 block text-xs font-medium text-muted">Desconto (R$)</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span>
                      <input type="text" inputMode="numeric" value={esDiscountStr}
                        onChange={e => setEsDiscountStr(e.target.value)} placeholder="0,00"
                        className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }} />
                    </div>
                  </div>
                </div>

                {/* ── Canal + Entrega (reclassificar venda) ── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Canal da venda</label>
                    <select
                      value={esSaleChannel}
                      onChange={e => setEsSaleChannel(e.target.value as SaleChannel | '')}
                      className={INP} style={{ ...INP_S, appearance: 'none' }}
                    >
                      <option value="">Não informar</option>
                      {SALE_CHANNEL_OPTIONS_PICKABLE.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted">Entrega</label>
                    <select
                      value={esDeliveryType}
                      onChange={e => setEsDeliveryType(e.target.value as DeliveryType | '')}
                      className={INP} style={{ ...INP_S, appearance: 'none' }}
                    >
                      <option value="">Não informar</option>
                      {DELIVERY_TYPE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Origem da venda — só pra Consumidor Final ou venda sem cliente.
                    Quando há cliente cadastrado, a origem dele é usada nos relatórios. */}
                {((esCustomerName === 'Consumidor Final') || !esCustomerId) && (
                  <div className="rounded-lg border p-3" style={{ ...INP_S, background: 'rgba(168,139,250,.05)' }}>
                    <label className="mb-1 block text-xs font-semibold" style={{ color: '#A78BFA' }}>
                      Onde nos conheceu?
                    </label>
                    <select
                      value={esConsumerOrigin}
                      onChange={e => setEsConsumerOrigin(e.target.value)}
                      className={INP} style={{ ...INP_S, appearance: 'none' }}
                    >
                      {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-muted">
                      Usado nos relatórios de origem mesmo sem cadastrar o cliente. Default: <strong>Passou na Porta</strong>.
                    </p>
                  </div>
                )}

                {esCart.length > 0 && (
                  <div className="rounded-lg border px-4 py-3 space-y-1" style={{ ...INP_S, background: '#1B2638' }}>
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Subtotal</span><span>{BRL(esSubtotal)}</span>
                    </div>
                    {esDiscount > 0 && (
                      <div className="flex items-center justify-between text-xs" style={{ color: '#EF4444' }}>
                        <span>Desconto</span><span>- {BRL(esDiscount)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between font-bold border-t pt-1" style={{ borderColor: '#2A3650' }}>
                      <span className="text-sm text-text">Total</span>
                      <span className="text-base" style={{ color: '#10B981' }}>{BRL(esTotal)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 border-t px-6 py-4" style={{ borderColor: '#2A3650' }}>
                <button onClick={() => setEsRow(null)} className="rounded-lg border px-4 py-2 text-sm text-muted hover:text-text" style={INP_S}>
                  Cancelar
                </button>
                <button onClick={doEditSale} disabled={savingEs || !esDate}
                  className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-black disabled:opacity-50"
                  style={{ background: '#22C55E' }}>
                  {savingEs && <Loader2 className="h-4 w-4 animate-spin" />}
                  {savingEs ? 'Salvando…' : 'Salvar Venda'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Modal Nova Venda ─────────────────────────────────────────────────── */}
      {novaVendaOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="relative w-full max-w-2xl rounded-2xl border my-8" style={{ background: '#131C2A', borderColor: '#2A3650' }}>

            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
              <h2 className="text-base font-semibold text-text">Registrar Venda</h2>
              <button onClick={() => setNovaVendaOpen(false)} className="text-muted hover:text-text"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-5 px-6 py-5">
              {nvError && (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: '#EF444418', color: '#EF4444', border: '1px solid #EF444440' }}>
                  <AlertTriangle className="h-4 w-4 shrink-0 pointer-events-none" />{nvError}
                </div>
              )}

              {/* Data */}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Data da venda *</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted pointer-events-none" />
                  <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)}
                    className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }} />
                </div>
              </div>

              {/* ── Cliente ─────────────────────────────────────────────────── */}
              <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: '#2A3650' }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Cliente (opcional)</p>

                {customer ? (
                  <>
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2.5" style={{ borderColor: '#22C55E30', background: '#22C55E08' }}>
                      <div>
                        <p className="text-sm font-medium text-text">{customer.full_name}</p>
                        {customer.whatsapp && <p className="text-xs text-muted">{customer.whatsapp}</p>}
                      </div>
                      <button onClick={() => { setCustomer(null); setCustQuery('') }} className="text-muted hover:text-text">
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* ── Origem (Como nos conheceu?) ── */}
                    {customer.origin ? (
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
                          onChange={e => handleSetCustomerOrigin(e.target.value)}
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
                          Como nos conheceu?
                        </label>
                        <select
                          value=""
                          onChange={e => handleSetCustomerOrigin(e.target.value)}
                          disabled={savingOrigin}
                          className={INP}
                          style={{ ...INP_S, appearance: 'none' }}
                        >
                          <option value="">Selecione uma opção…</option>
                          {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* ── Código da campanha (origens Meta) ── */}
                    {customer.origin && (customer.origin === 'instagram_pago' || customer.origin === 'facebook') && (
                      <div className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2"
                        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
                        <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0" style={{ color: '#94A3B8' }}>
                          Campanha
                        </span>
                        <CampaignCodePicker
                          customerId={customer.id}
                          currentCode={customer.campaign_code}
                          origin={customer.origin}
                          onUpdated={code => setCustomer(customer ? { ...customer, campaign_code: code } : null)}
                          compact
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {!showCustForm && (
                      <div className="space-y-2">
                        <div className="flex gap-2">
                          <input value={custQuery} onChange={e => setCustQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleCustSearch()}
                            placeholder="Buscar por nome, CPF ou WhatsApp…"
                            className={INP + ' flex-1'} style={INP_S} />
                          <button onClick={handleCustSearch} disabled={custSearching}
                            className="rounded-lg border px-3 text-sm text-accent hover:bg-white/5" style={INP_S}>
                            {custSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          </button>
                        </div>
                        <button onClick={() => setShowCustForm(true)}
                          className="flex items-center gap-2 text-xs font-medium transition-colors hover:text-accent"
                          style={{ color: '#22C55E' }}>
                          <UserPlus className="h-3.5 w-3.5" /> Cadastrar novo cliente
                        </button>
                        {custDrop && custResults.length > 0 && (
                          <div className="rounded-lg border overflow-hidden" style={{ ...INP_S, background: '#1B2638' }}>
                            {custResults.map(c => (
                              <button key={c.id} onClick={() => { setCustomer(c); setCustDrop(false); setCustQuery('') }}
                                className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-white/5 border-b last:border-0" style={{ borderColor: '#2A3650' }}>
                                <span className="text-text">{c.full_name}</span>
                                {c.whatsapp && <span className="text-xs text-muted">{c.whatsapp}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {showCustForm && (
                      <div className="space-y-3 border-t pt-3" style={{ borderColor: '#2A3650' }}>
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold text-amber uppercase tracking-wider">Cadastro de cliente</p>
                          <button onClick={() => setShowCustForm(false)} className="text-xs text-muted hover:text-text">Cancelar</button>
                        </div>
                        <input value={nc.name} onChange={e => setNc(p => ({ ...p, name: e.target.value }))}
                          placeholder="Nome completo *" className={INP} style={INP_S} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input value={nc.cpf} onChange={e => setNc(p => ({ ...p, cpf: fmtCpf(e.target.value) }))}
                            placeholder="CPF" className={INP} style={INP_S} />
                          <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted pointer-events-none" />
                            <input type="date" value={nc.birthDate} onChange={e => setNc(p => ({ ...p, birthDate: e.target.value }))}
                              className={INP + ' pl-9'} style={INP_S} title="Data de aniversário" />
                          </div>
                        </div>
                        <input value={nc.whatsapp} onChange={e => setNc(p => ({ ...p, whatsapp: fmtPhone(e.target.value) }))}
                          placeholder="WhatsApp" className={INP} style={INP_S} />
                        <input type="email" value={nc.email} onChange={e => setNc(p => ({ ...p, email: e.target.value }))}
                          placeholder="E-mail" className={INP} style={INP_S} />
                        <div className="relative">
                          <input value={nc.cep} onChange={e => setNc(p => ({ ...p, cep: fmtCep(e.target.value) }))}
                            onBlur={e => handleCepBlur(e.target.value)} placeholder="CEP (opcional)"
                            className={INP} style={INP_S} />
                          {fetchingCep && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted" />}
                        </div>
                        <input value={nc.addressStreet} onChange={e => setNc(p => ({ ...p, addressStreet: e.target.value }))}
                          placeholder="Logradouro" className={INP} style={INP_S} />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input value={nc.addressNumber} onChange={e => setNc(p => ({ ...p, addressNumber: e.target.value }))}
                            placeholder="Número" className={INP} style={INP_S} />
                          <input value={nc.addressComplement} onChange={e => setNc(p => ({ ...p, addressComplement: e.target.value }))}
                            placeholder="Complemento" className={INP} style={INP_S} />
                        </div>
                        <AddressCityState state={nc.addressState} city={nc.addressCity}
                          onStateChange={v => setNc(p => ({ ...p, addressState: v }))}
                          onCityChange={v => setNc(p => ({ ...p, addressCity: v }))}
                          inputCls={INP} inputStyle={INP_S} />
                        <button onClick={handleSaveCust} disabled={savingCust || !nc.name.trim()}
                          className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-black disabled:opacity-60"
                          style={{ background: '#10B981' }}>
                          {savingCust && <Loader2 className="h-4 w-4 animate-spin" />} Cadastrar cliente
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Produtos ─────────────────────────────────────────────────── */}
              <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: '#2A3650' }}>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Produtos / Serviços *</p>

                {/* Search */}
                <div ref={pRef} className="relative">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <input
                        ref={pInputRef}
                        value={pQuery}
                        onChange={e => setPQuery(e.target.value)}
                        onFocus={() => { if (pQuery.trim().length >= 2) setPDrop(true) }}
                        placeholder="Buscar produto por nome ou código…"
                        className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }}
                      />
                      {pSearching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />}
                    </div>
                    <button onClick={() => setShowManual(true)}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-accent hover:bg-white/5 whitespace-nowrap" style={INP_S}>
                      <Plus className="h-4 w-4" /> Manual
                    </button>
                  </div>

                  {pDrop && pQuery.trim().length >= 2 && (
                    <div className="absolute z-30 mt-1 w-full rounded-xl border shadow-xl overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
                      {pSearching && pResults.length === 0 && (
                        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Buscando…
                        </div>
                      )}

                      {!pSearching && pResults.length === 0 && (
                        <div className="px-4 py-3 text-sm">
                          <p className="text-muted">Nenhum produto encontrado para <strong>&quot;{pQuery}&quot;</strong>.</p>
                          <button
                            onClick={() => { setShowManual(true); setPDrop(false) }}
                            className="mt-2 text-xs font-semibold text-accent hover:underline"
                          >
                            + Adicionar como item manual
                          </button>
                        </div>
                      )}

                      {pResults.map(p => (
                        <button key={`${p.source}-${p.id}`} onMouseDown={() => addProduct(p)}
                          className="flex w-full items-center justify-between px-4 py-3 text-sm hover:bg-white/5 transition-colors border-b last:border-0" style={{ borderColor: '#2A3650' }}>
                          <div className="text-left">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-text">{p.name}</p>
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                style={p.source === 'parts_catalog' ? { background: '#F59E0B18', color: '#F59E0B' } : { background: '#22C55E18', color: '#22C55E' }}>
                                {p.source === 'parts_catalog' ? 'Peça' : 'Produto'}
                              </span>
                            </div>
                            {p.code && <p className="text-xs text-muted">Cód: {p.code}</p>}
                          </div>
                          <div className="text-right ml-4 shrink-0">
                            <p className="font-semibold text-accent">{BRL(p.price_cents)}</p>
                            {p.stock_qty != null && <p className="text-xs text-muted">Estoque: {p.stock_qty}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Item manual inline */}
                {showManual && (
                  <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: '#2A3650', background: '#1B2638' }}>
                    <input value={mName} onChange={e => setMName(e.target.value)} placeholder="Descrição do item / serviço *"
                      className={INP} style={INP_S} autoFocus onKeyDown={e => e.key === 'Enter' && addManualItem()} />
                    <div className="grid grid-cols-3 gap-2">
                      <input value={mPrice} onChange={e => setMPrice(e.target.value)} placeholder="Preço (R$)"
                        className={INP} style={INP_S} />
                      <input type="number" min="1" value={mQty} onChange={e => setMQty(e.target.value)} placeholder="Qtd"
                        className={INP} style={INP_S} />
                      <div className="flex gap-2">
                        <button onClick={addManualItem} disabled={!mName.trim() || !mPrice}
                          className="flex-1 rounded-lg py-2 text-sm font-semibold text-black disabled:opacity-50" style={{ background: '#10B981' }}>
                          Adicionar
                        </button>
                        <button onClick={() => setShowManual(false)} className="rounded-lg border px-2 text-muted hover:text-text" style={INP_S}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Cart */}
                {cart.length > 0 && (
                  <div className="space-y-1">
                    {cart.map(item => (
                      <div key={item.key} className="flex items-center gap-3 rounded-lg border px-3 py-2" style={{ borderColor: '#2A3650', background: '#1B2638' }}>
                        <p className="flex-1 text-sm text-text truncate">{item.name}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => setItemQty(item.key, item.quantity - 1)}
                            className="h-6 w-6 rounded border flex items-center justify-center text-xs text-muted hover:bg-white/5" style={INP_S}>−</button>
                          <span className="w-6 text-center text-sm text-text">{item.quantity}</span>
                          <button onClick={() => setItemQty(item.key, item.quantity + 1)}
                            className="h-6 w-6 rounded border flex items-center justify-center text-xs text-muted hover:bg-white/5" style={INP_S}>+</button>
                        </div>
                        <p className="text-sm font-semibold text-accent shrink-0 w-24 text-right">{BRL(item.unitPriceCents * item.quantity)}</p>
                        <button onClick={() => setCart(prev => prev.filter(i => i.key !== item.key))} className="text-muted hover:text-red-400 shrink-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {cart.length === 0 && !showManual && (
                  <p className="text-center text-xs text-muted py-4">Busque um produto ou clique em "Manual"</p>
                )}
              </div>

              {/* ── Desconto + Pagamento ─────────────────────────────────────── */}
              <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Forma de Pagamento</label>
                  <div className="grid grid-cols-4 gap-2">
                    {(['cash','pix','card','mixed'] as const).map(m => {
                      const colors = { cash:'#10B981', pix:'#22C55E', card:'#F59E0B', mixed:'#EF4444' }
                      const labels = { cash:'Dinheiro', pix:'PIX', card:'Cartão', mixed:'Misto' }
                      const active = payMethod === m; const c = colors[m]
                      return (
                        <button key={m} onClick={() => setPayMethod(m)}
                          className="rounded-lg border py-2 text-xs font-medium transition-all"
                          style={active ? { background:`${c}18`, borderColor:c, color:c } : { borderColor:'#2A3650', color:'#94A3B8' }}>
                          {labels[m]}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div className="min-w-32">
                  <label className="mb-1 block text-xs font-medium text-muted">Desconto (R$)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span>
                    <input type="text" inputMode="numeric" value={discountStr}
                      onChange={e => setDiscountStr(e.target.value)} placeholder="0,00"
                      className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }} />
                  </div>
                </div>
              </div>

              {/* ── Canal + Entrega ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Canal da venda</label>
                  <select
                    value={nvSaleChannel}
                    onChange={e => setNvSaleChannel(e.target.value as SaleChannel | '')}
                    className={INP} style={{ ...INP_S, appearance: 'none' }}
                  >
                    <option value="">Não informar</option>
                    {SALE_CHANNEL_OPTIONS_PICKABLE.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Entrega</label>
                  <select
                    value={nvDeliveryType}
                    onChange={e => setNvDeliveryType(e.target.value as DeliveryType | '')}
                    className={INP} style={{ ...INP_S, appearance: 'none' }}
                  >
                    <option value="">Não informar</option>
                    {DELIVERY_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Total preview */}
              {cart.length > 0 && (
                <div className="rounded-lg border px-4 py-3 space-y-1" style={{ ...INP_S, background: '#1B2638' }}>
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>Subtotal</span><span>{BRL(subtotal)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex items-center justify-between text-xs" style={{ color: '#EF4444' }}>
                      <span>Desconto</span><span>- {BRL(discount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between font-bold border-t pt-1" style={{ borderColor: '#2A3650' }}>
                    <span className="text-sm text-text">Total</span>
                    <span className="text-base" style={{ color: '#10B981' }}>{BRL(total)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 border-t px-6 py-4" style={{ borderColor: '#2A3650' }}>
              <button onClick={() => setNovaVendaOpen(false)} className="rounded-lg border px-4 py-2 text-sm text-muted hover:text-text" style={INP_S}>
                Cancelar
              </button>
              <button onClick={doNovaVenda} disabled={nvSaving || cart.length === 0}
                className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-black disabled:opacity-50"
                style={{ background: '#10B981' }}>
                {nvSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {nvSaving ? 'Registrando…' : 'Registrar Venda'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Editar OS (CheckSmart) — Opção B: financeiro + cliente, peças read-only ── */}
      {eosRow && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setEosRow(null) }}>
          <div className="relative w-full max-w-2xl rounded-2xl border my-8" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: '#22C55E18' }}>
                  <Pencil className="h-5 w-5" style={{ color: '#22C55E' }} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-text">Editar OS</h3>
                  <p className="text-xs text-muted">Origem: CheckSmart</p>
                </div>
              </div>
              <button onClick={() => setEosRow(null)} className="text-muted hover:text-text">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Cliente */}
              <div className="relative">
                <label className="mb-1 block text-xs font-medium text-muted">Cliente</label>
                <input
                  type="text"
                  value={eosCustQuery || eosCustomerName}
                  onChange={e => { setEosCustQuery(e.target.value); setEosShowCustDrop(true) }}
                  onFocus={() => { setEosCustQuery(''); setEosShowCustDrop(true) }}
                  placeholder="Buscar cliente..."
                  className={INP} style={INP_S}
                />
                {eosShowCustDrop && eosCustQuery.trim().length >= 2 && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg border max-h-60 overflow-y-auto"
                    style={{ background: '#1B2638', borderColor: '#3A4868' }}>
                    {eosCustSearching && (
                      <div className="p-3 text-xs text-muted flex items-center gap-2">
                        <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
                      </div>
                    )}
                    {!eosCustSearching && eosCustResults.length === 0 && (
                      <p className="p-3 text-xs text-muted">Nenhum cliente encontrado.</p>
                    )}
                    {eosCustResults.map(c => (
                      <button key={c.id} type="button"
                        onClick={() => {
                          setEosCustomerId(c.id)
                          setEosCustomerName(c.full_name)
                          setEosCustQuery('')
                          setEosShowCustDrop(false)
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-white/5 text-sm border-b last:border-b-0"
                        style={{ borderColor: '#2A3650', color: '#F8FAFC' }}>
                        {c.full_name}
                        {c.whatsapp && <span className="ml-2 text-[11px] text-muted">{c.whatsapp}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Data + Pagamento */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Data / Hora</label>
                  <input type="datetime-local" value={eosDate} onChange={e => setEosDate(e.target.value)}
                    className={INP} style={{ ...INP_S, colorScheme: 'dark' }} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Forma de pagamento</label>
                  <select value={eosPayMethod} onChange={e => setEosPayMethod(e.target.value)}
                    className={INP} style={INP_S}>
                    <option value="">— Não informado —</option>
                    <option value="cash">Dinheiro</option>
                    <option value="pix">PIX</option>
                    <option value="credit_card">Cartão de Crédito</option>
                    <option value="debit_card">Cartão de Débito</option>
                    <option value="transfer">Transferência</option>
                    <option value="pending">A receber</option>
                  </select>
                </div>
              </div>

              {/* Valor de serviço + Desconto */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Novo valor do serviço (R$)</label>
                  <input type="text" inputMode="decimal" value={eosServicePrice}
                    onChange={e => setEosServicePrice(e.target.value)}
                    placeholder="Deixe vazio pra manter o atual"
                    className={INP} style={INP_S} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Desconto (R$)</label>
                  <input type="text" inputMode="decimal" value={eosDiscount}
                    onChange={e => setEosDiscount(e.target.value)}
                    placeholder="0,00" className={INP} style={INP_S} />
                </div>
              </div>

              {/* Peças (read-only) */}
              <div className="rounded-xl border p-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#CBD5E1' }}>
                    Peças da OS ({eosParts.length})
                  </p>
                  <a href="https://checksmart-grok.vercel.app/orders" target="_blank" rel="noopener noreferrer"
                    className="text-xs font-semibold hover:underline" style={{ color: '#22C55E' }}>
                    Editar peças no CheckSmart →
                  </a>
                </div>
                {eosLoadingParts ? (
                  <p className="text-xs text-muted flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Carregando peças...
                  </p>
                ) : eosParts.length === 0 ? (
                  <p className="text-xs text-muted">Nenhuma peça lançada nesta OS.</p>
                ) : (
                  <div className="space-y-1.5">
                    {eosParts.map(p => (
                      <div key={p.id} className="flex items-center justify-between text-xs">
                        <span className="text-text truncate">
                          {p.quantity}× {p.name}
                          {p.supplier && <span className="text-muted ml-1">· {p.supplier}</span>}
                        </span>
                        <span className="font-mono shrink-0 ml-2" style={{ color: '#10B981' }}>
                          {BRL(p.totalSaleCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] mt-2" style={{ color: '#94A3B8' }}>
                  Pra adicionar, remover ou alterar peças, use o CheckSmart (modelo de dados diferente entre os 2 sistemas).
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t px-6 py-4" style={{ borderColor: '#2A3650' }}>
              <button onClick={() => setEosRow(null)}
                className="rounded-lg border px-4 py-2 text-sm text-muted hover:text-text"
                style={{ borderColor: '#2A3650' }}>
                Cancelar
              </button>
              <button onClick={doSaveEditOS} disabled={eosSaving || !eosDate}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50"
                style={{ background: '#22C55E', color: '#131C2A' }}>
                {eosSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {eosSaving ? 'Salvando...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Reclassificar Canal (ERP sale + OS CheckSmart) ──────────── */}
      {rcRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={e => { if (e.target === e.currentTarget) setRcRow(null) }}>
          <div className="w-full max-w-md rounded-2xl border p-6 space-y-4"
            style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Pencil className="h-4 w-4" style={{ color: '#22C55E' }} />
                <h3 className="text-base font-semibold text-text">Reclassificar canal</h3>
              </div>
              <button onClick={() => setRcRow(null)} className="text-muted hover:text-coral transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-lg border px-3 py-2" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                {rcRow.source === 'erp' ? 'Venda' : 'Ordem de Serviço'}
              </p>
              <p className="text-sm mt-1" style={{ color: '#F8FAFC' }}>{rcRow.customerName}</p>
              <p className="text-xs mt-0.5 font-mono" style={{ color: '#CBD5E1' }}>
                {rcRow.dateStr} · {BRL(rcRow.total)}
              </p>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#94A3B8' }}>
                Canal da venda
              </label>
              <select
                value={rcChannel}
                onChange={e => setRcChannel(e.target.value as SaleChannel | '')}
                className={INP} style={{ ...INP_S, appearance: 'none' }}
              >
                <option value="">Não informar</option>
                {SALE_CHANNEL_OPTIONS_PICKABLE.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#94A3B8' }}>
                Entrega
              </label>
              <select
                value={rcDelivery}
                onChange={e => setRcDelivery(e.target.value as DeliveryType | '')}
                className={INP} style={{ ...INP_S, appearance: 'none' }}
              >
                <option value="">Não informar</option>
                {DELIVERY_TYPE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setRcRow(null)}
                className="rounded-lg border px-4 py-2 text-sm text-muted hover:text-text" style={INP_S}
              >
                Cancelar
              </button>
              <button
                onClick={doReclassify}
                disabled={rcSaving}
                className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-black disabled:opacity-50"
                style={{ background: '#10B981' }}
              >
                {rcSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {rcSaving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Enviar comprovante por E-MAIL ──────────────────── */}
      {emailRow && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => !sendingEmail && setEmailRow(null)}>
          <div className="w-full max-w-md rounded-xl border p-5" style={{ background: '#1B2638', borderColor: '#3A4868' }} onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <Mail className="h-5 w-5" style={{ color: '#06B6D4' }} />
              <h3 className="text-base font-semibold" style={{ color: '#E2E8F0' }}>Enviar comprovante por e-mail</h3>
            </div>
            <p className="mb-4 text-xs" style={{ color: '#94A3B8' }}>
              Cliente: <span className="font-medium" style={{ color: '#E2E8F0' }}>{emailRow.customerName}</span> · {emailRow.dateStr}
            </p>

            <label className="mb-1 block text-xs font-medium" style={{ color: '#CBD5E1' }}>E-mail do cliente</label>
            <input
              type="email"
              value={emailTo}
              onChange={e => setEmailTo(e.target.value)}
              placeholder="cliente@exemplo.com"
              className="mb-3 w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: '#0F172A', border: '1px solid #3A4868', color: '#E2E8F0' }}
              disabled={sendingEmail}
              autoFocus
            />

            <label className="mb-1 block text-xs font-medium" style={{ color: '#CBD5E1' }}>Observação (opcional)</label>
            <textarea
              value={emailObs}
              onChange={e => setEmailObs(e.target.value.slice(0, 500))}
              placeholder="Mensagem que aparece no PDF e no corpo do e-mail."
              rows={3}
              className="mb-1 w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: '#0F172A', border: '1px solid #3A4868', color: '#E2E8F0' }}
              disabled={sendingEmail}
            />
            <p className="mb-4 text-right text-[10px]" style={{ color: '#64748B' }}>{emailObs.length}/500</p>

            <label className="mb-1 flex items-center gap-1 text-xs font-medium" style={{ color: '#CBD5E1' }}>
              <LinkIcon className="h-3.5 w-3.5" /> Link público (sempre atualizado)
            </label>
            <div className="mb-4 flex gap-2">
              <input
                readOnly
                value={loadingShareUrl ? 'Gerando link…' : shareUrl}
                className="flex-1 rounded-lg px-3 py-2 text-xs"
                style={{ background: '#0F172A', border: '1px solid #3A4868', color: '#94A3B8' }}
                onFocus={e => e.target.select()}
              />
              <button
                onClick={copyShareUrl}
                disabled={!shareUrl || loadingShareUrl}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                style={{ background: '#475569', color: '#F1F5F9' }}
                title="Copiar link"
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setEmailRow(null)}
                disabled={sendingEmail}
                className="flex-1 rounded-lg border py-2 text-sm"
                style={{ borderColor: '#3A4868', color: '#94A3B8' }}
              >Cancelar</button>
              <button
                onClick={handleSendComprovanteEmail}
                disabled={sendingEmail || !emailTo.trim()}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: '#06B6D4' }}
              >
                {sendingEmail && <Loader2 className="h-4 w-4 animate-spin" />}
                {sendingEmail ? 'Enviando…' : 'Enviar e-mail'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Enviar comprovante por WHATSAPP ──────────────── */}
      {waRow && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={() => !waLoadingLink && setWaRow(null)}>
          <div className="w-full max-w-md rounded-xl border p-5" style={{ background: '#1B2638', borderColor: '#3A4868' }} onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center gap-2">
              <MessageCircle className="h-5 w-5" style={{ color: '#22C55E' }} />
              <h3 className="text-base font-semibold" style={{ color: '#E2E8F0' }}>Enviar comprovante por WhatsApp</h3>
            </div>
            <p className="mb-4 text-xs" style={{ color: '#94A3B8' }}>
              Cliente: <span className="font-medium" style={{ color: '#E2E8F0' }}>{waRow.customerName}</span> · {waRow.dateStr}
            </p>

            <label className="mb-1 block text-xs font-medium" style={{ color: '#CBD5E1' }}>WhatsApp do cliente</label>
            <input
              type="tel"
              value={waTo}
              onChange={e => setWaTo(e.target.value)}
              placeholder="(11) 99999-9999"
              className="mb-3 w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: '#0F172A', border: '1px solid #3A4868', color: '#E2E8F0' }}
              disabled={waLoadingLink}
              autoFocus
            />

            <label className="mb-1 block text-xs font-medium" style={{ color: '#CBD5E1' }}>Mensagem extra (opcional)</label>
            <textarea
              value={waObs}
              onChange={e => setWaObs(e.target.value.slice(0, 300))}
              placeholder="Texto extra que vai junto da mensagem do WhatsApp."
              rows={3}
              className="mb-1 w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: '#0F172A', border: '1px solid #3A4868', color: '#E2E8F0' }}
              disabled={waLoadingLink}
            />
            <p className="mb-3 text-right text-[10px]" style={{ color: '#64748B' }}>{waObs.length}/300</p>

            <label className="mb-1 flex items-center gap-1 text-xs font-medium" style={{ color: '#CBD5E1' }}>
              <LinkIcon className="h-3.5 w-3.5" /> Link público (sempre atualizado)
            </label>
            <div className="mb-3 flex gap-2">
              <input
                readOnly
                value={loadingShareUrl ? 'Gerando link…' : shareUrl}
                className="flex-1 rounded-lg px-3 py-2 text-xs"
                style={{ background: '#0F172A', border: '1px solid #3A4868', color: '#94A3B8' }}
                onFocus={e => e.target.select()}
              />
              <button
                onClick={copyShareUrl}
                disabled={!shareUrl || loadingShareUrl}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                style={{ background: '#475569', color: '#F1F5F9' }}
                title="Copiar link"
              >
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </button>
            </div>

            <p className="mb-4 rounded-lg p-2 text-[11px]" style={{ background: '#0F172A', color: '#94A3B8' }}>
              💡 Vai abrir o WhatsApp Web ou app com mensagem pré-preenchida + esse link. O cliente clica e baixa o PDF — link válido por 30 dias e <strong>sempre reflete a versão atual</strong> da venda (se você editar, atualiza automaticamente).
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setWaRow(null)}
                disabled={waLoadingLink}
                className="flex-1 rounded-lg border py-2 text-sm"
                style={{ borderColor: '#3A4868', color: '#94A3B8' }}
              >Cancelar</button>
              <button
                onClick={handleSendComprovanteWhatsapp}
                disabled={waLoadingLink || !waTo.trim()}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                style={{ background: '#22C55E' }}
              >
                {waLoadingLink && <Loader2 className="h-4 w-4 animate-spin" />}
                {waLoadingLink ? 'Gerando link…' : 'Abrir WhatsApp'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
