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
