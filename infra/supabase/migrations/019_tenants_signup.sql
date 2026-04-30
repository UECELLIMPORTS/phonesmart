-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  019 — Tenants & Signup automático                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Tanto `tenants` quanto `subscriptions` JÁ EXISTEM no banco (criadas pelo
-- CheckSmart). Vamos REAPROVEITAR:
--
--   - `tenants`: adiciona owner_user_id (nullable)
--   - `subscriptions`: já tem schema completo (id, tenant_id, status, plan_name,
--      price_cents, gateway, etc) — só precisa que a RPC saiba o esquema certo
--
-- Idempotente: pode rodar várias vezes sem efeito colateral.

-- ── 1. Estende tabela tenants existente ────────────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_owner ON public.tenants(owner_user_id);

-- (RLS já existe na tabela — não mexer)

-- ── 2. Garante que subscriptions tem RLS de leitura por tenant ────────────
-- Se já existe policy igual, drop+recreate pra ficar consistente.

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions: tenant reads" ON public.subscriptions;
CREATE POLICY "subscriptions: tenant reads"
  ON public.subscriptions FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- ── 3. RPC create_tenant_for_user ──────────────────────────────────────────
--
-- Cria tenant + subscription pra um user recém-criado.
-- Usa o schema EXISTENTE de subscriptions (plan_name TEXT, price_cents INTEGER).

CREATE OR REPLACE FUNCTION public.create_tenant_for_user(
  p_user_id     UUID,
  p_tenant_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_slug      TEXT;
BEGIN
  -- Slug único (nome normalizado + timestamp)
  v_slug := lower(regexp_replace(p_tenant_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || extract(epoch from now())::bigint;

  -- Cria tenant com defaults razoáveis (campos NOT NULL legados do CheckSmart)
  INSERT INTO public.tenants (
    name,
    slug,
    address_state,
    warranty_days,
    pickup_days,
    is_active,
    require_signature,
    owner_user_id
  ) VALUES (
    p_tenant_name,
    v_slug,
    'SP',           -- placeholder — user altera nas configurações
    90,
    30,
    true,
    true,
    p_user_id
  )
  RETURNING id INTO v_tenant_id;

  -- Cria assinatura em trial de 7 dias, plano Básico (R$ 97)
  INSERT INTO public.subscriptions (
    tenant_id, status, plan_name, price_cents, trial_ends_at
  ) VALUES (
    v_tenant_id, 'trialing', 'basico', 9700, now() + INTERVAL '7 days'
  );

  RETURN v_tenant_id;
END $$;

REVOKE  ALL    ON FUNCTION public.create_tenant_for_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE  ON FUNCTION public.create_tenant_for_user(UUID, TEXT) TO service_role;

-- ── 4. Refresh do schema cache ────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
