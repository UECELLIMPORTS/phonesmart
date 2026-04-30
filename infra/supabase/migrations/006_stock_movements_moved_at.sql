-- Migration 006 — data de negócio e depósito nos lançamentos de estoque

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS moved_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS depot    text;

-- Índice para ordenação eficiente por data de negócio
CREATE INDEX IF NOT EXISTS idx_stock_movements_moved_at
  ON stock_movements (product_id, tenant_id, moved_at DESC);
