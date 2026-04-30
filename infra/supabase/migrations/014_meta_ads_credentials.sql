-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 014 — credenciais do Meta Ads por tenant
--
-- Cada tenant (loja) tem sua própria conta Meta Business. As credenciais
-- ficam aqui e são consultadas pelo módulo /meta-ads.
--
-- Segurança:
--   - RLS estrito: só o próprio tenant vê suas credenciais
--   - app_secret e access_token devem ser tratados como secretos
--     (considerar encryption at-rest no futuro via pgcrypto)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_ads_credentials (
  id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid         NOT NULL UNIQUE,
  app_id             text         NOT NULL,
  app_secret         text         NOT NULL,
  access_token       text         NOT NULL,
  ad_account_id      text         NOT NULL,  -- formato "act_XXXXXXXXX"
  business_id        text,                    -- opcional
  token_expires_at   timestamptz,
  last_sync_at       timestamptz,
  last_error         text,                    -- última mensagem de erro da API
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_ads_credentials_tenant_idx
  ON meta_ads_credentials (tenant_id);

-- RLS
ALTER TABLE meta_ads_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_ads_credentials: tenant isolation" ON meta_ads_credentials;
CREATE POLICY "meta_ads_credentials: tenant isolation"
  ON meta_ads_credentials
  FOR ALL
  USING     (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

COMMENT ON TABLE  meta_ads_credentials IS 'Credenciais do Meta Ads API por tenant. Uma linha por loja.';
COMMENT ON COLUMN meta_ads_credentials.access_token   IS 'Long-lived user access token (60 dias) ou system user token.';
COMMENT ON COLUMN meta_ads_credentials.ad_account_id  IS 'Formato act_XXXXXXXXX — pega no Meta Ads Manager.';
