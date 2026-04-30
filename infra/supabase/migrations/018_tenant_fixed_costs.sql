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
