-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  038 — Product Serials (IMEI/Serial tracking pra lojas de celular)       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cada celular físico vira uma row em product_serials. Permite:
--   - Rastrear cada aparelho individualmente por IMEI/Serial
--   - Buscar por IMEI no PDV (escanear código de barras)
--   - Bloquear venda duplicada do mesmo IMEI
--   - Histórico: qual cliente comprou qual aparelho específico
--
-- Estrutura:
--   1 product (modelo) → N product_serials (unidades físicas com IMEI único)
--   1 sale_item → 1 product_serial (quando aplicável — celulares novos/seminovos)
--
-- Status:
--   'available' — em estoque, pode vender
--   'sold'      — vendido (sale_item_id preenchido)
--   'returned'  — devolvido pelo cliente, voltou pro estoque
--   'defective' — com defeito, não pode vender (mas mantém histórico)
--
-- product_serials NÃO substitui o stock_qty do products — o sistema continua
-- usando stock_qty pra controle simples (acessórios, peças, etc). Pra produtos
-- com IMEI tracking (celulares), stock_qty deveria ser igual ao count de
-- serials com status='available' — mantemos coerente via app, não trigger SQL.

CREATE TABLE IF NOT EXISTS public.product_serials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,

  -- IMEI principal (15 dígitos pra celulares, alfanumérico em geral pra serial)
  serial        TEXT NOT NULL,
  -- IMEI secundário (dual-SIM tem 2 IMEIs)
  serial_2      TEXT,
  -- Número de série do fabricante (alguns celulares têm IMEI + SN diferentes)
  manufacturer_sn TEXT,

  status        TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'sold', 'returned', 'defective')),

  -- Vínculo com a venda quando vendido (NULL se ainda em estoque)
  sale_item_id  UUID REFERENCES public.sale_items(id) ON DELETE SET NULL,
  sold_at       TIMESTAMPTZ,

  -- Custo de aquisição desta unidade (cada IMEI pode ter custo diferente,
  -- importante pra celulares novos vs semi-novos do mesmo modelo)
  cost_cents    INTEGER,

  -- Notas internas (cor, condição, observação)
  notes         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IMEI único por tenant (impede cadastrar 2x o mesmo aparelho)
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_serials_tenant_serial_unique
  ON public.product_serials(tenant_id, serial);

-- Busca rápida por produto + status (listar IMEIs disponíveis de um modelo)
CREATE INDEX IF NOT EXISTS idx_product_serials_product_status
  ON public.product_serials(product_id, status);

-- Busca rápida por serial (PDV escaneando código de barras)
CREATE INDEX IF NOT EXISTS idx_product_serials_tenant_serial_lookup
  ON public.product_serials(tenant_id, serial);

-- Busca por sale_item (ver qual aparelho foi vendido em qual venda)
CREATE INDEX IF NOT EXISTS idx_product_serials_sale_item
  ON public.product_serials(sale_item_id) WHERE sale_item_id IS NOT NULL;

-- Touch updated_at trigger
DROP TRIGGER IF EXISTS trg_touch_product_serials ON public.product_serials;
CREATE TRIGGER trg_touch_product_serials
  BEFORE UPDATE ON public.product_serials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.product_serials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_serials: tenant isolation" ON public.product_serials;
CREATE POLICY "product_serials: tenant isolation"
  ON public.product_serials FOR ALL
  USING (tenant_id = public.tenant_id())
  WITH CHECK (tenant_id = public.tenant_id());

-- ── Adiciona flag em products pra marcar quais usam IMEI tracking ────────
-- Quando track_serials=true, o PDV exige selecionar um IMEI específico ao
-- vender, e o estoque é calculado pelo count de serials available (não stock_qty).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS track_serials BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.track_serials IS
  'Quando true, este produto usa IMEI/Serial tracking — venda exige selecionar unidade específica via product_serials.';

-- ── Adiciona FK em sale_items pra apontar pro serial vendido ─────────────
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS product_serial_id UUID REFERENCES public.product_serials(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.sale_items.product_serial_id IS
  'Vínculo com o IMEI específico vendido (quando produto tem track_serials=true).';

NOTIFY pgrst, 'reload schema';
