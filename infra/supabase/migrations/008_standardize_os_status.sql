-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 008 — padronizar status de service_orders em inglês
--
-- Contexto: ao longo do desenvolvimento alguns registros foram criados com
-- status em português ('Cancelado', 'Entregue') e outros em inglês
-- ('cancelled', 'delivered'). O código precisa usar `.in('status', [...])`
-- com os dois casos pra funcionar. Essa migração normaliza tudo em inglês.
--
-- Status válidos (alinhados com o enum do CheckSmart):
--   received · diagnosing · waiting_parts · in_repair · ready · delivered · cancelled
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. DIAGNÓSTICO (opcional) — rode primeiro pra ver o que vai mudar
--    Copie e cole separadamente se quiser só olhar antes de aplicar:
--
-- SELECT status, COUNT(*) as total
--   FROM service_orders
--  GROUP BY status
--  ORDER BY total DESC;

-- 2. APLICAR — atualiza os registros em português para inglês
UPDATE service_orders SET status = 'received'      WHERE status IN ('Recebido',         'Recebida');
UPDATE service_orders SET status = 'diagnosing'    WHERE status IN ('Em diagnóstico',   'Em diagnostico', 'Diagnosticando');
UPDATE service_orders SET status = 'waiting_parts' WHERE status IN ('Aguardando peças', 'Aguardando pecas');
UPDATE service_orders SET status = 'in_repair'     WHERE status IN ('Em reparo',        'Em conserto');
UPDATE service_orders SET status = 'ready'         WHERE status IN ('Pronto',           'Pronta');
UPDATE service_orders SET status = 'delivered'     WHERE status IN ('Entregue',         'Entregado');
UPDATE service_orders SET status = 'cancelled'     WHERE status IN ('Cancelado',        'Cancelada');

-- 3. VERIFICAR resultado — deve listar apenas os 7 status válidos em inglês
SELECT status, COUNT(*) as total
  FROM service_orders
 GROUP BY status
 ORDER BY total DESC;

-- Nota: depois disso, os filtros `.in('status', ['delivered', 'Entregue'])` no
-- código podem ser simplificados para `.eq('status', 'delivered')` — mas isso
-- não é obrigatório, o `.in()` continua funcionando.
