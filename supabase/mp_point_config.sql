-- ============================================
-- Dietética Vishal - Mercado Pago POINT (terminal)
--
-- Ejecutar en Supabase SQL Editor.
-- Es idempotente: se puede volver a ejecutar.
--
-- Qué crea:
--   1. sales.mp_order_id: id de la "order" de MP Point (distinto del
--      payment_id de Checkout Pro).
--   2. mp_point_config: terminal configurada (una fila activa).
--   3. RLS de la tabla de configuración (escritura solo admin).
-- ============================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Columna para la order de Point
-- ------------------------------------------------------------
ALTER TABLE sales ADD COLUMN IF NOT EXISTS mp_order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_mp_order_id
  ON sales(mp_order_id) WHERE mp_order_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2) Configuracion de la terminal Point
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mp_point_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id TEXT NOT NULL,
  label TEXT,
  -- seller_ticket: la terminal imprime el ticket | no_ticket: no imprime
  print_on_terminal TEXT NOT NULL DEFAULT 'seller_ticket',
  -- credit_card | debit_card | qr | NULL = el cliente elige en la terminal
  default_payment_method TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE mp_point_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mp_point_select" ON mp_point_config;
CREATE POLICY "mp_point_select" ON mp_point_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "mp_point_insert" ON mp_point_config;
CREATE POLICY "mp_point_insert" ON mp_point_config
  FOR INSERT WITH CHECK (user_role() = 'admin');

DROP POLICY IF EXISTS "mp_point_update" ON mp_point_config;
CREATE POLICY "mp_point_update" ON mp_point_config
  FOR UPDATE USING (user_role() = 'admin') WITH CHECK (user_role() = 'admin');

DROP POLICY IF EXISTS "mp_point_delete" ON mp_point_config;
CREATE POLICY "mp_point_delete" ON mp_point_config
  FOR DELETE USING (user_role() = 'admin');

-- ------------------------------------------------------------
-- 3) Solo una terminal activa
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mp_point_single_active() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active THEN
    UPDATE mp_point_config SET active = false, updated_at = now()
     WHERE id <> NEW.id AND active = true;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mp_point_single_active ON mp_point_config;
CREATE TRIGGER trg_mp_point_single_active
  BEFORE INSERT OR UPDATE ON mp_point_config
  FOR EACH ROW EXECUTE FUNCTION mp_point_single_active();

COMMIT;

-- ---------- Configurar la terminal ----------
-- Reemplazar <TERMINAL_ID> por el id que devuelve:
--   GET https://api.mercadopago.com/terminals/v1/list
-- (el id tiene el formato TIPO__NUMERO_DE_SERIE, ej: NEWLAND_N950__N950NCB801293324)
--
-- INSERT INTO mp_point_config (terminal_id, label, print_on_terminal, default_payment_method)
-- VALUES ('<TERMINAL_ID>', 'Point Smart mostrador', 'seller_ticket', NULL)
-- ON CONFLICT DO NOTHING;
--
-- ---------- Verificacion ----------
-- SELECT terminal_id, label, print_on_terminal, default_payment_method, active
--   FROM mp_point_config;
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='sales' AND column_name='mp_order_id';
