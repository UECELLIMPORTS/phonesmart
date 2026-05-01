-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  043 — Notification Log (histórico de avisos enviados)                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Genérico pra qualquer tipo de notificação (lembrete de parcela, garantia,
-- aniversário). Permite checar "já avisei nas últimas 24h?" antes de enviar
-- de novo, evitando spam.

CREATE TABLE IF NOT EXISTS public.notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Tipo de notificação: 'installment_reminder' | 'warranty_expiring' | etc
  type          TEXT NOT NULL,
  -- ID da entidade referenciada (installment.id, sale.id, etc)
  reference_id  UUID NOT NULL,
  -- Canal: 'email' | 'whatsapp_link' | 'sms' | 'in_app'
  channel       TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp_link', 'sms', 'in_app')),

  -- Cliente/destinatário (opcional — alguns tipos não tem cliente)
  customer_id   UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  recipient     TEXT,                    -- email/whatsapp text usado

  -- Quando foi disparado e resultado
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error         TEXT,

  -- Payload livre pra debug
  metadata      JSONB,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup rápido: "já notifiquei essa parcela nas últimas 24h?"
CREATE INDEX IF NOT EXISTS idx_notification_log_ref_recent
  ON public.notification_log(tenant_id, type, reference_id, sent_at DESC);

-- Lista geral por tenant
CREATE INDEX IF NOT EXISTS idx_notification_log_tenant_recent
  ON public.notification_log(tenant_id, sent_at DESC);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_log: tenant isolation" ON public.notification_log;
CREATE POLICY "notification_log: tenant isolation"
  ON public.notification_log FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- Setting on/off de lembretes automáticos por tenant
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS installment_reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.tenants.installment_reminders_enabled IS
  'Habilita lembrete automático de parcelas (cron diário envia email + gera link WhatsApp).';

NOTIFY pgrst, 'reload schema';
