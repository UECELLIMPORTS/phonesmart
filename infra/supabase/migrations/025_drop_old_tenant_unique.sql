-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  025 — Remove constraint UNIQUE antiga em subscriptions(tenant_id)       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Histórico do problema:
-- - Schema original tinha UNIQUE(tenant_id) → cada tenant 1 sub total
-- - Migration 020 introduziu billing modular (4 produtos) e adicionou
--   UNIQUE (tenant_id, product) — mas esqueceu de DROPar a constraint antiga
-- - Resultado: tenant consegue assinar 1 produto; 2º falha com
--   "duplicate key value violates unique constraint subscriptions_tenant_id_key"
--
-- Fix: dropar a constraint legada. A nova UNIQUE(tenant_id, product) já
-- garante 1 sub por (tenant, produto), que é o comportamento correto.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tenant_id_key;

NOTIFY pgrst, 'reload schema';
