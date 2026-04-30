-- ╔══════════════════════════════════════════════════════════════════╗
-- ║ PhoneSmart — Init completo (CheckSmart 001-018 + SmartERP 001b-037) ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════════
-- 001_initial_schema.sql (CheckSmart base)
-- ════════════════════════════════════════════════════════════════════════════
-- ============================================================
-- CheckSmart — 001_initial_schema.sql
-- Versão: 1.0.0
-- Aplicar no Supabase SQL Editor (Dashboard → SQL Editor)
-- ATENÇÃO: Execute em um banco limpo. Não re-executar em produção.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 1: EXTENSÕES
-- ════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "unaccent";  -- buscas sem acento


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 2: FUNÇÕES HELPER
-- ════════════════════════════════════════════════════════════

-- ── public.tenant_id() ─────────────────────────────────────────────────────
--
-- Extrai o tenant_id do JWT emitido pelo Supabase Auth.
-- Usada em TODAS as políticas RLS como única fonte de verdade do tenant.
--
-- O valor é injetado automaticamente no JWT pelo custom_access_token_hook
-- (Seção 2-B), que lê a tabela tenant_members quando o token é emitido.
--
-- Estrutura relevante do JWT Supabase:
-- {
--   "sub":  "uuid-do-usuario",          ← auth.uid()
--   "role": "authenticated",
--   "app_metadata": {
--     "provider": "email",
--     "tenant_id":   "uuid-do-tenant",  ← public.tenant_id()  ✓
--     "tenant_role": "owner"            ← public.tenant_role() ✓
--   }
-- }
--
-- Retorna NULL (não UUID vazio) se o claim estiver ausente,
-- o que faz as políticas RLS falharem de forma segura (sem acesso).
CREATE OR REPLACE FUNCTION public.tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT NULLIF(
    TRIM(COALESCE(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')),
    ''
  )::UUID;
$$;

-- ── public.tenant_role() ───────────────────────────────────────────────────
--
-- Extrai o role do usuário no tenant ativo a partir do JWT.
-- Valores válidos: 'owner' | 'manager' | 'technician' | 'viewer'
-- Retorna NULL se ausente → políticas que checam role falham de forma segura.
--
-- Hierarquia de permissões:
--   owner      → acesso total (configurações, financeiro, deleção)
--   manager    → acesso total exceto configurações críticas do tenant
--   technician → criação e edição de OS, clientes, checklists
--   viewer     → somente leitura
CREATE OR REPLACE FUNCTION public.tenant_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT NULLIF(
    TRIM(COALESCE(auth.jwt() -> 'app_metadata' ->> 'tenant_role', '')),
    ''
  );
$$;

-- Função genérica para atualizar a coluna updated_at automaticamente.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 2-B: CUSTOM ACCESS TOKEN HOOK
-- ════════════════════════════════════════════════════════════
--
-- Este hook é chamado pelo Supabase Auth TODA VEZ que um JWT é emitido
-- (login inicial e refresh de token). Ele injeta tenant_id e tenant_role
-- no app_metadata do JWT, alimentando as funções public.tenant_id() e
-- public.tenant_role() usadas nas políticas RLS.
--
-- ── COMO REGISTRAR NO SUPABASE ───────────────────────────────────────────
-- 1. Acesse: Dashboard → Authentication → Hooks
-- 2. Em "Custom Access Token Hook", selecione:
--      Schema: public  |  Function: custom_access_token_hook
-- 3. Salve. O hook será acionado automaticamente a cada emissão de JWT.
--
-- ── FLUXO COMPLETO ───────────────────────────────────────────────────────
--  Usuário faz login
--       │
--       ▼
--  Supabase Auth emite JWT → chama este hook
--       │
--       ▼
--  Hook consulta tenant_members WHERE user_id = usuario
--       │
--       ├── Tem tenant → injeta tenant_id + tenant_role no app_metadata
--       └── Sem tenant → app_metadata sem tenant_id (novo usuário)
--                             → Next.js middleware redireciona p/ /onboarding
--
-- ── SUPORTE A MÚLTIPLOS TENANTS ──────────────────────────────────────────
-- O hook seleciona o tenant de role mais alta (owner > manager > ...).
-- Troca de tenant ativo: Server Action atualiza auth.users.app_metadata
-- via service_role key, depois chama supabase.auth.refreshSession().
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID;
  v_tenant_id    UUID;
  v_tenant_role  TEXT;
  v_claims       jsonb;
  v_app_metadata jsonb;
BEGIN
  -- 1. Extrai o user_id do evento recebido pelo hook
  v_user_id := (event ->> 'user_id')::UUID;

  -- 2. Busca o tenant ativo do usuário na tabela tenant_members.
  --    Critério de desempate quando há múltiplos tenants:
  --    prioridade pelo role mais alto, depois pelo mais antigo (joined_at).
  SELECT tm.tenant_id, tm.role
  INTO   v_tenant_id, v_tenant_role
  FROM   public.tenant_members tm
  WHERE  tm.user_id   = v_user_id
    AND  tm.is_active = TRUE
  ORDER BY
    CASE tm.role
      WHEN 'owner'      THEN 1
      WHEN 'manager'    THEN 2
      WHEN 'technician' THEN 3
      WHEN 'viewer'     THEN 4
      ELSE 5
    END ASC,
    tm.joined_at ASC NULLS LAST
  LIMIT 1;

  -- 3. Prepara claims e app_metadata atuais (preserva campos existentes)
  v_claims       := event -> 'claims';
  v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);

  -- 4. Injeta tenant_id e tenant_role SOMENTE se o usuário tiver um tenant.
  --    Usuários sem tenant (recém-cadastrados) recebem JWT sem esses campos
  --    e o middleware Next.js os redireciona para /onboarding.
  IF v_tenant_id IS NOT NULL THEN
    v_app_metadata := v_app_metadata
      || jsonb_build_object(
           'tenant_id',   v_tenant_id::TEXT,
           'tenant_role', v_tenant_role
         );
  END IF;

  -- 5. Reconstrói o evento com os claims atualizados e retorna
  v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_metadata);
  RETURN jsonb_set(event, '{claims}', v_claims);

EXCEPTION WHEN OTHERS THEN
  -- Em caso de erro inesperado, retorna o evento original sem modificação.
  -- O usuário consegue logar, mas sem tenant_id (RLS bloqueará os dados).
  RAISE WARNING '[custom_access_token_hook] Erro ao processar user_id=%: %', v_user_id, SQLERRM;
  RETURN event;
END;
$$;

-- Permissões: apenas o sistema de auth do Supabase pode invocar este hook.
-- Usuários autenticados e anônimos NÃO podem chamá-lo diretamente.
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 3: TABELAS CORE
-- ════════════════════════════════════════════════════════════

-- ------------------------------------------------------------
-- TENANTS — Assistências técnicas cadastradas no sistema
-- ------------------------------------------------------------
CREATE TABLE public.tenants (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  slug              TEXT        UNIQUE NOT NULL,           -- URL-friendly: "ue-cell-imports"
  cnpj              TEXT,
  ie                TEXT,                                  -- Inscrição Estadual
  phone             TEXT,
  whatsapp          TEXT,
  email             TEXT,
  address_street    TEXT,
  address_number    TEXT,
  address_complement TEXT,
  address_district  TEXT,
  address_city      TEXT,
  address_state     TEXT        NOT NULL DEFAULT 'SE',
  address_zip       TEXT,
  logo_url          TEXT,                                  -- Supabase Storage URL
  warranty_days     INT         NOT NULL DEFAULT 90,       -- dias de garantia
  pickup_days       INT         NOT NULL DEFAULT 30,       -- prazo para retirada
  custom_header     TEXT,                                  -- cabeçalho extra no PDF
  custom_footer     TEXT,                                  -- rodapé extra no PDF
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- SUBSCRIPTIONS — Assinaturas (preparado para Asaas/Stripe)
-- ------------------------------------------------------------
CREATE TABLE public.subscriptions (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status                    TEXT        NOT NULL DEFAULT 'trial'
                            CHECK (status IN ('trial', 'active', 'late', 'inactive', 'cancelled')),
  plan_name                 TEXT        NOT NULL DEFAULT 'starter',
  price_cents               INT         NOT NULL DEFAULT 4700,   -- R$ 47,00
  trial_ends_at             TIMESTAMPTZ,
  current_period_start      TIMESTAMPTZ,
  current_period_end        TIMESTAMPTZ,
  -- Integração futura com gateway de pagamento
  gateway                   TEXT        CHECK (gateway IN ('asaas', 'stripe', 'manual')),
  gateway_customer_id       TEXT,
  gateway_subscription_id   TEXT,
  last_payment_at           TIMESTAMPTZ,
  next_payment_at           TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)
);

-- ------------------------------------------------------------
-- PROFILES — Extensão do auth.users com dados do usuário
-- ------------------------------------------------------------
CREATE TABLE public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT        NOT NULL,
  phone       TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TENANT_MEMBERS — Quais usuários pertencem a qual tenant
-- Um usuário pode ser membro de múltiplos tenants,
-- mas o app_metadata guarda o tenant "ativo" no JWT.
-- ------------------------------------------------------------
CREATE TABLE public.tenant_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        TEXT        NOT NULL DEFAULT 'technician'
              CHECK (role IN ('owner', 'manager', 'technician', 'viewer')),
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  invited_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at   TIMESTAMPTZ,
  UNIQUE (tenant_id, user_id)
);


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 4: CATÁLOGO DE APARELHOS
-- ════════════════════════════════════════════════════════════

-- ------------------------------------------------------------
-- DEVICE_BRANDS — Marcas de aparelhos
-- is_system=TRUE e tenant_id=NULL → marca global do sistema (seed)
-- is_system=FALSE e tenant_id≠NULL → marca customizada pelo tenant
-- ------------------------------------------------------------
CREATE TABLE public.device_brands (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  logo_url    TEXT,
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
  tenant_id   UUID        REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INT         NOT NULL DEFAULT 999,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

-- Marcas globais não têm tenant_id; garantimos unicidade do nome entre globais:
CREATE UNIQUE INDEX idx_brands_global_name ON public.device_brands(name) WHERE tenant_id IS NULL;

-- ------------------------------------------------------------
-- DEVICE_MODELS — Modelos de aparelhos
-- Mesma lógica de isolamento de device_brands
-- ------------------------------------------------------------
CREATE TABLE public.device_models (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id    UUID        NOT NULL REFERENCES public.device_brands(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  is_system   BOOLEAN     NOT NULL DEFAULT FALSE,
  tenant_id   UUID        REFERENCES public.tenants(id) ON DELETE CASCADE,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_device_models_unique
  ON public.device_models (brand_id, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::UUID), name);


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 5: CLIENTES
-- ════════════════════════════════════════════════════════════

CREATE TABLE public.customers (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name           TEXT        NOT NULL,
  cpf_cnpj            TEXT,
  whatsapp            TEXT,
  email               TEXT,
  address_street      TEXT,
  address_number      TEXT,
  address_complement  TEXT,
  address_district    TEXT,
  address_city        TEXT,
  address_state       TEXT,
  address_zip         TEXT,
  notes               TEXT,
  created_by          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 6: ORDENS DE SERVIÇO
-- ════════════════════════════════════════════════════════════

-- Contador atômico por tenant+ano para numeração de OS sem race condition
CREATE TABLE public.tenant_order_counters (
  tenant_id   UUID    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year        INT     NOT NULL,
  counter     INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, year)
);

-- ------------------------------------------------------------
-- SERVICE_ORDERS — Coração do sistema
-- ------------------------------------------------------------
CREATE TABLE public.service_orders (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_number          TEXT        NOT NULL,              -- "OS-2025-0001" (gerado por trigger)
  customer_id           UUID        NOT NULL REFERENCES public.customers(id),

  -- Dados do aparelho (desnormalizados: preserva histórico se modelo for excluído)
  brand_id              UUID        REFERENCES public.device_brands(id) ON DELETE SET NULL,
  model_id              UUID        REFERENCES public.device_models(id) ON DELETE SET NULL,
  brand_name            TEXT        NOT NULL,
  model_name            TEXT        NOT NULL,
  color                 TEXT,
  storage               TEXT,                              -- "128GB", "256GB"
  imei                  TEXT,
  serial_number         TEXT,
  password              TEXT,                              -- senha/padrão (armazenar com cuidado)
  password_type         TEXT
                        CHECK (password_type IN ('pin', 'pattern', 'password', 'none', 'unknown')),

  -- ─── LÓGICA CRÍTICA: APARELHO APAGADO ───────────────────
  -- Se powers_on = FALSE:
  --   • inoperative_clause vira TRUE (trigger)
  --   • todos os checklist_items criados com is_blocked=TRUE, status='not_tested'
  --   • PDF inclui adendo jurídico de isenção por defeitos ocultos
  powers_on             BOOLEAN     NOT NULL DEFAULT TRUE,
  inoperative_clause    BOOLEAN     NOT NULL DEFAULT FALSE, -- sincronizado via trigger
  -- ────────────────────────────────────────────────────────

  -- Condição física
  physical_condition    TEXT        NOT NULL DEFAULT 'good'
                        CHECK (physical_condition IN ('like_new', 'good', 'fair', 'damaged', 'heavily_damaged')),
  physical_notes        TEXT,                              -- "Tela trincada, canto amassado"
  accessories           TEXT[],                            -- ['Carregador','Capa','Caixa']

  -- Problema e diagnóstico
  reported_issue        TEXT        NOT NULL,
  diagnosis             TEXT,
  repair_description    TEXT,

  -- Status do fluxo
  status                TEXT        NOT NULL DEFAULT 'received'
                        CHECK (status IN (
                          'received',       -- Recebido
                          'diagnosing',     -- Em diagnóstico
                          'waiting_parts',  -- Aguardando peça
                          'in_repair',      -- Em reparo
                          'ready',          -- Pronto para retirada
                          'delivered',      -- Entregue
                          'cancelled'       -- Cancelado
                        )),

  -- ─── FINANCEIRO (em centavos → evita erros de float) ────
  parts_cost_cents      INT         NOT NULL DEFAULT 0  CHECK (parts_cost_cents >= 0),
  service_price_cents   INT         NOT NULL DEFAULT 0  CHECK (service_price_cents >= 0),
  discount_cents        INT         NOT NULL DEFAULT 0  CHECK (discount_cents >= 0),
  total_price_cents     INT         GENERATED ALWAYS AS (service_price_cents - discount_cents) STORED,
  profit_cents          INT         GENERATED ALWAYS AS (service_price_cents - discount_cents - parts_cost_cents) STORED,
  payment_method        TEXT
                        CHECK (payment_method IN ('cash', 'pix', 'credit_card', 'debit_card', 'transfer', 'pending')),
  payment_installments  INT         DEFAULT 1,
  paid_at               TIMESTAMPTZ,
  -- ────────────────────────────────────────────────────────

  -- Assinaturas digitais (URLs do Supabase Storage)
  entry_signature_url   TEXT,
  exit_signature_url    TEXT,

  -- Datas
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estimated_at          TIMESTAMPTZ,
  pickup_deadline_at    TIMESTAMPTZ,                       -- preenchido pelo trigger
  ready_at              TIMESTAMPTZ,
  delivered_at          TIMESTAMPTZ,

  -- Rastreabilidade
  created_by            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_to           UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, order_number)
);


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 7: DETALHES DA OS
-- ════════════════════════════════════════════════════════════

-- ------------------------------------------------------------
-- CHECKLIST_ITEMS_TEMPLATE — Itens padrão gerenciados pelo sistema
-- Todos os tenants usam este template como base.
-- Inserções via seed/migrations; sem escrita pelo client.
-- ------------------------------------------------------------
CREATE TABLE public.checklist_items_template (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT    NOT NULL
              CHECK (category IN ('display', 'camera', 'audio', 'connectivity', 'hardware', 'software')),
  item_key    TEXT    NOT NULL UNIQUE,             -- ex: 'hw_battery' (estável, nunca renomear)
  label_pt    TEXT    NOT NULL,                    -- ex: 'Bateria / Carregamento'
  sort_order  INT     NOT NULL DEFAULT 999,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- CHECKLIST_ITEMS — Snapshot imutável dos itens por OS
-- Criados no momento de abertura da OS (entry) e entrega (exit).
-- Garante comparativo histórico mesmo se o template mudar.
-- ------------------------------------------------------------
CREATE TABLE public.checklist_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id         UUID        NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  template_item_id UUID        REFERENCES public.checklist_items_template(id) ON DELETE SET NULL,
  phase            TEXT        NOT NULL CHECK (phase IN ('entry', 'exit')),

  -- Dados desnormalizados do template (snapshot)
  category         TEXT        NOT NULL,
  item_key         TEXT        NOT NULL,
  label_pt         TEXT        NOT NULL,

  -- Status do item
  status           TEXT        NOT NULL DEFAULT 'not_tested'
                   CHECK (status IN (
                     'ok',           -- Funcionando normalmente
                     'nok',          -- Com defeito
                     'not_tested',   -- Não testado (padrão para aparelho apagado)
                     'na'            -- Não se aplica (ex: P2 em modelo sem P2)
                   )),
  notes            TEXT,

  -- is_blocked=TRUE quando powers_on=FALSE: impede edição via RLS e frontend
  is_blocked       BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (order_id, phase, item_key)
);

-- ------------------------------------------------------------
-- ORDER_PHOTOS — Fotos por OS (máx 4 por fase)
-- ------------------------------------------------------------
CREATE TABLE public.order_photos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id      UUID        NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  storage_path  TEXT        NOT NULL,    -- ex: "tenant-uuid/orders/order-uuid/entry/1.jpg"
  storage_url   TEXT        NOT NULL,    -- URL pública ou signed URL
  phase         TEXT        NOT NULL CHECK (phase IN ('entry', 'exit')),
  position      INT         NOT NULL CHECK (position BETWEEN 1 AND 4),
  uploaded_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, phase, position)
);

