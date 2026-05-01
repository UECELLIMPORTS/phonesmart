-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  042 — Suppliers (cadastro de fornecedores recorrente)                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Substitui o campo livre `supplier_name` em product_serials por FK pra um
-- registro persistente. supplier_name continua existindo pra manter compat
-- com aquisições antigas; novas compras devem usar supplier_id.

CREATE TABLE IF NOT EXISTS public.suppliers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  name          TEXT NOT NULL,                  -- razão social ou nome
  trade_name    TEXT,                           -- fantasia
  cpf_cnpj      TEXT,
  state_reg     TEXT,                           -- inscrição estadual

  whatsapp      TEXT,
  phone         TEXT,
  email         TEXT,
  contact_name  TEXT,                           -- nome da pessoa de contato

  -- Endereço
  address_zip       TEXT,
  address_street    TEXT,
  address_number    TEXT,
  address_complement TEXT,
  address_district  TEXT,
  address_city      TEXT,
  address_state     TEXT,

  category      TEXT,                           -- 'distribuidor', 'pessoa_fisica', 'lote', 'leilao', 'outro'
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_active
  ON public.suppliers(tenant_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_cpf_cnpj
  ON public.suppliers(tenant_id, cpf_cnpj) WHERE cpf_cnpj IS NOT NULL;

DROP TRIGGER IF EXISTS trg_touch_suppliers ON public.suppliers;
CREATE TRIGGER trg_touch_suppliers
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suppliers: tenant isolation" ON public.suppliers;
CREATE POLICY "suppliers: tenant isolation"
  ON public.suppliers FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- Adiciona FK em product_serials (sem remover supplier_name pra preservar histórico)
ALTER TABLE public.product_serials
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_serials_supplier
  ON public.product_serials(supplier_id) WHERE supplier_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
