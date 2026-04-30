-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  032 — Módulo Fiscal (NF-e, NFC-e, NFS-e via Focus NFe)                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Fase 1 do módulo fiscal: schema básico pra suportar emissão de notas
-- fiscais via Focus NFe. Universal — atende qualquer regime tributário.
--
-- Tabelas:
-- - fiscal_configs: 1 row por tenant. Configuração fiscal (regime, IE, CSC,
--   certificado A1 path, etc). Inativada por padrão (enabled=false).
-- - fiscal_emissions: histórico de toda emissão. 1 row por NFe/NFC-e/NFS-e
--   tentada (autorizada, cancelada, rejeitada, etc).
--
-- Adições em products: NCM, CFOP, CST/CSOSN, unidade, origem (campos fiscais).

-- ──────────────────────────────────────────────────────────────────────────
-- 1. fiscal_configs
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fiscal_configs (
  tenant_id                UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Regime tributário (afeta cálculo de impostos na nota)
  regime                   TEXT NOT NULL DEFAULT 'simples_nacional'
    CHECK (regime IN ('simples_nacional', 'simples_excesso', 'normal', 'lucro_presumido', 'lucro_real')),

  -- Inscrições
  inscricao_estadual       TEXT,
  ie_isenta                BOOLEAN NOT NULL DEFAULT false,
  inscricao_municipal      TEXT,
  cnae                     TEXT,

  -- CSC pra NFC-e (Código de Segurança do Contribuinte — vem do portal SEFAZ)
  csc_id                   TEXT,
  csc_token                TEXT,            -- TODO: criptografar via pgsodium

  -- Certificado A1 (.pfx) — armazenado no Supabase Storage bucket privado
  certificate_path         TEXT,            -- ex: "tenants/{id}/cert.pfx"
  certificate_password     TEXT,            -- TODO: criptografar via pgsodium
  certificate_expires_at   DATE,

  -- Ambiente — começa SEMPRE em homologação (testes), só vai pra produção
  -- depois que tenant confirmar setup correto
  ambiente                 TEXT NOT NULL DEFAULT 'homologacao'
    CHECK (ambiente IN ('homologacao', 'producao')),

  -- Defaults pra emissão (podem ser overrided por produto)
  cfop_padrao              TEXT DEFAULT '5102',  -- venda merc adquirida ou recebida
  cst_csosn_padrao         TEXT DEFAULT '102',   -- Simples Nacional sem permissão de crédito

  -- Modo de emissão
  emission_mode            TEXT NOT NULL DEFAULT 'manual'
    CHECK (emission_mode IN ('manual', 'automatic', 'batch')),

  -- Endereço fiscal (pode diferir do tenant principal)
  endereco_logradouro      TEXT,
  endereco_numero          TEXT,
  endereco_complemento     TEXT,
  endereco_bairro          TEXT,
  endereco_cidade          TEXT,
  endereco_uf              TEXT,             -- 2 letras: SP, SE, etc
  endereco_cep             TEXT,             -- só dígitos
  endereco_codigo_municipio TEXT,            -- código IBGE 7 dígitos

  -- Numeração próxima emissão (cada série mantém seu contador)
  next_nfce_number         INTEGER NOT NULL DEFAULT 1,
  next_nfce_serie          INTEGER NOT NULL DEFAULT 1,
  next_nfe_number          INTEGER NOT NULL DEFAULT 1,
  next_nfe_serie           INTEGER NOT NULL DEFAULT 1,
  next_nfse_number         INTEGER NOT NULL DEFAULT 1,

  -- Quota mensal (0 = ilimitado, ou N notas/mês — controle do plano comercial)
  monthly_quota            INTEGER NOT NULL DEFAULT 0,

  -- Flag mestre — só emite se enabled=true
  enabled                  BOOLEAN NOT NULL DEFAULT false,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. fiscal_emissions
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fiscal_emissions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Origem: venda OR ordem de serviço (uma das duas, não as duas)
  sale_id                  UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  service_order_id         UUID REFERENCES public.service_orders(id) ON DELETE SET NULL,

  type                     TEXT NOT NULL
    CHECK (type IN ('nfce', 'nfe', 'nfse')),

  status                   TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'authorized', 'cancelled', 'rejected', 'inutilizada')),

  -- Identificadores SEFAZ
  numero                   INTEGER,
  serie                    INTEGER,
  chave_acesso             TEXT,             -- 44 dígitos da NF-e/NFC-e
  protocolo                TEXT,             -- protocolo de autorização

  -- Storage paths (XML + DANFE PDF — bucket privado)
  xml_path                 TEXT,
  pdf_path                 TEXT,

  ambiente                 TEXT NOT NULL
    CHECK (ambiente IN ('homologacao', 'producao')),

  total_cents              INTEGER NOT NULL,

  -- Snapshot do destinatário (preserva caso cliente seja editado/excluído)
  destinatario_nome        TEXT,
  destinatario_documento   TEXT,             -- CPF (11) ou CNPJ (14)
  destinatario_email       TEXT,

  -- Timestamps
  emitted_at               TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,
  cancellation_reason      TEXT,
  cancellation_protocolo   TEXT,
  rejection_message        TEXT,

  -- Integração Focus NFe
  focus_reference          TEXT,             -- ID interno (ex: 'nfce-tenant-123-001')
  focus_response           JSONB,            -- payload completo da última resposta

  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Indexes
-- ──────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_fiscal_emissions_tenant_emitted
  ON public.fiscal_emissions (tenant_id, emitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_fiscal_emissions_tenant_status
  ON public.fiscal_emissions (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_fiscal_emissions_sale
  ON public.fiscal_emissions (sale_id) WHERE sale_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_emissions_os
  ON public.fiscal_emissions (service_order_id) WHERE service_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_emissions_chave
  ON public.fiscal_emissions (chave_acesso) WHERE chave_acesso IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Adições em products — campos fiscais
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ncm TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cfop TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cst_csosn TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unidade TEXT DEFAULT 'UN';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT '0';

-- ──────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.fiscal_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_emissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fiscal_configs: tenant isolation"
  ON public.fiscal_configs FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "fiscal_emissions: tenant isolation"
  ON public.fiscal_emissions FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

NOTIFY pgrst, 'reload schema';
