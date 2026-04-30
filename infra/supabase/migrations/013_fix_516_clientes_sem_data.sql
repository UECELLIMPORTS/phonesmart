-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 013 — corrige 516 clientes sem "cliente desde" no Bling
--
-- Contexto: durante a importação do Bling (23/04/2026), 516 clientes tinham
-- o campo "Cliente desde" em branco na fonte. Como `customers.created_at`
-- tem DEFAULT NOW(), todos ficaram com a data da importação.
--
-- Solução escolhida: setar todos para `2023-01-01` — data simbólica que deixa
-- claro que são clientes "antigos" sem data confiável. Usar essa data
-- consistente em todos evita que apareçam no filtro "clientes novos" (30 dias)
-- erroneamente.
--
-- Depois disso, o usuário pode editar individualmente via modal quando
-- descobrir a data real de algum cliente (o campo "Cliente desde" no
-- modal de edição já é editável).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. DIAGNÓSTICO — conta quantos estão com a data da importação
-- (rode antes se quiser confirmar o número)
-- SELECT COUNT(*)
--   FROM customers
--  WHERE created_at::date = '2026-04-23';

-- 2. APLICAR — muda todos pra 2023-01-01
-- Só atualiza os que têm created_at exatamente em 23/04/2026 (data da importação)
UPDATE customers
   SET created_at = '2023-01-01T12:00:00+00:00',
       updated_at = NOW()
 WHERE created_at::date = '2026-04-23'
   AND cpf_cnpj IS NULL;  -- salvaguarda: só sem CPF (que é o caso desses 516)

-- 3. VERIFICAR resultado
SELECT
  created_at::date AS data,
  COUNT(*)         AS qtd
  FROM customers
 WHERE created_at::date IN ('2026-04-23', '2023-01-01')
 GROUP BY created_at::date
 ORDER BY data DESC;
