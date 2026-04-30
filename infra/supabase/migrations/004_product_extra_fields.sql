-- Migration 004 — campos extras no produto (formato, condição, GTIN, peso, dimensões, estoque min/max, localização)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS format    text NOT NULL DEFAULT 'simples',
  ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'novo',
  ADD COLUMN IF NOT EXISTS gtin      text,
  ADD COLUMN IF NOT EXISTS weight_g  numeric(10,3),
  ADD COLUMN IF NOT EXISTS height_cm numeric(10,2),
  ADD COLUMN IF NOT EXISTS width_cm  numeric(10,2),
  ADD COLUMN IF NOT EXISTS depth_cm  numeric(10,2),
  ADD COLUMN IF NOT EXISTS stock_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_max integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location  text;
