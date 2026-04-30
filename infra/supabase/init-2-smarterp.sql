-- Parte 2: SmartERP tables + features
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

-- 002_stock_movements.sql
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

-- 003_add_category_to_products.sql
-- Migration 003 — adiciona coluna category à tabela products

ALTER TABLE products ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);

-- 004_product_extra_fields.sql
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

-- 005_product_gross_weight.sql
-- Migration 005 — peso bruto separado do peso líquido

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS gross_weight_g numeric(10,3);

-- 006_stock_movements_moved_at.sql
-- Migration 006 — data de negócio e depósito nos lançamentos de estoque

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS moved_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS depot    text;

-- Índice para ordenação eficiente por data de negócio
CREATE INDEX IF NOT EXISTS idx_stock_movements_moved_at
  ON stock_movements (product_id, tenant_id, moved_at DESC);

-- 007_customer_origin.sql
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

-- 008_standardize_os_status.sql
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

-- 009_merge_consumidor_final.sql
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

-- 010_diagnostico_duplicados.sql
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

-- 011_recreate_whatsapp_unique_index.sql
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

-- 012_sale_items_cost_snapshot.sql
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

-- 013_fix_516_clientes_sem_data.sql
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

-- 014_meta_ads_credentials.sql
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

-- 015_meta_ads_multi_account.sql
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

-- 016_meta_ads_alerts.sql
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

-- 017_sales_channels.sql
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

-- 018_tenant_fixed_costs.sql
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

-- 019_tenants_signup.sql
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

-- 020_subscriptions_per_product.sql
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

-- 021_subscriptions_status_compat.sql
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

-- 022_tenant_invites.sql
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

-- 023_notifications.sql
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

-- 024_asaas_integration.sql
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

-- 025_drop_old_tenant_unique.sql
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

-- 026_pending_plan.sql
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

-- 027_recurring_expenses.sql
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

-- 028_tenant_member_permissions.sql
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

-- 029_admin_actions_log.sql
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

-- 030_tenant_invites_employee_role.sql
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

-- 031_cash_sessions.sql
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

-- 032_fiscal_module.sql
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

-- 033_comprovante_venda.sql
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

-- 034_tenant_contact.sql
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

-- 035_sale_customer_origin.sql
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

-- 036_variable_expenses.sql
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

-- 037_birthdays.sql
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
