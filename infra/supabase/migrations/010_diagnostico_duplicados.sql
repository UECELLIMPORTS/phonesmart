-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010 — DIAGNÓSTICO de clientes duplicados (só SELECTs)
--
-- ⚠️ Esta migração NÃO modifica dados. Ela só lista os clientes duplicados
-- para você revisar e decidir caso a caso se são realmente duplicatas ou se
-- são pessoas diferentes com o mesmo nome.
--
-- Depois de revisar, use a 010b_merge_manual_duplicados.sql (você mesmo edita
-- com os IDs específicos).
-- ─────────────────────────────────────────────────────────────────────────────

-- QUERY 1: grupos de clientes com MESMO NOME (exato) no mesmo tenant
-- Provavelmente duplicatas, mas pode ter pessoas diferentes com mesmo nome
SELECT
  tenant_id,
  full_name,
  COUNT(*) AS qtd_duplicatas,
  ARRAY_AGG(id ORDER BY created_at ASC) AS ids_do_grupo,
  ARRAY_AGG(cpf_cnpj ORDER BY created_at ASC) AS cpfs,
  ARRAY_AGG(whatsapp ORDER BY created_at ASC) AS whatsapps,
  MIN(created_at) AS mais_antigo,
  MAX(created_at) AS mais_recente
FROM customers
GROUP BY tenant_id, full_name
HAVING COUNT(*) > 1
ORDER BY qtd_duplicatas DESC, full_name
LIMIT 200;

-- QUERY 2: grupos com MESMO CPF (definitivamente duplicata — CPF é único por pessoa)
SELECT
  tenant_id,
  cpf_cnpj,
  COUNT(*) AS qtd_duplicatas,
  ARRAY_AGG(id ORDER BY created_at ASC) AS ids_do_grupo,
  ARRAY_AGG(full_name ORDER BY created_at ASC) AS nomes,
  MIN(created_at) AS mais_antigo
FROM customers
WHERE cpf_cnpj IS NOT NULL
GROUP BY tenant_id, cpf_cnpj
HAVING COUNT(*) > 1
ORDER BY qtd_duplicatas DESC;

-- QUERY 3: grupos com MESMO WHATSAPP
-- Pode ser duplicata OU família compartilhando o número — precisa revisão
SELECT
  tenant_id,
  whatsapp,
  COUNT(*) AS qtd_duplicatas,
  ARRAY_AGG(id ORDER BY created_at ASC) AS ids_do_grupo,
  ARRAY_AGG(full_name ORDER BY created_at ASC) AS nomes,
  ARRAY_AGG(cpf_cnpj ORDER BY created_at ASC) AS cpfs
FROM customers
WHERE whatsapp IS NOT NULL
GROUP BY tenant_id, whatsapp
HAVING COUNT(*) > 1
ORDER BY qtd_duplicatas DESC
LIMIT 100;

-- QUERY 4: resumo geral
SELECT
  (SELECT COUNT(*) FROM (
     SELECT tenant_id, full_name FROM customers
      GROUP BY tenant_id, full_name HAVING COUNT(*) > 1
   ) x) AS grupos_nome_duplicado,
  (SELECT COUNT(*) FROM (
     SELECT tenant_id, cpf_cnpj FROM customers
      WHERE cpf_cnpj IS NOT NULL
      GROUP BY tenant_id, cpf_cnpj HAVING COUNT(*) > 1
   ) x) AS grupos_cpf_duplicado,
  (SELECT COUNT(*) FROM (
     SELECT tenant_id, whatsapp FROM customers
      WHERE whatsapp IS NOT NULL
      GROUP BY tenant_id, whatsapp HAVING COUNT(*) > 1
   ) x) AS grupos_whatsapp_duplicado;

-- ─────────────────────────────────────────────────────────────────────────────
-- Como proceder depois:
--
-- CASO 1 — CPF igual: quase certo duplicata. Escolha o canônico (mais velho
-- ou mais completo), use o template abaixo:
--
--   BEGIN;
--   UPDATE sales          SET customer_id = '<CANONICAL_ID>' WHERE customer_id = '<DUP_ID>';
--   UPDATE service_orders SET customer_id = '<CANONICAL_ID>' WHERE customer_id = '<DUP_ID>';
--   DELETE FROM customers WHERE id = '<DUP_ID>';
--   COMMIT;
--
-- CASO 2 — Só nome igual: cuidado — pode ser dois Joãos diferentes.
-- Cheque CPF/WhatsApp/endereço antes de mesclar.
--
-- CASO 3 — Só WhatsApp igual: pode ser família. Só mescle se nome E CPF
-- também forem iguais.
-- ─────────────────────────────────────────────────────────────────────────────
