-- Migration 007 — origem do cliente ("Como nos conheceu?")
-- Campo opcional em customers. É a fonte única usada por PhoneSmart e CheckSmart
-- (cadastro de cliente, abertura de OS, Frente de Caixa, dashboards e relatórios).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS origin text;

-- Constraint garante que só os valores pré-definidos são aceitos (ou NULL).
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_origin_check;

ALTER TABLE customers
  ADD CONSTRAINT customers_origin_check
  CHECK (origin IS NULL OR origin IN (
    'instagram_pago',
    'instagram_organico',
    'indicacao',
    'passou_na_porta',
    'google',
    'facebook',
    'outros'
  ));

-- Índice parcial para acelerar agregações por origem nos relatórios/dashboards.
CREATE INDEX IF NOT EXISTS customers_origin_idx
  ON customers (origin)
  WHERE origin IS NOT NULL;

COMMENT ON COLUMN customers.origin IS
  'Como o cliente conheceu a empresa. Valores: instagram_pago, instagram_organico, indicacao, passou_na_porta, google, facebook, outros. NULL = não informado.';
