-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  040 — Service Orders (OS / Assistência técnica por IMEI)                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cliente chega com defeito → busca venda pelo IMEI → abre OS.
-- Status: open → in_progress → ready → delivered (ou rejected se desistir).
-- warranty_used flag indica se foi consertado em garantia (sem cobrança).

CREATE TABLE IF NOT EXISTS public.service_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Vínculos opcionais (OS pode ser de aparelho não vendido pela loja, ex: cliente trouxe pra conserto)
  product_serial_id  UUID REFERENCES public.product_serials(id) ON DELETE SET NULL,
  sale_item_id       UUID REFERENCES public.sale_items(id)      ON DELETE SET NULL,
  customer_id        UUID REFERENCES public.customers(id)       ON DELETE SET NULL,

  -- Numero amigável (preenchido por trigger): OS-YYMMDD-NNNN
  os_number          TEXT NOT NULL,

  opened_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'ready', 'delivered', 'rejected')),

  -- Dados da OS
  device_description TEXT,                -- "iPhone 12 64GB Branco" (livre, caso não tenha serial)
  serial_text        TEXT,                -- IMEI/Serial em texto livre quando não há FK
  defect_description TEXT NOT NULL,       -- queixa do cliente
  diagnosis          TEXT,                -- diagnóstico do técnico
  parts_used         JSONB,               -- [{name, qty, cost}, ...]

  warranty_used      BOOLEAN NOT NULL DEFAULT FALSE,
  cost_cents         INTEGER NOT NULL DEFAULT 0,  -- valor cobrado do cliente
  service_cost_cents INTEGER NOT NULL DEFAULT 0,  -- custo interno (peças + serviço)

  technician_name    TEXT,
  estimated_ready_at TIMESTAMPTZ,
  closed_at          TIMESTAMPTZ,

  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_orders_tenant_status
  ON public.service_orders(tenant_id, status, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_orders_serial
  ON public.service_orders(product_serial_id) WHERE product_serial_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_orders_customer
  ON public.service_orders(customer_id) WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_tenant_number
  ON public.service_orders(tenant_id, os_number);

-- Touch updated_at
DROP TRIGGER IF EXISTS trg_touch_service_orders ON public.service_orders;
CREATE TRIGGER trg_touch_service_orders
  BEFORE UPDATE ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trigger pra gerar os_number automaticamente: OS-YYMMDD-NNNN onde N é sequencial do dia
CREATE OR REPLACE FUNCTION public.generate_os_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  prefix TEXT;
  seq    INTEGER;
BEGIN
  IF NEW.os_number IS NOT NULL AND NEW.os_number <> '' THEN
    RETURN NEW;
  END IF;

  prefix := 'OS-' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYMMDD') || '-';

  SELECT COALESCE(MAX(CAST(SPLIT_PART(os_number, '-', 3) AS INTEGER)), 0) + 1
  INTO   seq
  FROM   public.service_orders
  WHERE  tenant_id = NEW.tenant_id
    AND  os_number LIKE prefix || '%';

  NEW.os_number := prefix || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gen_os_number ON public.service_orders;
CREATE TRIGGER trg_gen_os_number
  BEFORE INSERT ON public.service_orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_os_number();

-- RLS
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_orders: tenant isolation" ON public.service_orders;
CREATE POLICY "service_orders: tenant isolation"
  ON public.service_orders FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

NOTIFY pgrst, 'reload schema';
