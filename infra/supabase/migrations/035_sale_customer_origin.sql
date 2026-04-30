-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  035 — sales.customer_origin                                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Cada venda guarda sua propria origem do cliente, separadamente do
-- customer.origin. Necessario porque vendas pra "Consumidor Final" (cliente
-- compartilhado fixo) nao podem editar customer.origin (afetaria todas as
-- vendas anteriores).
--
-- Uso: PDV pergunta "Onde te conheceu?" quando o cliente selecionado e
-- Consumidor Final. Relatorios de origem fazem COALESCE(sale.customer_origin,
-- customer.origin) — vendas anonimas agora contabilizam na origem real
-- (default: 'passou_na_porta') em vez de "Nao informado".

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS customer_origin TEXT;

COMMENT ON COLUMN public.sales.customer_origin IS
  'Origem do cliente declarada NO MOMENTO da venda. Sobrepoe customer.origin no Top Clientes e relatorios — util pra Consumidor Final (cliente compartilhado fixo).';

-- Indice pra agregacoes rapidas por origem
CREATE INDEX IF NOT EXISTS idx_sales_customer_origin ON public.sales(tenant_id, customer_origin)
  WHERE customer_origin IS NOT NULL;

NOTIFY pgrst, 'reload schema';
