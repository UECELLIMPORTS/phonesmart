-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  021 — Compatibilidade com CHECK constraint de status                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A coluna `subscriptions.status` tem CHECK que aceita apenas:
-- 'trial' | 'active' | 'late' | 'inactive' | 'cancelled'
--
-- Eu usei 'trialing' (nome que o Stripe usa) na RPC, e quebrou o INSERT.
-- Aqui ajusto a RPC pra usar 'trial' (nome que já existia no banco).

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

  -- 'trial' (não 'trialing') — match do CHECK constraint existente
  INSERT INTO public.subscriptions (
    tenant_id, product, status, plan_name, price_cents, trial_ends_at
  ) VALUES (
    v_tenant_id, 'gestao_smart', 'trial', 'basico', 9700,
    now() + INTERVAL '7 days'
  );

  RETURN v_tenant_id;
END $$;

REVOKE  ALL    ON FUNCTION public.create_tenant_for_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE  ON FUNCTION public.create_tenant_for_user(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
