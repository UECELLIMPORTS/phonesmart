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
