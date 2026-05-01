-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  038 — WhatsApp via Evolution API (multi-tenant)                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cada tenant tem 1 instância na Evolution API centralizada (VPS do dono).
-- Lojista escaneia QR dentro do app pra conectar o número dele.
-- Mensagens agendadas vão pra fila scheduled_whatsapp_messages, cron horário
-- envia. Templates customizáveis por tenant (whatsapp_templates).

-- ── Status do WhatsApp no tenant ───────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS whatsapp_instance_name TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_status        TEXT
    CHECK (whatsapp_status IN ('disconnected', 'connecting', 'connected', 'error')),
  ADD COLUMN IF NOT EXISTS whatsapp_phone         TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_connected_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS whatsapp_last_error    TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_whatsapp_instance_unique
  ON public.tenants(whatsapp_instance_name)
  WHERE whatsapp_instance_name IS NOT NULL;

-- ── Templates de mensagens (configurável por tenant) ───────────────────────
-- Tipos pré-definidos: post_sale, post_service, birthday_month, birthday_day
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  delay_hours   INTEGER NOT NULL DEFAULT 24,    -- delay após gatilho (em horas)
  body          TEXT NOT NULL,                  -- com placeholders {nome}, {valor}, etc
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_templates_tenant_type
  ON public.whatsapp_templates(tenant_id, type);

DROP TRIGGER IF EXISTS trg_touch_whatsapp_templates ON public.whatsapp_templates;
CREATE TRIGGER trg_touch_whatsapp_templates
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_templates: tenant isolation" ON public.whatsapp_templates;
CREATE POLICY "whatsapp_templates: tenant isolation"
  ON public.whatsapp_templates FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- ── Fila de mensagens agendadas ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduled_whatsapp_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Tipo do gatilho (post_sale, post_service, birthday_month, birthday_day, etc)
  type          TEXT NOT NULL,
  -- ID da entidade que disparou (sale_id, service_order_id, customer_id pra aniversário, etc)
  reference_id  UUID,

  -- Destinatário
  customer_id   UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,            -- normalizado (só dígitos, com 55)

  -- Conteúdo final renderizado (placeholders já resolvidos)
  body          TEXT NOT NULL,

  -- Agendamento
  scheduled_for TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),

  sent_at       TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  evolution_message_id TEXT,                -- id retornado pela Evolution API

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_whatsapp_pending
  ON public.scheduled_whatsapp_messages(tenant_id, status, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_whatsapp_dispatch
  ON public.scheduled_whatsapp_messages(scheduled_for)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_whatsapp_customer
  ON public.scheduled_whatsapp_messages(customer_id, type, scheduled_for DESC);

DROP TRIGGER IF EXISTS trg_touch_scheduled_wpp ON public.scheduled_whatsapp_messages;
CREATE TRIGGER trg_touch_scheduled_wpp
  BEFORE UPDATE ON public.scheduled_whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.scheduled_whatsapp_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduled_whatsapp: tenant isolation" ON public.scheduled_whatsapp_messages;
CREATE POLICY "scheduled_whatsapp: tenant isolation"
  ON public.scheduled_whatsapp_messages FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

NOTIFY pgrst, 'reload schema';
