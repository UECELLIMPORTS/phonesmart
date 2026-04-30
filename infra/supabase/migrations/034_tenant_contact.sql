-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  034 — Tenant: contato institucional pra cabeçalho de comprovantes       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Adiciona telefone, email e Instagram da empresa pra aparecer no PDF e
-- email do comprovante. Endereço/CNPJ/IE continuam vindo de tenants e
-- fiscal_configs.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_phone   TEXT,
  ADD COLUMN IF NOT EXISTS business_email   TEXT,
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT;

COMMENT ON COLUMN public.tenants.business_phone   IS 'Telefone/WhatsApp da empresa pro cabeçalho dos comprovantes.';
COMMENT ON COLUMN public.tenants.business_email   IS 'E-mail institucional pro cabeçalho dos comprovantes.';
COMMENT ON COLUMN public.tenants.instagram_handle IS 'Handle do Instagram (sem @) pra branding nos comprovantes.';

NOTIFY pgrst, 'reload schema';
