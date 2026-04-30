'use client'

/**
 * StockPopover — tooltip de estoque detalhado ativado por hover.
 *
 * Estratégia de dados:
 *  - Dados de depósito derivados do product.location já disponível na linha.
 *  - Totais de entrada/saída carregados sob demanda na 1ª abertura via getStockSummary().
 *  - Resultado cacheado em useRef: re-abertura não dispara nova requisição.
 *  - position: fixed para escapar do overflow:hidden da tabela sem interferir no layout.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Loader2, Warehouse, TrendingUp, TrendingDown,
  Package, AlertTriangle, Ban,
} from 'lucide-react'
import { getStockSummary, type StockSummary } from '@/actions/stock-movements'
import type { ProductRow } from '@/actions/products'

// ── Constants ─────────────────────────────────────────────────────────────────

const POPOVER_W  = 264
const POPOVER_H  = 248
const HOVER_OPEN_DELAY  = 160  // ms antes de abrir
const HOVER_CLOSE_DELAY = 100  // ms de graça antes de fechar

// ── Helpers ───────────────────────────────────────────────────────────────────

function stockColor(qty: number, min: number): string | undefined {
  if (qty <= 0)              return '#EF4444'
  if (min > 0 && qty <= min) return '#F59E0B'
  return undefined
}

function availableColor(avail: number, min: number): string {
  if (avail <= 0)              return '#EF4444'
  if (min > 0 && avail <= min) return '#F59E0B'
  return '#10B981'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({
  label, value, accent, dim,
}: { label: string; value: string; accent?: string; dim?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: '#94A3B8' }}>{label}</span>
      <span
        className="text-xs font-semibold tabular-nums"
        style={{ color: accent ?? (dim ? '#CBD5E1' : '#3A4868') }}
      >
        {value}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="my-2 border-t" style={{ borderColor: '#2A3650' }} />
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between animate-pulse">
      <div className="h-2.5 rounded-full" style={{ background: '#2A3650', width: '45%' }} />
      <div className="h-2.5 rounded-full" style={{ background: '#2A3650', width: '25%' }} />
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export function StockPopover({ product: p }: { product: ProductRow }) {
  const [open, setOpen]           = useState(false)
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [summary, setSummary]     = useState<StockSummary | null>(null)
  const [pos, setPos]             = useState({ top: 0, left: 0, placement: 'bottom' as 'bottom' | 'top' })

  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cachedRef  = useRef(false)

  // Calcula posição ideal do popover relativa à viewport
  function computePos() {
    if (!triggerRef.current) return
    const r         = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    const placement  = spaceBelow >= POPOVER_H + 10 ? 'bottom' : 'top'
    const top        = placement === 'bottom'
      ? r.bottom + 8
      : r.top - POPOVER_H - 8
    // Centraliza horizontalmente sob o trigger, mas mantém dentro da viewport
    let left = r.left + r.width / 2 - POPOVER_W / 2
    left     = Math.max(8, Math.min(left, window.innerWidth - POPOVER_W - 8))
    setPos({ top, left, placement })
  }

  const doOpen = useCallback(() => {
    computePos()
    setOpen(true)
    if (!cachedRef.current) {
      setLoadState('loading')
      getStockSummary(p.id)
        .then(data => {
          setSummary(data)
          setLoadState('ready')
          cachedRef.current = true
        })
        .catch(() => setLoadState('error'))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id])

  const doClose = useCallback(() => setOpen(false), [])

  function onEnter() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(doOpen, HOVER_OPEN_DELAY)
  }
  function onLeave() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(doClose, HOVER_CLOSE_DELAY)
  }

  // Limpa timer ao desmontar para não causar setState em componente desmontado
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // ── Dados derivados ───────────────────────────────────────────────────────

  const depot     = p.location?.trim() || 'Depósito Padrão'
  const reserved  = 0                           // sistema de reserva não implementado
  const available = Math.max(0, p.stock_qty - reserved)
  const color     = stockColor(p.stock_qty, p.stock_min)
  const animation = pos.placement === 'bottom' ? 'stockPopIn 0.14s ease-out' : 'stockPopInUp 0.14s ease-out'

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Trigger ─────────────────────────────────────────────────────── */}
      <div
        ref={triggerRef}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="flex items-center justify-end gap-1 w-full cursor-default select-none group"
      >
        {color && (
          <span title={p.stock_qty <= 0 ? 'Sem estoque' : `Abaixo do mínimo (${p.stock_min})`}>
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color }} />
          </span>
        )}
        <span className="text-sm font-bold" style={color ? { color } : {}}>
          {p.stock_qty}
        </span>
        <span className="text-xs" style={{ color: '#94A3B8' }}>{p.unit}</span>
        {/* Indicador de interatividade */}
        <span
          className="text-[10px] transition-opacity duration-100"
          style={{ color: '#94A3B8', opacity: 0 }}
          aria-hidden
          ref={el => {
            // Usa o grupo para mostrar via CSS sem re-render
            if (el) el.style.opacity = '0'
          }}
        >▾</span>
      </div>

      {/* ── Popover (position:fixed, escapa overflow:hidden da tabela) ──── */}
      {open && (
        <div
          className="fixed z-[60] rounded-xl border shadow-2xl"
          style={{
            top:         pos.top,
            left:        pos.left,
            width:       POPOVER_W,
            background:  '#0A1628',
            borderColor: '#2A3650',
            animation,
          }}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          {/* Cabeçalho */}
          <div
            className="flex items-center gap-2 px-3.5 py-2.5 border-b"
            style={{ borderColor: '#2A3650' }}
          >
            <Warehouse className="h-3.5 w-3.5 shrink-0" style={{ color: '#10B981' }} />
            <span className="text-xs font-semibold" style={{ color: '#1B2638' }}>
              Estoque Detalhado
            </span>
          </div>

          {/* Corpo */}
          <div className="px-3.5 py-3 space-y-2">

            {/* Depósito */}
            <div className="flex items-center gap-1.5 mb-1">
              <Package className="h-3 w-3 shrink-0" style={{ color: '#CBD5E1' }} />
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#CBD5E1' }}>
                {depot}
              </span>
            </div>

            <Row label="Saldo Atual"  value={`${p.stock_qty} ${p.unit}`}  accent={color} />
            <Row label="Reservado"    value={`${reserved} ${p.unit}`}     dim />
            <Row label="Mínimo"       value={p.stock_min > 0 ? `${p.stock_min} ${p.unit}` : '—'} dim />
            <Row label="Máximo"       value={p.stock_max > 0 ? `${p.stock_max} ${p.unit}` : '—'} dim />

            <Divider />

            {/* Movimentações — carregado sob demanda */}
            {loadState === 'loading' && (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}

            {loadState === 'error' && (
              <div className="flex items-center gap-1.5 text-xs py-1" style={{ color: '#94A3B8' }}>
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Erro ao carregar movimentações
              </div>
            )}

            {loadState === 'ready' && summary && (
              <>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: '#94A3B8' }}>
                    <TrendingDown className="h-3 w-3 shrink-0" style={{ color: '#10B981' }} />
                    Total entradas
                  </span>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: '#3A4868' }}>
                    {summary.total_entrada} {p.unit}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: '#94A3B8' }}>
                    <TrendingUp className="h-3 w-3 shrink-0" style={{ color: '#EF4444' }} />
                    Total saídas
                  </span>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: '#3A4868' }}>
                    {summary.total_saida} {p.unit}
                  </span>
                </div>
              </>
            )}

            {loadState === 'idle' && (
              <div className="flex items-center justify-center gap-1.5 py-1">
                <Loader2 className="h-3 w-3 animate-spin" style={{ color: '#CBD5E1' }} />
                <span className="text-xs" style={{ color: '#CBD5E1' }}>carregando…</span>
              </div>
            )}
          </div>

          {/* Rodapé — Saldo Disponível */}
          <div
            className="flex items-center justify-between px-3.5 py-2.5 border-t rounded-b-xl"
            style={{ borderColor: '#2A3650', background: 'rgba(255,255,255,0.03)' }}
          >
            <span className="text-xs font-semibold" style={{ color: '#94A3B8' }}>
              Saldo Disponível
            </span>
            <div className="flex items-center gap-1.5">
              {available <= 0 && <Ban className="h-3 w-3" style={{ color: '#EF4444' }} />}
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: availableColor(available, p.stock_min) }}
              >
                {available} {p.unit}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
