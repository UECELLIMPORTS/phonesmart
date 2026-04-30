'use client'

import { useRouter } from 'next/navigation'
import { Download, ShoppingCart, DollarSign, TrendingUp, Receipt } from 'lucide-react'
import type { SalesReportData } from '@/actions/relatorios'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

const PAYMENT_LABEL: Record<string, string> = {
  pix:      'PIX',
  dinheiro: 'Dinheiro',
  cash:     'Dinheiro',
  credito:  'Crédito',
  credit:   'Crédito',
  debito:   'Débito',
  debit:    'Débito',
  outros:   'Outros',
}

const STATUS_LABEL: Record<string, string> = {
  completed:  'Concluída',
  cancelled:  'Cancelada',
  pending:    'Pendente',
}

const STATUS_COLOR: Record<string, string> = {
  completed: '#10B981',
  cancelled: '#EF4444',
  pending:   '#F59E0B',
}

type Props = {
  data:           SalesReportData
  paymentMethod:  string
  status:         'all' | 'completed' | 'cancelled'
  channel:        string
  buildUrl:       (changes: Record<string, string | undefined>) => string
}

export function VendasTab({ data, paymentMethod, status, channel, buildUrl }: Props) {
  const router = useRouter()

  function exportCsv() {
    const BOM = '﻿'
    const header = 'Data;Cliente;Vendedor;Canal;Pagamento;Status;Itens;Subtotal;Desconto;Frete;Total;Lucro\n'
    const lines = data.rows.map(r => {
      const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
      return [
        cell(fmtDate(r.createdAt)),
        cell(r.customerName ?? '—'),
        cell(r.sellerEmail ?? '—'),
        cell(r.saleChannel ?? '—'),
        cell(PAYMENT_LABEL[r.paymentMethod ?? ''] ?? r.paymentMethod ?? '—'),
        cell(STATUS_LABEL[r.status] ?? r.status),
        String(r.itemsCount),
        (r.subtotalCents / 100).toFixed(2).replace('.', ','),
        (r.discountCents / 100).toFixed(2).replace('.', ','),
        (r.shippingCents / 100).toFixed(2).replace('.', ','),
        (r.totalCents    / 100).toFixed(2).replace('.', ','),
        (r.profitCents   / 100).toFixed(2).replace('.', ','),
      ].join(';')
    }).join('\n')

    const blob = new Blob([BOM + header + lines], { type: 'text/csv;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `vendas-detalhado-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function setFilter(key: string, value: string) {
    router.push(buildUrl({ [key]: value === 'all' ? undefined : value }))
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Vendas" value={String(data.totalCount)} icon={ShoppingCart} color="#F59E0B" />
        <KPI label="Faturado" value={BRL(data.totalRevenueCents)} icon={DollarSign} color="#10B981" />
        <KPI label="Lucro" value={BRL(data.totalProfitCents)} icon={TrendingUp} color="#22C55E" />
        <KPI label="Ticket médio" value={BRL(data.avgTicketCents)} icon={Receipt} color="#CBD5E1" />
      </div>

      {/* Filtros */}
      <div className="rounded-xl border p-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <FilterSelect label="Forma de pagamento" value={paymentMethod}
          options={[
            { v: 'all',      label: 'Todas' },
            { v: 'pix',      label: 'PIX' },
            { v: 'dinheiro', label: 'Dinheiro' },
            { v: 'credito',  label: 'Crédito' },
            { v: 'debito',   label: 'Débito' },
            { v: 'outros',   label: 'Outros' },
          ]}
          onChange={v => setFilter('payment', v)} />
        <FilterSelect label="Canal de venda" value={channel}
          options={[
            { v: 'all',         label: 'Todos' },
            { v: 'instagram',   label: 'Instagram' },
            { v: 'whatsapp',    label: 'WhatsApp' },
            { v: 'loja_fisica', label: 'Loja física' },
            { v: 'site',        label: 'Site' },
            { v: 'mercado_livre', label: 'Mercado Livre' },
          ]}
          onChange={v => setFilter('channel', v)} />
        <FilterSelect label="Status" value={status}
          options={[
            { v: 'completed', label: 'Concluídas' },
            { v: 'cancelled', label: 'Canceladas' },
            { v: 'all',       label: 'Todas' },
          ]}
          onChange={v => setFilter('status', v)} />
      </div>

      {/* Tabela */}
      <div className="rounded-xl border overflow-hidden"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <div className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
            {data.totalCount} {data.totalCount === 1 ? 'venda' : 'vendas'} no período
          </p>
          {data.rows.length > 0 && (
            <button onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
              style={{ borderColor: '#2A3650', color: '#22C55E' }}>
              <Download className="h-3 w-3" />
              CSV
            </button>
          )}
        </div>

        {data.rows.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              Nenhuma venda encontrada com esses filtros.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: '#1B2638' }}>
                <tr>
                  <Th>Data</Th>
                  <Th>Cliente</Th>
                  <Th>Vendedor</Th>
                  <Th>Canal</Th>
                  <Th>Pagamento</Th>
                  <Th>Status</Th>
                  <Th align="right">Itens</Th>
                  <Th align="right">Total</Th>
                  <Th align="right">Lucro</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.id} className="border-t hover:bg-white/[0.02] transition-colors"
                    style={{ borderColor: '#2A3650' }}>
                    <Td>{fmtDate(r.createdAt)}</Td>
                    <Td>{r.customerName ?? <span className="italic" style={{ color: '#94A3B8' }}>—</span>}</Td>
                    <Td>
                      <span className="font-mono text-[10px]" style={{ color: '#CBD5E1' }}>
                        {r.sellerEmail?.split('@')[0] ?? '—'}
                      </span>
                    </Td>
                    <Td>{r.saleChannel ?? '—'}</Td>
                    <Td>{PAYMENT_LABEL[r.paymentMethod ?? ''] ?? r.paymentMethod ?? '—'}</Td>
                    <Td>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          background: `${STATUS_COLOR[r.status] ?? '#94A3B8'}18`,
                          color: STATUS_COLOR[r.status] ?? '#94A3B8',
                        }}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </Td>
                    <Td align="right">{r.itemsCount}</Td>
                    <Td align="right" mono color="#F8FAFC" bold>{BRL(r.totalCents)}</Td>
                    <Td align="right" mono
                      color={r.profitCents > 0 ? '#10B981' : r.profitCents < 0 ? '#EF4444' : '#94A3B8'}>
                      {BRL(r.profitCents)}
                    </Td>
                  </tr>
                ))}
              </tbody>
              {/* Totais */}
              <tfoot style={{ background: '#1B2638' }}>
                <tr>
                  <Td colSpan={6}><span className="font-bold uppercase text-[10px] tracking-wider"
                    style={{ color: '#94A3B8' }}>Totais (excl. canceladas)</span></Td>
                  <Td align="right" bold>{data.rows.filter(r => r.status !== 'cancelled').reduce((s, r) => s + r.itemsCount, 0)}</Td>
                  <Td align="right" mono bold color="#10B981">{BRL(data.totalRevenueCents)}</Td>
                  <Td align="right" mono bold color="#22C55E">{BRL(data.totalProfitCents)}</Td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function FilterSelect({ label, value, options, onChange }: {
  label: string; value: string
  options: { v: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#94A3B8' }}>
        {label}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-xs outline-none transition-colors focus:border-accent/60"
        style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }}>
        {options.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </div>
  )
}

function KPI({ label, value, icon: Icon, color }: {
  label: string; value: string; icon: React.ElementType; color: string
}) {
  return (
    <div className="rounded-xl border p-4"
      style={{ background: '#131C2A', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className="h-3 w-3" style={{ color }} />
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
          {label}
        </p>
      </div>
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

function Td({ children, align = 'left', mono, bold, color, colSpan }: {
  children: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean; bold?: boolean
  color?: string
  colSpan?: number
}) {
  return (
    <td colSpan={colSpan}
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : ''}`}
      style={{ color: color ?? '#F8FAFC' }}>
      {children}
    </td>
  )
}
