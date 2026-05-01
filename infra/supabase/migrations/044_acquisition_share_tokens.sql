-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  044 — Acquisition Share Tokens (link público pro recibo de compra usado)║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Espelha sale_share_tokens (033). Token aleatório pra link público do recibo
-- de compra de aparelho usado, compartilhável via WhatsApp. Cliente vendedor
-- recebe link sem login. Expira em 30 dias.

CREATE TABLE IF NOT EXISTS public.acquisition_share_tokens (
  token        TEXT PRIMARY KEY,
  serial_id    UUID NOT NULL REFERENCES public.product_serials(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acq_share_tokens_serial   ON public.acquisition_share_tokens(serial_id);
CREATE INDEX IF NOT EXISTS idx_acq_share_tokens_expires  ON public.acquisition_share_tokens(expires_at);

-- RLS deny-all: só admin client (que ignora RLS) acessa via route handler.
ALTER TABLE public.acquisition_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acquisition_share_tokens: deny all" ON public.acquisition_share_tokens;
CREATE POLICY "acquisition_share_tokens: deny all"
  ON public.acquisition_share_tokens FOR ALL
  USING (false);

NOTIFY pgrst, 'reload schema';
