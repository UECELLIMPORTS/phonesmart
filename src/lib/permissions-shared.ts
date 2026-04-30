/**
 * Parte client-safe do sistema de permissões: types, MODULES list e helpers sync.
 * Não importa nada de server-only (next/headers, supabase admin, etc).
 *
 * Server-only helpers (getUserPermissions, getUserFeatures, requireModuleAccess)
 * vivem em @/lib/permissions e re-exportam tudo daqui.
 *
 * Conceitos:
 * - Módulo: rota base do app. Ex: 'pos', 'estoque', 'dashboard'. Bloqueio é por
 *   tudo-ou-nada (acessa ou não acessa o módulo).
 * - Feature: bloco granular dentro de um módulo. Ex: 'dashboard:kpis',
 *   'dashboard:charts'. Permite limitar partes específicas pro funcionário.
 *   Salvas na mesma tabela tenant_member_permissions com prefixo "modulo:feature".
 */

export type ModuleKey =
  | 'dashboard'
  | 'pos'
  | 'estoque'
  | 'financeiro'
  | 'clientes'
  | 'erp_clientes'
  | 'analytics_canais'
  | 'relatorios'
  | 'meta_ads'
  | 'crm'
  | 'notas_fiscais'
  | 'gastos'
  | 'aniversariantes'

export type ModuleInfo = {
  key:         ModuleKey
  label:       string
  description: string
  icon:        string
  route:       string
}

/** Lista canônica dos módulos com gate de permissão. */
export const MODULES: ModuleInfo[] = [
  { key: 'dashboard',        label: 'Dashboard',           description: 'Visão geral: faturamento, gráficos, atividade', icon: 'LayoutDashboard', route: '/' },
  { key: 'pos',              label: 'Frente de Caixa',     description: 'Vender produtos no POS',                icon: 'ShoppingCart',  route: '/pos' },
  { key: 'estoque',          label: 'Estoque',             description: 'Gerenciar produtos e estoque',          icon: 'Package',       route: '/estoque' },
  { key: 'financeiro',       label: 'Financeiro',          description: 'Vendas + OS + cancelamentos',           icon: 'DollarSign',    route: '/financeiro' },
  { key: 'clientes',         label: 'Clientes',            description: 'Cadastro e busca de clientes',          icon: 'Users',         route: '/clientes' },
  { key: 'erp_clientes',     label: 'ERP Clientes',        description: 'Analytics de clientes (Pro+)',          icon: 'PieChart',      route: '/erp-clientes' },
  { key: 'analytics_canais', label: 'Canais',              description: 'Análise de canais e break-even (Pro+)', icon: 'BarChart3',     route: '/analytics/canais' },
  { key: 'relatorios',       label: 'Relatórios',          description: 'Relatórios avançados (Pro+)',           icon: 'FileText',      route: '/relatorios' },
  { key: 'meta_ads',         label: 'Meta Ads',            description: 'ROAS e CAC (Premium)',                  icon: 'TrendingUp',    route: '/meta-ads' },
  { key: 'crm',              label: 'CRM',                 description: 'Pipeline e Inbox (Premium)',            icon: 'MessageCircle', route: '/crm' },
  { key: 'notas_fiscais',    label: 'Notas Fiscais',       description: 'Emissão de NF-e, NFC-e e NFS-e',        icon: 'FileText',      route: '/notas-fiscais' },
  { key: 'gastos',           label: 'Gastos',              description: 'Gastos variáveis com categorias e relatórios', icon: 'Wallet', route: '/gastos' },
  { key: 'aniversariantes',  label: 'Aniversariantes',     description: 'Lista do dia/semana/mês + envio WhatsApp + cupom', icon: 'Cake', route: '/aniversariantes' },
]

const MODULE_KEYS = new Set<string>(MODULES.map(m => m.key))
export function isValidModuleKey(s: string): s is ModuleKey {
  return MODULE_KEYS.has(s)
}

// ──────────────────────────────────────────────────────────────────────────
// Features (granularidade dentro de módulos)
// ──────────────────────────────────────────────────────────────────────────

export type FeatureInfo = {
  key:         string   // sufixo após o ":" — ex: 'kpis', 'charts'
  label:       string
  description: string
}

/**
 * Map de módulo → features granulares disponíveis. Módulos sem entrada aqui
 * são bloqueados/liberados por inteiro (binário).
 *
 * Quando um módulo TEM features: liberar o módulo no convite expande
 * automaticamente todas as features. Owner pode desmarcar individualmente
 * pra restringir partes específicas.
 */
export const MODULE_FEATURES: Partial<Record<ModuleKey, FeatureInfo[]>> = {
  dashboard: [
    { key: 'kpis',    label: 'Cards de faturamento',  description: 'Faturamento, vendas, ticket médio, clientes ativos, OS abertas' },
    { key: 'charts',  label: 'Gráficos',              description: 'Donut de origem dos clientes e canais de venda' },
    { key: 'reports', label: 'Atividade recente',     description: 'Lista das últimas vendas e OS' },
    { key: 'filtros', label: 'Filtros de período',    description: 'Selecionar Hoje, 7d, 30d, Personalizado' },
  ],
}

/** Builda a key completa de uma feature: 'dashboard' + 'kpis' → 'dashboard:kpis' */
export function featureKey(module: ModuleKey, feature: string): string {
  return `${module}:${feature}`
}

/** True se a string está no formato 'modulo:feature' */
export function isFeatureKey(s: string): boolean {
  return s.includes(':')
}

/** Lista todas as features possíveis em todos os módulos. */
export function allFeatureKeys(): string[] {
  const out: string[] = []
  for (const mod of MODULES) {
    for (const feat of MODULE_FEATURES[mod.key] ?? []) {
      out.push(featureKey(mod.key, feat.key))
    }
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers sync (client-safe)
// ──────────────────────────────────────────────────────────────────────────

// Aceita tanto o User do Supabase (app_metadata: UserAppMetadata) quanto um
// objeto simples — usar `unknown`-like loose shape pra compatibilidade.
type UserLike = { app_metadata?: Record<string, unknown> | { tenant_role?: string } }

/**
 * True se o user tem garantia de acesso total — apenas owner.
 * Manager pode ter ou não acesso total (depende de tenant_member_permissions);
 * a fonte da verdade é `getUserPermissions` (server). Pra UI, sempre filtre
 * a partir de allowedModules — esse helper é só pra atalhos óbvios.
 */
export function hasFullAccess(user: UserLike): boolean {
  const role = (user.app_metadata as { tenant_role?: string } | undefined)?.tenant_role
  return role === 'owner'
}

/** Sync: dado uma lista pré-carregada, checa se módulo está liberado. */
export function canAccessModuleSync(
  user: UserLike,
  perms: ModuleKey[],
  key: ModuleKey,
): boolean {
  if (hasFullAccess(user)) return true
  return perms.includes(key)
}

/** Sync: dado um Set pré-carregado, checa se feature está liberada. */
export function hasFeatureSync(
  user: UserLike,
  features: Set<string>,
  fullKey: string,
): boolean {
  if (hasFullAccess(user)) return true
  return features.has(fullKey)
}
