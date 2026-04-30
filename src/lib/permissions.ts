/**
 * Sistema de permissões por módulo + features pra funcionários.
 * Server-only — usa next/headers, supabase admin, etc.
 *
 * Regras:
 * - Owner sempre tem acesso total (todos os módulos + todas as features)
 * - Manager sem rows em tenant_member_permissions = acesso total (compat)
 * - Manager com rows = limitado às rows
 * - Employee sempre limitado às rows
 *
 * Features ficam na mesma tabela com prefix 'modulo:feature' (ex: 'dashboard:kpis').
 */

import 'server-only'
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantId } from '@/lib/tenant'
import { requireAuth } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import {
  MODULES, MODULE_FEATURES, featureKey, isValidModuleKey,
  type ModuleKey,
} from './permissions-shared'

// Re-exporta tudo client-safe pra simplificar imports server-side
export {
  MODULES, MODULE_FEATURES, featureKey, isValidModuleKey,
  isFeatureKey, allFeatureKeys, hasFullAccess, canAccessModuleSync, hasFeatureSync,
} from './permissions-shared'
export type { ModuleKey, ModuleInfo, FeatureInfo } from './permissions-shared'

// ──────────────────────────────────────────────────────────────────────────
// Loader unificado — lê banco 1x por request (cacheado por React.cache)
// ──────────────────────────────────────────────────────────────────────────

type LoadResult = {
  /** Set com TODAS as keys (módulos + features) acessíveis pelo user. */
  keys:         Set<string>
  /** Se true: user tem acesso total — keys foi populado com tudo. */
  fullAccess:   boolean
}

const loadKeys = cache(async (user: User): Promise<LoadResult> => {
  const role = user.app_metadata?.tenant_role

  if (role === 'owner') {
    return { keys: buildFullAccessKeys(), fullAccess: true }
  }

  const tenantId = getTenantId(user)
  if (!tenantId) return { keys: new Set(), fullAccess: false }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data, error } = await sb
    .from('tenant_member_permissions')
    .select('module_key')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)

  if (error) {
    console.error('[loadKeys] erro:', error.message)
    return { keys: new Set(), fullAccess: false }
  }

  type Row = { module_key: string }
  const keys = new Set<string>(((data ?? []) as Row[]).map(r => r.module_key))

  // Manager sem rows registradas → compat retroativa (acesso total)
  if (role === 'manager' && keys.size === 0) {
    return { keys: buildFullAccessKeys(), fullAccess: true }
  }

  return { keys, fullAccess: false }
})

function buildFullAccessKeys(): Set<string> {
  const out = new Set<string>()
  for (const m of MODULES) {
    out.add(m.key)
    for (const f of MODULE_FEATURES[m.key] ?? []) {
      out.add(featureKey(m.key, f.key))
    }
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// API pública
// ──────────────────────────────────────────────────────────────────────────

/** Lê os módulos liberados pro user (não retorna feature keys). */
export async function getUserPermissions(user: User): Promise<ModuleKey[]> {
  const { keys } = await loadKeys(user)
  const out: ModuleKey[] = []
  for (const m of MODULES) {
    if (keys.has(m.key)) out.push(m.key)
  }
  return out
}

/** Lê todas as keys (módulos + features) liberadas pro user — pra checagens granulares. */
export async function getUserFeatures(user: User): Promise<Set<string>> {
  const { keys } = await loadKeys(user)
  return keys
}

/** True se user pode acessar o módulo. Owner/manager-full sempre true. */
export async function canAccessModule(user: User, key: ModuleKey): Promise<boolean> {
  const { keys } = await loadKeys(user)
  return keys.has(key)
}

/**
 * Server gate: garante user autenticado E com acesso ao módulo.
 * - Não autenticado → /login
 * - Sem permissão → primeira rota acessível, ou /sem-acesso se não tem nenhuma
 *
 * Usar no topo de layout.tsx de cada módulo.
 */
export async function requireModuleAccess(key: ModuleKey): Promise<User> {
  let user: User
  try {
    const auth = await requireAuth()
    user = auth.user
  } catch {
    redirect('/login')
  }

  const { keys } = await loadKeys(user)
  if (keys.has(key)) return user

  // Sem permissão — redireciona pra primeira rota acessível
  const fallback = await getDefaultRoute(user)
  redirect(fallback)
}

/**
 * Retorna a rota inicial sensata pra esse user — Dashboard se tem acesso,
 * senão o primeiro módulo permitido. Se não tem nenhum, '/sem-acesso'.
 */
export async function getDefaultRoute(user: User): Promise<string> {
  const { keys } = await loadKeys(user)
  if (keys.has('dashboard')) return '/'
  for (const m of MODULES) {
    if (m.key === 'dashboard') continue
    if (keys.has(m.key)) return m.route
  }
  return '/sem-acesso'
}
