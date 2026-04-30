import Link from 'next/link'
import { Lock, Sparkles, ArrowRight } from 'lucide-react'
import { FEATURE_REQUIREMENT, type FeatureKey } from '@/lib/subscription'

/**
 * Tela de bloqueio mostrada quando o user tenta acessar uma feature de
 * plano superior. Renderizada como conteúdo da própria página (não modal),
 * pra que a sidebar/topbar continuem funcionais.
 */
export function UpgradeBlock({
  feature,
  pageTitle,
}: {
  feature:   FeatureKey
  pageTitle: string
}) {
  const req = FEATURE_REQUIREMENT[feature]

  return (
    <div className="flex items-start justify-center min-h-[calc(100vh-12rem)] py-10">
      <div className="w-full max-w-2xl">
        <div className="rounded-2xl border p-8 lg:p-10 text-center"
          style={{ background: '#131C2A', borderColor: 'rgba(255,184,0,.4)' }}>

          {/* Ícone */}
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border"
            style={{ background: 'rgba(255,184,0,.1)', borderColor: 'rgba(255,184,0,.3)' }}>
            <Lock className="h-8 w-8" style={{ color: '#F59E0B' }} />
          </div>

          {/* Título */}
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-3" style={{ color: '#F8FAFC' }}>
            {pageTitle} é parte do plano <span style={{ color: '#F59E0B' }}>{req.label}</span>
          </h1>

          {/* Descrição */}
          <p className="text-base mb-8 max-w-md mx-auto" style={{ color: '#CBD5E1' }}>
            {req.description}
          </p>

          {/* Highlights */}
          <div className="rounded-xl border p-5 mb-8 text-left"
            style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#10B981' }}>
              <Sparkles className="h-3.5 w-3.5 inline mr-1.5" />
              Ao fazer upgrade você desbloqueia
            </p>
            <ul className="space-y-2 text-sm" style={{ color: '#F8FAFC' }}>
              {HIGHLIGHTS_BY_FEATURE[feature].map(item => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#10B981' }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/configuracoes/assinatura"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
            >
              Fazer upgrade <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="https://wa.me/5579999998876?text=Quero%20fazer%20upgrade%20de%20plano"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border px-6 py-3 text-sm font-bold transition-colors hover:bg-white/5"
              style={{ borderColor: '#2A3650', color: '#F8FAFC' }}
            >
              Falar no WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

const HIGHLIGHTS_BY_FEATURE: Record<FeatureKey, string[]> = {
  reports: [
    'Top 10 clientes por faturamento e lucro',
    'Filtros por período, origem e canal',
    'Exportação CSV pra contabilidade',
  ],
  canais: [
    'Online vs Física (com Break-even da loja)',
    'Origem dos clientes × Canal de venda (heatmap)',
    'Performance por canal com lucro e margem',
    'Modalidade de entrega + evolução diária',
  ],
  erp_clientes: [
    'Comparativo PhoneSmart × CheckSmart',
    'Clientes em risco de perda (auto-detecção)',
    'Heatmap por dia da semana',
    'Diagnóstico de Lucro automático',
  ],
  meta_ads: [
    'Sincronização com Meta Graph API',
    'ROAS e CAC por canal',
    'Atribuição via campaign_code',
    'Alertas automáticos de campanhas',
  ],
  crm: [
    'Pipeline visual por estágio',
    'Inbox WhatsApp + Instagram unificado',
    'Detecção de clientes em risco',
    'Histórico completo do cliente',
  ],
  checksmart: [
    'OS multi-aparelho com checklist',
    'Escudo jurídico em aparelho apagado',
    'PDF assinado pelo cliente',
    'Sincronização com Gestão Smart',
  ],
}
