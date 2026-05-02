-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  041 — Customer Coupons (cupons rastreáveis por cliente)                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Sprint 16: cupons gerados por campanhas (reativação, futuras) que precisam
-- funcionar no PDV de verdade (aplicar % de desconto).
--
-- Modelo: cupom genérico (mesmo `code` pra muitos clientes) MAS rastreável —
-- 1 row por (tenant, customer, code). Cliente X só usa o seu cupom 1 vez.
-- Cliente Y pode ter o mesmo `code` em outro row.

CREATE TABLE IF NOT EXISTS public.customer_coupons (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,

  code            TEXT NOT NULL,              -- ex: VOLTA15, ANIV2026
  type            TEXT NOT NULL,              -- 'reactivation' | 'birthday' | 'manual'
  discount_pct    INTEGER NOT NULL CHECK (discount_pct >= 0 AND discount_pct <= 100),

  valid_until     DATE NOT NULL,
  used_at         TIMESTAMPTZ,
  used_in_sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,

  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada cliente só pode ter 1 cupom ativo do mesmo código (não-usado)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_coupons_unique_active
  ON public.customer_coupons(tenant_id, customer_id, code)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_coupons_lookup
  ON public.customer_coupons(tenant_id, customer_id, code, valid_until DESC);

CREATE INDEX IF NOT EXISTS idx_customer_coupons_type_recent
  ON public.customer_coupons(tenant_id, type, created_at DESC);

DROP TRIGGER IF EXISTS trg_touch_customer_coupons ON public.customer_coupons;
CREATE TRIGGER trg_touch_customer_coupons
  BEFORE UPDATE ON public.customer_coupons
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.customer_coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_coupons: tenant isolation" ON public.customer_coupons;
CREATE POLICY "customer_coupons: tenant isolation"
  ON public.customer_coupons FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- ── Campos extras no whatsapp_templates pra config do template inactive_customer ──
ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS inactivity_days     INTEGER,
  ADD COLUMN IF NOT EXISTS coupon_code         TEXT,
  ADD COLUMN IF NOT EXISTS coupon_discount_pct INTEGER CHECK (coupon_discount_pct IS NULL OR (coupon_discount_pct >= 0 AND coupon_discount_pct <= 100)),
  ADD COLUMN IF NOT EXISTS coupon_valid_days   INTEGER;

NOTIFY pgrst, 'reload schema';
