-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  031 — Sessões de caixa (abrir / fechar / auto-fechar)                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cada vez que o operador abre o caixa, cria 1 row em cash_sessions com
-- valor inicial. Vendas feitas durante a sessão referenciam ela via
-- sales.cash_session_id. Ao fechar, o operador informa o valor contado em
-- dinheiro e o sistema calcula breakdown por forma de pagamento.
--
-- Status:
-- - 'open'        → caixa aberto, aceitando vendas
-- - 'closed'      → fechado manualmente pelo operador (com snapshot final)
-- - 'auto_closed' → fechado automático às 00:00 pelo cron (operador esqueceu)

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  opened_by_user_id        UUID NOT NULL REFERENCES auth.users(id),
  closed_by_user_id        UUID REFERENCES auth.users(id),
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                TIMESTAMPTZ,
  opening_balance_cents    INTEGER NOT NULL DEFAULT 0,
  closing_counted_cents    INTEGER,                          -- valor contado fisicamente em dinheiro
  status                   TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'auto_closed')),
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1 sessão aberta por tenant por vez (UNIQUE parcial — só conta status='open')
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_sessions_one_open_per_tenant
  ON public.cash_sessions (tenant_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_opened
  ON public.cash_sessions (tenant_id, opened_at DESC);

-- Liga venda à sessão de caixa em que foi feita
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cash_session_id UUID REFERENCES public.cash_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_cash_session
  ON public.sales (cash_session_id)
  WHERE cash_session_id IS NOT NULL;

-- RLS — só vê sessões do próprio tenant
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_sessions: tenant select"
  ON public.cash_sessions FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "cash_sessions: tenant insert"
  ON public.cash_sessions FOR INSERT
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "cash_sessions: tenant update"
  ON public.cash_sessions FOR UPDATE
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

NOTIFY pgrst, 'reload schema';
