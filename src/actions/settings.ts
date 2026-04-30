'use server'

import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import { revalidatePath } from 'next/cache'

// ── Types ─────────────────────────────────────────────────────────────────────

export type StockControlMode = 'off' | 'warn' | 'block'

export type TenantSettings = {
  stock_control_mode:      StockControlMode
  fisica_fixed_cost_cents: number | null
}

const DEFAULTS: TenantSettings = {
  stock_control_mode:      'warn',
  fisica_fixed_cost_cents: null,
}

// ── Get ───────────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<TenantSettings> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  const { data } = await supabase
    .from('tenant_settings')
    .select('stock_control_mode, fisica_fixed_cost_cents')
    .eq('tenant_id', tenantId)
    .single()

  if (!data) return DEFAULTS
  return {
    stock_control_mode:      (data.stock_control_mode as StockControlMode) ?? DEFAULTS.stock_control_mode,
    fisica_fixed_cost_cents: (data.fisica_fixed_cost_cents as number | null) ?? null,
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

export async function saveSettings(settings: TenantSettings): Promise<void> {
  const { supabase, user } = await requireAuth()
  const tenantId = getTenantId(user)

  if (settings.fisica_fixed_cost_cents !== null
      && (!Number.isFinite(settings.fisica_fixed_cost_cents)
          || settings.fisica_fixed_cost_cents < 0)) {
    throw new Error('Custo fixo da loja física deve ser zero ou positivo')
  }

  const { error } = await supabase
    .from('tenant_settings')
    .upsert(
      { tenant_id: tenantId, ...settings, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' },
    )

  if (error) throw new Error(error.message)
  revalidatePath('/configuracoes')
  revalidatePath('/pos')
  revalidatePath('/analytics/canais')
}
