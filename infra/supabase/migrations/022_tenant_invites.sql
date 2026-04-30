-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  022 — Tenant invites (multi-usuário no tenant)                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Permite que o owner de um tenant convide outros usuários (manager) pra
-- acessar a mesma conta. Cada convite é um token de uso único com expiração.
--
-- Fluxo:
-- 1. Owner cria invite (email + role) → token gerado, email enviado
-- 2. Convidado clica no link /aceitar-convite/[token]
-- 3. Define senha → backend cria user via admin com app_metadata apontando
--    pro mesmo tenant_id do owner + tenant_role escolhido
-- 4. Invite marcado como aceito (accepted_at = now)
--
-- Roles permitidos: 'owner' (já existente, default no signup), 'manager'.
-- 'seller' / 'technician' ficam pra depois (precisam ajuste nas RLS).

CREATE TABLE IF NOT EXISTS public.tenant_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('manager')),
  token           TEXT NOT NULL UNIQUE,
  invited_by      UUID NOT NULL REFERENCES auth.users(id),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at     TIMESTAMPTZ,
  accepted_by     UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant ON public.tenant_invites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_token  ON public.tenant_invites(token) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_invites_email  ON public.tenant_invites(email);

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;

-- Owner do tenant pode ler/criar/cancelar invites
DROP POLICY IF EXISTS "tenant_invites: owner reads"   ON public.tenant_invites;
DROP POLICY IF EXISTS "tenant_invites: owner inserts" ON public.tenant_invites;
DROP POLICY IF EXISTS "tenant_invites: owner deletes" ON public.tenant_invites;

CREATE POLICY "tenant_invites: owner reads"
  ON public.tenant_invites FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'tenant_role') = 'owner'
  );

CREATE POLICY "tenant_invites: owner inserts"
  ON public.tenant_invites FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'tenant_role') = 'owner'
  );

CREATE POLICY "tenant_invites: owner deletes"
  ON public.tenant_invites FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'tenant_role') = 'owner'
  );

-- (sem UPDATE policy — accept_at é setado via service_role no backend)

NOTIFY pgrst, 'reload schema';
