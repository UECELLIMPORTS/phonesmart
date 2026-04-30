'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart2, Download, Megaphone, TrendingUp, Users, Phone, MessageCircle,
  ShoppingCart, Package,
} from 'lucide-react'
import type { RelatoriosData, OriginReportRow, TopClientRow, Tab } from './page'
import { CUSTOMER_ORIGIN_OPTIONS, originLabel } from '@/lib/customer-origin'
import { SALE_CHANNEL_OPTIONS_PICKABLE, channelLabel } from '@/lib/sale-channels'
import { VendasTab } from './vendas-tab'
import { ProdutosTab } from './produtos-tab'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const ORIGIN_COLORS: Record<string, string> = {
  instagram_pago:     '#E4405F',
  instagram_organico: '#C13584',
  indicacao:          '#10B981',
  passou_na_porta:    '#F59E0B',
  google:             '#4285F4',
  facebook:           '#1877F2',
  outros:             '#8B5CF6',
}

function stripDigits(s: string | null): string {
  return (s ?? '').replace(/\D/g, '')
}
function fmtPhone(s: string | null): string {
  const d = stripDigits(s)
  if (!d) return ''
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return s ?? ''
}

export function RelatoriosClient({ data }: { data: RelatoriosData }) {
  const router = useRouter()
  const { tab, period, source, origin, channel, resumo, origins, topClients, from, to } = data

  const [customOpen, setCustomOpen] = useState(period === 'custom')
  const [fromDate, setFromDate]     = useState(from ?? '')
  const [toDate, setToDate]         = useState(to ?? '')

  function buildUrl(changes: Record<string, string | undefined>): string {
    const p = new URLSearchParams()
    const merged: Record<string, string | undefined> = {
      tab, period, source, origin, channel,
      payment: data.paymentMethod, status: data.status, category: data.category,
      ...changes,
    }
    if (merged.tab && merged.tab !== 'geral') p.set('tab', merged.tab)
    if (merged.period)   p.set('period',  merged.period)
    if (merged.source && merged.source !== 'total')   p.set('source',  merged.source)
    if (merged.origin && merged.origin !== 'all')     p.set('origin',  merged.origin)
    if (merged.channel && merged.channel !== 'all')   p.set('channel', merged.channel)
    if (merged.payment && merged.payment !== 'all')   p.set('payment', merged.payment)
    if (merged.status && merged.status !== 'completed') p.set('status', merged.status)
    if (merged.category && merged.category !== 'all') p.set('category', merged.category)
    if (merged.period === 'custom' && fromDate && toDate) {
      p.set('from', fromDate)
      p.set('to', toDate)
    }
    return `/relatorios?${p.toString()}`
  }

  function updateQuery(changes: Record<string, string | undefined>) {
    router.push(buildUrl(changes))
  }

  function applyCustom() {
    if (!fromDate || !toDate) return
    const p = new URLSearchParams()
    p.set('period', 'custom')
    p.set('from', fromDate)
    p.set('to', toDate)
    p.set('source', source)
    p.set('origin', origin)
    p.set('channel', channel)
    router.push(`/relatorios?${p.toString()}`)
  }

  const PERIODS: { v: 'total' | 'phonesmart' | 'checksmart'; label: string; color: string }[] = [
    { v: 'total',      label: 'Ambos',      color: '#22C55E' },
    { v: 'phonesmart',   label: 'PhoneSmart',   color: '#10B981' },
    { v: 'checksmart', label: 'CheckSmart', color: '#8B5CF6' },
  ]

  const periodOptions: { v: RelatoriosData['period']; label: string }[] = [
    { v: '7d',  label: '7d' },
    { v: '30d', label: '30d' },
    { v: '90d', label: '90d' },
    { v: '6m',  label: '6m' },
  ]

  function exportOriginsCsv() {
    const BOM = '﻿'
    const header = 'Origem;Qtd Clientes;Transações;Ticket Médio;Total Faturado;Total Lucro;Margem %\n'
    const lines = origins.map(o => {
      const ticket = (o.ticketMedioCents / 100).toFixed(2).replace('.', ',')
      const total  = (o.totalCents  / 100).toFixed(2).replace('.', ',')
      const profit = (o.profitCents / 100).toFixed(2).replace('.', ',')
      const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
      return [
        cell(o.label),
        o.uniqueCustomers,
        o.transactions,
        `"R$ ${ticket}"`,
        `"R$ ${total}"`,
        `"R$ ${profit}"`,
        `${o.marginPercent}%`,
      ].join(';')
    }).join('\n')

    const blob = new Blob([BOM + header + lines], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `relatorio-origens-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const TABS: { v: Tab; label: string; icon: React.ElementType }[] = [
    { v: 'geral',    label: 'Visão geral', icon: BarChart2 },
    { v: 'vendas',   label: 'Vendas',      icon: ShoppingCart },
    { v: 'produtos', label: 'Produtos',    icon: Package },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>Relatórios</h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            {tab === 'geral'    && 'Análise consolidada por origem dos clientes'}
            {tab === 'vendas'   && 'Tabela detalhada de cada venda com filtros e export'}
            {tab === 'produtos' && 'Ranking de produtos: faturamento, lucro e margem'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 rounded-xl p-1" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
            {periodOptions.map(p => (
              <button
                key={p.v}
                onClick={() => { setCustomOpen(false); updateQuery({ period: p.v }) }}
                className="rounded-lg px-4 py-1.5 text-xs font-bold transition-all"
                style={period === p.v
                  ? { background: '#22C55E', color: '#000' }
                  : { color: '#94A3B8' }
                }
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setCustomOpen(v => !v)}
              className="rounded-lg px-4 py-1.5 text-xs font-bold transition-all"
              style={period === 'custom' || customOpen
                ? { background: '#22C55E', color: '#000' }
                : { color: '#94A3B8' }
              }
            >
              Datas
            </button>
          </div>
          {customOpen && (
            <div className="flex items-center gap-2 rounded-xl p-2" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                className="rounded-lg border px-2 py-1 text-xs text-text outline-none"
                style={{ background: '#131C2A', borderColor: '#2A3650' }} />
              <span className="text-xs" style={{ color: '#94A3B8' }}>até</span>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
                className="rounded-lg border px-2 py-1 text-xs text-text outline-none"
                style={{ background: '#131C2A', borderColor: '#2A3650' }} />
              <button onClick={applyCustom} disabled={!fromDate || !toDate}
                className="rounded-lg px-3 py-1 text-xs font-bold transition-opacity disabled:opacity-50"
                style={{ background: '#10B981', color: '#000' }}>
                Aplicar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl p-1 w-fit"
        style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.v
          return (
            <button key={t.v}
              onClick={() => updateQuery({ tab: t.v })}
              className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all inline-flex items-center gap-1.5"
              style={active
                ? { background: '#22C55E', color: '#000' }
                : { color: '#94A3B8' }
              }>
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Conteúdo das abas Vendas/Produtos */}
      {tab === 'vendas' && data.salesReport && (
        <VendasTab
          data={data.salesReport}
          paymentMethod={data.paymentMethod}
          status={data.status}
          channel={data.channel}
          buildUrl={buildUrl}
        />
      )}
      {tab === 'produtos' && data.productsReport && (
        <ProdutosTab
          data={data.productsReport}
          category={data.category}
          buildUrl={buildUrl}
        />
      )}

      {/* Conteúdo da aba Geral */}
      {tab === 'geral' && (
      <>
      <div className="flex flex-wrap items-center gap-3">
        {/* Sistema */}
        <div className="flex gap-1 rounded-lg p-1" style={{ background: '#131C2A', border: '1px solid #2A3650' }}>
          {PERIODS.map(p => (
            <button
              key={p.v}
              onClick={() => updateQuery({ source: p.v })}
              className="rounded px-3 py-1 text-[11px] font-bold transition-all"
              style={source === p.v ? { background: p.color, color: '#000' } : { color: '#94A3B8' }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Filtro de Origem */}
        <select
          value={origin}
          onChange={e => updateQuery({ origin: e.target.value })}
          className="rounded-lg border px-3 py-1.5 text-xs outline-none"
          style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
        >
          <option value="all">Todas as origens</option>
          {CUSTOMER_ORIGIN_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
          <option value="__no_origin__">Sem origem informada</option>
        </select>

        {/* Filtro de Canal de Venda */}
        <select
          value={channel}
          onChange={e => updateQuery({ channel: e.target.value })}
          className="rounded-lg border px-3 py-1.5 text-xs outline-none"
          style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
        >
          <option value="all">Todos os canais</option>
          {SALE_CHANNEL_OPTIONS_PICKABLE.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
          <option value="__no_channel__">Sem canal informado</option>
        </select>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label="Faturamento" value={BRL(resumo.totalCents)} color="#22C55E" icon={TrendingUp} />
        <SummaryCard label="Lucro bruto" value={BRL(resumo.profitCents)} sub={`margem ${resumo.marginPercent}%`} color="#10B981" icon={BarChart2} />
        <SummaryCard label="Transações" value={String(resumo.transactions)} color="#F8FAFC" icon={BarChart2} />
        <SummaryCard label="Clientes únicos" value={String(resumo.uniqueCustomers)} color="#8B5CF6" icon={Users} />
      </div>

      {/* Lucro Líquido — bruto − custo fixo − gastos variáveis */}
      <div className="rounded-2xl border p-5"
        style={{ background: 'linear-gradient(135deg, rgba(16,185,129,.08), rgba(6,182,212,.06))', borderColor: '#10B98140' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BarChart2 className="h-4 w-4" style={{ color: '#10B981' }} />
              <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: '#10B981' }}>Lucro Líquido do período</h3>
            </div>
            <p className="text-xs text-muted">Lucro bruto − custos fixos pro-rata − gastos variáveis registrados em /gastos</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold" style={{ color: resumo.netProfitCents >= 0 ? '#10B981' : '#EF4444' }}>
              {BRL(resumo.netProfitCents)}
            </p>
            <p className="text-xs text-muted">margem líquida {resumo.netMarginPercent}%</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg p-3" style={{ background: '#0F172A' }}>
            <p className="uppercase tracking-wider text-[10px] text-muted">Lucro bruto</p>
            <p className="mt-1 font-bold" style={{ color: '#10B981' }}>+ {BRL(resumo.profitCents)}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: '#0F172A' }}>
            <p className="uppercase tracking-wider text-[10px] text-muted">Custo fixo (pro-rata)</p>
            <p className="mt-1 font-bold" style={{ color: '#F59E0B' }}>− {BRL(resumo.fixedCostCents)}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: '#0F172A' }}>
            <p className="uppercase tracking-wider text-[10px] text-muted">Gastos variáveis</p>
            <p className="mt-1 font-bold" style={{ color: '#EF4444' }}>− {BRL(resumo.variableCostCents)}</p>
          </div>
        </div>
      </div>

      {/* Relatório por Origem */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2">
            <div className="h-4 w-1 rounded-full" style={{ background: '#E4405F' }} />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>Relatório por Origem</p>
              <p className="text-[11px]" style={{ color: '#94A3B8' }}>Métricas completas por canal de aquisição</p>
            </div>
          </div>
          <button
            onClick={exportOriginsCsv}
            disabled={origins.length === 0}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: '#2A3650', color: '#10B981' }}
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </button>
        </div>
        <div className="p-6 overflow-x-auto">
          {origins.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: '#94A3B8' }}>
              Sem dados no período e filtros selecionados
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
                  {['Origem', 'Clientes', 'Transações', 'Ticket Médio', 'Faturamento', 'Lucro', 'Margem'].map(h => (
                    <th key={h} className="pb-3 pr-4 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {origins.map((row, i) => <OriginRow key={i} row={row} />)}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Top 10 Clientes */}
      <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <div className="h-4 w-1 rounded-full" style={{ background: '#22C55E' }} />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>Top 10 Clientes</p>
            <p className="text-[11px]" style={{ color: '#94A3B8' }}>
              No período, aplicando todos os filtros
              {origin !== 'all' && <> · <span style={{ color: '#22C55E' }}>origem: {origin === '__no_origin__' ? 'Não informado' : originLabel(origin)}</span></>}
              {channel !== 'all' && <> · <span style={{ color: '#22C55E' }}>canal: {channel === '__no_channel__' ? 'Não informado' : channelLabel(channel)}</span></>}
            </p>
          </div>
        </div>
        <div className="p-6 overflow-x-auto">
          {topClients.length === 0 ? (
            <p className="py-10 text-center text-sm" style={{ color: '#94A3B8' }}>
              Nenhum cliente no período
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
                  {['Cliente', 'Contato', 'Origem', 'Transações', 'Faturamento', 'Lucro'].map(h => (
                    <th key={h} className="pb-3 pr-4 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topClients.map(c => <ClientRow key={c.id} c={c} />)}
              </tbody>
            </table>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────

function SummaryCard({
  label, value, sub, color, icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  color: string
  icon: React.ElementType
}) {
  return (
    <div className="rounded-2xl border p-5 relative overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full opacity-20"
        style={{ background: `radial-gradient(circle, ${color}, transparent)` }} />
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>{label}</span>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color, fontFamily: 'ui-monospace,monospace' }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px]" style={{ color: '#94A3B8' }}>{sub}</div>}
    </div>
  )
}

// ── Origin row ────────────────────────────────────────────────────────────

function OriginRow({ row }: { row: OriginReportRow }) {
  const color = row.value ? (ORIGIN_COLORS[row.value] ?? '#8B5CF6') : '#94A3B8'
  return (
    <tr className="border-b transition-colors hover:bg-white/[0.02]" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="font-medium text-sm" style={{ color: '#F8FAFC' }}>{row.label}</span>
        </div>
      </td>
      <td className="py-3 pr-4 font-mono" style={{ color: '#F8FAFC' }}>{row.uniqueCustomers}</td>
      <td className="py-3 pr-4 font-mono" style={{ color: '#F8FAFC' }}>{row.transactions}</td>
      <td className="py-3 pr-4 font-mono" style={{ color: '#CBD5E1' }}>{BRL(row.ticketMedioCents)}</td>
      <td className="py-3 pr-4 font-mono font-semibold" style={{ color }}>{BRL(row.totalCents)}</td>
      <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#10B981' }}>{BRL(row.profitCents)}</td>
      <td className="py-3 pr-4 font-mono" style={{ color: row.marginPercent >= 20 ? '#10B981' : row.marginPercent >= 10 ? '#F59E0B' : '#EF4444' }}>
        {row.marginPercent}%
      </td>
    </tr>
  )
}

// ── Client row ────────────────────────────────────────────────────────────

function ClientRow({ c }: { c: TopClientRow }) {
  const waNum    = stripDigits(c.whatsapp)
  const phoneNum = stripDigits(c.whatsapp || c.phone)
  const phoneDisplay = fmtPhone(c.whatsapp || c.phone)
  const wa = waNum
    ? `https://wa.me/${waNum.startsWith('55') ? '' : '55'}${waNum}?text=${encodeURIComponent(`Olá ${c.name.split(' ')[0]}! Tudo bem?`)}`
    : ''
  const ori = c.origin ? originLabel(c.origin) : null
  const oriColor = c.origin ? (ORIGIN_COLORS[c.origin] ?? '#8B5CF6') : '#94A3B8'

  return (
    <tr className="border-b transition-colors hover:bg-white/[0.02]" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{ background: 'rgba(34,197,94,.12)', color: '#22C55E' }}>
            {c.name.trim().charAt(0).toUpperCase()}
          </div>
          <span className="font-medium text-sm" style={{ color: '#F8FAFC' }}>{c.name}</span>
        </div>
      </td>
      <td className="py-3 pr-4">
        {phoneDisplay ? (
          <div className="flex items-center gap-1.5">
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:opacity-80"
                style={{ background: 'rgba(37,211,102,.15)', color: '#25D366' }}
                title={`WhatsApp ${phoneDisplay}`}>
                <MessageCircle className="h-3.5 w-3.5" />
              </a>
            )}
            <a href={`tel:${phoneNum}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:opacity-80"
              style={{ background: 'rgba(34,197,94,.12)', color: '#22C55E' }}
              title={`Ligar ${phoneDisplay}`}>
              <Phone className="h-3.5 w-3.5" />
            </a>
            <span className="text-xs font-mono" style={{ color: '#CBD5E1' }}>{phoneDisplay}</span>
          </div>
        ) : (
          <span className="text-xs" style={{ color: '#94A3B8' }}>—</span>
        )}
      </td>
      <td className="py-3 pr-4">
        {ori ? (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: `${oriColor}20`, color: oriColor }}>
            <Megaphone className="h-2.5 w-2.5 mr-1" />
            {ori}
          </span>
        ) : (
          <span className="text-xs" style={{ color: '#94A3B8' }}>—</span>
        )}
      </td>
      <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#F8FAFC' }}>{c.transactions}</td>
      <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#F8FAFC' }}>{BRL(c.totalCents)}</td>
      <td className="py-3 pr-4 font-mono font-semibold" style={{ color: '#10B981' }}>{BRL(c.profitCents)}</td>
    </tr>
  )
}
