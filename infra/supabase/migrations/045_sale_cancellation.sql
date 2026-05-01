-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  045 — Sale cancellation/return (timestamp + motivo + processamento)     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Estende sales com dados de devolução. Sales.status já aceita 'cancelled'.
-- Aqui só guardamos QUANDO e POR QUE foi cancelada, e que ação foi tomada
-- com os IMEIs (devolvidos ao estoque ou marcados como returned).

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS cancelled_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason  TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Como os IMEIs foram tratados na devolução: 'available' (volta pro estoque)
  -- | 'returned' (mantém status retornado, não vende de novo) | null (sem IMEIs)
  ADD COLUMN IF NOT EXISTS return_serial_action TEXT
    CHECK (return_serial_action IN ('available', 'returned'));

COMMENT ON COLUMN public.sales.cancelled_at IS
  'Quando a venda foi cancelada/devolvida. NULL se não foi.';
COMMENT ON COLUMN public.sales.return_serial_action IS
  'Ação aplicada aos IMEIs no momento da devolução: available (revende) ou returned (não vende).';

CREATE INDEX IF NOT EXISTS idx_sales_cancelled_at
  ON public.sales(tenant_id, cancelled_at DESC) WHERE cancelled_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
