-- Migration 003 — adiciona coluna category à tabela products

ALTER TABLE products ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
