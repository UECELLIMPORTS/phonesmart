-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  039 — Template delay em minutos + envio por email                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Sprint 14: granularidade em minutos (não só horas) + opção de mandar
-- email junto com WhatsApp pra cada template.

ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS delay_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS send_email   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_subject TEXT;

-- Migra dados existentes: delay_hours em horas → delay_minutes em minutos
UPDATE public.whatsapp_templates
SET delay_minutes = COALESCE(delay_hours, 0) * 60
WHERE delay_minutes IS NULL;

-- Default 0 e NOT NULL
UPDATE public.whatsapp_templates SET delay_minutes = 0 WHERE delay_minutes IS NULL;

ALTER TABLE public.whatsapp_templates
  ALTER COLUMN delay_minutes SET DEFAULT 0,
  ALTER COLUMN delay_minutes SET NOT NULL;

-- Habilita email por padrão nos 2 templates de aniversário (caso de uso comum)
UPDATE public.whatsapp_templates
SET send_email = TRUE
WHERE type IN ('birthday_month', 'birthday_day');

-- delay_hours fica por compat (não dropamos pra evitar quebrar app antigo);
-- novas leituras devem usar SOMENTE delay_minutes.

NOTIFY pgrst, 'reload schema';
