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