-- ------------------------------------------------------------
-- ORDER_PARTS — Peças utilizadas no reparo
-- ------------------------------------------------------------
CREATE TABLE public.order_parts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id         UUID        NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  quantity         INT         NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost_cents  INT         NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  total_cost_cents INT         GENERATED ALWAYS AS (quantity * unit_cost_cents) STORED,
  supplier         TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- ORDER_STATUS_LOGS — Auditoria de mudanças de status
-- Alimentado exclusivamente por trigger (SECURITY DEFINER).
-- ------------------------------------------------------------
CREATE TABLE public.order_status_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id    UUID        NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT        NOT NULL,
  notes       TEXT,
  changed_by  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 8: ÍNDICES DE PERFORMANCE
-- ════════════════════════════════════════════════════════════

-- tenants
CREATE INDEX idx_tenants_slug               ON public.tenants(slug);

-- customers
CREATE INDEX idx_customers_tenant           ON public.customers(tenant_id);
CREATE INDEX idx_customers_name             ON public.customers(tenant_id, full_name);
CREATE INDEX idx_customers_cpf              ON public.customers(tenant_id, cpf_cnpj)
                                            WHERE cpf_cnpj IS NOT NULL;
CREATE INDEX idx_customers_whatsapp         ON public.customers(tenant_id, whatsapp)
                                            WHERE whatsapp IS NOT NULL;

-- service_orders
CREATE INDEX idx_orders_tenant              ON public.service_orders(tenant_id);
CREATE INDEX idx_orders_customer            ON public.service_orders(tenant_id, customer_id);
CREATE INDEX idx_orders_status              ON public.service_orders(tenant_id, status);
CREATE INDEX idx_orders_number              ON public.service_orders(tenant_id, order_number);
CREATE INDEX idx_orders_received_at         ON public.service_orders(tenant_id, received_at DESC);
CREATE INDEX idx_orders_paid_at             ON public.service_orders(tenant_id, paid_at)
                                            WHERE paid_at IS NOT NULL;
CREATE INDEX idx_orders_deadline            ON public.service_orders(tenant_id, pickup_deadline_at)
                                            WHERE status NOT IN ('delivered', 'cancelled');

-- checklist
CREATE INDEX idx_checklist_order            ON public.checklist_items(tenant_id, order_id, phase);

-- photos
CREATE INDEX idx_photos_order               ON public.order_photos(tenant_id, order_id, phase);

-- parts
CREATE INDEX idx_parts_order                ON public.order_parts(tenant_id, order_id);

-- device catalog
CREATE INDEX idx_models_brand               ON public.device_models(brand_id);
CREATE INDEX idx_models_tenant              ON public.device_models(tenant_id);
CREATE INDEX idx_brands_tenant              ON public.device_brands(tenant_id);

-- tenant_members
CREATE INDEX idx_members_user               ON public.tenant_members(user_id);
CREATE INDEX idx_members_tenant             ON public.tenant_members(tenant_id);

-- status logs
CREATE INDEX idx_status_logs_order          ON public.order_status_logs(tenant_id, order_id);

-- financial queries (dashboard)
CREATE INDEX idx_orders_financial_month     ON public.service_orders(tenant_id, paid_at, profit_cents)
                                            WHERE paid_at IS NOT NULL;


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 9: FUNÇÕES DE NEGÓCIO E TRIGGERS
-- ════════════════════════════════════════════════════════════

