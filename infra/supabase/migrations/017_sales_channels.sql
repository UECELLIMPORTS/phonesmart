-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017 — Canal da venda + modalidade de entrega
--
-- Permite distinguir:
--   - Canal da venda (sale_channel): como a venda aconteceu
--     whatsapp | instagram_dm | delivery_online | fisica_balcao | fisica_retirada | outro
--
--   - Tipo de entrega (delivery_type): como o produto chegou ao cliente
--     counter  — entregue no balcão (cliente levou na hora)
--     pickup   — cliente retirou depois (venda online com retirada física)
--     shipping — enviado via transportadora / motoboy / correios
--
-- Objetivo: medir % de vendas online vs físicas, calcular o "efeito sustento"
-- (quanto % da "física" é na verdade retirada de venda online) e viabilizar
-- relatórios de break-even da loja física.
--
-- Aplicado em AMBAS as tabelas de venda:
--   - sales (vendas do PhoneSmart/POS)
--   - service_orders (OS do CheckSmart)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── sales ────────────────────────────────────────────────────────────────────

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sale_channel   text,
  ADD COLUMN IF NOT EXISTS delivery_type  text;

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_sale_channel_check;

ALTER TABLE sales
  ADD CONSTRAINT sales_sale_channel_check
  CHECK (sale_channel IS NULL OR sale_channel IN (
    'whatsapp', 'instagram_dm', 'delivery_online',
    'fisica_balcao', 'fisica_retirada', 'outro'
  ));

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_delivery_type_check;

ALTER TABLE sales
  ADD CONSTRAINT sales_delivery_type_check
  CHECK (delivery_type IS NULL OR delivery_type IN ('counter', 'pickup', 'shipping'));

CREATE INDEX IF NOT EXISTS sales_sale_channel_idx
  ON sales (tenant_id, sale_channel)
  WHERE sale_channel IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_delivery_type_idx
  ON sales (tenant_id, delivery_type)
  WHERE delivery_type IS NOT NULL;

COMMENT ON COLUMN sales.sale_channel IS
  'Canal pelo qual a venda aconteceu: whatsapp | instagram_dm | delivery_online | fisica_balcao | fisica_retirada | outro. NULL = não informado (vendas legadas).';
COMMENT ON COLUMN sales.delivery_type IS
  'Modalidade de entrega: counter (levou na hora) | pickup (retirou depois) | shipping (enviado). NULL = não informado.';

-- ── service_orders ───────────────────────────────────────────────────────────

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS sale_channel   text,
  ADD COLUMN IF NOT EXISTS delivery_type  text;

ALTER TABLE service_orders
  DROP CONSTRAINT IF EXISTS service_orders_sale_channel_check;

ALTER TABLE service_orders
  ADD CONSTRAINT service_orders_sale_channel_check
  CHECK (sale_channel IS NULL OR sale_channel IN (
    'whatsapp', 'instagram_dm', 'delivery_online',
    'fisica_balcao', 'fisica_retirada', 'outro'
  ));

ALTER TABLE service_orders
  DROP CONSTRAINT IF EXISTS service_orders_delivery_type_check;

ALTER TABLE service_orders
  ADD CONSTRAINT service_orders_delivery_type_check
  CHECK (delivery_type IS NULL OR delivery_type IN ('counter', 'pickup', 'shipping'));

CREATE INDEX IF NOT EXISTS service_orders_sale_channel_idx
  ON service_orders (tenant_id, sale_channel)
  WHERE sale_channel IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_orders_delivery_type_idx
  ON service_orders (tenant_id, delivery_type)
  WHERE delivery_type IS NOT NULL;

COMMENT ON COLUMN service_orders.sale_channel IS
  'Canal pelo qual a OS foi originada. Mesmos valores de sales.sale_channel.';
COMMENT ON COLUMN service_orders.delivery_type IS
  'Modalidade de entrega. Mesmos valores de sales.delivery_type.';
