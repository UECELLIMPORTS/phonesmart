-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  028 — Permissões por módulo pra funcionários                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Owner pode cadastrar funcionários (role 'employee') escolhendo quais
-- módulos cada um pode acessar. Owner e manager (legado) continuam com
-- acesso total — não precisam registros nessa tabela.
--
-- Cada linha = (user_id × module_key) liberado. Ausência de linha = bloqueado.
--
-- Module keys canônicos (lista em src/lib/permissions.ts):
--   pos, estoque, financeiro, clientes, erp_clientes, analytics_canais,
--   relatorios, meta_ads, crm
--
-- /configuracoes (assinatura, equipe) é sempre owner-only — não passa por
-- esse sistema (gate por tenant_role no app_metadata).
--
-- O role 'employee' é o NOVO. Roles existentes:
--   owner    — acesso total, único que gerencia equipe + assinatura
--   manager  — acesso total (legado, mantém compatibilidade)
--   employee — acesso só aos módulos liberados nessa tabela

CREATE TABLE IF NOT EXISTS public.tenant_member_permissions (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_key  TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_member_permissions_user
  ON public.tenant_member_permissions(user_id, tenant_id);

-- ── tenant_invites: armazena permissions pré-definidas pro convite ────────
-- Quando owner convida um employee, escolhe os módulos no momento.
-- Quando user aceita convite, copiamos pra tenant_member_permissions.

ALTER TABLE public.tenant_invites
  ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}';

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_member_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_member_permissions: own select" ON public.tenant_member_permissions;
DROP POLICY IF EXISTS "tenant_member_permissions: owner manage" ON public.tenant_member_permissions;

-- User pode ler suas próprias permissions
CREATE POLICY "tenant_member_permissions: own select"
  ON public.tenant_member_permissions FOR SELECT
  USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE só via service_role (chamado por Server Actions
-- que verificam ownership). Sem policy = bloqueado pra usuários comuns.

NOTIFY pgrst, 'reload schema';
