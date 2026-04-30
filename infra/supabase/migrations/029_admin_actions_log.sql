-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  029 — Audit log de ações administrativas                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Registra ações executadas no painel admin (/admin) — liberar plano manual,
-- estender trial, cancelar assinatura. Permite auditoria e rollback se algo
-- der errado.

CREATE TABLE IF NOT EXISTS public.admin_actions_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  tenant_id    UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_log_tenant
  ON public.admin_actions_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_log_admin
  ON public.admin_actions_log (admin_email, created_at DESC);

-- RLS: ninguém vê via cliente normal — só service_role (admin client)
ALTER TABLE public.admin_actions_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