-- ── Trigger: auto-criação de profile quando usuário se registra ──────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(
      TRIM(NEW.raw_user_meta_data ->> 'full_name'),
      SPLIT_PART(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Trigger: geração automática do número de OS ──────────────────────────
--
-- Formato: OS-{YYYY}-{NNNN}  ex: OS-2025-0001
--
-- ── COMO O CONTADOR ATÔMICO FUNCIONA ────────────────────────────────────
-- Problema: duas OS abertas ao mesmo tempo pelo mesmo tenant no mesmo ano
-- não podem receber o mesmo número. SELECT MAX() + 1 não é seguro.
--
-- Solução: INSERT ... ON CONFLICT DO UPDATE com RETURNING em uma única
-- operação atômica (um round-trip ao banco). O PostgreSQL garante que
-- a operação é serializada por row-lock na chave (tenant_id, year):
--
--  1ª OS do ano  → INSERT (tenant_id, 2025, counter=1) → RETURNING 1
--  2ª OS (concorrente) → tenta INSERT, encontra conflito
--                     → UPDATE counter = 0 + 1 = 1? NÃO!
--                     → UPDATE counter = counter + 1 (lê o valor atual) → RETURNING 2
--
-- O "counter + 1" na cláusula UPDATE lê o valor comprometido da linha
-- DEPOIS do lock de escrita, então duas transações concorrentes sempre
-- recebem valores distintos. Não há duplicatas.
--
-- A função usa SECURITY DEFINER para contornar a RLS da tabela
-- tenant_order_counters (que bloqueia acesso direto do client).
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year        INT := EXTRACT(YEAR FROM NOW())::INT;
  v_count       INT;
  v_pickup_days INT;
BEGIN
  -- Passo 1: Incremento atômico do contador (INSERT ou UPDATE, retorna novo valor)
  INSERT INTO public.tenant_order_counters (tenant_id, year, counter)
  VALUES (NEW.tenant_id, v_year, 1)
  ON CONFLICT (tenant_id, year)
  DO UPDATE
    SET counter = tenant_order_counters.counter + 1
  RETURNING counter INTO v_count;

  -- Passo 2: Formata o número da OS com zero-padding de 4 dígitos
  -- Exemplos: OS-2025-0001, OS-2025-0042, OS-2025-1000
  NEW.order_number := 'OS-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');

  -- Passo 3: Calcula prazo de retirada (received_at + pickup_days do tenant)
  SELECT pickup_days
  INTO   v_pickup_days
  FROM   public.tenants
  WHERE  id = NEW.tenant_id;

  NEW.pickup_deadline_at := NEW.received_at + (v_pickup_days * INTERVAL '1 day');

  -- Passo 4: Sincroniza inoperative_clause com powers_on
  -- (redundância intencional: campo separado para clareza jurídica no PDF)
  NEW.inoperative_clause := NOT NEW.powers_on;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_order_number
  BEFORE INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_order_number();

-- ── Trigger: manter inoperative_clause sincronizado no UPDATE ────────────
CREATE OR REPLACE FUNCTION public.sync_inoperative_clause()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.powers_on IS DISTINCT FROM OLD.powers_on THEN
    NEW.inoperative_clause := NOT NEW.powers_on;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_inoperative_clause
  BEFORE UPDATE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_inoperative_clause();

-- ── Trigger: log automático de mudança de status ─────────────────────────
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_status_logs (
      tenant_id, order_id, from_status, to_status
    ) VALUES (
      NEW.tenant_id, NEW.id, OLD.status, NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_log_order_status
  AFTER UPDATE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

-- ── Triggers updated_at ──────────────────────────────────────────────────
CREATE TRIGGER trg_touch_tenants
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_touch_subscriptions
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_touch_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_touch_customers
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_touch_service_orders
  BEFORE UPDATE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_touch_checklist_items
  BEFORE UPDATE ON public.checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 10: ROW LEVEL SECURITY (RLS)
-- ════════════════════════════════════════════════════════════

-- Habilitar RLS em todas as tabelas sensíveis
ALTER TABLE public.tenants                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_brands             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_models             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items_template  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_photos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_parts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_order_counters     ENABLE ROW LEVEL SECURITY;

-- ── TENANTS ──────────────────────────────────────────────────────────────

CREATE POLICY "tenants: members can view own"
  ON public.tenants FOR SELECT
  USING (id = public.tenant_id());

CREATE POLICY "tenants: owner can update"
  ON public.tenants FOR UPDATE
  USING (id = public.tenant_id() AND public.tenant_role() = 'owner')
  WITH CHECK (id = public.tenant_id());

-- ── SUBSCRIPTIONS ────────────────────────────────────────────────────────

CREATE POLICY "subscriptions: members can view own"
  ON public.subscriptions FOR SELECT
  USING (tenant_id = public.tenant_id());

-- Escrita apenas via service_role (webhooks de pagamento).
-- Sem policies de INSERT/UPDATE/DELETE para 'authenticated'.

-- ── PROFILES ─────────────────────────────────────────────────────────────

-- Usuário vê o próprio perfil
CREATE POLICY "profiles: user views own"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

-- Membros do mesmo tenant veem uns aos outros
CREATE POLICY "profiles: tenant members view each other"
  ON public.profiles FOR SELECT
  USING (
    id IN (
      SELECT user_id
      FROM public.tenant_members
      WHERE tenant_id = public.tenant_id()
        AND is_active = TRUE
    )
  );

CREATE POLICY "profiles: user updates own"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── TENANT_MEMBERS ───────────────────────────────────────────────────────

CREATE POLICY "members: view own tenant"
  ON public.tenant_members FOR SELECT
  USING (tenant_id = public.tenant_id());

CREATE POLICY "members: owner and manager can insert"
  ON public.tenant_members FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager')
  );

CREATE POLICY "members: owner and manager can update"
  ON public.tenant_members FOR UPDATE
  USING (tenant_id = public.tenant_id() AND public.tenant_role() IN ('owner', 'manager'))
  WITH CHECK (tenant_id = public.tenant_id());

CREATE POLICY "members: owner can delete"
  ON public.tenant_members FOR DELETE
  USING (tenant_id = public.tenant_id() AND public.tenant_role() = 'owner');

-- ── DEVICE_BRANDS ────────────────────────────────────────────────────────

-- Leitura: marcas globais (tenant_id IS NULL) + marcas do próprio tenant
CREATE POLICY "brands: view global and own"
  ON public.device_brands FOR SELECT
  USING (
    is_active = TRUE
    AND (tenant_id IS NULL OR tenant_id = public.tenant_id())
  );

CREATE POLICY "brands: tenant can insert custom"
  ON public.device_brands FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND is_system = FALSE
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "brands: tenant can update own custom"
  ON public.device_brands FOR UPDATE
  USING (tenant_id = public.tenant_id() AND is_system = FALSE)
  WITH CHECK (tenant_id = public.tenant_id());

CREATE POLICY "brands: owner and manager can delete own custom"
  ON public.device_brands FOR DELETE
  USING (
    tenant_id = public.tenant_id()
    AND is_system = FALSE
    AND public.tenant_role() IN ('owner', 'manager')
  );

-- ── DEVICE_MODELS ────────────────────────────────────────────────────────

CREATE POLICY "models: view global and own"
  ON public.device_models FOR SELECT
  USING (
    is_active = TRUE
    AND (tenant_id IS NULL OR tenant_id = public.tenant_id())
  );

CREATE POLICY "models: tenant can insert custom"
  ON public.device_models FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND is_system = FALSE
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "models: tenant can update own custom"
  ON public.device_models FOR UPDATE
  USING (tenant_id = public.tenant_id() AND is_system = FALSE)
  WITH CHECK (tenant_id = public.tenant_id());

CREATE POLICY "models: owner and manager can delete own custom"
  ON public.device_models FOR DELETE
  USING (
    tenant_id = public.tenant_id()
    AND is_system = FALSE
    AND public.tenant_role() IN ('owner', 'manager')
  );

-- ── CUSTOMERS ────────────────────────────────────────────────────────────

CREATE POLICY "customers: tenant isolation select"
  ON public.customers FOR SELECT
  USING (tenant_id = public.tenant_id());

CREATE POLICY "customers: technician and above can insert"
  ON public.customers FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "customers: technician and above can update"
  ON public.customers FOR UPDATE
  USING (tenant_id = public.tenant_id())
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "customers: owner and manager can delete"
  ON public.customers FOR DELETE
  USING (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager')
  );

-- ── SERVICE_ORDERS ───────────────────────────────────────────────────────

CREATE POLICY "orders: tenant isolation select"
  ON public.service_orders FOR SELECT
  USING (tenant_id = public.tenant_id());

CREATE POLICY "orders: technician and above can insert"
  ON public.service_orders FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "orders: technician and above can update"
  ON public.service_orders FOR UPDATE
  USING (tenant_id = public.tenant_id())
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "orders: owner and manager can delete"
  ON public.service_orders FOR DELETE
  USING (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager')
  );

-- ── CHECKLIST_ITEMS_TEMPLATE ─────────────────────────────────────────────

-- Leitura pública para todos autenticados. Escrita apenas via service_role/migrations.
CREATE POLICY "checklist_template: all authenticated can read"
  ON public.checklist_items_template FOR SELECT
  TO authenticated
  USING (is_active = TRUE);

-- ── CHECKLIST_ITEMS ──────────────────────────────────────────────────────
--
-- ── PROVA DE SEGURANÇA DO BLOQUEIO (is_blocked) ──────────────────────────
--
-- Cenário A: Aparelho apagado (is_blocked = TRUE) → UPDATE tentado
--   USING avalia a linha ATUAL (OLD row):
--     is_blocked = TRUE → condição "is_blocked = FALSE" falha
--     → linha não aparece como candidata ao UPDATE
--     → PostgreSQL retorna "0 rows updated" sem erro (silencioso e seguro)
--
-- Cenário B: Item normal (is_blocked = FALSE) → alguém tenta setar is_blocked = TRUE
--   USING avalia OLD row: is_blocked = FALSE → passa ✓
--   WITH CHECK avalia NEW row: is_blocked = TRUE → "is_blocked = FALSE" falha
--   → UPDATE rejeitado com erro de violação de política ✓
--
-- Resultado: is_blocked só pode mudar de FALSE → TRUE via service_role
-- (Server Action no backend, que usa a service_role key e bypassa RLS).
-- Nenhum client autenticado pode desbloqueá-lo ou bloqueá-lo diretamente.
-- ─────────────────────────────────────────────────────────────────────────

CREATE POLICY "checklist: tenant isolation select"
  ON public.checklist_items FOR SELECT
  USING (tenant_id = public.tenant_id());

CREATE POLICY "checklist: technician and above can insert"
  ON public.checklist_items FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

-- Dupla proteção: USING bloqueia acesso a linhas com is_blocked=TRUE (Cenário A)
--                 WITH CHECK impede setar is_blocked=TRUE no UPDATE (Cenário B)
CREATE POLICY "checklist: update only unlocked items"
  ON public.checklist_items FOR UPDATE
  USING (
    tenant_id  = public.tenant_id()
    AND is_blocked = FALSE
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  )
  WITH CHECK (
    tenant_id  = public.tenant_id()
    AND is_blocked = FALSE           -- garante que is_blocked não vira TRUE via UPDATE
  );

CREATE POLICY "checklist: owner and manager can delete"
  ON public.checklist_items FOR DELETE
  USING (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager')
  );

-- ── ORDER_PHOTOS ─────────────────────────────────────────────────────────

CREATE POLICY "photos: tenant isolation select"
  ON public.order_photos FOR SELECT
  USING (tenant_id = public.tenant_id());

CREATE POLICY "photos: technician and above can insert"
  ON public.order_photos FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "photos: owner and manager can delete"
  ON public.order_photos FOR DELETE
  USING (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager')
  );

-- ── ORDER_PARTS ──────────────────────────────────────────────────────────

CREATE POLICY "parts: tenant isolation select"
  ON public.order_parts FOR SELECT
  USING (tenant_id = public.tenant_id());

CREATE POLICY "parts: technician and above can insert"
  ON public.order_parts FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "parts: technician and above can update"
  ON public.order_parts FOR UPDATE
  USING (tenant_id = public.tenant_id())
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "parts: owner and manager can delete"
  ON public.order_parts FOR DELETE
  USING (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager')
  );

-- ── ORDER_STATUS_LOGS ────────────────────────────────────────────────────

-- Somente leitura para membros do tenant. Escrita exclusiva via trigger SECURITY DEFINER.
CREATE POLICY "status_logs: tenant isolation select"
  ON public.order_status_logs FOR SELECT
  USING (tenant_id = public.tenant_id());

-- ── TENANT_ORDER_COUNTERS ────────────────────────────────────────────────

-- Sem acesso direto pelo client. Gerenciado exclusivamente pelo trigger SECURITY DEFINER.
CREATE POLICY "counters: no direct client access"
  ON public.tenant_order_counters FOR ALL
  USING (FALSE)
  WITH CHECK (FALSE);


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 11: SEED — MARCAS GLOBAIS
-- ════════════════════════════════════════════════════════════

INSERT INTO public.device_brands (name, is_system, tenant_id, sort_order)
VALUES
  ('Apple',     TRUE, NULL,  1),
  ('Samsung',   TRUE, NULL,  2),
  ('Xiaomi',    TRUE, NULL,  3),
  ('Motorola',  TRUE, NULL,  4),
  ('LG',        TRUE, NULL,  5),
  ('Huawei',    TRUE, NULL,  6),
  ('Nokia',     TRUE, NULL,  7),
  ('OnePlus',   TRUE, NULL,  8),
  ('ASUS',      TRUE, NULL,  9),
  ('Sony',      TRUE, NULL, 10),
  ('Realme',    TRUE, NULL, 11),
  ('TCL',       TRUE, NULL, 12),
  ('Positivo',  TRUE, NULL, 13),
  ('Multilaser',TRUE, NULL, 14),
  ('ZTE',       TRUE, NULL, 15);


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 12: SEED — MODELOS POPULARES
-- ════════════════════════════════════════════════════════════

-- ── Apple ────────────────────────────────────────────────────────────────
INSERT INTO public.device_models (brand_id, name, is_system)
SELECT b.id, m.name, TRUE
FROM public.device_brands b
CROSS JOIN (VALUES
  ('iPhone 7'),
  ('iPhone 7 Plus'),
  ('iPhone 8'),
  ('iPhone 8 Plus'),
  ('iPhone X'),
  ('iPhone XR'),
  ('iPhone XS'),
  ('iPhone XS Max'),
  ('iPhone 11'),
  ('iPhone 11 Pro'),
  ('iPhone 11 Pro Max'),
  ('iPhone 12'),
  ('iPhone 12 Mini'),
  ('iPhone 12 Pro'),
  ('iPhone 12 Pro Max'),
  ('iPhone 13'),
  ('iPhone 13 Mini'),
  ('iPhone 13 Pro'),
  ('iPhone 13 Pro Max'),
  ('iPhone 14'),
  ('iPhone 14 Plus'),
  ('iPhone 14 Pro'),
  ('iPhone 14 Pro Max'),
  ('iPhone 15'),
  ('iPhone 15 Plus'),
  ('iPhone 15 Pro'),
  ('iPhone 15 Pro Max'),
  ('iPhone SE (2ª Geração)'),
  ('iPhone SE (3ª Geração)'),
  ('iPad (9ª Geração)'),
  ('iPad (10ª Geração)'),
  ('iPad Mini 6'),
  ('iPad Air (5ª Geração)')
) AS m(name)
WHERE b.name = 'Apple' AND b.tenant_id IS NULL;

-- ── Samsung ───────────────────────────────────────────────────────────────
INSERT INTO public.device_models (brand_id, name, is_system)
SELECT b.id, m.name, TRUE
FROM public.device_brands b
CROSS JOIN (VALUES
  ('Galaxy A03s'),
  ('Galaxy A04s'),
  ('Galaxy A13'),
  ('Galaxy A14'),
  ('Galaxy A14 5G'),
  ('Galaxy A15'),
  ('Galaxy A15 5G'),
  ('Galaxy A23'),
  ('Galaxy A24'),
  ('Galaxy A25 5G'),
  ('Galaxy A33 5G'),
  ('Galaxy A34 5G'),
  ('Galaxy A35 5G'),
  ('Galaxy A53 5G'),
  ('Galaxy A54 5G'),
  ('Galaxy A55 5G'),
  ('Galaxy A73 5G'),
  ('Galaxy S21'),
  ('Galaxy S21+'),
  ('Galaxy S21 Ultra'),
  ('Galaxy S22'),
  ('Galaxy S22+'),
  ('Galaxy S22 Ultra'),
  ('Galaxy S23'),
  ('Galaxy S23+'),
  ('Galaxy S23 Ultra'),
  ('Galaxy S23 FE'),
  ('Galaxy S24'),
  ('Galaxy S24+'),
  ('Galaxy S24 Ultra'),
  ('Galaxy Note 20'),
  ('Galaxy Note 20 Ultra'),
  ('Galaxy Z Fold 4'),
  ('Galaxy Z Fold 5'),
  ('Galaxy Z Flip 4'),
  ('Galaxy Z Flip 5')
) AS m(name)
WHERE b.name = 'Samsung' AND b.tenant_id IS NULL;

-- ── Xiaomi ────────────────────────────────────────────────────────────────
INSERT INTO public.device_models (brand_id, name, is_system)
SELECT b.id, m.name, TRUE
FROM public.device_brands b
CROSS JOIN (VALUES
  ('Redmi 9'),
  ('Redmi 9A'),
  ('Redmi 9C'),
  ('Redmi 10'),
  ('Redmi 10A'),
  ('Redmi 10C'),
  ('Redmi 12'),
  ('Redmi 12C'),
  ('Redmi 13C'),
  ('Redmi Note 10'),
  ('Redmi Note 10 Pro'),
  ('Redmi Note 11'),
  ('Redmi Note 11 Pro'),
  ('Redmi Note 11S'),
  ('Redmi Note 12'),
  ('Redmi Note 12 Pro'),
  ('Redmi Note 13'),
  ('Redmi Note 13 Pro'),
  ('Redmi Note 13 Pro+'),
  ('POCO M4 Pro'),
  ('POCO M5'),
  ('POCO X4 Pro 5G'),
  ('POCO X5'),
  ('POCO X5 Pro'),
  ('POCO F4'),
  ('Xiaomi 12'),
  ('Xiaomi 12 Pro'),
  ('Xiaomi 13'),
  ('Xiaomi 13 Pro'),
  ('Xiaomi 13T'),
  ('Xiaomi 13T Pro')
) AS m(name)
WHERE b.name = 'Xiaomi' AND b.tenant_id IS NULL;

-- ── Motorola ──────────────────────────────────────────────────────────────
INSERT INTO public.device_models (brand_id, name, is_system)
SELECT b.id, m.name, TRUE
FROM public.device_brands b
CROSS JOIN (VALUES
  ('Moto G8 Power Lite'),
  ('Moto G9 Play'),
  ('Moto G9 Power'),
  ('Moto G10'),
  ('Moto G20'),
  ('Moto G30'),
  ('Moto G31'),
  ('Moto G41'),
  ('Moto G51 5G'),
  ('Moto G52'),
  ('Moto G53 5G'),
  ('Moto G54 5G'),
  ('Moto G62 5G'),
  ('Moto G71 5G'),
  ('Moto G72'),
  ('Moto G82 5G'),
  ('Moto G84 5G'),
  ('Moto E13'),
  ('Moto E22'),
  ('Moto E22i'),
  ('Moto E32'),
  ('Moto Edge 20'),
  ('Moto Edge 30'),
  ('Moto Edge 30 Fusion'),
  ('Moto Edge 40'),
  ('Moto Edge 40 Pro'),
  ('Moto Edge 50 Pro'),
  ('Motorola Razr 40'),
  ('Motorola Razr 40 Ultra')
) AS m(name)
WHERE b.name = 'Motorola' AND b.tenant_id IS NULL;

-- ── Samsung Galaxy A básico (modelos de entrada muito comuns no Brasil) ───
-- Já incluído acima.

-- ── LG (legado, ainda muito comum em assistências) ───────────────────────
INSERT INTO public.device_models (brand_id, name, is_system)
SELECT b.id, m.name, TRUE
FROM public.device_brands b
CROSS JOIN (VALUES
  ('LG K22'),
  ('LG K41S'),
  ('LG K51S'),
  ('LG K52'),
  ('LG K61'),
  ('LG K62'),
  ('LG Velvet'),
  ('LG Wing'),
  ('LG G8X ThinQ'),
  ('LG Q60')
) AS m(name)
WHERE b.name = 'LG' AND b.tenant_id IS NULL;


-- ════════════════════════════════════════════════════════════
-- SEÇÃO 13: SEED — TEMPLATE DO CHECKLIST
-- ════════════════════════════════════════════════════════════

INSERT INTO public.checklist_items_template (category, item_key, label_pt, sort_order)
VALUES

  -- ── DISPLAY ──────────────────────────────────────────────
  ('display', 'display_screen',        'Tela / Display (imagem)',                10),
  ('display', 'display_touch',         'Touch Screen (resposta ao toque)',       20),
  ('display', 'display_brightness',    'Brilho e Luminosidade',                 30),
  ('display', 'display_dead_pixels',   'Pixels Mortos / Manchas na Tela',       40),
  ('display', 'display_multitouch',    'Multi-Touch (zoom, gestos)',             50),

  -- ── CÂMERA ───────────────────────────────────────────────
  ('camera',  'camera_front',          'Câmera Frontal (selfie)',                10),
  ('camera',  'camera_rear_main',      'Câmera Traseira (principal)',            20),
  ('camera',  'camera_rear_ultra',     'Câmera Ultra-Wide / Teleobjetiva',       30),
  ('camera',  'camera_flash',          'Flash / Lanterna',                      40),
  ('camera',  'camera_video',          'Gravação de Vídeo',                     50),
  ('camera',  'camera_autofocus',      'Auto-Foco',                             60),

  -- ── ÁUDIO ────────────────────────────────────────────────
  ('audio',   'audio_earpiece',        'Caixa de Voz (chamadas)',                10),
  ('audio',   'audio_loudspeaker',     'Alto-falante Externo',                  20),
  ('audio',   'audio_microphone',      'Microfone',                             30),
  ('audio',   'audio_headphone',       'Saída de Fone (P2 ou USB-C)',           40),
  ('audio',   'audio_vibration',       'Vibração / Motor Háptico',              50),

  -- ── CONECTIVIDADE ────────────────────────────────────────
  ('connectivity', 'conn_wifi',        'Wi-Fi',                                 10),
  ('connectivity', 'conn_bluetooth',   'Bluetooth',                             20),
  ('connectivity', 'conn_sim_signal',  'Sinal de Rede / Chip',                  30),
  ('connectivity', 'conn_gps',         'GPS / Localização',                     40),
  ('connectivity', 'conn_nfc',         'NFC',                                   50),
  ('connectivity', 'conn_usb_charge',  'Conector de Carga (USB-C / Lightning)',  60),
  ('connectivity', 'conn_hotspot',     'Compartilhamento de Internet (Hotspot)', 70),

  -- ── HARDWARE ─────────────────────────────────────────────
  ('hardware', 'hw_battery',           'Bateria / Carregamento',                10),
  ('hardware', 'hw_fast_charge',       'Carregamento Rápido',                   20),
  ('hardware', 'hw_button_power',      'Botão Power (Liga/Desliga)',             30),
  ('hardware', 'hw_button_vol_up',     'Botão Volume +',                        40),
  ('hardware', 'hw_button_vol_down',   'Botão Volume -',                        50),
  ('hardware', 'hw_button_home',       'Botão Home (se aplicável)',              60),
  ('hardware', 'hw_fingerprint',       'Leitor de Impressão Digital',           70),
  ('hardware', 'hw_face_unlock',       'Reconhecimento Facial (Face ID)',        80),
  ('hardware', 'hw_proximity_sensor',  'Sensor de Proximidade',                 90),
  ('hardware', 'hw_gyroscope',         'Acelerômetro / Giroscópio',            100),
  ('hardware', 'hw_compass',           'Bússola / Magnetômetro',               110),

  -- ── SOFTWARE ─────────────────────────────────────────────
  ('software', 'sw_os',                'Sistema Operacional (boot / funcionamento)', 10),
  ('software', 'sw_cloud_lock',        'iCloud / Google Account (aparelho bloqueado?)', 20),
  ('software', 'sw_apps',              'Aplicativos Essenciais Funcionando',    30),
  ('software', 'sw_find_my',           'Find My / Localizar Ativado',           40),
  ('software', 'sw_updates',           'Atualização do Sistema',               50);


-- ════════════════════════════════════════════════════════════
-- FIM DA MIGRATION 001
-- ════════════════════════════════════════════════════════════

-- Próximos passos após aplicar esta migration:
-- 1. Configure o hook auth.custom_access_token em Supabase (Authentication → Hooks)
--    para popular app_metadata com tenant_id e tenant_role no JWT.
-- 2. Configure Storage Buckets:
--    - 'order-photos'  (public: false, size limit: 5MB por arquivo)
--    - 'signatures'    (public: false, size limit: 1MB)
--    - 'logos'         (public: true,  size limit: 2MB)
-- 3. Execute: npx supabase gen types typescript --project-id SEU_ID > src/types/database.ts


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 002_disable_status_log_trigger.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ============================================================
-- Migration 002 — Desabilita trigger duplicado de log de status
-- ============================================================
--
-- Contexto:
--   A Server Action `update-order-status.ts` já insere explicitamente
--   em `order_status_logs` (com o campo `notes`). O trigger
--   `trg_log_order_status` fazia o mesmo insert automaticamente,
--   resultando em dois registros por mudança de status.
--
-- Solução:
--   Desabilitar o trigger. O insert explícito na Server Action é a
--   fonte canônica — ele carrega `notes`, `changed_by`, e pode ser
--   controlado por lógica de negócio (ex: idempotência).
--
-- Rollback:
--   ALTER TABLE public.service_orders ENABLE TRIGGER trg_log_order_status;
-- ============================================================

ALTER TABLE public.service_orders
  DISABLE TRIGGER trg_log_order_status;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 003_contract_text.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Adiciona campo de contrato/garantia personalizado ao tenant
-- Execute no SQL Editor do Supabase

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS contract_text TEXT DEFAULT NULL;

-- Pré-popula com o contrato padrão da UÉ CELL IMPORTS
UPDATE public.tenants SET contract_text =
'CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE ASSISTÊNCIA TÉCNICA

Cláusula 1 — As partes concordam que os serviços de manutenção, reparo e/ou diagnóstico serão realizados pela UÉ CELL IMPORTS (CNPJ 35.868.361/0001-39), doravante denominada CONTRATADA, no equipamento descrito nesta Ordem de Serviço.

Cláusula 2 — A CONTRATADA não se responsabiliza por dados armazenados no equipamento. O CONTRATANTE declara ter realizado backup antes da entrega, isentando a empresa de qualquer responsabilidade por perda de informações.

Cláusula 3 — Aparelhos com danos por líquidos (água, suor, bebidas) podem apresentar falhas secundárias após o reparo, sem qualquer responsabilidade da CONTRATADA.

Cláusula 4 — Em caso de aparelho inoperante (não liga), não é possível atestar o estado funcional dos componentes. A CONTRATADA se isenta de defeitos ocultos preexistentes não identificáveis sem o funcionamento do aparelho.

Cláusula 5 — Aparelhos deixados por prazo superior a 30 (trinta) dias corridos após a conclusão do serviço ou após a recusa do orçamento poderão ser descartados, sem ônus à CONTRATADA.

Cláusula 6 — A garantia dos serviços prestados é de 90 (noventa) dias, contados a partir da data de entrega ao cliente, cobrindo exclusivamente os defeitos relacionados ao serviço executado, conforme o Código de Defesa do Consumidor (CDC).

Cláusula 7 — Não são cobertos pela garantia: danos causados por quedas, impactos, umidade, mau uso, oxidação, danos causados por carregadores ou acessórios não originais, vírus ou softwares de terceiros após a saída do equipamento.

Cláusula 8 — A garantia será automaticamente cancelada se o equipamento for aberto por terceiros ou submetido a qualquer intervenção não autorizada pela CONTRATADA.

Cláusula 9 — O orçamento aprovado pelo CONTRATANTE (presencialmente, por WhatsApp ou outro meio eletrônico) tem validade de 5 (cinco) dias corridos. Após esse prazo, os valores poderão ser reajustados.

Cláusula 10 — A recusa do orçamento não isenta o CONTRATANTE do pagamento das despesas com diagnóstico, quando estas forem previamente informadas e aceitas.

Cláusula 11 — Peças substituídas e defeituosas serão devolvidas ao CONTRATANTE somente mediante solicitação expressa no ato da abertura da OS. Caso contrário, poderão ser descartadas pela CONTRATADA.

Cláusula 12 — Ao assinar esta Ordem de Serviço, o CONTRATANTE declara estar ciente e de acordo com todas as cláusulas acima e autoriza expressamente a CONTRATADA a realizar o diagnóstico e/ou o reparo descrito.

Cláusula 13 — Fica eleito o foro da Comarca de Aracaju/SE para dirimir quaisquer controvérsias decorrentes deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.

Cláusula 14 — Este contrato é regido pela Lei nº 8.078/1990 (Código de Defesa do Consumidor) e demais legislações aplicáveis à prestação de serviços no Brasil.'
WHERE contract_text IS NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 004_clean_connectivity_checklist.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Remove itens duplicados e insignificantes da categoria conectividade
DELETE FROM checklist_items_template
WHERE category = 'connectivity'
  AND label_pt IN (
    'Sinal de rede / chip',
    'Porta USB / carregamento',
    'Compartilhamento de Internet (Hotspot)',
    'Sinal de Rede / Chip',
    'Wi-Fi',
    'Bluetooth',
    'GPS',
    'NFC',
    'Conector de Carga (USB-C / Lightning)'
  );

-- Reinsere conectividade limpa, sem duplicatas
INSERT INTO checklist_items_template (category, item_key, label_pt, sort_order, is_active)
VALUES
  ('connectivity', 'signal_chip',    'Sinal de Rede / Chip',            50, true),
  ('connectivity', 'wifi',           'Wi-Fi',                           51, true),
  ('connectivity', 'bluetooth',      'Bluetooth',                       52, true),
  ('connectivity', 'gps',            'GPS',                             53, true),
  ('connectivity', 'nfc',            'NFC',                             54, true),
  ('connectivity', 'charge_port',    'Conector de Carga (USB-C / Lightning)', 55, true);


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 005_parts_catalog.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ── Catálogo de peças por tenant ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parts_catalog (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text NOT NULL,
  sku              text,
  supplier         text,
  cost_cents       integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_parts_catalog_tenant ON parts_catalog(tenant_id);
CREATE INDEX idx_parts_catalog_name   ON parts_catalog(tenant_id, name);

ALTER TABLE parts_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parts_catalog: tenant isolation"
  ON parts_catalog FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- ── Adiciona referência ao catálogo em order_parts ────────────────────────
ALTER TABLE order_parts
  ADD COLUMN IF NOT EXISTS catalog_part_id uuid REFERENCES parts_catalog(id) ON DELETE SET NULL;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 006_parts_catalog_purchase_price.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ============================================================
-- Migration 006 — Adiciona preço de compra ao catálogo de peças
--
-- Contexto: parts_catalog tinha apenas cost_cents (preço de custo).
-- Adicionamos purchase_price_cents para separar:
--   • purchase_price_cents → valor pago ao fornecedor
--   • cost_cents           → valor usado para calcular lucro
--
-- IMPORTANTE: Aplique ANTES desta migration a 005_parts_catalog.sql,
-- caso ainda não tenha sido aplicada no seu Supabase.
-- ============================================================

ALTER TABLE public.parts_catalog
  ADD COLUMN IF NOT EXISTS purchase_price_cents integer NOT NULL DEFAULT 0
    CHECK (purchase_price_cents >= 0);

COMMENT ON COLUMN public.parts_catalog.purchase_price_cents
  IS 'Preço pago ao fornecedor (centavos). Usado para controle de estoque/negociação.';

COMMENT ON COLUMN public.parts_catalog.cost_cents
  IS 'Preço de custo interno (centavos). Usado para cálculo de lucro nas OS.';


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 007_parts_sale_price.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 007: adiciona coluna sale_price_cents na tabela parts_catalog
-- Representa o preço cobrado do cliente pela peça

ALTER TABLE parts_catalog
  ADD COLUMN IF NOT EXISTS sale_price_cents INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN parts_catalog.sale_price_cents IS 'Preço de venda da peça ao cliente (em centavos)';


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 008_order_parts_prices.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 008: adiciona preço de compra e preço de venda em order_parts

ALTER TABLE order_parts
  ADD COLUMN IF NOT EXISTS unit_purchase_price_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_sale_price_cents     INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN order_parts.unit_purchase_price_cents IS 'Preço pago ao fornecedor pela peça (em centavos)';
COMMENT ON COLUMN order_parts.unit_sale_price_cents     IS 'Preço cobrado do cliente pela peça (em centavos)';


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 009_parts_payment_and_sale_total.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 009: forma de pagamento em order_parts + total com peças em service_orders
-- Roda no Supabase SQL Editor

-- 1. Adiciona payment_method em order_parts
ALTER TABLE public.order_parts
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- 2. Adiciona parts_sale_cents em service_orders para rastrear total de venda de peças
ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS parts_sale_cents INTEGER NOT NULL DEFAULT 0;

-- 3. Recria total_price_cents incluindo parts_sale_cents
--    GENERATED ALWAYS AS não pode ser alterada in-place — dropa e recria.
ALTER TABLE public.service_orders DROP COLUMN total_price_cents;
ALTER TABLE public.service_orders
  ADD COLUMN total_price_cents INTEGER
    GENERATED ALWAYS AS (
      service_price_cents - discount_cents + parts_sale_cents
    ) STORED;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 010_signature_b64.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 010: armazena base64 das assinaturas diretamente no banco
-- Permite uso no PDF sem depender de URLs do Storage que podem expirar.

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS entry_signature_b64 TEXT;

ALTER TABLE public.service_orders
  ADD COLUMN IF NOT EXISTS exit_signature_b64 TEXT;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 011_warranty_term.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 011: campo warranty_term na tabela tenants
-- Texto do Termo de Garantia editável pelo tenant, impresso como página extra no PDF.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS warranty_term TEXT;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 012_fix_hook_permissions.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════
-- Migration 012: Corrige permissões do custom_access_token_hook
-- ════════════════════════════════════════════════════════════
--
-- PROBLEMA:
--   O hook estava sem GRANT SELECT em tenant_members para supabase_auth_admin.
--   Quando chamado, o PostgreSQL negava o acesso à tabela (permissão + RLS).
--   O bloco EXCEPTION capturava silenciosamente e retornava o evento original
--   sem injetar tenant_id / tenant_role no JWT.
--
--   Para owners: não era visível porque o Supabase preserva os valores
--   de raw_app_meta_data.tenant_id no JWT mesmo quando o hook falha
--   (os dados foram setados manualmente na criação do tenant).
--
--   Para funcionários novos: raw_app_meta_data está vazio → sem hook
--   funcionando, o JWT nunca recebe tenant_id → redirecionados p/ /onboarding.
--
-- SOLUÇÃO:
--   1. Concede SELECT em tenant_members para supabase_auth_admin
--   2. Recria o hook com SET LOCAL row_security = off como segunda camada
--      de segurança (bypassa RLS independente de grants futuros)
-- ════════════════════════════════════════════════════════════

-- ── 1. Permissões necessárias para o hook ────────────────────────────────
GRANT USAGE  ON SCHEMA public               TO supabase_auth_admin;
GRANT SELECT ON TABLE  public.tenant_members TO supabase_auth_admin;

-- ── 2. Recria o hook com row_security desativado ─────────────────────────
--
-- SET LOCAL row_security = off: desativa RLS para esta execução de função,
-- garantindo que o hook possa ler qualquer linha de tenant_members
-- independentemente de políticas RLS ativas.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID;
  v_tenant_id    UUID;
  v_tenant_role  TEXT;
  v_claims       jsonb;
  v_app_metadata jsonb;
BEGIN
  -- Bypass RLS: hook precisa ler dados de qualquer usuário do sistema
  SET LOCAL row_security = off;

  -- 1. Extrai o user_id do evento recebido pelo hook
  v_user_id := (event ->> 'user_id')::UUID;

  -- 2. Busca o tenant ativo do usuário na tabela tenant_members.
  --    Critério de desempate quando há múltiplos tenants:
  --    prioridade pelo role mais alto, depois pelo mais antigo (joined_at).
  SELECT tm.tenant_id, tm.role
  INTO   v_tenant_id, v_tenant_role
  FROM   public.tenant_members tm
  WHERE  tm.user_id   = v_user_id
    AND  tm.is_active = TRUE
  ORDER BY
    CASE tm.role
      WHEN 'owner'      THEN 1
      WHEN 'manager'    THEN 2
      WHEN 'technician' THEN 3
      WHEN 'viewer'     THEN 4
      ELSE                   5
    END ASC,
    tm.joined_at ASC NULLS LAST
  LIMIT 1;

  -- 3. Prepara claims e app_metadata atuais (preserva campos existentes)
  v_claims       := event -> 'claims';
  v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);

  -- 4. Injeta tenant_id e tenant_role SOMENTE se o usuário tiver um tenant.
  --    Usuários sem tenant (recém-cadastrados) recebem JWT sem esses campos
  --    e o middleware Next.js os redireciona para /onboarding.
  IF v_tenant_id IS NOT NULL THEN
    v_app_metadata := v_app_metadata
      || jsonb_build_object(
           'tenant_id',   v_tenant_id::TEXT,
           'tenant_role', v_tenant_role
         );
  END IF;

  -- 5. Reconstrói o evento com os claims atualizados e retorna
  v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_metadata);
  RETURN jsonb_set(event, '{claims}', v_claims);

