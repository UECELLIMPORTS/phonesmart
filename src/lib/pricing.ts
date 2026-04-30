/**
 * Tabela central de preços dos 4 produtos da Phone Smart.
 *
 * Fonte da verdade pra tudo que precisa saber o valor: páginas de
 * assinatura, server actions de subscribe, webhook que valida valor pago.
 *
 * IMPORTANTE: alterar aqui não muda assinaturas já criadas no Asaas.
 * Pra reajustar valor de cliente existente, precisa chamar API do Asaas
 * em update da subscription.
 */

export type Product = 'gestao_smart' | 'checksmart' | 'crm' | 'meta_ads'
export type Plan    = 'basico' | 'pro' | 'premium'

export type PriceEntry = {
  product:     Product
  plan:        Plan
  priceCents:  number       // mensal
  description: string       // pra mostrar no Asaas
}

/** Preços vigentes em R$/mês (cents). */
export const PRICES: PriceEntry[] = [
  // Gestão Smart
  { product: 'gestao_smart', plan: 'basico',  priceCents:  9700, description: 'Gestão Smart Básico — ERP completo' },
  { product: 'gestao_smart', plan: 'pro',     priceCents: 14700, description: 'Gestão Smart Pro — ERP + Analytics avançado' },
  { product: 'gestao_smart', plan: 'premium', priceCents: 19700, description: 'Gestão Smart Premium — Tudo: ERP + CheckSmart + CRM + Meta Ads' },

  // CheckSmart
  { product: 'checksmart',   plan: 'basico',  priceCents:  5700, description: 'CheckSmart Básico — OS + Estoque assistência' },
  { product: 'checksmart',   plan: 'pro',     priceCents:  9700, description: 'CheckSmart Pro — OS + multi-aparelho + relatórios' },
  { product: 'checksmart',   plan: 'premium', priceCents: 12700, description: 'CheckSmart Premium — Tudo + integrações' },

  // CRM
  { product: 'crm',          plan: 'basico',  priceCents:  9700, description: 'CRM Básico — Pipeline + Inbox WhatsApp' },
  { product: 'crm',          plan: 'pro',     priceCents: 14700, description: 'CRM Pro — Pipeline + Inbox WA + IG + automações' },
  { product: 'crm',          plan: 'premium', priceCents: 19700, description: 'CRM Premium — Tudo + IA de mensagens' },

  // Meta Ads (só add-on — não tem plano básico/pro/premium próprio)
  // Convenção: armazenamos como plan='basico' com priceCents do add-on.
  // Premium do Gestão Smart libera grátis (priceCents=0 nesse caso, regra
  // aplicada na server action, não aqui).
  { product: 'meta_ads',     plan: 'basico',  priceCents:  4700, description: 'Meta Ads — ROAS e CAC integrados' },
]

/** Busca preço de (produto, plano). Retorna null se não existir. */
export function getPrice(product: Product, plan: Plan): PriceEntry | null {
  return PRICES.find(p => p.product === product && p.plan === plan) ?? null
}

/** Lista planos disponíveis pra um produto. */
export function plansForProduct(product: Product): PriceEntry[] {
  return PRICES.filter(p => p.product === product)
}

/** Formata cents → "R$ 97,00" (pra UI). */
export function fmtBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

/** Cents → reais (number) pra mandar pro Asaas (que espera valor em reais). */
export function centsToReais(cents: number): number {
  return cents / 100
}

// ── Plano anual: 10% de desconto sobre 12 mensalidades ───────────────────
// O desconto vale só no PRIMEIRO ciclo (não na renovação). A subscription
// no Asaas registra value=preço cheio anual; a 1ª cobrança é um Payment
// standalone com value=anual_com_desconto (parcelado em 12x sem juros se
// for cartão). Renovação no ano seguinte cobra preço cheio.

export const YEARLY_DISCOUNT_PCT = 0.1   // 10%
export const YEARLY_INSTALLMENTS  = 12   // parcelas no cartão

