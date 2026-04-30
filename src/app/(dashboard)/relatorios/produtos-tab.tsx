'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Package, ChevronDown, ChevronUp } from 'lucide-react'
import type { ProductReportRow } from '@/actions/relatorios'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

type SortKey = 'quantity' | 'revenue' | 'profit' | 'margin'

type Props = {
  data:     ProductReportRow[]
  category: string
  buildUrl: (changes: Record<string, string | undefined>) => string
}

export function ProdutosTab({ data, category, buildUrl }: Props) {
  const router = useRouter()
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    const arr = [...data]
    arr.sort((a, b) => {
      let av: number, bv: number
      switch (sortKey) {
        case 'quantity': av = a.quantitySold;  bv = b.quantitySold;  break
        case 'revenue':  av = a.revenueCents;  bv = b.revenueCents;  break
        case 'profit':   av = a.profitCents;   bv = b.profitCents;   break
        case 'margin':   av = a.marginPercent; bv = b.marginPercent; break
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return arr
  }, [data, sortKey, sortDir])

  const totals = useMemo(() => ({
    qty:     data.reduce((s, r) => s + r.quantitySold, 0),
    revenue: data.reduce((s, r) => s + r.revenueCents, 0),
    cost:    data.reduce((s, r) => s + r.costCents, 0),
    profit:  data.reduce((s, r) => s + r.profitCents, 0),
  }), [data])

  // Categorias únicas pra dropdown
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of data) if (r.category) set.add(r.category)
    return Array.from(set).sort()
  }, [data])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function exportCsv() {
    const BOM = '﻿'
    const header = 'Produto;Categoria;Qtd Vendida;Faturamento;Custo;Lucro;Margem %;Vendas\n'
    const lines = sorted.map(r => {
      const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
      return [
        cell(r.productName),
        cell(r.category ?? '—'),
        String(r.quantitySold),
        (r.revenueCents / 100).toFixed(2).replace('.', ','),
        (r.costCents    / 100).toFixed(2).replace('.', ','),
        (r.profitCents  / 100).toFixed(2).replace('.', ','),
        String(r.marginPercent),
        String(r.salesCount),
      ].join(';')
    }).join('\n')

    const blob = new Blob([BOM + header + lines], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `produtos-detalhado-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Filtro de categoria */}
      <div className="rounded-xl border p-4 flex items-end gap-3"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <div className="flex-1 max-w-xs">
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#94A3B8' }}>
            Categoria
          </label>
          <select value={category}
            onChange={e => router.push(buildUrl({ category: e.target.value === 'all' ? undefined : e.target.value }))}
            className="w-full rounded-lg border px-3 py-2 text-xs outline-none focus:border-accent/60"
            style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }}>
            <option value="all">Todas as categorias</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {data.length > 0 && (
          <button onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition-colors hover:bg-white/5"
            style={{ borderColor: '#2A3650', color: '#22C55E' }}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Produtos vendidos" value={String(data.length)} color="#F59E0B" />
        <KPI label="Unidades" value={String(totals.qty)} color="#22C55E" />
        <KPI label="Faturamento" value={BRL(totals.revenue)} color="#10B981" />
        <KPI label="Lucro total" value={BRL(totals.profit)} color="#22C55E" />
      </div>

      {/* Tabela */}
      <div className="rounded-xl border overflow-hidden"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <div className="border-b px-4 py-3" style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
            Ranking de produtos · clique na coluna pra ordenar
          </p>
        </div>

        {sorted.length === 0 ? (
          <div className="py-16 text-center">
            <Package className="mx-auto h-8 w-8 mb-3" style={{ color: '#64748B' }} />
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              Nenhuma venda de produto no período.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: '#1B2638' }}>
                <tr>
                  <Th>#</Th>
                  <Th>Produto</Th>
                  <Th>Categoria</Th>
                  <SortableTh active={sortKey === 'quantity'} dir={sortDir} align="right"
                    onClick={() => toggleSort('quantity')}>
                    Qtd
                  </SortableTh>
                  <SortableTh active={sortKey === 'revenue'} dir={sortDir} align="right"
                    onClick={() => toggleSort('revenue')}>
                    Faturado
                  </SortableTh>
                  <Th align="right">Custo</Th>
                  <SortableTh active={sortKey === 'profit'} dir={sortDir} align="right"
                    onClick={() => toggleSort('profit')}>
                    Lucro
                  </SortableTh>
                  <SortableTh active={sortKey === 'margin'} dir={sortDir} align="right"
                    onClick={() => toggleSort('margin')}>
                    Margem
                  </SortableTh>
                  <Th align="right">Vendas</Th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => (
                  <tr key={r.productId ?? `m-${idx}`}
                    className="border-t hover:bg-white/[0.02] transition-colors"
                    style={{ borderColor: '#2A3650' }}>
                    <Td color="#94A3B8">{idx + 1}</Td>
                    <Td bold>{r.productName}</Td>
                    <Td color="#CBD5E1">{r.category ?? '—'}</Td>
                    <Td align="right" mono>{r.quantitySold}</Td>
                    <Td align="right" mono color="#10B981">{BRL(r.revenueCents)}</Td>
                    <Td align="right" mono color="#94A3B8">{BRL(r.costCents)}</Td>
                    <Td align="right" mono color={r.profitCents > 0 ? '#22C55E' : '#EF4444'}>
                      {BRL(r.profitCents)}
                    </Td>
                    <Td align="right" mono
                      color={r.marginPercent >= 30 ? '#10B981' : r.marginPercent >= 10 ? '#F59E0B' : '#EA580C'}
                      bold>
                      {r.marginPercent}%
                    </Td>
                    <Td align="right" color="#94A3B8">{r.salesCount}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot style={{ background: '#1B2638' }}>
                <tr>
                  <Td colSpan={3}><span className="font-bold uppercase text-[10px] tracking-wider"
                    style={{ color: '#94A3B8' }}>Totais</span></Td>
                  <Td align="right" mono bold>{totals.qty}</Td>
                  <Td align="right" mono bold color="#10B981">{BRL(totals.revenue)}</Td>
                  <Td align="right" mono bold color="#94A3B8">{BRL(totals.cost)}</Td>
                  <Td align="right" mono bold color="#22C55E">{BRL(totals.profit)}</Td>
                  <Td align="right" mono bold color={totals.revenue > 0 && totals.profit / totals.revenue >= 0.3 ? '#10B981' : '#F59E0B'}>
                    {totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) : 0}%
                  </Td>
                  <Td>—</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border p-4"
      style={{ background: '#131C2A', borderColor: '#2A3650' }}>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#94A3B8' }}>
        {label}
      </p>
      <p className="text-lg font-bold font-mono" style={{ color }}>{value}</p>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: '#94A3B8' }}>
      {children}
    </th>
  )
}

function SortableTh({ children, active, dir, align = 'left', onClick }: {
  children: React.ReactNode
  active: boolean
  dir: 'asc' | 'desc'
  align?: 'left' | 'right'
  onClick: () => void
}) {
  return (
    <th onClick={onClick}
      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer hover:bg-white/5 ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: active ? '#22C55E' : '#94A3B8' }}>
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end w-full' : ''}`}>
        {children}
        {active && (dir === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
      </span>
    </th>
  )
}

function Td({ children, align = 'left', mono, bold, color, colSpan }: {
  children: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean; bold?: boolean
  color?: string; colSpan?: number
}) {
  return (
    <td colSpan={colSpan}
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : ''}`}
      style={{ color: color ?? '#F8FAFC' }}>
      {children}
    </td>
  )
}