EXCEPTION WHEN OTHERS THEN
  -- Em caso de erro inesperado, retorna o evento original sem modificação.
  -- O usuário consegue logar, mas sem tenant_id (RLS bloqueará os dados).
  RAISE WARNING '[custom_access_token_hook] Erro ao processar user_id=%: %', v_user_id, SQLERRM;
  RETURN event;
END;
$$;

-- ── 3. Re-aplica grants de execução após recriar a função ────────────────
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 013_member_permissions.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ════════════════════════════════════════════════════════════
-- Migration 013: Permissões personalizadas por membro
-- ════════════════════════════════════════════════════════════
--
-- Adiciona coluna `permissions` JSONB em tenant_members e atualiza
-- o custom_access_token_hook para injetar as permissões resolvidas
-- no JWT (custom override ou defaults por role).
--
-- Estrutura do JSON:
--   { "orders": true, "customers": true, "financial": false,
--     "reports": false, "settings": false }
--
-- Quando {} (vazio, default), o hook resolve pelo role:
--   owner      → tudo true
--   manager    → orders, customers, financial, reports = true; settings = false
--   technician → orders, customers = true; demais = false
-- ════════════════════════════════════════════════════════════

-- ── 1. Coluna permissions ─────────────────────────────────────────────────
ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}';

-- ── 2. Recria o hook injetando também as permissões resolvidas ────────────
-- Nota: usa dollar quoting ($func$) para evitar escaping de aspas simples.
-- Nota: postgres tem BYPASSRLS=true → SECURITY DEFINER já bypassa RLS
--       sem necessidade de SET LOCAL row_security = off.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_user_id      UUID;
  v_tenant_id    UUID;
  v_tenant_role  TEXT;
  v_permissions  JSONB;
  v_claims       jsonb;
  v_app_metadata jsonb;
BEGIN
  v_user_id := (event ->> 'user_id')::UUID;

  SELECT tm.tenant_id, tm.role, tm.permissions
  INTO   v_tenant_id, v_tenant_role, v_permissions
  FROM   public.tenant_members tm
  WHERE  tm.user_id   = v_user_id
    AND  tm.is_active = TRUE
  ORDER BY
    CASE tm.role
      WHEN 'owner'      THEN 1
      WHEN 'manager'    THEN 2
      WHEN 'technician' THEN 3
      WHEN 'viewer'     THEN 4
      ELSE                   5
    END ASC,
    tm.joined_at ASC NULLS LAST
  LIMIT 1;

  v_claims       := event -> 'claims';
  v_app_metadata := COALESCE(v_claims -> 'app_metadata', '{}'::jsonb);

  IF v_tenant_id IS NOT NULL THEN
    -- Resolve permissões efetivas: custom override ou defaults por role
    IF v_permissions IS NULL OR v_permissions = '{}'::jsonb THEN
      IF v_tenant_role = 'owner' THEN
        v_permissions := '{"orders":true,"customers":true,"financial":true,"reports":true,"settings":true}'::jsonb;
      ELSIF v_tenant_role = 'manager' THEN
        v_permissions := '{"orders":true,"customers":true,"financial":true,"reports":true,"settings":false}'::jsonb;
      ELSE
        v_permissions := '{"orders":true,"customers":true,"financial":false,"reports":false,"settings":false}'::jsonb;
      END IF;
    END IF;

    v_app_metadata := v_app_metadata
      || jsonb_build_object(
           'tenant_id',   v_tenant_id::TEXT,
           'tenant_role', v_tenant_role,
           'permissions', v_permissions
         );
  END IF;

  v_claims := jsonb_set(v_claims, '{app_metadata}', v_app_metadata);
  RETURN jsonb_set(event, '{claims}', v_claims);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[custom_access_token_hook] Erro ao processar user_id=%: %', v_user_id, SQLERRM;
  RETURN event;
END;
$func$;

GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 014_order_devices.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ============================================================
-- CheckSmart — 014_order_devices.sql
-- Multi-aparelho por OS
--
-- O que esta migration faz:
-- 1. Cria tabela order_devices (aparelhos da OS)
-- 2. Adiciona device_id em checklist_items e order_photos
-- 3. Migra dados existentes: cada OS vira 1 device (position=1)
-- 4. Vincula checklist e fotos ao device migrado
-- 5. Remove constraint UNIQUE antiga do checklist (incompatível)
-- 6. Adiciona nova constraint que inclui device_id
-- 7. RLS, índices e trigger updated_at
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. TABELA order_devices
-- ════════════════════════════════════════════════════════════

