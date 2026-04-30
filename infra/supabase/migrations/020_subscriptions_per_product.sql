-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  020 — Subscriptions por produto                                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Hoje subscriptions tem 1 row por tenant_id. Mas Phone Smart vende 4
-- produtos INDEPENDENTES (gestao_smart, checksmart, crm, meta_ads). Cliente
-- pode contratar 1, alguns ou todos.
--
-- Este migration:
--   1. Adiciona coluna `product` (TEXT com CHECK) em subscriptions
--   2. Backfilla rows existentes como product='gestao_smart'
--   3. Cria UNIQUE (tenant_id, product) — cada tenant pode ter 1 sub por produto
--   4. Atualiza a RPC create_tenant_for_user pra setar product corretamente
--
-- Idempotente: pode rodar várias vezes sem efeito colateral.

-- ── 1. Adiciona coluna product ────────────────────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'gestao_smart';

-- CHECK constraint (em vez de enum) pra facilitar adicionar produtos no futuro.
-- DROP+ADD se já existir, pra refletir a lista atual sem erro.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_product_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_product_check
    CHECK (product IN ('gestao_smart', 'checksmart', 'crm', 'meta_ads'));

-- ── 2. UNIQUE (tenant_id, product) ────────────────────────────────────────
-- Cada tenant pode ter no máximo 1 assinatura por produto.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS uq_tenant_product;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT uq_tenant_product UNIQUE (tenant_id, product);

-- ── 3. Atualiza RPC create_tenant_for_user ────────────────────────────────
-- Ao criar tenant, gera apenas a assinatura de Gestão Smart Básico em trial.
-- CheckSmart/CRM/Meta Ads são contratados depois pelo cliente em
-- /configuracoes/assinatura.

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
  v_slug := lower(regexp_replace(p_tenant_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || extract(epoch from now())::bigint;

  INSERT INTO public.tenants (
    name, slug, address_state, warranty_days, pickup_days,
    is_active, require_signature, owner_user_id
  ) VALUES (
    p_tenant_name, v_slug, 'SP', 90, 30, true, true, p_user_id
  )
  RETURNING id INTO v_tenant_id;

  -- Assinatura Gestão Smart Básico em trial 7d
  INSERT INTO public.subscriptions (
    tenant_id, product, status, plan_name, price_cents, trial_ends_at
  ) VALUES (
    v_tenant_id, 'gestao_smart', 'trialing', 'basico', 9700,
    now() + INTERVAL '7 days'
  );

  RETURN v_tenant_id;
END $$;

REVOKE  ALL    ON FUNCTION public.create_tenant_for_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE  ON FUNCTION public.create_tenant_for_user(UUID, TEXT) TO service_role;

-- ── 4. Refresh schema cache ───────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
