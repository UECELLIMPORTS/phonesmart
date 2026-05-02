'use client'

import { useState, useTransition } from 'react'
import {
  Search, Wrench, Loader2, Plus, X, ShieldCheck, ShieldAlert,
  Phone, User as UserIcon, Calendar, CheckCircle2, AlertCircle,
  PlayCircle, PackageCheck, Truck, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  findSaleByImei, createServiceOrder, updateServiceOrder,
  type ServiceOrderRow, type ServiceOrderStatus, type SaleByImeiResult,
} from '@/actions/service-orders'

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

function fmtDateOnly(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
}

function parseBRLToCents(s: string): number {
  const cleaned = s.replace(/\s/g, '').replace(/[R$]/g, '').trim()
  if (!cleaned) return 0
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned
  const v = Number(normalized)
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : 0
}

const STATUS_CFG: Record<ServiceOrderStatus, { label: string; color: string; bg: string; icon: typeof PlayCircle }> = {
  open:        { label: 'Aberta',          color: 'text-amber-400', bg: 'bg-amber-500/20 border-amber-500/30',     icon: AlertCircle },
  in_progress: { label: 'Em conserto',     color: 'text-blue-400',  bg: 'bg-blue-500/20 border-blue-500/30',       icon: PlayCircle },
  ready:       { label: 'Pronto',          color: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/30', icon: PackageCheck },
  delivered:   { label: 'Entregue',        color: 'text-text/90',  bg: 'bg-zinc-800/60 border-zinc-700/60',       icon: Truck },
  rejected:    { label: 'Rejeitada',       color: 'text-rose-400',  bg: 'bg-rose-500/20 border-rose-500/30',       icon: XCircle },
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AssistenciaClient({ initialOrders }: { initialOrders: ServiceOrderRow[] }) {
  const [orders, setOrders] = useState<ServiceOrderRow[]>(initialOrders)
  const [filter, setFilter] = useState<ServiceOrderStatus | 'all'>('all')

  // Search por IMEI
  const [imeiQuery, setImeiQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [warranty, setWarranty]   = useState<SaleByImeiResult | null>(null)
  const [searchTried, setSearchTried] = useState(false)

  // Modal nova OS
  const [newOSOpen, setNewOSOpen] = useState(false)
  const [newOS, setNewOS] = useState({
    deviceDescription: '',
    serialText:        '',
    defectDescription: '',
    technicianName:    '',
    estimatedReadyAt:  '',
    costStr:           '',
    serviceCostStr:    '',
    warrantyUsed:      false,
    notes:             '',
  })

  const [pending, startTransition] = useTransition()

  const counts = {
    all:         orders.length,
    open:        orders.filter(o => o.status === 'open').length,
    in_progress: orders.filter(o => o.status === 'in_progress').length,
    ready:       orders.filter(o => o.status === 'ready').length,
    delivered:   orders.filter(o => o.status === 'delivered').length,
    rejected:    orders.filter(o => o.status === 'rejected').length,
  }

  const visible = filter === 'all' ? orders : orders.filter(o => o.status === filter)

  // ── Search by IMEI ──
  function handleSearch() {
    const q = imeiQuery.trim()
    if (q.length < 4) {
      toast.error('Digite ao menos 4 dígitos do IMEI.')
      return
    }
    setSearching(true)
    setSearchTried(true)
    setWarranty(null)
    findSaleByImei(q)
      .then(res => setWarranty(res))
      .catch(err => toast.error(err instanceof Error ? err.message : 'Erro na busca'))
      .finally(() => setSearching(false))
  }

  function openNewOS(prefill?: { deviceDescription?: string; serialText?: string }) {
    setNewOS({
      deviceDescription: prefill?.deviceDescription ?? '',
      serialText:        prefill?.serialText ?? '',
      defectDescription: '',
      technicianName:    '',
      estimatedReadyAt:  '',
      costStr:           '',
      serviceCostStr:    '',
      warrantyUsed:      warranty?.warrantyValid ?? false,
      notes:             '',
    })
    setNewOSOpen(true)
  }

  function submitNewOS() {
    if (!newOS.defectDescription.trim()) {
      toast.error('Descreva o defeito.')
      return
    }

    startTransition(async () => {
      const res = await createServiceOrder({
        productSerialId:    warranty?.serialId ?? null,
        saleItemId:         warranty?.saleItemId ?? null,
        customerId:         warranty?.customerId ?? null,
        deviceDescription:  newOS.deviceDescription.trim() || warranty?.productName || null,
        serialText:         newOS.serialText.trim() || warranty?.serial || null,
        defectDescription:  newOS.defectDescription.trim(),
        warrantyUsed:       newOS.warrantyUsed,
        costCents:          parseBRLToCents(newOS.costStr),
        serviceCostCents:   parseBRLToCents(newOS.serviceCostStr),
        technicianName:     newOS.technicianName.trim() || null,
        estimatedReadyAt:   newOS.estimatedReadyAt || null,
        notes:              newOS.notes.trim() || null,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`OS ${res.data!.osNumber} criada!`)
      setNewOSOpen(false)
      // Recarrega a lista do servidor
      window.location.reload()
    })
  }

  function changeStatus(o: ServiceOrderRow, status: ServiceOrderStatus) {
    startTransition(async () => {
      const res = await updateServiceOrder({ id: o.id, status })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setOrders(prev => prev.map(x => x.id === o.id ? { ...x, status, closedAt: status === 'delivered' || status === 'rejected' ? new Date().toISOString() : null } : x))
      toast.success('Status atualizado')
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text">Assistência Técnica</h1>
          <p className="mt-1 text-sm text-muted">
            Busque por IMEI pra ver garantia, abra OS e acompanhe o consertinho.
          </p>
        </div>
        <button
          onClick={() => openNewOS()}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          Nova OS
        </button>
      </div>

      {/* Buscar IMEI */}
      <div className="rounded-2xl border bg-card p-5 shadow-sm ring-1 ring-zinc-800/60">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-text">
          <Search className="h-4 w-4 text-blue-500" />
          Buscar por IMEI
        </h2>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={imeiQuery}
              onChange={e => setImeiQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="IMEI ou serial (mínimo 4 caracteres)"
              className="w-full rounded-lg border border-zinc-700/60 px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted/70" />}
          </div>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            Buscar
          </button>
        </div>

        {/* Resultado da busca */}
        {warranty && (
          <div className={`mt-4 rounded-lg border p-4 ${
            warranty.warrantyValid ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'
          }`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {warranty.warrantyValid ? (
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-amber-400" />
                  )}
                  <p className="text-sm font-bold text-text">
                    {warranty.warrantyValid ? 'Garantia VÁLIDA' : (warranty.saleDate ? 'Garantia EXPIRADA' : 'Não vendido por nós')}
                  </p>
                </div>
                <p className="font-mono text-xs text-muted">{warranty.serial}</p>
                <p className="mt-0.5 text-sm font-semibold text-text">{warranty.productName}</p>
                {warranty.saleDate && (
                  <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 text-xs text-muted">
                    <p><Calendar className="inline h-3 w-3 mr-1" />Vendido em {fmtDateOnly(warranty.saleDate)}</p>
                    <p>Garantia até {fmtDateOnly(warranty.warrantyExpiresAt)}</p>
                    {warranty.customerName && (
                      <p><UserIcon className="inline h-3 w-3 mr-1" />{warranty.customerName}</p>
                    )}
                    {warranty.customerWhatsapp && (
                      <p><Phone className="inline h-3 w-3 mr-1" />{warranty.customerWhatsapp}</p>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => openNewOS({
                  deviceDescription: warranty.productName,
                  serialText:        warranty.serial,
                })}
                className="rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-600 whitespace-nowrap"
              >
                Abrir OS
              </button>
            </div>
          </div>
        )}

        {searchTried && !warranty && !searching && (
          <p className="mt-3 text-sm text-muted">
            IMEI não encontrado. Você pode abrir OS mesmo assim clicando em "Nova OS".
          </p>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'open', 'in_progress', 'ready', 'delivered', 'rejected'] as const).map(f => {
          const cfg = f === 'all' ? null : STATUS_CFG[f]
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                filter === f
                  ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                  : 'border-zinc-700/60 bg-card text-muted hover:border-zinc-300'
              }`}
            >
              {f === 'all' ? 'Todas' : cfg!.label}
              <span className="ml-1.5 text-muted/70">{counts[f]}</span>
            </button>
          )
        })}
      </div>

      {/* Lista de OS */}
      <div className="rounded-2xl border bg-card shadow-sm ring-1 ring-zinc-800/60 overflow-hidden">
        {visible.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-muted">
            <Wrench className="mx-auto mb-3 h-8 w-8 text-muted/50" />
            Nenhuma OS {filter !== 'all' ? `com status "${STATUS_CFG[filter].label}"` : ''}.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {visible.map(o => {
              const cfg = STATUS_CFG[o.status]
              const StatusIcon = cfg.icon
              return (
                <li key={o.id} className="px-5 py-4 hover:bg-zinc-800/40 transition">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-text">{o.osNumber}</span>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.bg} ${cfg.color}`}>
                          <StatusIcon className="h-3 w-3" />
                          {cfg.label}
                        </span>
                        {o.warrantyUsed && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                            <ShieldCheck className="h-3 w-3" />
                            Garantia
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-semibold text-text">
                        {o.productName ?? o.deviceDescription ?? 'Aparelho não identificado'}
                      </p>
                      {o.serial && <p className="font-mono text-xs text-muted">{o.serial}</p>}
                      <p className="mt-1 text-sm text-text/90 line-clamp-2">{o.defectDescription}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                        {o.customerName && <span><UserIcon className="inline h-3 w-3 mr-0.5" />{o.customerName}</span>}
                        {o.customerWhatsapp && <span><Phone className="inline h-3 w-3 mr-0.5" />{o.customerWhatsapp}</span>}
                        <span>Aberta {fmtDate(o.openedAt)}</span>
                        {o.estimatedReadyAt && <span>Previsão: {fmtDateOnly(o.estimatedReadyAt)}</span>}
                        {o.technicianName && <span>👨‍🔧 {o.technicianName}</span>}
                        {o.costCents > 0 && <span className="font-semibold text-text/90">{BRL(o.costCents)}</span>}
                      </div>
                    </div>

                    {/* Status quick actions */}
                    <div className="flex flex-wrap gap-1">
                      {o.status === 'open' && (
                        <button onClick={() => changeStatus(o, 'in_progress')} disabled={pending} className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-400 hover:bg-blue-500/150/20">
                          Iniciar
                        </button>
                      )}
                      {o.status === 'in_progress' && (
                        <button onClick={() => changeStatus(o, 'ready')} disabled={pending} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/150/20">
                          Pronto
                        </button>
                      )}
                      {o.status === 'ready' && (
                        <button onClick={() => changeStatus(o, 'delivered')} disabled={pending} className="rounded-lg border border-zinc-700/60 bg-zinc-800/40 px-2.5 py-1 text-[11px] font-medium text-text/90 hover:bg-zinc-800/60">
                          Entregar
                        </button>
                      )}
                      {(o.status === 'open' || o.status === 'in_progress') && (
                        <button onClick={() => changeStatus(o, 'rejected')} disabled={pending} className="rounded-lg border border-rose-500/30 bg-card px-2.5 py-1 text-[11px] font-medium text-rose-400 hover:bg-rose-500/150/10">
                          Rejeitar
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Modal Nova OS */}
      {newOSOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
          onClick={e => { if (e.target === e.currentTarget) setNewOSOpen(false) }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-700/60 px-5 py-3">
              <h3 className="text-base font-semibold text-text">Nova Ordem de Serviço</h3>
              <button onClick={() => setNewOSOpen(false)} className="rounded-lg p-1 text-muted hover:bg-zinc-800/60">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {warranty && (
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs">
                  <p className="font-semibold text-blue-900">Vinculado à venda</p>
                  <p className="text-blue-400">{warranty.productName} • {warranty.serial}</p>
                  {warranty.customerName && <p className="text-blue-400">{warranty.customerName}</p>}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text/90">Aparelho</label>
                  <input
                    value={newOS.deviceDescription}
                    onChange={e => setNewOS(s => ({ ...s, deviceDescription: e.target.value }))}
                    placeholder="iPhone 12 64GB"
                    className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text/90">IMEI / Serial</label>
                  <input
                    value={newOS.serialText}
                    onChange={e => setNewOS(s => ({ ...s, serialText: e.target.value }))}
                    placeholder="opcional"
                    className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-text/90">Defeito relatado *</label>
                <textarea
                  value={newOS.defectDescription}
                  onChange={e => setNewOS(s => ({ ...s, defectDescription: e.target.value }))}
                  rows={3}
                  placeholder="Ex: Tela quebrada, não carrega, áudio com chiado…"
                  className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text/90">Técnico</label>
                  <input
                    value={newOS.technicianName}
                    onChange={e => setNewOS(s => ({ ...s, technicianName: e.target.value }))}
                    placeholder="Nome"
                    className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text/90">Previsão de entrega</label>
                  <input
                    type="date"
                    value={newOS.estimatedReadyAt}
                    onChange={e => setNewOS(s => ({ ...s, estimatedReadyAt: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text/90">Valor cobrado (R$)</label>
                  <input
                    value={newOS.costStr}
                    onChange={e => setNewOS(s => ({ ...s, costStr: e.target.value }))}
                    placeholder="0,00"
                    className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text/90">Custo interno (R$)</label>
                  <input
                    value={newOS.serviceCostStr}
                    onChange={e => setNewOS(s => ({ ...s, serviceCostStr: e.target.value }))}
                    placeholder="0,00"
                    className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newOS.warrantyUsed}
                  onChange={e => setNewOS(s => ({ ...s, warrantyUsed: e.target.checked }))}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-text/90">
                  Conserto em garantia <span className="text-muted/70">(sem cobrança)</span>
                </span>
              </label>

              <div>
                <label className="mb-1 block text-xs font-medium text-text/90">Observações</label>
                <input
                  value={newOS.notes}
                  onChange={e => setNewOS(s => ({ ...s, notes: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700/60 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-800/60 px-5 py-3">
              <button
                onClick={() => setNewOSOpen(false)}
                disabled={pending}
                className="rounded-lg border border-zinc-700/60 px-4 py-2 text-sm font-medium text-text/90 hover:bg-zinc-800/40"
              >
                Cancelar
              </button>
              <button
                onClick={submitNewOS}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Criar OS
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