CREATE TABLE public.order_devices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id            UUID        NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  position            INT         NOT NULL DEFAULT 1 CHECK (position >= 1),

  -- Dados do aparelho (mesmos campos que service_orders, desnormalizados)
  brand_id            UUID        REFERENCES public.device_brands(id) ON DELETE SET NULL,
  model_id            UUID        REFERENCES public.device_models(id) ON DELETE SET NULL,
  brand_name          TEXT        NOT NULL DEFAULT '',
  model_name          TEXT        NOT NULL DEFAULT '',
  color               TEXT,
  storage             TEXT,
  imei                TEXT,
  serial_number       TEXT,
  password            TEXT,
  password_type       TEXT
                      CHECK (password_type IN ('pin', 'pattern', 'password', 'none', 'unknown')),

  powers_on           BOOLEAN     NOT NULL DEFAULT TRUE,
  physical_condition  TEXT        NOT NULL DEFAULT 'good'
                      CHECK (physical_condition IN ('like_new', 'good', 'fair', 'damaged', 'heavily_damaged')),
  physical_notes      TEXT,

  -- Valor individual deste aparelho
  service_price_cents INT         NOT NULL DEFAULT 0 CHECK (service_price_cents >= 0),

  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (order_id, position)
);


-- ════════════════════════════════════════════════════════════
-- 2. DEVICE_ID EM CHECKLIST_ITEMS E ORDER_PHOTOS
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.checklist_items
  ADD COLUMN device_id UUID REFERENCES public.order_devices(id) ON DELETE CASCADE;

ALTER TABLE public.order_photos
  ADD COLUMN device_id UUID REFERENCES public.order_devices(id) ON DELETE CASCADE;


-- ════════════════════════════════════════════════════════════
-- 3. MIGRAR DADOS EXISTENTES
--    Cada OS atual tem exatamente 1 aparelho → position = 1
-- ════════════════════════════════════════════════════════════

