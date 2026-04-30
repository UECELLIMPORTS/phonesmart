import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase com SERVICE_ROLE — ignora RLS.
 *
 * USAR APENAS:
 * - Em Server Actions onde precisa criar/modificar dados que ainda não
 *   pertencem a nenhum tenant (ex: signup público — o user/tenant ainda
 *   não existem, então RLS não tem como autorizar).
 * - Em webhooks (Asaas, Meta) que precisam mexer em qualquer tenant.
 * - Em jobs administrativos (limpar dados de teste, migrar, etc).
 *
 * NUNCA USAR:
 * - Em Server Actions normais autenticadas (use createClient + RLS).
 * - Em código client-side (vaza a chave).
 * - Pra pular validação de posse — sempre validar tenant_id manualmente
 *   antes de cada operação.
 *
 * A chave SUPABASE_SERVICE_ROLE_KEY mora SÓ no servidor (sem prefixo
 * NEXT_PUBLIC_) e nunca é exposta ao bundle do cliente.
 */
export function createAdminClient() {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      'Variáveis NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY ' +
      'precisam estar definidas no .env.local (e no Vercel pra produção).',
    )
  }

  return createSupabaseClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession:   false,
    },
  })
}