export type YearlyPrice = {
  fullCents:        number   // 12 × monthlyCents (renovação)
  discountedCents:  number   // 12 × monthlyCents × 0.9 (1º ano)
  installmentCents: number   // discountedCents / 12 (cada parcela)
  savingsCents:     number   // fullCents - discountedCents
}

/** Calcula valores anuais a partir do preço mensal. */
export function getYearlyPrice(product: Product, plan: Plan): YearlyPrice | null {
  const monthly = getPrice(product, plan)
  if (!monthly) return null
  const fullCents       = monthly.priceCents * 12
  const discountedCents = Math.round(fullCents * (1 - YEARLY_DISCOUNT_PCT))
  const installmentCents = Math.round(discountedCents / YEARLY_INSTALLMENTS)
  return {
    fullCents,
    discountedCents,
    installmentCents,
    savingsCents: fullCents - discountedCents,
  }
}

export type BillingCycle = 'MONTHLY' | 'YEARLY'

// ── Features de cada plano (pra exibir nos modais de upgrade/downgrade) ───
// Usado pra cliente comparar o que ganha/perde ao mudar de plano.

export const PLAN_FEATURES: Record<Product, Record<Plan, string[]>> = {
  gestao_smart: {
    basico: [
      'Frente de Caixa (POS) com busca e carrinho',
      'Estoque com controle de custo',
      'Financeiro consolidado (vendas + OS)',
      'Cadastro de clientes',
      'Dashboards básicos (faturamento, top produtos)',
      'Multi-usuário (até 3 vendedores)',
    ],
    pro: [
      'Tudo do Básico',
      'Relatórios avançados (período, ticket médio, comparativos)',
      'Análise de Canais (Online vs Física, Break-even)',
      'ERP Clientes (heatmap, em risco, origem)',
      'Diagnóstico de Lucro (itens órfãos, prejuízo)',
      'Multi-usuário ilimitado',
    ],
    premium: [
      'Tudo do Pro',
      'Meta Ads incluído (ROAS, CAC, alertas)',
      'CRM incluído (pipeline + WhatsApp + Instagram)',
      'CheckSmart incluído (OS de assistência)',
      'Suporte prioritário',
    ],
  },
  checksmart: {
    basico: [
      'OS (Ordem de Serviço) com checklist',
      'Cadastro de aparelhos e clientes',
      'Estoque de peças',
      'PDF da OS',
    ],
    pro: [
      'Tudo do Básico',
      'OS multi-aparelho (várias na mesma OS)',
      'Escudo jurídico (aparelho apagado bloqueia)',
      'Relatórios de produtividade',
    ],
    premium: [
      'Tudo do Pro',
      'Integração com Gestão Smart (caixa unificado)',
      'Notificação SMS pro cliente',
      'Suporte prioritário',
    ],
  },
  crm: {
    basico: [
      'Pipeline de vendas (leads → clientes)',
      'Inbox WhatsApp unificado',
      'Histórico de mensagens por cliente',
    ],
    pro: [
      'Tudo do Básico',
      'Inbox Instagram',
      'Mensagens automáticas (boas-vindas, lembretes)',
      'Templates pré-aprovados Meta',
    ],
    premium: [
      'Tudo do Pro',
      'IA de mensagens (resposta automática)',
      'Atribuição automática por palavra-chave',
      'Suporte prioritário',
    ],
  },
  meta_ads: {
    basico: [
      'Conexão com até 3 contas de anúncio',
      'Métricas em tempo real (ROAS, CAC, CPC)',
      'Alertas de campanhas com problema',
      'Atribuição via campaign_code WhatsApp',
    ],
    pro:     [],   // não usa (módulo só tem 1 plano)
    premium: [],   // não usa
  },
}

export function featuresFor(product: Product, plan: Plan): string[] {
  return PLAN_FEATURES[product]?.[plan] ?? []
}
