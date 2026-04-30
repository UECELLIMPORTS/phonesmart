-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011 — recriar índice único de WhatsApp por tenant
--
-- Contexto: o índice `customers_tenant_whatsapp_unique` foi removido em
-- 23/04/2026 porque a importação do Bling tinha muitos WhatsApps duplicados.
-- Agora que os dados estão mais limpos (depois de rodar as migrações 009 e
-- da revisão manual de duplicados da 010), esta migração recria o índice.
--
-- Segurança: NÃO cria o índice se ainda existirem duplicatas — em vez disso
-- lança um erro apontando quantos grupos precisam ser resolvidos primeiro.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  dup_count int;
BEGIN
  -- Verifica quantos grupos de WhatsApp duplicado existem
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT tenant_id, whatsapp
      FROM customers
     WHERE whatsapp IS NOT NULL
     GROUP BY tenant_id, whatsapp
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Ainda há % grupos de WhatsApp duplicado no banco. '
      'Rode a query 3 da migração 010_diagnostico_duplicados.sql para '
      'ver quais são, e aplique o merge manual antes de criar o índice.',
      dup_count;
  END IF;

  -- Tudo limpo — cria o índice único parcial (ignora whatsapp NULL)
  CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_whatsapp_unique
    ON customers(tenant_id, whatsapp)
    WHERE whatsapp IS NOT NULL;

  RAISE NOTICE 'Índice customers_tenant_whatsapp_unique criado com sucesso.';
END $$;

-- Verificação final
SELECT
  indexname,
  indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename  = 'customers'
   AND indexname  = 'customers_tenant_whatsapp_unique';
