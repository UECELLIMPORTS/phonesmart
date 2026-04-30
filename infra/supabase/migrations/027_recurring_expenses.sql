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
