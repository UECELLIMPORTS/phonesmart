-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  030 — tenant_invites aceita role='employee'                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A migration 022 criou tenant_invites com CHECK (role IN ('manager')) — só
-- gerente. Migration 028 adicionou employee no app, mas esqueci de relaxar o
-- constraint, então o INSERT falhava com violation.

ALTER TABLE public.tenant_invites
  DROP CONSTRAINT IF EXISTS tenant_invites_role_check;

ALTER TABLE public.tenant_invites
  ADD CONSTRAINT tenant_invites_role_check
    CHECK (role IN ('manager', 'employee'));

NOTIFY pgrst, 'reload schema';
