-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  024 — Asaas integration                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Adiciona campos pra integrar com Asaas (gateway BR — PIX + cartão).
--
-- Decisão de schema:
-- - asaas_customer_id e cpf_cnpj ficam em `tenants` (1 customer Asaas por
--   empresa, reusado em todas as subscriptions).
-- - asaas_subscription_id, payment_method, next_due_date, billing_cycle ficam
--   em `subscriptions` (1 subscription Asaas por produto contratado).
--
-- Fluxo:
-- 1. User clica "Assinar produto X" → modal pede CPF/CNPJ se ainda não tiver
-- 2. Backend cria customer no Asaas (se 1ª vez), salva tenants.asaas_customer_id
-- 3. Backend cria subscription no Asaas com billingType=PIX (default) ou
--    CREDIT_CARD, salva subscriptions.asaas_subscription_id
-- 4. Webhook recebe PAYMENT_RECEIVED → vira status='active'
--
-- Idempotente.

-- ── 1. Tenants: cpf_cnpj + asaas_customer_id ──────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS cpf_cnpj          TEXT,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

-- CPF (11 dígitos) ou CNPJ (14 dígitos), só números (Asaas valida formato).
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_cpf_cnpj_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_cpf_cnpj_check
    CHECK (cpf_cnpj IS NULL OR cpf_cnpj ~ '^\d{11}$' OR cpf_cnpj ~ '^\d{14}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_asaas_customer_id
  ON public.tenants(asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

-- ── 2. Subscriptions: campos do Asaas ─────────────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_method        TEXT,
  ADD COLUMN IF NOT EXISTS next_due_date         DATE,
  ADD COLUMN IF NOT EXISTS billing_cycle         TEXT DEFAULT 'MONTHLY';

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_payment_method_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN ('PIX', 'CREDIT_CARD', 'BOLETO'));

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_cycle_check
    CHECK (billing_cycle IN ('MONTHLY', 'YEARLY'));

CREATE INDEX IF NOT EXISTS idx_subscriptions_asaas_subscription_id
  ON public.subscriptions(asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

-- ── 3. Tabela de log dos eventos do webhook (idempotência) ───────────────
-- Asaas pode reenviar o mesmo evento. Usar event_id como idempotency key
-- pra não processar duplicado.

CREATE TABLE IF NOT EXISTS public.asaas_webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT NOT NULL UNIQUE,    -- vem do Asaas (campo "id")
  event_type    TEXT NOT NULL,           -- PAYMENT_RECEIVED, PAYMENT_OVERDUE, etc
  payload       JSONB NOT NULL,          -- corpo cru pra auditoria
  processed     BOOLEAN NOT NULL DEFAULT false,
  processed_at  TIMESTAMPTZ,
  error         TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_received
  ON public.asaas_webhook_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_unprocessed
  ON public.asaas_webhook_events(received_at)
  WHERE processed = false;

-- RLS: só service_role lê/escreve (webhook + admin)
ALTER TABLE public.asaas_webhook_events ENABLE ROW LEVEL SECURITY;
-- Sem policy = ninguém acessa via API pública. service_role bypassa RLS.

-- ── 4. Refresh schema cache ───────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
