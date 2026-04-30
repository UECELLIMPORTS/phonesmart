-- Migration 005 — peso bruto separado do peso líquido

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS gross_weight_g numeric(10,3);
