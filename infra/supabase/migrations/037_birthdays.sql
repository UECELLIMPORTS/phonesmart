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
