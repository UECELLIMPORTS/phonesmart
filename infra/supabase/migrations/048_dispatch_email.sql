-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  040 — Dispatch envia email tambem (anti-duplicate por message)          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Sprint 15: cron whatsapp-dispatch agora processa email tambem quando o
-- template tem send_email=TRUE. Pra evitar duplicate em retries, marcamos
-- email_sent_at na primeira tentativa bem-sucedida.

ALTER TABLE public.scheduled_whatsapp_messages
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_error   TEXT;

NOTIFY pgrst, 'reload schema';
