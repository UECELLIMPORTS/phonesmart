-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  026 — Downgrade agendado pro próximo ciclo                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cliente pode mudar pra plano menor (downgrade), mas o efeito vale só no
-- próximo ciclo (sem reembolso da diferença). Modelo padrão SaaS.
--
-- Fluxo:
-- 1. User clica "Mudar plano" e escolhe plano menor que o atual
-- 2. Backend salva `pending_plan` e `pending_price_cents` na sub
-- 3. Backend chama PUT /v3/subscriptions/{id} no Asaas pra atualizar value
-- 4. Cliente continua com plano antigo (e features) até o ciclo expirar
-- 5. Webhook PAYMENT_RECEIVED da próxima cobrança detecta pending_plan,
--    aplica: plan_name = pending_plan, limpa pending
-- 6. Cliente passa a ver o novo plano e perde features do anterior

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pending_plan        TEXT,
  ADD COLUMN IF NOT EXISTS pending_price_cents INTEGER;

NOTIFY pgrst, 'reload schema';
