-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  023 — Notifications in-app                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Tabela de notificações por usuário (não por tenant). Cada user vê só
-- as suas. RLS isola.
--
-- Geradores típicos:
-- - alerta Meta Ads (campanha pausada/com problema)
-- - cliente em risco detectado pelo CRM
-- - nova OS pendente do CheckSmart
-- - convite aceito (avisa o owner que alguém entrou na equipe)
-- - trial acabando (D-3, D-1, D-0)
-- - boas-vindas após signup
--
-- Cada notif tem `type` (categoria pra ícone/cor), `title`, `body`, `link`
-- (rota interna pra navegar ao clicar) e `metadata` (jsonb pra dados extras).

CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,                      -- ex: '/meta-ads/alertas'
  metadata    JSONB,                     -- payload livre pra contexto
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_all
  ON public.notifications(user_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications: user reads"   ON public.notifications;
DROP POLICY IF EXISTS "notifications: user updates" ON public.notifications;

-- User só vê suas próprias notifs
CREATE POLICY "notifications: user reads"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

-- User só pode marcar suas próprias notifs como lidas (update no read_at)
CREATE POLICY "notifications: user updates"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- INSERT só via service_role (chamado por triggers/Server Actions de outros módulos).
-- Usuário não cria notif pra si direto.

-- ── Realtime: habilita pra essa tabela ─────────────────────────────────────
-- Permite que o client faça subscribe e receba INSERT em tempo real.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

NOTIFY pgrst, 'reload schema';
