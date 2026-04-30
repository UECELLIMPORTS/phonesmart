-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 009 — unificar múltiplos "Consumidor Final" em um só
--
-- Contexto: a função getOrCreateConsumidorFinal() no POS pega o PRIMEIRO
-- cliente com nome "Consumidor Final" e cpf_cnpj null. Mas ao longo do tempo
-- foram criados MÚLTIPLOS registros com esse nome. Vendas antigas apontam
-- pra instâncias diferentes, resultando em dados fragmentados.
--
-- Esta migração:
--   1. Elege o "Consumidor Final" CANÔNICO de cada tenant (o mais antigo)
--   2. Aponta todas as sales e service_orders dos duplicatas pro canônico
--   3. Deleta os duplicatas
--
-- É SEGURA pra Consumidor Final porque eles representam a mesma coisa
-- (vendas anônimas). Não aplicar em clientes com CPF/nome real.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. DIAGNÓSTICO — veja quantos Consumidor Final duplicados existem por tenant
-- SELECT tenant_id, COUNT(*) as total
--   FROM customers
--  WHERE full_name = 'Consumidor Final'
--    AND cpf_cnpj IS NULL
--  GROUP BY tenant_id
-- HAVING COUNT(*) > 1;

-- 2. APLICAR — em bloco transacional pra atomicidade
BEGIN;

-- CTE: identifica o canônico (mais antigo) por tenant
WITH canonical AS (
  SELECT DISTINCT ON (tenant_id)
         tenant_id,
         id AS canonical_id
    FROM customers
   WHERE full_name = 'Consumidor Final'
     AND cpf_cnpj IS NULL
   ORDER BY tenant_id, created_at ASC
),

-- CTE: lista todos os duplicatas (não-canônicos)
duplicates AS (
  SELECT c.id AS dup_id, c.tenant_id, can.canonical_id
    FROM customers c
    JOIN canonical can ON can.tenant_id = c.tenant_id
   WHERE c.full_name = 'Consumidor Final'
     AND c.cpf_cnpj IS NULL
     AND c.id != can.canonical_id
)

-- Atualiza sales dos duplicatas pro canônico
UPDATE sales s
   SET customer_id = d.canonical_id,
       updated_at  = NOW()
  FROM duplicates d
 WHERE s.customer_id = d.dup_id
   AND s.tenant_id   = d.tenant_id;

-- Mesma coisa pra service_orders (caso algum tenha ido pra lá)
WITH canonical AS (
  SELECT DISTINCT ON (tenant_id)
         tenant_id,
         id AS canonical_id
    FROM customers
   WHERE full_name = 'Consumidor Final'
     AND cpf_cnpj IS NULL
   ORDER BY tenant_id, created_at ASC
),
duplicates AS (
  SELECT c.id AS dup_id, c.tenant_id, can.canonical_id
    FROM customers c
    JOIN canonical can ON can.tenant_id = c.tenant_id
   WHERE c.full_name = 'Consumidor Final'
     AND c.cpf_cnpj IS NULL
     AND c.id != can.canonical_id
)
UPDATE service_orders so
   SET customer_id = d.canonical_id
  FROM duplicates d
 WHERE so.customer_id = d.dup_id
   AND so.tenant_id   = d.tenant_id;

-- Agora deleta os duplicatas (todas as FKs já foram redirecionadas)
WITH canonical AS (
  SELECT DISTINCT ON (tenant_id)
         tenant_id,
         id AS canonical_id
    FROM customers
   WHERE full_name = 'Consumidor Final'
     AND cpf_cnpj IS NULL
   ORDER BY tenant_id, created_at ASC
)
DELETE FROM customers c
 USING canonical can
 WHERE c.tenant_id = can.tenant_id
   AND c.full_name = 'Consumidor Final'
   AND c.cpf_cnpj IS NULL
   AND c.id != can.canonical_id;

COMMIT;

-- 3. VERIFICAR — deve retornar no máximo 1 Consumidor Final por tenant
SELECT tenant_id, COUNT(*) as total
  FROM customers
 WHERE full_name = 'Consumidor Final'
   AND cpf_cnpj IS NULL
 GROUP BY tenant_id
 ORDER BY total DESC;
