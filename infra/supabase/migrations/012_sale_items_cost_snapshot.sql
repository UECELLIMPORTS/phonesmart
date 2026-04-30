-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012 — snapshot de custo em sale_items
--
-- Contexto: hoje o ERP Clientes calcula o lucro como
--   sale_items.unit_price_cents × quantity − products.cost_cents × quantity
-- Problema: products.cost_cents é o custo ATUAL. Se você mudar o custo depois,
-- o lucro de vendas antigas recalcula retroativamente, o que distorce
-- relatórios contábeis.
--
-- Solução: adicionar cost_snapshot_cents em sale_items, preenchido com o custo
-- corrente no momento da venda. O ERP Clientes passa a usar esse valor quando
-- existir (com fallback pro products.cost_cents atual, pra vendas antigas
-- que não têm snapshot).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS cost_snapshot_cents integer;

COMMENT ON COLUMN sale_items.cost_snapshot_cents IS
  'Custo do produto NO MOMENTO da venda (cópia de products.cost_cents). '
  'NULL para vendas feitas antes desta migração — ERP Clientes faz '
  'fallback para o custo atual.';

-- (Opcional) Backfill: preenche snapshot das vendas antigas com o custo atual.
-- Isso NÃO reconstrói o custo histórico (que foi perdido), mas evita que
-- mudanças futuras de custo afetem retroativamente essas vendas.
-- Descomente se quiser aplicar:
--
-- UPDATE sale_items si
--    SET cost_snapshot_cents = p.cost_cents
--   FROM products p
--  WHERE si.product_id = p.id
--    AND si.cost_snapshot_cents IS NULL;

-- Verificação
SELECT
  COUNT(*) AS total_sale_items,
  COUNT(cost_snapshot_cents) AS com_snapshot,
  COUNT(*) - COUNT(cost_snapshot_cents) AS sem_snapshot
  FROM sale_items;
