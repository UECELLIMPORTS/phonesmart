-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  041 — Crediário interno (vendas parceladas com a loja)                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Quando cliente compra parcelado direto com a loja (não cartão), cria 1 plan
-- com N installments mensais. Cada parcela tem due_date e status pending/paid/late.
-- Cobrança via WhatsApp manual (botão na UI gera link wa.me).

CREATE TABLE IF NOT EXISTS public.installment_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sale_id             UUID NOT NULL REFERENCES public.sales(id)   ON DELETE CASCADE,
  customer_id         UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,

  total_cents         INTEGER NOT NULL,         -- valor total da venda parcelada
  down_payment_cents  INTEGER NOT NULL DEFAULT 0, -- entrada
  installments_count  INTEGER NOT NULL,         -- N parcelas
  installment_value_cents INTEGER NOT NULL,     -- valor unitário (rateado, ajuste de centavos na 1ª)

  first_due_date      DATE NOT NULL,
  frequency           TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'biweekly', 'weekly')),

  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installment_plans_tenant_status
  ON public.installment_plans(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_installment_plans_customer
  ON public.installment_plans(customer_id);
CREATE INDEX IF NOT EXISTS idx_installment_plans_sale
  ON public.installment_plans(sale_id);

DROP TRIGGER IF EXISTS trg_touch_installment_plans ON public.installment_plans;
CREATE TRIGGER trg_touch_installment_plans
  BEFORE UPDATE ON public.installment_plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "installment_plans: tenant isolation" ON public.installment_plans;
CREATE POLICY "installment_plans: tenant isolation"
  ON public.installment_plans FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- ── Parcelas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.installments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_id             UUID NOT NULL REFERENCES public.installment_plans(id) ON DELETE CASCADE,

  installment_number  INTEGER NOT NULL,         -- 1, 2, 3...
  amount_cents        INTEGER NOT NULL,
  due_date            DATE NOT NULL,

  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'late', 'cancelled')),

  paid_at             TIMESTAMPTZ,
  paid_amount_cents   INTEGER,
  payment_method      TEXT CHECK (payment_method IN ('cash', 'pix', 'card', 'transfer', 'mixed')),
  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installments_tenant_status_due
  ON public.installments(tenant_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_installments_plan
  ON public.installments(plan_id, installment_number);

DROP TRIGGER IF EXISTS trg_touch_installments ON public.installments;
CREATE TRIGGER trg_touch_installments
  BEFORE UPDATE ON public.installments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "installments: tenant isolation" ON public.installments;
CREATE POLICY "installments: tenant isolation"
  ON public.installments FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- Adiciona 'crediario' como payment_method válido em sales (extensão do enum existente)
-- Em vez de ALTER TYPE (caro), uso check constraint via TEXT — sales.payment_method já é TEXT.
-- O front passa 'crediario' como valor literal e UI trata.

NOTIFY pgrst, 'reload schema';
