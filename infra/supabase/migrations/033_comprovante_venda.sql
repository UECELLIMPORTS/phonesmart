-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  033 — Comprovante de Venda + Termo de Garantia                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Adiciona:
-- 1. products.warranty_days (nullable) — sobrepõe o padrão do tenant
-- 2. tenants.logo_url — URL pública do logo (Supabase Storage)
-- 3. tenants.warranty_terms — texto customizável do termo de garantia
-- 4. sale_share_tokens — tokens públicos pra compartilhar PDF do comprovante
--    via WhatsApp (cliente abre sem login)
-- 5. Bucket Storage `tenant-logos` (público) pra logos das empresas

-- ── 1. products.warranty_days ──────────────────────────────────────────────
--
-- Quando preenchido, sobrepõe o tenants.warranty_days. Permite:
--   - Acessórios eletrônicos: deixar NULL (cai no padrão 90 do tenant)
--   - Celular novo lacrado: 365
--   - Seminovo: 90 (ou NULL — mesmo valor do default)
--   - Custom: qualquer inteiro
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS warranty_days INTEGER;

COMMENT ON COLUMN public.products.warranty_days IS
  'Garantia em dias específica do produto. NULL = usa tenants.warranty_days.';

-- ── 2. tenants.logo_url + warranty_terms ───────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS logo_url        TEXT,
  ADD COLUMN IF NOT EXISTS warranty_terms  TEXT;

COMMENT ON COLUMN public.tenants.logo_url IS
  'URL pública do logo da empresa (bucket tenant-logos).';
COMMENT ON COLUMN public.tenants.warranty_terms IS
  'Texto customizável do termo de garantia. Quando NULL, usa template padrão CDC.';

-- ── 3. Tabela sale_share_tokens ────────────────────────────────────────────
--
-- Token aleatório pra link público do comprovante (WhatsApp). Cliente abre
-- sem login. Expira em 30 dias.
CREATE TABLE IF NOT EXISTS public.sale_share_tokens (
  token        TEXT PRIMARY KEY,
  sale_id      UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_share_tokens_sale     ON public.sale_share_tokens(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_share_tokens_expires  ON public.sale_share_tokens(expires_at);

-- RLS: ninguém lê via cliente Supabase. Acesso só via admin client (route
-- handler valida o token antes de gerar PDF).
ALTER TABLE public.sale_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sale_share_tokens: deny all" ON public.sale_share_tokens;
CREATE POLICY "sale_share_tokens: deny all"
  ON public.sale_share_tokens FOR ALL
  USING (false);

-- ── 4. Bucket Storage tenant-logos (público) ───────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-logos',
  'tenant-logos',
  true,
  2097152,  -- 2MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: tenant pode upload no próprio prefixo {tenant_id}/...
DROP POLICY IF EXISTS "tenant-logos: tenant upload" ON storage.objects;
CREATE POLICY "tenant-logos: tenant upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

DROP POLICY IF EXISTS "tenant-logos: tenant update" ON storage.objects;
CREATE POLICY "tenant-logos: tenant update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

DROP POLICY IF EXISTS "tenant-logos: tenant delete" ON storage.objects;
CREATE POLICY "tenant-logos: tenant delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'tenant-logos'
    AND (storage.foldername(name))[1] = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

-- Public read (bucket já é público mas mantém policy explícita)
DROP POLICY IF EXISTS "tenant-logos: public read" ON storage.objects;
CREATE POLICY "tenant-logos: public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'tenant-logos');

-- ── 5. Refresh schema cache ────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
