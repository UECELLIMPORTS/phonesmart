-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 015 — múltiplas contas Meta Ads + código de campanha no cliente
--
-- Duas mudanças independentes mas do mesmo domínio (Meta Ads attribution):
--
-- 1) customers.campaign_code
--    Código identificador da campanha que trouxe o cliente (ex: "HJ-VAI-1").
--    Populado manualmente quando atendente lê a mensagem pré-preenchida do
--    anúncio Click-to-WhatsApp. Permite ROAS por campanha específica, não só
--    por canal.
--
-- 2) meta_ads_ad_accounts
--    Um tenant pode ter várias contas de anúncios no mesmo Business Manager
--    (ex: 3 contas no BM "Felipe Ferreira-BM MÃE"). O mesmo access_token
--    cobre todas, mas cada conta tem seu próprio ad_account_id, nome e moeda.
--    Esta tabela substitui o campo ad_account_id em meta_ads_credentials
--    (mantido por ora como legacy — será removido em migration futura quando
--    /meta-ads/configuracoes e o dashboard migrarem pra ler daqui).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Código da campanha no cliente ──────────────────────────────────────────

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS campaign_code text;

CREATE INDEX IF NOT EXISTS customers_campaign_code_idx
  ON customers (tenant_id, campaign_code)
  WHERE campaign_code IS NOT NULL;

COMMENT ON COLUMN customers.campaign_code IS
  'Código identificador da campanha Meta Ads (ex: "HJ-VAI-1"). Preenchido manualmente a partir da mensagem pré-preenchida dos anúncios Click-to-WhatsApp. Usado para cálculo de ROAS por campanha.';

-- ── 2) Múltiplas contas de anúncios por tenant ────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_ads_ad_accounts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  credentials_id  uuid        NOT NULL REFERENCES meta_ads_credentials(id) ON DELETE CASCADE,
  ad_account_id   text        NOT NULL,    -- formato "act_XXXXXXXXX"
  display_name    text        NOT NULL,    -- ex: "Dunald Rebouças", "Victoria Auto Peças"
  currency        text,                    -- "BRL", "USD"... preenchido no test-connection
  is_primary      boolean     NOT NULL DEFAULT false,
  is_active       boolean     NOT NULL DEFAULT true,
  last_sync_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, ad_account_id)
);

CREATE INDEX IF NOT EXISTS meta_ads_ad_accounts_tenant_idx
  ON meta_ads_ad_accounts (tenant_id);

CREATE INDEX IF NOT EXISTS meta_ads_ad_accounts_credentials_idx
  ON meta_ads_ad_accounts (credentials_id);

-- Só 1 conta primária por tenant (partial unique index — forma idiomática em Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS meta_ads_ad_accounts_one_primary_per_tenant_idx
  ON meta_ads_ad_accounts (tenant_id)
  WHERE is_primary = true;

-- RLS — mesmo padrão das outras tabelas
ALTER TABLE meta_ads_ad_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_ads_ad_accounts: tenant isolation" ON meta_ads_ad_accounts;
CREATE POLICY "meta_ads_ad_accounts: tenant isolation"
  ON meta_ads_ad_accounts
  FOR ALL
  USING     (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

COMMENT ON TABLE  meta_ads_ad_accounts IS 'Contas de anúncios do Meta vinculadas ao tenant. Um tenant pode ter N contas sob a mesma credencial (access_token compartilhado).';
COMMENT ON COLUMN meta_ads_ad_accounts.is_primary IS 'Conta default quando nenhuma é explicitamente selecionada no dashboard. Apenas 1 true por tenant (enforçado por unique index parcial).';
COMMENT ON COLUMN meta_ads_ad_accounts.currency  IS 'Código ISO 4217 (ex: BRL, USD). Preenchido automaticamente ao testar conexão.';

-- ── 3) Backfill — migra ad_account_id atual de meta_ads_credentials ───────────
-- Cada credencial existente vira 1 conta primária na nova tabela.
-- Idempotente: só insere se ainda não houver nenhuma conta pra aquele tenant.

INSERT INTO meta_ads_ad_accounts (tenant_id, credentials_id, ad_account_id, display_name, is_primary, is_active)
SELECT
  c.tenant_id,
  c.id,
  c.ad_account_id,
  'Conta principal',   -- placeholder; usuário renomeia pela UI depois
  true,
  true
FROM meta_ads_credentials c
WHERE NOT EXISTS (
  SELECT 1 FROM meta_ads_ad_accounts a
  WHERE a.tenant_id = c.tenant_id
);

-- ── 4) Marca ad_account_id de meta_ads_credentials como legacy ────────────────

COMMENT ON COLUMN meta_ads_credentials.ad_account_id IS
  'LEGACY — será removido em migration futura. Fonte de verdade agora é meta_ads_ad_accounts (1:N por credencial).';
