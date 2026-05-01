-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  039 — Device Acquisitions (compra de aparelho usado / troca)            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Estende product_serials com dados de aquisição. Cada IMEI carrega:
--   - quando foi adquirido
--   - de quem (cliente, fornecedor, troca)
--   - condição (A/B/C/defeito)
--   - valor pago (cost_cents — já existe)
--   - forma de pagamento
--   - se foi parte de uma troca, qual venda
--
-- Decisão arquitetural: colunas em product_serials em vez de tabela separada.
-- Cada IMEI físico tem 1 aquisição (entra na loja uma vez). Caso raro de
-- "comprou de novo o mesmo IMEI físico de outro cliente" é tratado via
-- atualização do registro + nota.

ALTER TABLE public.product_serials
  ADD COLUMN IF NOT EXISTS acquired_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acquired_from_type  TEXT
    CHECK (acquired_from_type IN ('customer', 'supplier', 'trade_in', 'other')),
  ADD COLUMN IF NOT EXISTS acquired_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_name       TEXT,
  ADD COLUMN IF NOT EXISTS condition           TEXT
    CHECK (condition IN ('A', 'B', 'C', 'defective')),
  ADD COLUMN IF NOT EXISTS payment_method      TEXT
    CHECK (payment_method IN ('cash', 'pix', 'transfer', 'card', 'trade_in_credit', 'mixed')),
  ADD COLUMN IF NOT EXISTS trade_in_sale_id    UUID REFERENCES public.sales(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.product_serials.acquired_at IS
  'Quando o aparelho foi adquirido pela loja.';
COMMENT ON COLUMN public.product_serials.acquired_from_type IS
  'Origem: customer (cliente vendeu), supplier (distribuidor), trade_in (troca), other.';
COMMENT ON COLUMN public.product_serials.condition IS
  'Estado físico do aparelho na entrada: A (impecável), B (bom), C (com sinais), defective.';
COMMENT ON COLUMN public.product_serials.trade_in_sale_id IS
  'Quando aquisição é parte de troca, aponta pra venda nova onde o usado entrou como abatimento.';

CREATE INDEX IF NOT EXISTS idx_product_serials_acquired_at
  ON public.product_serials(tenant_id, acquired_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_product_serials_acquired_customer
  ON public.product_serials(acquired_customer_id) WHERE acquired_customer_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
