'use client'

import { Megaphone } from 'lucide-react'
import { originLabel } from '@/lib/customer-origin'

type OriginItem = {
  value:           string | null
  totalCents:      number
  transactions:    number
  uniqueCustomers: number
  sharePercent:    number
}

const COLORS: Record<string, string> = {
  instagram_pago:     '#E4405F',
  instagram_organico: '#C13584',
  indicacao:          '#10B981',
  passou_na_porta:    '#F59E0B',
  google:             '#4285F4',
  facebook:           '#1877F2',
  outros:             '#8B5CF6',
  __no__:             '#94A3B8',
}

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

export function OriginDonut({ breakdown }: { breakdown: OriginItem[] }) {
  const total = breakdown.reduce((s, b) => s + b.totalCents, 0)
  const top = breakdown[0]

  // Constrói o conic-gradient a partir dos segmentos
  let acc = 0
  const segments: string[] = []
  for (const b of breakdown) {
    const color = COLORS[b.value ?? '__no__'] ?? '#8B5CF6'
    const startDeg = Math.round((acc / 100) * 360)
    const endDeg = Math.round(((acc + b.sharePercent) / 100) * 360)
    segments.push(`${color} ${startDeg}deg ${endDeg}deg`)
    acc += b.sharePercent
  }
  const gradient = segments.length > 0
    ? `conic-gradient(${segments.join(', ')})`
    : '#2A3650'

  if (breakdown.length === 0 || total === 0) {
    return (
      <div className="rounded-xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2 mb-4">
          <Megaphone className="h-4 w-4" style={{ color: '#E4405F' }} />
          <div>
            <h2 className="text-sm font-semibold text-text">Origem dos Clientes</h2>
            <p className="text-[11px]" style={{ color: '#94A3B8' }}>Canais de aquisição no período</p>
          </div>
        </div>
        <p className="py-8 text-center text-sm" style={{ color: '#94A3B8' }}>
          Sem transações com cliente cadastrado no período
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border p-6" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4" style={{ color: '#E4405F' }} />
          <div>
            <h2 className="text-sm font-semibold text-text">Origem dos Clientes</h2>
            <p className="text-[11px]" style={{ color: '#94A3B8' }}>Canais de aquisição no período</p>
          </div>
        </div>
        <a
          href="/erp-clientes"
          className="text-[11px] font-bold transition-colors hover:opacity-80"
          style={{ color: '#22C55E' }}
        >
          Ver análise completa →
        </a>
      </div>

      <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
        {/* Donut */}
        <div className="relative shrink-0" style={{ width: 180, height: 180 }}>
          <div
            style={{
              width: 180, height: 180, borderRadius: '50%',
              background: gradient,
            }}
          />
          <div
            className="absolute inset-0 m-auto flex flex-col items-center justify-center"
            style={{
              width: 110, height: 110, borderRadius: '50%',
              background: '#1B2638',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Total
            </span>
            <span className="text-sm font-bold" style={{ color: '#F8FAFC', fontFamily: 'ui-monospace,monospace' }}>
              {BRL(total)}
            </span>
          </div>
        </div>

        {/* Legenda com valores */}
        <div className="flex-1 w-full space-y-1.5">
          {top?.value && (
            <div
              className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs mb-3"
              style={{
                background: `${COLORS[top.value] ?? '#E4405F'}0D`,
                borderLeft: `3px solid ${COLORS[top.value] ?? '#E4405F'}`,
              }}
            >
              <Megaphone className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: COLORS[top.value] ?? '#E4405F' }} />
              <span style={{ color: '#CBD5E1' }}>
                <strong style={{ color: '#F8FAFC' }}>{originLabel(top.value)}</strong> é o principal canal —
                {' '}{top.sharePercent}% ({BRL(top.totalCents)})
              </span>
            </div>
          )}
          {breakdown.map(b => {
            const color = COLORS[b.value ?? '__no__'] ?? '#8B5CF6'
            return (
              <div
                key={b.value ?? 'sem-origem'}
                className="flex items-center justify-between gap-3 py-1"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-xs truncate" style={{ color: '#F8FAFC' }}>
                    {b.value ? originLabel(b.value) : 'Não informado'}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-xs font-mono">
                  <span className="rounded-full px-1.5 py-0 text-[10px] font-bold" style={{ background: `${color}20`, color }}>
                    {b.sharePercent}%
                  </span>
                  <span style={{ color: '#CBD5E1' }}>{BRL(b.totalCents)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
