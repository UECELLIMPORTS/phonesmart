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
-- parts_catalog (peças de OS — diferente de products)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.parts_catalog (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sku         TEXT,
  name        TEXT NOT NULL,
  cost_cents  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parts_catalog_tenant      ON public.parts_catalog(tenant_id);
CREATE INDEX IF NOT EXISTS idx_parts_catalog_tenant_name ON public.parts_catalog(tenant_id, name);

ALTER TABLE public.parts_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parts_catalog: tenant isolation" ON public.parts_catalog;
CREATE POLICY "parts_catalog: tenant isolation"
  ON public.parts_catalog FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

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
