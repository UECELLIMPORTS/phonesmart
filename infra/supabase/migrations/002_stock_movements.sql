-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — stock_movements
-- Módulo de lançamentos de estoque (entrada/saída), espelhando o workflow do Bling
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabela de movimentações ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_movements (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid          NOT NULL,
  product_id            uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  type                  text          NOT NULL CHECK (type IN ('entrada', 'saida')),
  quantity              numeric(12,3) NOT NULL CHECK (quantity > 0),

  -- Preços em centavos (inteiros), zerados quando não se aplicam ao tipo
  purchase_price_cents  integer       NOT NULL DEFAULT 0,  -- preço de compra (entrada)
  cost_price_cents      integer       NOT NULL DEFAULT 0,  -- preço de custo  (entrada)
  sale_price_cents      integer       NOT NULL DEFAULT 0,  -- preço de venda  (saída)

  notes                 text,
  origin                text,         -- 'manual' | id de venda | id de OS, etc.

  created_at            timestamptz   NOT NULL DEFAULT now()
);

-- 2. Índices ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_stock_movements_tenant_id   ON stock_movements (tenant_id);
CREATE INDEX idx_stock_movements_product_id  ON stock_movements (product_id);
CREATE INDEX idx_stock_movements_created_at  ON stock_movements (created_at DESC);

-- 3. RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_movements: tenant isolation"
  ON stock_movements
  FOR ALL
  USING  (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- 4. Função para atualizar o produto após cada lançamento ─────────────────────
--    Entrada → soma estoque, atualiza preço de compra e custo
--    Saída   → subtrai estoque (mínimo 0)

CREATE OR REPLACE FUNCTION trg_sync_product_after_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.type = 'entrada' THEN
    UPDATE products SET
      stock_qty             = stock_qty + NEW.quantity,
      purchase_price_cents  = CASE WHEN NEW.purchase_price_cents > 0
                                   THEN NEW.purchase_price_cents
                                   ELSE purchase_price_cents END,
      cost_cents            = CASE WHEN NEW.cost_price_cents > 0
                                   THEN NEW.cost_price_cents
                                   ELSE cost_cents END,
      updated_at            = now()
    WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;

  ELSIF NEW.type = 'saida' THEN
    UPDATE products SET
      stock_qty  = GREATEST(0, stock_qty - NEW.quantity),
      updated_at = now()
    WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_after_stock_movement
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION trg_sync_product_after_movement();

-- 5. View de resumo por produto (usado no painel lateral) ─────────────────────

CREATE OR REPLACE VIEW stock_summary_by_product AS
SELECT
  product_id,
  tenant_id,
  COALESCE(SUM(quantity) FILTER (WHERE type = 'entrada'), 0)              AS total_entrada,
  COALESCE(SUM(purchase_price_cents * quantity)
           FILTER (WHERE type = 'entrada') / NULLIF(
             SUM(quantity) FILTER (WHERE type = 'entrada'), 0
           ), 0)::integer                                                   AS avg_purchase_price_cents,
  COALESCE(SUM(quantity) FILTER (WHERE type = 'saida'),  0)               AS total_saida,
  COALESCE(SUM(sale_price_cents * quantity)
           FILTER (WHERE type = 'saida') / NULLIF(
             SUM(quantity) FILTER (WHERE type = 'saida'), 0
           ), 0)::integer                                                   AS avg_sale_price_cents
FROM stock_movements
GROUP BY product_id, tenant_id;