INSERT INTO public.order_devices (
  id, tenant_id, order_id, position,
  brand_id, model_id, brand_name, model_name,
  color, storage, imei, serial_number,
  password, password_type,
  powers_on, physical_condition, physical_notes,
  service_price_cents,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  tenant_id,
  id             AS order_id,
  1              AS position,
  brand_id,
  model_id,
  COALESCE(brand_name, '') AS brand_name,
  COALESCE(model_name, '') AS model_name,
  color,
  storage,
  imei,
  serial_number,
  password,
  password_type,
  powers_on,
  physical_condition,
  COALESCE(physical_notes, '') AS physical_notes,
  service_price_cents,
  created_at,
  updated_at
FROM public.service_orders;


-- ════════════════════════════════════════════════════════════
-- 4. VINCULAR CHECKLIST E FOTOS AO DEVICE MIGRADO
-- ════════════════════════════════════════════════════════════

UPDATE public.checklist_items ci
SET device_id = od.id
FROM public.order_devices od
WHERE od.order_id = ci.order_id
  AND od.position = 1;

UPDATE public.order_photos op
SET device_id = od.id
FROM public.order_devices od
WHERE od.order_id = op.order_id
  AND od.position = 1;


-- ════════════════════════════════════════════════════════════
-- 5. ATUALIZAR CONSTRAINT UNIQUE DO CHECKLIST
--    A constraint antiga era (order_id, phase, item_key).
--    Com multi-device vira (order_id, device_id, phase, item_key).
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.checklist_items
  DROP CONSTRAINT IF EXISTS checklist_items_order_id_phase_item_key_key;

ALTER TABLE public.checklist_items
  ADD CONSTRAINT checklist_items_device_phase_item_key
  UNIQUE (order_id, device_id, phase, item_key);

-- order_photos: a constraint antiga era (order_id, phase, position).
-- Com multi-device vira (order_id, device_id, phase, position).
ALTER TABLE public.order_photos
  DROP CONSTRAINT IF EXISTS order_photos_order_id_phase_position_key;

ALTER TABLE public.order_photos
  ADD CONSTRAINT order_photos_device_phase_position
  UNIQUE (order_id, device_id, phase, position);


-- ════════════════════════════════════════════════════════════
-- 6. RLS
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.order_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_devices: tenant select"
  ON public.order_devices FOR SELECT
  USING (tenant_id = public.tenant_id());

CREATE POLICY "order_devices: tenant insert"
  ON public.order_devices FOR INSERT
  WITH CHECK (tenant_id = public.tenant_id());

CREATE POLICY "order_devices: tenant update"
  ON public.order_devices FOR UPDATE
  USING (tenant_id = public.tenant_id());

CREATE POLICY "order_devices: tenant delete"
  ON public.order_devices FOR DELETE
  USING (tenant_id = public.tenant_id());

-- Permite acesso público (sem auth) via service_role para remote-sign
-- (service_role bypassa RLS por design — não precisa de policy adicional)


-- ════════════════════════════════════════════════════════════
-- 7. ÍNDICES
-- ════════════════════════════════════════════════════════════

CREATE INDEX idx_order_devices_order  ON public.order_devices(order_id);
CREATE INDEX idx_order_devices_tenant ON public.order_devices(tenant_id, order_id);
CREATE INDEX idx_checklist_device     ON public.checklist_items(device_id);
CREATE INDEX idx_photos_device        ON public.order_photos(device_id);


-- ════════════════════════════════════════════════════════════
-- 8. TRIGGER updated_at
-- ════════════════════════════════════════════════════════════

CREATE TRIGGER trg_touch_order_devices
  BEFORE UPDATE ON public.order_devices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 015_unlimited_photos.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 015: Remove 4-photo limit per phase
-- Allows unlimited photos per entry/exit phase on a service order.

-- Drop the CHECK constraint that limited position to 1-4
ALTER TABLE public.order_photos
  DROP CONSTRAINT IF EXISTS order_photos_position_check;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 016_order_videos.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 016: order_videos table
-- Stores entry/exit videos for service orders with signed URLs (like order_photos).

CREATE TABLE public.order_videos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  order_id      UUID        NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  device_id     UUID        REFERENCES public.order_devices(id) ON DELETE CASCADE,
  storage_path  TEXT        NOT NULL,
  storage_url   TEXT        NOT NULL,
  phase         TEXT        NOT NULL CHECK (phase IN ('entry', 'exit')),
  position      INT         NOT NULL,
  uploaded_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_videos_order_id  ON public.order_videos (order_id);
CREATE INDEX idx_order_videos_tenant_id ON public.order_videos (tenant_id);

ALTER TABLE public.order_videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Videos: tenant isolation"
  ON public.order_videos FOR SELECT
  USING (tenant_id = public.tenant_id());

CREATE POLICY "Videos: technician and above can insert"
  ON public.order_videos FOR INSERT
  WITH CHECK (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager', 'technician')
  );

CREATE POLICY "Videos: owner and manager can delete"
  ON public.order_videos FOR DELETE
  USING (
    tenant_id = public.tenant_id()
    AND public.tenant_role() IN ('owner', 'manager')
  );


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 017_customer_extra_fields.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 017: campos extras na tabela customers (espelho do Bling)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS birth_date       DATE,
  ADD COLUMN IF NOT EXISTS trade_name       TEXT,
  ADD COLUMN IF NOT EXISTS phone            TEXT,
  ADD COLUMN IF NOT EXISTS website          TEXT,
  ADD COLUMN IF NOT EXISTS person_type      TEXT DEFAULT 'fisica',
  ADD COLUMN IF NOT EXISTS ie_rg            TEXT,
  ADD COLUMN IF NOT EXISTS is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS marital_status   TEXT,
  ADD COLUMN IF NOT EXISTS profession       TEXT,
  ADD COLUMN IF NOT EXISTS gender           TEXT,
  ADD COLUMN IF NOT EXISTS father_name      TEXT,
  ADD COLUMN IF NOT EXISTS father_cpf       TEXT,
  ADD COLUMN IF NOT EXISTS mother_name      TEXT,
  ADD COLUMN IF NOT EXISTS mother_cpf       TEXT,
  ADD COLUMN IF NOT EXISTS salesperson      TEXT,
  ADD COLUMN IF NOT EXISTS contact_type     TEXT,
  ADD COLUMN IF NOT EXISTS nfe_email        TEXT,
  ADD COLUMN IF NOT EXISTS credit_limit_cents INTEGER NOT NULL DEFAULT 0;


-- ════════════════════════════════════════════════════════════════════════════
-- CheckSmart 018_order_share_tokens.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  018 — Tokens públicos pra compartilhar PDF da OS via WhatsApp/Email     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cria tabela `service_order_share_tokens` pra gerar links públicos
-- (sem autenticação) do PDF da OS. Cliente abre o link no celular/desktop
-- e baixa o PDF. Token aleatório, expira em 30 dias.
--
-- Uso: WhatsApp (link na mensagem wa.me) e Email (botão "Abrir online" no
-- corpo, complementando o anexo PDF estático).

CREATE TABLE IF NOT EXISTS public.service_order_share_tokens (
  token        TEXT PRIMARY KEY,
  order_id     UUID NOT NULL REFERENCES public.service_orders(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id)        ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_so_share_tokens_order    ON public.service_order_share_tokens(order_id);
CREATE INDEX IF NOT EXISTS idx_so_share_tokens_expires  ON public.service_order_share_tokens(expires_at);

-- RLS: ninguém lê/escreve via cliente Supabase. Acesso só via admin client
-- (route handler valida token antes de gerar PDF; server action cria via service_role).
ALTER TABLE public.service_order_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_order_share_tokens: deny all" ON public.service_order_share_tokens;
CREATE POLICY "service_order_share_tokens: deny all"
  ON public.service_order_share_tokens FOR ALL
  USING (false);

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- 001b_smarterp_tables.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  001b — Tabelas core do SmartERP (products, sales, parts_catalog)        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Complemento do 001_initial_schema.sql (que vem do CheckSmart e cria
-- tenants, customers, service_orders etc). Aqui criamos as tabelas que
-- as migrations 002-037 do SmartERP assumem existir mas que historicamente
-- foram criadas direto no SQL editor sem virar migration:
--   - products
--   - sales
--   - sale_items
--   - parts_catalog
--
-- IMPORTANTE: campos que foram adicionados via migrations posteriores
-- (ex: products.category, sales.sale_channel) NÃO entram aqui — vão ser
-- adicionados via ALTER TABLE quando as migrations 002+ rodarem em ordem.

-- ════════════════════════════════════════════════════════════
-- products
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  code                  TEXT,
  name                  TEXT NOT NULL,
  brand                 TEXT,
  format                TEXT NOT NULL DEFAULT 'simples',
  condition             TEXT NOT NULL DEFAULT 'novo',
  gtin                  TEXT,

  -- Preços em centavos
  purchase_price_cents  INTEGER NOT NULL DEFAULT 0,
  cost_cents            INTEGER NOT NULL DEFAULT 0,
  price_cents           INTEGER NOT NULL DEFAULT 0,
  unit                  TEXT NOT NULL DEFAULT 'Un',

  -- Estoque
  stock_qty             NUMERIC(12, 3) NOT NULL DEFAULT 0,
  stock_min             NUMERIC(12, 3) NOT NULL DEFAULT 0,
  stock_max             NUMERIC(12, 3) NOT NULL DEFAULT 0,
  location              TEXT,
  supplier              TEXT,

  image_urls            TEXT[] NOT NULL DEFAULT '{}',
  description           TEXT,
  active                BOOLEAN NOT NULL DEFAULT true,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_tenant       ON public.products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant_name  ON public.products(tenant_id, name);
CREATE INDEX IF NOT EXISTS idx_products_tenant_code  ON public.products(tenant_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_tenant_gtin  ON public.products(tenant_id, gtin) WHERE gtin IS NOT NULL;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products: tenant isolation" ON public.products;
CREATE POLICY "products: tenant isolation"
  ON public.products FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- ════════════════════════════════════════════════════════════
-- sales
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sales (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id       UUID REFERENCES public.customers(id) ON DELETE SET NULL,

  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  shipping_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,

  payment_method    TEXT NOT NULL DEFAULT 'pix',
  payment_details   JSONB,

  status            TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'cancelled', 'refunded')),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_tenant_created  ON public.sales(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer        ON public.sales(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_user            ON public.sales(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_status          ON public.sales(tenant_id, status);

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales: tenant isolation" ON public.sales;
CREATE POLICY "sales: tenant isolation"
  ON public.sales FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- ════════════════════════════════════════════════════════════
-- sale_items
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sale_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id           UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id        UUID,                          -- pode apontar pra products OU parts_catalog (não FK estrita)
  name              TEXT NOT NULL,                  -- snapshot — preserva histórico mesmo se produto for excluído
  quantity          NUMERIC(12, 3) NOT NULL,
  unit_price_cents  INTEGER NOT NULL,
  subtotal_cents    INTEGER NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale     ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product  ON public.sale_items(product_id) WHERE product_id IS NOT NULL;

-- RLS via JOIN com sales (sale_items não tem tenant_id próprio)
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sale_items: tenant via sale" ON public.sale_items;
CREATE POLICY "sale_items: tenant via sale"
  ON public.sale_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.tenant_id = public.tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.tenant_id = public.tenant_id()
    )
  );

-- ════════════════════════════════════════════════════════════
-- tenant_settings (configurações chave-valor por tenant)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.tenant_settings (
  tenant_id                  UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  stock_control_mode         TEXT NOT NULL DEFAULT 'warn'
    CHECK (stock_control_mode IN ('off', 'warn', 'block')),
  fisica_fixed_cost_cents    INTEGER,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_settings: tenant isolation" ON public.tenant_settings;
CREATE POLICY "tenant_settings: tenant isolation"
  ON public.tenant_settings FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 002_stock_movements.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — stock_movements
-- Módulo de lançamentos de estoque (entrada/saída), espelhando o workflow do Bling
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tabela de movimentações ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_movements (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid          NOT NULL,
  product_id            uuid          NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  type                  text          NOT NULL CHECK (type IN ('entrada', 'saida')),
  quantity              numeric(12,3) NOT NULL CHECK (quantity > 0),

  -- Preços em centavos (inteiros), zerados quando não se aplicam ao tipo
  purchase_price_cents  integer       NOT NULL DEFAULT 0,  -- preço de compra (entrada)
  cost_price_cents      integer       NOT NULL DEFAULT 0,  -- preço de custo  (entrada)
  sale_price_cents      integer       NOT NULL DEFAULT 0,  -- preço de venda  (saída)

  notes                 text,
  origin                text,         -- 'manual' | id de venda | id de OS, etc.

  created_at            timestamptz   NOT NULL DEFAULT now()
);

-- 2. Índices ───────────────────────────────────────────────────────────────────

CREATE INDEX idx_stock_movements_tenant_id   ON stock_movements (tenant_id);
CREATE INDEX idx_stock_movements_product_id  ON stock_movements (product_id);
CREATE INDEX idx_stock_movements_created_at  ON stock_movements (created_at DESC);

-- 3. RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_movements: tenant isolation"
  ON stock_movements
  FOR ALL
  USING  (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- 4. Função para atualizar o produto após cada lançamento ─────────────────────
--    Entrada → soma estoque, atualiza preço de compra e custo
--    Saída   → subtrai estoque (mínimo 0)

CREATE OR REPLACE FUNCTION trg_sync_product_after_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.type = 'entrada' THEN
    UPDATE products SET
      stock_qty             = stock_qty + NEW.quantity,
      purchase_price_cents  = CASE WHEN NEW.purchase_price_cents > 0
                                   THEN NEW.purchase_price_cents
                                   ELSE purchase_price_cents END,
      cost_cents            = CASE WHEN NEW.cost_price_cents > 0
                                   THEN NEW.cost_price_cents
                                   ELSE cost_cents END,
      updated_at            = now()
    WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;

  ELSIF NEW.type = 'saida' THEN
    UPDATE products SET
      stock_qty  = GREATEST(0, stock_qty - NEW.quantity),
      updated_at = now()
    WHERE id = NEW.product_id AND tenant_id = NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_after_stock_movement
  AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION trg_sync_product_after_movement();

-- 5. View de resumo por produto (usado no painel lateral) ─────────────────────

CREATE OR REPLACE VIEW stock_summary_by_product AS
SELECT
  product_id,
  tenant_id,
  COALESCE(SUM(quantity) FILTER (WHERE type = 'entrada'), 0)              AS total_entrada,
  COALESCE(SUM(purchase_price_cents * quantity)
           FILTER (WHERE type = 'entrada') / NULLIF(
             SUM(quantity) FILTER (WHERE type = 'entrada'), 0
           ), 0)::integer                                                   AS avg_purchase_price_cents,
  COALESCE(SUM(quantity) FILTER (WHERE type = 'saida'),  0)               AS total_saida,
  COALESCE(SUM(sale_price_cents * quantity)
           FILTER (WHERE type = 'saida') / NULLIF(
             SUM(quantity) FILTER (WHERE type = 'saida'), 0
           ), 0)::integer                                                   AS avg_sale_price_cents
FROM stock_movements
GROUP BY product_id, tenant_id;


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 003_add_category_to_products.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 003 — adiciona coluna category à tabela products

ALTER TABLE products ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 004_product_extra_fields.sql
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 005_product_gross_weight.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 005 — peso bruto separado do peso líquido

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS gross_weight_g numeric(10,3);


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 006_stock_movements_moved_at.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 006 — data de negócio e depósito nos lançamentos de estoque

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS moved_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS depot    text;

-- Índice para ordenação eficiente por data de negócio
CREATE INDEX IF NOT EXISTS idx_stock_movements_moved_at
  ON stock_movements (product_id, tenant_id, moved_at DESC);


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 007_customer_origin.sql
-- ════════════════════════════════════════════════════════════════════════════
-- Migration 007 — origem do cliente ("Como nos conheceu?")
-- Campo opcional em customers. É a fonte única usada por PhoneSmart e CheckSmart
-- (cadastro de cliente, abertura de OS, Frente de Caixa, dashboards e relatórios).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS origin text;

-- Constraint garante que só os valores pré-definidos são aceitos (ou NULL).
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_origin_check;

ALTER TABLE customers
  ADD CONSTRAINT customers_origin_check
  CHECK (origin IS NULL OR origin IN (
    'instagram_pago',
    'instagram_organico',
    'indicacao',
    'passou_na_porta',
    'google',
    'facebook',
    'outros'
  ));

-- Índice parcial para acelerar agregações por origem nos relatórios/dashboards.
CREATE INDEX IF NOT EXISTS customers_origin_idx
  ON customers (origin)
  WHERE origin IS NOT NULL;

COMMENT ON COLUMN customers.origin IS
  'Como o cliente conheceu a empresa. Valores: instagram_pago, instagram_organico, indicacao, passou_na_porta, google, facebook, outros. NULL = não informado.';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 008_standardize_os_status.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008 — padronizar status de service_orders em inglês
--
-- Contexto: ao longo do desenvolvimento alguns registros foram criados com
-- status em português ('Cancelado', 'Entregue') e outros em inglês
-- ('cancelled', 'delivered'). O código precisa usar `.in('status', [...])`
-- com os dois casos pra funcionar. Essa migração normaliza tudo em inglês.
--
-- Status válidos (alinhados com o enum do CheckSmart):
--   received · diagnosing · waiting_parts · in_repair · ready · delivered · cancelled
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. DIAGNÓSTICO (opcional) — rode primeiro pra ver o que vai mudar
--    Copie e cole separadamente se quiser só olhar antes de aplicar:
--
-- SELECT status, COUNT(*) as total
--   FROM service_orders
--  GROUP BY status
--  ORDER BY total DESC;

-- 2. APLICAR — atualiza os registros em português para inglês
UPDATE service_orders SET status = 'received'      WHERE status IN ('Recebido',         'Recebida');
UPDATE service_orders SET status = 'diagnosing'    WHERE status IN ('Em diagnóstico',   'Em diagnostico', 'Diagnosticando');
UPDATE service_orders SET status = 'waiting_parts' WHERE status IN ('Aguardando peças', 'Aguardando pecas');
UPDATE service_orders SET status = 'in_repair'     WHERE status IN ('Em reparo',        'Em conserto');
UPDATE service_orders SET status = 'ready'         WHERE status IN ('Pronto',           'Pronta');
UPDATE service_orders SET status = 'delivered'     WHERE status IN ('Entregue',         'Entregado');
UPDATE service_orders SET status = 'cancelled'     WHERE status IN ('Cancelado',        'Cancelada');

-- 3. VERIFICAR resultado — deve listar apenas os 7 status válidos em inglês
SELECT status, COUNT(*) as total
  FROM service_orders
 GROUP BY status
 ORDER BY total DESC;

-- Nota: depois disso, os filtros `.in('status', ['delivered', 'Entregue'])` no
-- código podem ser simplificados para `.eq('status', 'delivered')` — mas isso
-- não é obrigatório, o `.in()` continua funcionando.


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 009_merge_consumidor_final.sql
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 010_diagnostico_duplicados.sql
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 011_recreate_whatsapp_unique_index.sql
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 012_sale_items_cost_snapshot.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012 — snapshot de custo em sale_items
--
-- Contexto: hoje o ERP Clientes calcula o lucro como
--   sale_items.unit_price_cents × quantity − products.cost_cents × quantity
-- Problema: products.cost_cents é o custo ATUAL. Se você mudar o custo depois,
-- o lucro de vendas antigas recalcula retroativamente, o que distorce
-- relatórios contábeis.
--
-- Solução: adicionar cost_snapshot_cents em sale_items, preenchido com o custo
-- corrente no momento da venda. O ERP Clientes passa a usar esse valor quando
-- existir (com fallback pro products.cost_cents atual, pra vendas antigas
-- que não têm snapshot).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS cost_snapshot_cents integer;

COMMENT ON COLUMN sale_items.cost_snapshot_cents IS
  'Custo do produto NO MOMENTO da venda (cópia de products.cost_cents). '
  'NULL para vendas feitas antes desta migração — ERP Clientes faz '
  'fallback para o custo atual.';

-- (Opcional) Backfill: preenche snapshot das vendas antigas com o custo atual.
-- Isso NÃO reconstrói o custo histórico (que foi perdido), mas evita que
-- mudanças futuras de custo afetem retroativamente essas vendas.
-- Descomente se quiser aplicar:
--
-- UPDATE sale_items si
--    SET cost_snapshot_cents = p.cost_cents
--   FROM products p
--  WHERE si.product_id = p.id
--    AND si.cost_snapshot_cents IS NULL;

-- Verificação
SELECT
  COUNT(*) AS total_sale_items,
  COUNT(cost_snapshot_cents) AS com_snapshot,
  COUNT(*) - COUNT(cost_snapshot_cents) AS sem_snapshot
  FROM sale_items;


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 013_fix_516_clientes_sem_data.sql
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 014_meta_ads_credentials.sql
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 015_meta_ads_multi_account.sql
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 016_meta_ads_alerts.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 016 — Alertas de Meta Ads
--
-- Permite configurar regras que monitoram métricas de campanhas e disparam
-- eventos quando thresholds são violados (ex: "CPC > R$ 2,00 por 3 dias").
--
-- Duas tabelas:
--   1) meta_ads_alert_rules  → regras configuradas pelo usuário
--   2) meta_ads_alert_events → histórico de alertas disparados (audit trail)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Regras ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_ads_alert_rules (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  name              text        NOT NULL,
  rule_type         text        NOT NULL
                                CHECK (rule_type IN ('high_cpc', 'high_daily_spend', 'low_ctr', 'zero_clicks')),

  -- Escopo: NULL em ambos = todas as contas e campanhas
  ad_account_id     text,
  campaign_id       text,       -- se informado, só avalia essa campanha; caso contrário, todas

  -- Threshold (só um é usado por rule_type):
  --   high_cpc         → threshold_cents     (CPC em centavos)
  --   high_daily_spend → threshold_cents     (gasto diário em centavos)
  --   low_ctr          → threshold_percent   (CTR em %, ex: 1.5)
  --   zero_clicks      → (nenhum threshold necessário)
  threshold_cents   integer,
  threshold_percent numeric(6, 2),

  -- Janela temporal: avalia os últimos N dias
  days_window       integer     NOT NULL DEFAULT 1
                                CHECK (days_window >= 1 AND days_window <= 30),

  -- Cooldown: tempo mínimo entre disparos do mesmo alerta (rule × campanha)
  cooldown_hours    integer     NOT NULL DEFAULT 24
                                CHECK (cooldown_hours >= 1 AND cooldown_hours <= 720),

  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_ads_alert_rules_tenant_idx
  ON meta_ads_alert_rules (tenant_id);

CREATE INDEX IF NOT EXISTS meta_ads_alert_rules_active_idx
  ON meta_ads_alert_rules (tenant_id)
  WHERE is_active = true;

ALTER TABLE meta_ads_alert_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_ads_alert_rules: tenant isolation" ON meta_ads_alert_rules;
CREATE POLICY "meta_ads_alert_rules: tenant isolation"
  ON meta_ads_alert_rules
  FOR ALL
  USING     (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

COMMENT ON TABLE  meta_ads_alert_rules IS 'Regras de monitoramento de campanhas Meta. Avaliadas manualmente via "Avaliar agora" ou via cron externo.';
COMMENT ON COLUMN meta_ads_alert_rules.rule_type IS 'high_cpc | high_daily_spend | low_ctr | zero_clicks';
COMMENT ON COLUMN meta_ads_alert_rules.days_window IS 'Janela de avaliação: métrica precisa violar o threshold por N dias consecutivos.';
COMMENT ON COLUMN meta_ads_alert_rules.cooldown_hours IS 'Tempo mínimo entre disparos do mesmo par (rule, campanha). Evita spam.';

-- ── 2) Eventos (histórico) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_ads_alert_events (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  rule_id           uuid        REFERENCES meta_ads_alert_rules(id) ON DELETE CASCADE,
  rule_type         text        NOT NULL,
  rule_name         text        NOT NULL,      -- snapshot do nome da regra no momento do disparo

  ad_account_id     text        NOT NULL,
  campaign_id       text,
  campaign_name     text,

  message           text        NOT NULL,      -- texto já formatado pra UI
  value_observed    text,                       -- ex: "R$ 2,45" ou "0.80%"
  value_threshold   text,                       -- ex: "R$ 2,00" ou "1.50%"

  triggered_at      timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz,                -- null = não lido
  dismissed_at      timestamptz                 -- null = ativo na lista; não-null = arquivado
);

CREATE INDEX IF NOT EXISTS meta_ads_alert_events_tenant_idx
  ON meta_ads_alert_events (tenant_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS meta_ads_alert_events_unread_idx
  ON meta_ads_alert_events (tenant_id)
  WHERE read_at IS NULL AND dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS meta_ads_alert_events_cooldown_idx
  ON meta_ads_alert_events (tenant_id, rule_id, campaign_id, triggered_at DESC);

ALTER TABLE meta_ads_alert_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meta_ads_alert_events: tenant isolation" ON meta_ads_alert_events;
CREATE POLICY "meta_ads_alert_events: tenant isolation"
  ON meta_ads_alert_events
  FOR ALL
  USING     (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

COMMENT ON TABLE  meta_ads_alert_events IS 'Eventos disparados pelas regras de meta_ads_alert_rules. Snapshot textual pra permitir histórico mesmo após a regra ser editada/removida.';
COMMENT ON COLUMN meta_ads_alert_events.read_at IS 'Marcado quando o usuário visualiza. NULL = não lido (entra no contador do badge).';
COMMENT ON COLUMN meta_ads_alert_events.dismissed_at IS 'Marcado quando o usuário arquiva. Eventos dismissados somem da lista principal.';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 017_sales_channels.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017 — Canal da venda + modalidade de entrega
--
-- Permite distinguir:
--   - Canal da venda (sale_channel): como a venda aconteceu
--     whatsapp | instagram_dm | delivery_online | fisica_balcao | fisica_retirada | outro
--
--   - Tipo de entrega (delivery_type): como o produto chegou ao cliente
--     counter  — entregue no balcão (cliente levou na hora)
--     pickup   — cliente retirou depois (venda online com retirada física)
--     shipping — enviado via transportadora / motoboy / correios
--
-- Objetivo: medir % de vendas online vs físicas, calcular o "efeito sustento"
-- (quanto % da "física" é na verdade retirada de venda online) e viabilizar
-- relatórios de break-even da loja física.
--
-- Aplicado em AMBAS as tabelas de venda:
--   - sales (vendas do PhoneSmart/POS)
--   - service_orders (OS do CheckSmart)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── sales ────────────────────────────────────────────────────────────────────

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sale_channel   text,
  ADD COLUMN IF NOT EXISTS delivery_type  text;

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_sale_channel_check;

ALTER TABLE sales
  ADD CONSTRAINT sales_sale_channel_check
  CHECK (sale_channel IS NULL OR sale_channel IN (
    'whatsapp', 'instagram_dm', 'delivery_online',
    'fisica_balcao', 'fisica_retirada', 'outro'
  ));

ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_delivery_type_check;

ALTER TABLE sales
  ADD CONSTRAINT sales_delivery_type_check
  CHECK (delivery_type IS NULL OR delivery_type IN ('counter', 'pickup', 'shipping'));

CREATE INDEX IF NOT EXISTS sales_sale_channel_idx
  ON sales (tenant_id, sale_channel)
  WHERE sale_channel IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_delivery_type_idx
  ON sales (tenant_id, delivery_type)
  WHERE delivery_type IS NOT NULL;

COMMENT ON COLUMN sales.sale_channel IS
  'Canal pelo qual a venda aconteceu: whatsapp | instagram_dm | delivery_online | fisica_balcao | fisica_retirada | outro. NULL = não informado (vendas legadas).';
COMMENT ON COLUMN sales.delivery_type IS
  'Modalidade de entrega: counter (levou na hora) | pickup (retirou depois) | shipping (enviado). NULL = não informado.';

-- ── service_orders ───────────────────────────────────────────────────────────

ALTER TABLE service_orders
  ADD COLUMN IF NOT EXISTS sale_channel   text,
  ADD COLUMN IF NOT EXISTS delivery_type  text;

ALTER TABLE service_orders
  DROP CONSTRAINT IF EXISTS service_orders_sale_channel_check;

ALTER TABLE service_orders
  ADD CONSTRAINT service_orders_sale_channel_check
  CHECK (sale_channel IS NULL OR sale_channel IN (
    'whatsapp', 'instagram_dm', 'delivery_online',
    'fisica_balcao', 'fisica_retirada', 'outro'
  ));

ALTER TABLE service_orders
  DROP CONSTRAINT IF EXISTS service_orders_delivery_type_check;

ALTER TABLE service_orders
  ADD CONSTRAINT service_orders_delivery_type_check
  CHECK (delivery_type IS NULL OR delivery_type IN ('counter', 'pickup', 'shipping'));

CREATE INDEX IF NOT EXISTS service_orders_sale_channel_idx
  ON service_orders (tenant_id, sale_channel)
  WHERE sale_channel IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_orders_delivery_type_idx
  ON service_orders (tenant_id, delivery_type)
  WHERE delivery_type IS NOT NULL;

COMMENT ON COLUMN service_orders.sale_channel IS
  'Canal pelo qual a OS foi originada. Mesmos valores de sales.sale_channel.';
COMMENT ON COLUMN service_orders.delivery_type IS
  'Modalidade de entrega. Mesmos valores de sales.delivery_type.';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 018_tenant_fixed_costs.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 018 — Custo fixo mensal da loja física
--
-- Adiciona coluna em tenant_settings pra registrar quanto custa manter a
-- loja física por mês (aluguel + contas + salários alocados à física + etc).
--
-- Usado no dashboard /analytics/canais pra calcular break-even:
--   deficit_fisica = custo_fixo_mensal - (faturamento_balcao_no_mes)
--   se deficit > 0  → online cobre a diferença (loja física dando prejuízo)
--
-- NULL = não configurado (break-even não é exibido).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS fisica_fixed_cost_cents integer;

ALTER TABLE tenant_settings
  DROP CONSTRAINT IF EXISTS tenant_settings_fisica_fixed_cost_nonneg;

ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_fisica_fixed_cost_nonneg
  CHECK (fisica_fixed_cost_cents IS NULL OR fisica_fixed_cost_cents >= 0);

COMMENT ON COLUMN tenant_settings.fisica_fixed_cost_cents IS
  'Custo fixo mensal (em cents) da loja física: aluguel + energia + água + internet + salários alocados à física + outros recorrentes. Usado no cálculo de break-even em /analytics/canais. NULL = não configurado.';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 019_tenants_signup.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  019 — Tenants & Signup automático                                       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Tanto `tenants` quanto `subscriptions` JÁ EXISTEM no banco (criadas pelo
-- CheckSmart). Vamos REAPROVEITAR:
--
--   - `tenants`: adiciona owner_user_id (nullable)
--   - `subscriptions`: já tem schema completo (id, tenant_id, status, plan_name,
--      price_cents, gateway, etc) — só precisa que a RPC saiba o esquema certo
--
-- Idempotente: pode rodar várias vezes sem efeito colateral.

-- ── 1. Estende tabela tenants existente ────────────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_owner ON public.tenants(owner_user_id);

-- (RLS já existe na tabela — não mexer)

-- ── 2. Garante que subscriptions tem RLS de leitura por tenant ────────────
-- Se já existe policy igual, drop+recreate pra ficar consistente.

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions: tenant reads" ON public.subscriptions;
CREATE POLICY "subscriptions: tenant reads"
  ON public.subscriptions FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- ── 3. RPC create_tenant_for_user ──────────────────────────────────────────
--
-- Cria tenant + subscription pra um user recém-criado.
-- Usa o schema EXISTENTE de subscriptions (plan_name TEXT, price_cents INTEGER).

CREATE OR REPLACE FUNCTION public.create_tenant_for_user(
  p_user_id     UUID,
  p_tenant_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_slug      TEXT;
BEGIN
  -- Slug único (nome normalizado + timestamp)
  v_slug := lower(regexp_replace(p_tenant_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || extract(epoch from now())::bigint;

  -- Cria tenant com defaults razoáveis (campos NOT NULL legados do CheckSmart)
  INSERT INTO public.tenants (
    name,
    slug,
    address_state,
    warranty_days,
    pickup_days,
    is_active,
    require_signature,
    owner_user_id
  ) VALUES (
    p_tenant_name,
    v_slug,
    'SP',           -- placeholder — user altera nas configurações
    90,
    30,
    true,
    true,
    p_user_id
  )
  RETURNING id INTO v_tenant_id;

  -- Cria assinatura em trial de 7 dias, plano Básico (R$ 97)
  INSERT INTO public.subscriptions (
    tenant_id, status, plan_name, price_cents, trial_ends_at
  ) VALUES (
    v_tenant_id, 'trialing', 'basico', 9700, now() + INTERVAL '7 days'
  );

  RETURN v_tenant_id;
END $$;

REVOKE  ALL    ON FUNCTION public.create_tenant_for_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE  ON FUNCTION public.create_tenant_for_user(UUID, TEXT) TO service_role;

-- ── 4. Refresh do schema cache ────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 020_subscriptions_per_product.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  020 — Subscriptions por produto                                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Hoje subscriptions tem 1 row por tenant_id. Mas Phone Smart vende 4
-- produtos INDEPENDENTES (gestao_smart, checksmart, crm, meta_ads). Cliente
-- pode contratar 1, alguns ou todos.
--
-- Este migration:
--   1. Adiciona coluna `product` (TEXT com CHECK) em subscriptions
--   2. Backfilla rows existentes como product='gestao_smart'
--   3. Cria UNIQUE (tenant_id, product) — cada tenant pode ter 1 sub por produto
--   4. Atualiza a RPC create_tenant_for_user pra setar product corretamente
--
-- Idempotente: pode rodar várias vezes sem efeito colateral.

-- ── 1. Adiciona coluna product ────────────────────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'gestao_smart';

-- CHECK constraint (em vez de enum) pra facilitar adicionar produtos no futuro.
-- DROP+ADD se já existir, pra refletir a lista atual sem erro.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_product_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_product_check
    CHECK (product IN ('gestao_smart', 'checksmart', 'crm', 'meta_ads'));

-- ── 2. UNIQUE (tenant_id, product) ────────────────────────────────────────
-- Cada tenant pode ter no máximo 1 assinatura por produto.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS uq_tenant_product;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT uq_tenant_product UNIQUE (tenant_id, product);

-- ── 3. Atualiza RPC create_tenant_for_user ────────────────────────────────
-- Ao criar tenant, gera apenas a assinatura de Gestão Smart Básico em trial.
-- CheckSmart/CRM/Meta Ads são contratados depois pelo cliente em
-- /configuracoes/assinatura.

CREATE OR REPLACE FUNCTION public.create_tenant_for_user(
  p_user_id     UUID,
  p_tenant_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_slug      TEXT;
BEGIN
  v_slug := lower(regexp_replace(p_tenant_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || extract(epoch from now())::bigint;

  INSERT INTO public.tenants (
    name, slug, address_state, warranty_days, pickup_days,
    is_active, require_signature, owner_user_id
  ) VALUES (
    p_tenant_name, v_slug, 'SP', 90, 30, true, true, p_user_id
  )
  RETURNING id INTO v_tenant_id;

  -- Assinatura Gestão Smart Básico em trial 7d
  INSERT INTO public.subscriptions (
    tenant_id, product, status, plan_name, price_cents, trial_ends_at
  ) VALUES (
    v_tenant_id, 'gestao_smart', 'trialing', 'basico', 9700,
    now() + INTERVAL '7 days'
  );

  RETURN v_tenant_id;
END $$;

REVOKE  ALL    ON FUNCTION public.create_tenant_for_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE  ON FUNCTION public.create_tenant_for_user(UUID, TEXT) TO service_role;

-- ── 4. Refresh schema cache ───────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 021_subscriptions_status_compat.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  021 — Compatibilidade com CHECK constraint de status                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A coluna `subscriptions.status` tem CHECK que aceita apenas:
-- 'trial' | 'active' | 'late' | 'inactive' | 'cancelled'
--
-- Eu usei 'trialing' (nome que o Stripe usa) na RPC, e quebrou o INSERT.
-- Aqui ajusto a RPC pra usar 'trial' (nome que já existia no banco).

CREATE OR REPLACE FUNCTION public.create_tenant_for_user(
  p_user_id     UUID,
  p_tenant_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_slug      TEXT;
BEGIN
  v_slug := lower(regexp_replace(p_tenant_name, '[^a-zA-Z0-9]+', '-', 'g'))
            || '-' || extract(epoch from now())::bigint;

  INSERT INTO public.tenants (
    name, slug, address_state, warranty_days, pickup_days,
    is_active, require_signature, owner_user_id
  ) VALUES (
    p_tenant_name, v_slug, 'SP', 90, 30, true, true, p_user_id
  )
  RETURNING id INTO v_tenant_id;

  -- 'trial' (não 'trialing') — match do CHECK constraint existente
  INSERT INTO public.subscriptions (
    tenant_id, product, status, plan_name, price_cents, trial_ends_at
  ) VALUES (
    v_tenant_id, 'gestao_smart', 'trial', 'basico', 9700,
    now() + INTERVAL '7 days'
  );

  RETURN v_tenant_id;
END $$;

REVOKE  ALL    ON FUNCTION public.create_tenant_for_user(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE  ON FUNCTION public.create_tenant_for_user(UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 022_tenant_invites.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  022 — Tenant invites (multi-usuário no tenant)                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Permite que o owner de um tenant convide outros usuários (manager) pra
-- acessar a mesma conta. Cada convite é um token de uso único com expiração.
--
-- Fluxo:
-- 1. Owner cria invite (email + role) → token gerado, email enviado
-- 2. Convidado clica no link /aceitar-convite/[token]
-- 3. Define senha → backend cria user via admin com app_metadata apontando
--    pro mesmo tenant_id do owner + tenant_role escolhido
-- 4. Invite marcado como aceito (accepted_at = now)
--
-- Roles permitidos: 'owner' (já existente, default no signup), 'manager'.
-- 'seller' / 'technician' ficam pra depois (precisam ajuste nas RLS).

CREATE TABLE IF NOT EXISTS public.tenant_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('manager')),
  token           TEXT NOT NULL UNIQUE,
  invited_by      UUID NOT NULL REFERENCES auth.users(id),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  accepted_at     TIMESTAMPTZ,
  accepted_by     UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant ON public.tenant_invites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_token  ON public.tenant_invites(token) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_invites_email  ON public.tenant_invites(email);

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;

-- Owner do tenant pode ler/criar/cancelar invites
DROP POLICY IF EXISTS "tenant_invites: owner reads"   ON public.tenant_invites;
DROP POLICY IF EXISTS "tenant_invites: owner inserts" ON public.tenant_invites;
DROP POLICY IF EXISTS "tenant_invites: owner deletes" ON public.tenant_invites;

CREATE POLICY "tenant_invites: owner reads"
  ON public.tenant_invites FOR SELECT
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'tenant_role') = 'owner'
  );

CREATE POLICY "tenant_invites: owner inserts"
  ON public.tenant_invites FOR INSERT
  WITH CHECK (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'tenant_role') = 'owner'
  );

CREATE POLICY "tenant_invites: owner deletes"
  ON public.tenant_invites FOR DELETE
  USING (
    tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'tenant_role') = 'owner'
  );

-- (sem UPDATE policy — accept_at é setado via service_role no backend)

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 023_notifications.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  023 — Notifications in-app                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Tabela de notificações por usuário (não por tenant). Cada user vê só
-- as suas. RLS isola.
--
-- Geradores típicos:
-- - alerta Meta Ads (campanha pausada/com problema)
-- - cliente em risco detectado pelo CRM
-- - nova OS pendente do CheckSmart
-- - convite aceito (avisa o owner que alguém entrou na equipe)
-- - trial acabando (D-3, D-1, D-0)
-- - boas-vindas após signup
--
-- Cada notif tem `type` (categoria pra ícone/cor), `title`, `body`, `link`
-- (rota interna pra navegar ao clicar) e `metadata` (jsonb pra dados extras).

CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,                      -- ex: '/meta-ads/alertas'
  metadata    JSONB,                     -- payload livre pra contexto
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_all
  ON public.notifications(user_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications: user reads"   ON public.notifications;
DROP POLICY IF EXISTS "notifications: user updates" ON public.notifications;

-- User só vê suas próprias notifs
CREATE POLICY "notifications: user reads"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

-- User só pode marcar suas próprias notifs como lidas (update no read_at)
CREATE POLICY "notifications: user updates"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- INSERT só via service_role (chamado por triggers/Server Actions de outros módulos).
-- Usuário não cria notif pra si direto.

-- ── Realtime: habilita pra essa tabela ─────────────────────────────────────
-- Permite que o client faça subscribe e receba INSERT em tempo real.

ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 024_asaas_integration.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  024 — Asaas integration                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Adiciona campos pra integrar com Asaas (gateway BR — PIX + cartão).
--
-- Decisão de schema:
-- - asaas_customer_id e cpf_cnpj ficam em `tenants` (1 customer Asaas por
--   empresa, reusado em todas as subscriptions).
-- - asaas_subscription_id, payment_method, next_due_date, billing_cycle ficam
--   em `subscriptions` (1 subscription Asaas por produto contratado).
--
-- Fluxo:
-- 1. User clica "Assinar produto X" → modal pede CPF/CNPJ se ainda não tiver
-- 2. Backend cria customer no Asaas (se 1ª vez), salva tenants.asaas_customer_id
-- 3. Backend cria subscription no Asaas com billingType=PIX (default) ou
--    CREDIT_CARD, salva subscriptions.asaas_subscription_id
-- 4. Webhook recebe PAYMENT_RECEIVED → vira status='active'
--
-- Idempotente.

-- ── 1. Tenants: cpf_cnpj + asaas_customer_id ──────────────────────────────

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS cpf_cnpj          TEXT,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

-- CPF (11 dígitos) ou CNPJ (14 dígitos), só números (Asaas valida formato).
ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_cpf_cnpj_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_cpf_cnpj_check
    CHECK (cpf_cnpj IS NULL OR cpf_cnpj ~ '^\d{11}$' OR cpf_cnpj ~ '^\d{14}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_asaas_customer_id
  ON public.tenants(asaas_customer_id)
  WHERE asaas_customer_id IS NOT NULL;

-- ── 2. Subscriptions: campos do Asaas ─────────────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_method        TEXT,
  ADD COLUMN IF NOT EXISTS next_due_date         DATE,
  ADD COLUMN IF NOT EXISTS billing_cycle         TEXT DEFAULT 'MONTHLY';

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_payment_method_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_payment_method_check
    CHECK (payment_method IS NULL OR payment_method IN ('PIX', 'CREDIT_CARD', 'BOLETO'));

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_billing_cycle_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_billing_cycle_check
    CHECK (billing_cycle IN ('MONTHLY', 'YEARLY'));

CREATE INDEX IF NOT EXISTS idx_subscriptions_asaas_subscription_id
  ON public.subscriptions(asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

-- ── 3. Tabela de log dos eventos do webhook (idempotência) ───────────────
-- Asaas pode reenviar o mesmo evento. Usar event_id como idempotency key
-- pra não processar duplicado.

CREATE TABLE IF NOT EXISTS public.asaas_webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT NOT NULL UNIQUE,    -- vem do Asaas (campo "id")
  event_type    TEXT NOT NULL,           -- PAYMENT_RECEIVED, PAYMENT_OVERDUE, etc
  payload       JSONB NOT NULL,          -- corpo cru pra auditoria
  processed     BOOLEAN NOT NULL DEFAULT false,
  processed_at  TIMESTAMPTZ,
  error         TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_received
  ON public.asaas_webhook_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_asaas_webhook_events_unprocessed
  ON public.asaas_webhook_events(received_at)
  WHERE processed = false;

-- RLS: só service_role lê/escreve (webhook + admin)
ALTER TABLE public.asaas_webhook_events ENABLE ROW LEVEL SECURITY;
-- Sem policy = ninguém acessa via API pública. service_role bypassa RLS.

-- ── 4. Refresh schema cache ───────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 025_drop_old_tenant_unique.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  025 — Remove constraint UNIQUE antiga em subscriptions(tenant_id)       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Histórico do problema:
-- - Schema original tinha UNIQUE(tenant_id) → cada tenant 1 sub total
-- - Migration 020 introduziu billing modular (4 produtos) e adicionou
--   UNIQUE (tenant_id, product) — mas esqueceu de DROPar a constraint antiga
-- - Resultado: tenant consegue assinar 1 produto; 2º falha com
--   "duplicate key value violates unique constraint subscriptions_tenant_id_key"
--
-- Fix: dropar a constraint legada. A nova UNIQUE(tenant_id, product) já
-- garante 1 sub por (tenant, produto), que é o comportamento correto.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_tenant_id_key;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 026_pending_plan.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  026 — Downgrade agendado pro próximo ciclo                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cliente pode mudar pra plano menor (downgrade), mas o efeito vale só no
-- próximo ciclo (sem reembolso da diferença). Modelo padrão SaaS.
--
-- Fluxo:
-- 1. User clica "Mudar plano" e escolhe plano menor que o atual
-- 2. Backend salva `pending_plan` e `pending_price_cents` na sub
-- 3. Backend chama PUT /v3/subscriptions/{id} no Asaas pra atualizar value
-- 4. Cliente continua com plano antigo (e features) até o ciclo expirar
-- 5. Webhook PAYMENT_RECEIVED da próxima cobrança detecta pending_plan,
--    aplica: plan_name = pending_plan, limpa pending
-- 6. Cliente passa a ver o novo plano e perde features do anterior

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pending_plan        TEXT,
  ADD COLUMN IF NOT EXISTS pending_price_cents INTEGER;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 027_recurring_expenses.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  027 — Recurring expenses (custos fixos detalhados)                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Substitui o campo único `tenants.fisica_fixed_cost_cents` por uma tabela
-- de despesas recorrentes detalhadas. Permite cadastrar cada despesa
-- separadamente (aluguel, salário, luz, etc) e calcular o total automático
-- pra usar no break-even da loja física.
--
-- O campo antigo `fisica_fixed_cost_cents` continua existindo como
-- fallback — se tenant tem despesas detalhadas cadastradas, usa a soma
-- delas; senão usa o campo antigo (compatibilidade pra contas existentes).
--
-- Categorias livres (TEXT) — user pode digitar qualquer categoria, mas a
-- UI sugere as principais: Aluguel, Salário, Luz, Água, Internet,
-- Contabilidade, Marketing, Outros.

CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                  -- ex: "Aluguel da loja"
  category    TEXT NOT NULL,                  -- ex: "aluguel", "salario", "luz"
  value_cents INTEGER NOT NULL CHECK (value_cents >= 0),
  active      BOOLEAN NOT NULL DEFAULT true,  -- pra desativar sem apagar
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_tenant
  ON public.recurring_expenses(tenant_id, active);

-- Auto-update do updated_at
CREATE OR REPLACE FUNCTION public.recurring_expenses_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recurring_expenses_updated_at ON public.recurring_expenses;
CREATE TRIGGER recurring_expenses_updated_at
  BEFORE UPDATE ON public.recurring_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.recurring_expenses_set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recurring_expenses: tenant select" ON public.recurring_expenses;
DROP POLICY IF EXISTS "recurring_expenses: tenant insert" ON public.recurring_expenses;
DROP POLICY IF EXISTS "recurring_expenses: tenant update" ON public.recurring_expenses;
DROP POLICY IF EXISTS "recurring_expenses: tenant delete" ON public.recurring_expenses;

CREATE POLICY "recurring_expenses: tenant select"
  ON public.recurring_expenses FOR SELECT
  USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE POLICY "recurring_expenses: tenant insert"
  ON public.recurring_expenses FOR INSERT
  WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE POLICY "recurring_expenses: tenant update"
  ON public.recurring_expenses FOR UPDATE
  USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE POLICY "recurring_expenses: tenant delete"
  ON public.recurring_expenses FOR DELETE
  USING (tenant_id = ((auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 028_tenant_member_permissions.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  028 — Permissões por módulo pra funcionários                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Owner pode cadastrar funcionários (role 'employee') escolhendo quais
-- módulos cada um pode acessar. Owner e manager (legado) continuam com
-- acesso total — não precisam registros nessa tabela.
--
-- Cada linha = (user_id × module_key) liberado. Ausência de linha = bloqueado.
--
-- Module keys canônicos (lista em src/lib/permissions.ts):
--   pos, estoque, financeiro, clientes, erp_clientes, analytics_canais,
--   relatorios, meta_ads, crm
--
-- /configuracoes (assinatura, equipe) é sempre owner-only — não passa por
-- esse sistema (gate por tenant_role no app_metadata).
--
-- O role 'employee' é o NOVO. Roles existentes:
--   owner    — acesso total, único que gerencia equipe + assinatura
--   manager  — acesso total (legado, mantém compatibilidade)
--   employee — acesso só aos módulos liberados nessa tabela

CREATE TABLE IF NOT EXISTS public.tenant_member_permissions (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  module_key  TEXT NOT NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_tenant_member_permissions_user
  ON public.tenant_member_permissions(user_id, tenant_id);

-- ── tenant_invites: armazena permissions pré-definidas pro convite ────────
-- Quando owner convida um employee, escolhe os módulos no momento.
-- Quando user aceita convite, copiamos pra tenant_member_permissions.

ALTER TABLE public.tenant_invites
  ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}';

-- ── RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_member_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_member_permissions: own select" ON public.tenant_member_permissions;
DROP POLICY IF EXISTS "tenant_member_permissions: owner manage" ON public.tenant_member_permissions;

-- User pode ler suas próprias permissions
CREATE POLICY "tenant_member_permissions: own select"
  ON public.tenant_member_permissions FOR SELECT
  USING (user_id = auth.uid());

-- INSERT/UPDATE/DELETE só via service_role (chamado por Server Actions
-- que verificam ownership). Sem policy = bloqueado pra usuários comuns.

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 029_admin_actions_log.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  029 — Audit log de ações administrativas                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Registra ações executadas no painel admin (/admin) — liberar plano manual,
-- estender trial, cancelar assinatura. Permite auditoria e rollback se algo
-- der errado.

CREATE TABLE IF NOT EXISTS public.admin_actions_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  tenant_id    UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_log_tenant
  ON public.admin_actions_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_actions_log_admin
  ON public.admin_actions_log (admin_email, created_at DESC);

-- RLS: ninguém vê via cliente normal — só service_role (admin client)
ALTER TABLE public.admin_actions_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 030_tenant_invites_employee_role.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  030 — tenant_invites aceita role='employee'                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- A migration 022 criou tenant_invites com CHECK (role IN ('manager')) — só
-- gerente. Migration 028 adicionou employee no app, mas esqueci de relaxar o
-- constraint, então o INSERT falhava com violation.

ALTER TABLE public.tenant_invites
  DROP CONSTRAINT IF EXISTS tenant_invites_role_check;

ALTER TABLE public.tenant_invites
  ADD CONSTRAINT tenant_invites_role_check
    CHECK (role IN ('manager', 'employee'));

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 031_cash_sessions.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  031 — Sessões de caixa (abrir / fechar / auto-fechar)                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cada vez que o operador abre o caixa, cria 1 row em cash_sessions com
-- valor inicial. Vendas feitas durante a sessão referenciam ela via
-- sales.cash_session_id. Ao fechar, o operador informa o valor contado em
-- dinheiro e o sistema calcula breakdown por forma de pagamento.
--
-- Status:
-- - 'open'        → caixa aberto, aceitando vendas
-- - 'closed'      → fechado manualmente pelo operador (com snapshot final)
-- - 'auto_closed' → fechado automático às 00:00 pelo cron (operador esqueceu)

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  opened_by_user_id        UUID NOT NULL REFERENCES auth.users(id),
  closed_by_user_id        UUID REFERENCES auth.users(id),
  opened_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at                TIMESTAMPTZ,
  opening_balance_cents    INTEGER NOT NULL DEFAULT 0,
  closing_counted_cents    INTEGER,                          -- valor contado fisicamente em dinheiro
  status                   TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'auto_closed')),
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1 sessão aberta por tenant por vez (UNIQUE parcial — só conta status='open')
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_sessions_one_open_per_tenant
  ON public.cash_sessions (tenant_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_opened
  ON public.cash_sessions (tenant_id, opened_at DESC);

-- Liga venda à sessão de caixa em que foi feita
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cash_session_id UUID REFERENCES public.cash_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_cash_session
  ON public.sales (cash_session_id)
  WHERE cash_session_id IS NOT NULL;

-- RLS — só vê sessões do próprio tenant
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cash_sessions: tenant select"
  ON public.cash_sessions FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "cash_sessions: tenant insert"
  ON public.cash_sessions FOR INSERT
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "cash_sessions: tenant update"
  ON public.cash_sessions FOR UPDATE
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 032_fiscal_module.sql
-- ════════════════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 033_comprovante_venda.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  033 — Comprovante de Venda + Termo de Garantia                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Adiciona:
-- 1. products.warranty_days (nullable) — sobrepõe o padrão do tenant
-- 2. tenants.logo_url — URL pública do logo (Supabase Storage)
-- 3. tenants.warranty_terms — texto customizável do termo de garantia
-- 4. sale_share_tokens — tokens públicos pra compartilhar PDF do comprovante
--    via WhatsApp (cliente abre sem login)
-- 5. Bucket Storage `tenant-logos` (público) pra logos das empresas

-- ── 1. products.warranty_days ──────────────────────────────────────────────
--
-- Quando preenchido, sobrepõe o tenants.warranty_days. Permite:
--   - Acessórios eletrônicos: deixar NULL (cai no padrão 90 do tenant)
--   - Celular novo lacrado: 365
--   - Seminovo: 90 (ou NULL — mesmo valor do default)
--   - Custom: qualquer inteiro
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS warranty_days INTEGER;

COMMENT ON COLUMN public.products.warranty_days IS
  'Garantia em dias específica do produto. NULL = usa tenants.warranty_days.';

-- ── 2. tenants.logo_url + warranty_terms ───────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS logo_url        TEXT,
  ADD COLUMN IF NOT EXISTS warranty_terms  TEXT;

COMMENT ON COLUMN public.tenants.logo_url IS
  'URL pública do logo da empresa (bucket tenant-logos).';
COMMENT ON COLUMN public.tenants.warranty_terms IS
  'Texto customizável do termo de garantia. Quando NULL, usa template padrão CDC.';

-- ── 3. Tabela sale_share_tokens ────────────────────────────────────────────
--
-- Token aleatório pra link público do comprovante (WhatsApp). Cliente abre
-- sem login. Expira em 30 dias.
CREATE TABLE IF NOT EXISTS public.sale_share_tokens (
  token        TEXT PRIMARY KEY,
  sale_id      UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_share_tokens_sale     ON public.sale_share_tokens(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_share_tokens_expires  ON public.sale_share_tokens(expires_at);

-- RLS: ninguém lê via cliente Supabase. Acesso só via admin client (route
-- handler valida o token antes de gerar PDF).
ALTER TABLE public.sale_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sale_share_tokens: deny all" ON public.sale_share_tokens;
CREATE POLICY "sale_share_tokens: deny all"
  ON public.sale_share_tokens FOR ALL
  USING (false);

-- ── 4. Bucket Storage tenant-logos (público) ───────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-logos',
  'tenant-logos',
  true,
  2097152,  -- 2MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: tenant pode upload no próprio prefixo {tenant_id}/...
DROP POLICY IF EXISTS "tenant-logos: tenant upload" ON storage.objects;
CREATE POLICY "tenant-logos: tenant upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

DROP POLICY IF EXISTS "tenant-logos: tenant update" ON storage.objects;
CREATE POLICY "tenant-logos: tenant update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

DROP POLICY IF EXISTS "tenant-logos: tenant delete" ON storage.objects;
CREATE POLICY "tenant-logos: tenant delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

-- Public read (bucket já é público mas mantém policy explícita)
DROP POLICY IF EXISTS "tenant-logos: public read" ON storage.objects;
CREATE POLICY "tenant-logos: public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'tenant-logos');

-- ── 5. Refresh schema cache ────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 034_tenant_contact.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  034 — Tenant: contato institucional pra cabeçalho de comprovantes       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Adiciona telefone, email e Instagram da empresa pra aparecer no PDF e
-- email do comprovante. Endereço/CNPJ/IE continuam vindo de tenants e
-- fiscal_configs.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_phone   TEXT,
  ADD COLUMN IF NOT EXISTS business_email   TEXT,
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT;

COMMENT ON COLUMN public.tenants.business_phone   IS 'Telefone/WhatsApp da empresa pro cabeçalho dos comprovantes.';
COMMENT ON COLUMN public.tenants.business_email   IS 'E-mail institucional pro cabeçalho dos comprovantes.';
COMMENT ON COLUMN public.tenants.instagram_handle IS 'Handle do Instagram (sem @) pra branding nos comprovantes.';

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 035_sale_customer_origin.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  035 — sales.customer_origin                                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cada venda guarda sua propria origem do cliente, separadamente do
-- customer.origin. Necessario porque vendas pra "Consumidor Final" (cliente
-- compartilhado fixo) nao podem editar customer.origin (afetaria todas as
-- vendas anteriores).
--
-- Uso: PDV pergunta "Onde te conheceu?" quando o cliente selecionado e
-- Consumidor Final. Relatorios de origem fazem COALESCE(sale.customer_origin,
-- customer.origin) — vendas anonimas agora contabilizam na origem real
-- (default: 'passou_na_porta') em vez de "Nao informado".

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_origin TEXT;

COMMENT ON COLUMN public.sales.customer_origin IS
  'Origem do cliente declarada NO MOMENTO da venda. Sobrepoe customer.origin no Top Clientes e relatorios — util pra Consumidor Final (cliente compartilhado fixo).';

-- Indice pra agregacoes rapidas por origem
CREATE INDEX IF NOT EXISTS idx_sales_customer_origin ON public.sales(tenant_id, customer_origin)
  WHERE customer_origin IS NOT NULL;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 036_variable_expenses.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  036 — Variable Expenses (gastos variaveis)                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Gastos variaveis pontuais (moto boy, produtos de limpeza, prejuizo, etc).
-- Diferente de recurring_expenses (custos fixos mensais).
--
-- Usado pra:
--   - Modulo /gastos: registrar despesas avulsas com data + categoria
--   - Calcular lucro liquido real (vendas - custo fixo - gastos variaveis)
--   - Relatorios por categoria, dia da semana, evolucao temporal
--   - Export CSV pra Google Sheets

CREATE TABLE IF NOT EXISTS public.variable_expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  occurred_at     DATE NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  category        TEXT NOT NULL,        -- chave do lib/variable-expense-categories.ts
  description     TEXT,                  -- "Entrega Marylia, bairro Atalaia"
  payment_method  TEXT,                  -- 'cash' | 'pix' | 'card' | null
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_variable_expenses_tenant_date
  ON public.variable_expenses(tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_variable_expenses_category
  ON public.variable_expenses(tenant_id, category, occurred_at DESC);

ALTER TABLE public.variable_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "variable_expenses: tenant isolation" ON public.variable_expenses;
CREATE POLICY "variable_expenses: tenant isolation"
  ON public.variable_expenses FOR ALL
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- SmartERP 037_birthdays.sql
-- ════════════════════════════════════════════════════════════════════════════
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  037 — Aniversariantes (modulo /aniversariantes)                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Adiciona controle de:
--   - customers.last_birthday_contact_year: ano em que o cliente foi
--     parabenizado (evita mandar 2x). Vendedor clica "Marcar contactado"
--     e atualiza pro ano corrente.
--   - customers.birth_discount_used_year: ano em que o cliente usou o cupom
--     de aniversario. Bloqueia uso duplicado no mesmo ano.
--   - tenants.birthday_message_template: template editavel da mensagem que
--     vai pro WhatsApp. Suporta variaveis {nome}, {hoje|em DD/MM}, {MES},
--     {DESCONTO}, {ANO}, {ULTIMO_DIA_DO_MES}.
--   - tenants.birthday_discount_percent: percentual padrao do desconto
--     (default 10%).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS last_birthday_contact_year INTEGER,
  ADD COLUMN IF NOT EXISTS birth_discount_used_year   INTEGER;

COMMENT ON COLUMN public.customers.last_birthday_contact_year IS
  'Ano em que o cliente foi parabenizado pela ultima vez. Evita reenvio no mesmo ano.';
COMMENT ON COLUMN public.customers.birth_discount_used_year IS
  'Ano em que o cliente resgatou o cupom de aniversario. NULL = nunca usou.';

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS birthday_message_template TEXT,
  ADD COLUMN IF NOT EXISTS birthday_discount_percent INTEGER DEFAULT 10
    CHECK (birthday_discount_percent IS NULL OR (birthday_discount_percent >= 0 AND birthday_discount_percent <= 100));

COMMENT ON COLUMN public.tenants.birthday_message_template IS
  'Template editavel da mensagem de aniversario. Suporta variaveis: {nome}, {DESCONTO}, {MES}, {ANO}, etc. NULL = usa template padrao.';
COMMENT ON COLUMN public.tenants.birthday_discount_percent IS
  'Percentual do desconto de aniversario (0-100). Default 10%.';

-- Indice pra busca rapida por mes/dia (extracao de birth_date)
-- Usado pela query de aniversariantes do dia/semana/mes
CREATE INDEX IF NOT EXISTS idx_customers_birth_month_day
  ON public.customers(tenant_id, EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date))
  WHERE birth_date IS NOT NULL;

NOTIFY pgrst, 'reload schema';

