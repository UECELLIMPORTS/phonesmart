import Link from 'next/link'
import { Sparkles, ArrowRight } from 'lucide-react'

/**
 * Banner global mostrado quando o tenant tá em trial. Renderizado no layout
 * pra aparecer em todas as páginas. Mostra quantos dias faltam e CTA pra
 * /configuracoes/assinatura.
 */
export function TrialBanner({ daysLeft }: { daysLeft: number }) {
  const isUrgent = daysLeft <= 2
  const color = isUrgent ? '#EF4444' : '#F59E0B'
  const bg    = isUrgent ? 'rgba(255,77,109,.08)' : 'rgba(255,184,0,.08)'

  return (
    <div className="border-b" style={{ background: bg, borderColor: `${color}40` }}>
      <div className="px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm" style={{ color: '#F8FAFC' }}>
          <Sparkles className="h-4 w-4 shrink-0" style={{ color }} />
          <span>
            <strong style={{ color }}>
              {daysLeft === 0
                ? 'Seu trial expira hoje!'
                : daysLeft === 1
                  ? 'Seu trial expira amanhã'
                  : `Faltam ${daysLeft} dias do seu trial`
              }
            </strong>
            <span className="hidden sm:inline" style={{ color: '#CBD5E1' }}>
              {' '}— assine agora pra continuar usando todos os recursos
            </span>
          </span>
        </div>
        <Link
          href="/configuracoes/assinatura"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-90 shrink-0"
          style={{ background: color, color: '#131C2A' }}
        >
          Assinar agora <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}
