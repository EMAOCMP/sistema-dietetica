-- ============================================================
-- MERCADO / COMPRAS — Órdenes de Compra por Proveedor + Demanda
-- Ejecutar en: SQL Editor de Supabase (una sola vez).
-- Idempotente: puede re-ejecutarse sin romper datos existentes.
-- ============================================================

-- ============================================
-- 0. lead_time_days en suppliers (tiempo de entrega)
-- ============================================
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INT DEFAULT 7;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;

-- ============================================
-- 1. Completar purchase_orders / purchase_order_items
--    (el esqueleto ya existía en schema_improvements.sql)
-- ============================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','received','cancelled')),
  expected_date DATE,
  notes TEXT,
  total_cost NUMERIC(12,2) DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  receipt_id UUID REFERENCES stock_receipts(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  qty_replenish NUMERIC(12,3) DEFAULT 0,
  qty_suggested NUMERIC(12,3) DEFAULT 0,
  unit_cost NUMERIC(12,2),
  received_quantity NUMERIC(12,3) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Renombrar columnas del esqueleto viejo (si existían)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_order_items' AND column_name='quantity_ordered') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN quantity_ordered TO quantity;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='purchase_order_items' AND column_name='quantity_received') THEN
    ALTER TABLE purchase_order_items RENAME COLUMN quantity_received TO received_quantity;
  END IF;
END $$;

-- Asegurar columna quantity (por si la tabla se creó sin ella)
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS quantity NUMERIC(12,3);
UPDATE purchase_order_items SET quantity = 1 WHERE quantity IS NULL;
ALTER TABLE purchase_order_items ALTER COLUMN quantity SET NOT NULL;

-- Columnas nuevas si la tabla ya existía con el esqueleto viejo
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS order_number TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES stock_receipts(id) ON DELETE SET NULL;

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS qty_replenish NUMERIC(12,3) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS qty_suggested NUMERIC(12,3) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_quantity NUMERIC(12,3) DEFAULT 0;

-- Numeración
CREATE SEQUENCE IF NOT EXISTS purchase_order_seq START 1;
-- order_number único (permitir NULL para filas viejas)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_order_number_key'
  ) THEN
    ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_order_number_key UNIQUE (order_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_items_order ON purchase_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product ON purchase_order_items(product_id);

-- ============================================
-- 2. RLS
-- ============================================
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_select" ON purchase_orders;
CREATE POLICY "po_select" ON purchase_orders FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "po_insert" ON purchase_orders;
CREATE POLICY "po_insert" ON purchase_orders FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND user_role() IN ('admin','supervisor'));

DROP POLICY IF EXISTS "po_update" ON purchase_orders;
CREATE POLICY "po_update" ON purchase_orders FOR UPDATE
  USING (auth.uid() IS NOT NULL AND user_role() IN ('admin','supervisor'))
  WITH CHECK (auth.uid() IS NOT NULL AND user_role() IN ('admin','supervisor'));

DROP POLICY IF EXISTS "po_delete" ON purchase_orders;
CREATE POLICY "po_delete" ON purchase_orders FOR DELETE
  USING (user_role() = 'admin');

DROP POLICY IF EXISTS "poi_select" ON purchase_order_items;
CREATE POLICY "poi_select" ON purchase_order_items FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "poi_insert" ON purchase_order_items;
CREATE POLICY "poi_insert" ON purchase_order_items FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND user_role() IN ('admin','supervisor'));

DROP POLICY IF EXISTS "poi_update" ON purchase_order_items;
CREATE POLICY "poi_update" ON purchase_order_items FOR UPDATE
  USING (auth.uid() IS NOT NULL AND user_role() IN ('admin','supervisor'))
  WITH CHECK (auth.uid() IS NOT NULL AND user_role() IN ('admin','supervisor'));

DROP POLICY IF EXISTS "poi_delete" ON purchase_order_items;
CREATE POLICY "poi_delete" ON purchase_order_items FOR DELETE
  USING (user_role() = 'admin');

-- ============================================
-- 3. Función de demanda (ROP + order-up-to)
--    Ventana por defecto 30 días, revisión 30 días, z=1.65 (95%).
-- ============================================
CREATE OR REPLACE FUNCTION compute_replenishment(
  p_window_days INT DEFAULT 30,
  p_review_period INT DEFAULT 30,
  p_service_z NUMERIC DEFAULT 1.65
)
RETURNS TABLE (
  product_id UUID,
  product_name TEXT,
  supplier_id UUID,
  stock NUMERIC,
  min_stock NUMERIC,
  avg_daily NUMERIC,
  sigma_daily NUMERIC,
  lead_time_days INT,
  safety_stock NUMERIC,
  rop NUMERIC,
  order_up_to NUMERIC,
  suggested NUMERIC,
  replenish NUMERIC,
  has_history BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;

  RETURN QUERY
  WITH window_days AS (
    SELECT g::date AS d
    FROM generate_series(CURRENT_DATE - (p_window_days - 1), CURRENT_DATE, interval '1 day') AS g
  ),
  daily AS (
    SELECT p.id AS pid, wd.d,
           COALESCE((
             SELECT SUM(si.quantity)
             FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
             WHERE si.product_id = p.id
               AND s.created_at::date = wd.d
               AND s.status = 'completed'
           ), 0)::numeric AS qty
    FROM products p
    CROSS JOIN window_days wd
    WHERE COALESCE(p.is_active, true) = true
  ),
  agg AS (
    SELECT d.pid AS pid,
           AVG(d.qty)::numeric AS avg_d,
           COALESCE(stddev_samp(d.qty), 0)::numeric AS sigma_d,
           SUM(d.qty)::numeric AS total_q
    FROM daily d
    GROUP BY d.pid
  ),
  base AS (
    SELECT p.id AS pid,
           p.name AS pname,
           p.supplier_id AS psup,
           COALESCE(p.stock_quantity, 0)::numeric AS stock_n,
           COALESCE(p.min_stock, 5)::numeric AS min_n,
           COALESCE(a.avg_d, 0)::numeric AS avg_n,
           COALESCE(a.sigma_d, 0)::numeric AS sigma_n,
           COALESCE(a.total_q, 0)::numeric AS total_n,
           COALESCE(s.lead_time_days, 7)::int AS lt_n
    FROM products p
    LEFT JOIN agg a ON a.pid = p.id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE COALESCE(p.is_active, true) = true
  ),
  calc AS (
    SELECT b.*,
           (p_service_z::numeric * b.sigma_n * sqrt(GREATEST(b.lt_n, 1)::numeric))::numeric AS ss_n
    FROM base b
  ),
  calc2 AS (
    SELECT c.*,
           (c.avg_n * c.lt_n::numeric + c.ss_n)::numeric AS rop_n
    FROM calc c
  )
  SELECT c.pid,
         c.pname,
         c.psup,
         c.stock_n,
         c.min_n,
         ROUND(c.avg_n, 4),
         ROUND(c.sigma_n, 4),
         c.lt_n,
         ROUND(c.ss_n, 2),
         ROUND(c.rop_n, 2),
         ROUND(c.rop_n + c.avg_n * p_review_period::numeric, 2),
         GREATEST(ROUND(c.rop_n + c.avg_n * p_review_period::numeric - c.stock_n, 2), 0::numeric),
         GREATEST(ROUND(c.min_n - c.stock_n, 2), 0::numeric),
         (c.total_n > 0)
  FROM calc2 c
  ORDER BY c.pname;
END;
$$;

-- 4. RPC: crear orden de compra (draft)
--    p_items: [{ product_id, quantity, qty_replenish?, qty_suggested?, unit_cost? }]
--    Congela el costo de cada línea y calcula total_cost.
-- ============================================
CREATE OR REPLACE FUNCTION create_purchase_order(
  p_supplier_id UUID DEFAULT NULL,
  p_supplier_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
) RETURNS TABLE(order_id UUID, order_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_number TEXT;
  v_supplier_name TEXT := p_supplier_name;
  v_total NUMERIC(12,2) := 0;
  it JSONB;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF user_role() NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'Sin permiso'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La orden necesita al menos un producto';
  END IF;

  IF p_supplier_id IS NOT NULL AND COALESCE(btrim(v_supplier_name), '') = '' THEN
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = p_supplier_id;
  END IF;
  v_supplier_name := COALESCE(NULLIF(btrim(v_supplier_name), ''), 'Sin proveedor');

  v_number := 'OC-' || LPAD(nextval('purchase_order_seq')::text, 6, '0');

  INSERT INTO purchase_orders (order_number, supplier_id, supplier_name, status, notes, total_cost, created_by)
  VALUES (v_number, p_supplier_id, v_supplier_name, 'draft', p_notes, 0, auth.uid())
  RETURNING id INTO v_order_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF (it->>'product_id') IS NULL THEN
      RAISE EXCEPTION 'Ítem sin producto';
    END IF;
    IF (it->>'quantity') IS NULL OR (it->>'quantity')::numeric <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida en ítem';
    END IF;

    INSERT INTO purchase_order_items
      (order_id, product_id, quantity, qty_replenish, qty_suggested, unit_cost)
    VALUES (
      v_order_id,
      (it->>'product_id')::uuid,
      (it->>'quantity')::numeric,
      COALESCE(NULLIF(it->>'qty_replenish', '')::numeric, 0),
      COALESCE(NULLIF(it->>'qty_suggested', '')::numeric, 0),
      NULLIF(it->>'unit_cost', '')::numeric
    );

    v_total := v_total + (it->>'quantity')::numeric
      * COALESCE(NULLIF(it->>'unit_cost', '')::numeric, 0);
  END LOOP;

  UPDATE purchase_orders SET total_cost = v_total, updated_at = now() WHERE id = v_order_id;

  order_id := v_order_id;
  order_number := v_number;
  RETURN NEXT;
END;
$$;

-- 5. RPC: actualizar ítems de una orden draft
-- ============================================
CREATE OR REPLACE FUNCTION update_purchase_order(
  p_order_id UUID,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_status TEXT;
  it JSONB;
  v_total NUMERIC := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF user_role() NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  SELECT status INTO v_status FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Solo se pueden editar órdenes en borrador'; END IF;

  IF p_notes IS NOT NULL THEN
    UPDATE purchase_orders SET notes = p_notes, updated_at = now() WHERE id = p_order_id;
  END IF;

  IF p_items IS NOT NULL AND jsonb_array_length(p_items) > 0 THEN
    DELETE FROM purchase_order_items WHERE order_id = p_order_id;
    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      IF (it->>'quantity') IS NULL OR (it->>'quantity')::numeric <= 0 THEN
        RAISE EXCEPTION 'Cantidad inválida en ítem';
      END IF;
      INSERT INTO purchase_order_items (order_id, product_id, quantity, qty_replenish, qty_suggested, unit_cost)
      VALUES (
        p_order_id,
        (it->>'product_id')::uuid,
        (it->>'quantity')::numeric,
        COALESCE((it->>'qty_replenish')::numeric, 0),
        COALESCE((it->>'qty_suggested')::numeric, 0),
        NULLIF(it->>'unit_cost','')::numeric
      );
      v_total := v_total + (it->>'quantity')::numeric * COALESCE(NULLIF(it->>'unit_cost','')::numeric, 0);
    END LOOP;
    UPDATE purchase_orders SET total_cost = v_total, updated_at = now() WHERE id = p_order_id;
  END IF;

  RETURN TRUE;
END;
$$;

-- ============================================
-- 6. RPC: enviar orden (draft -> sent)
-- ============================================
CREATE OR REPLACE FUNCTION send_purchase_order(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF user_role() NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  SELECT status INTO v_status FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'Solo se pueden enviar órdenes en borrador (estado actual: %)', v_status; END IF;

  UPDATE purchase_orders
  SET status = 'sent', sent_at = now(), updated_at = now()
  WHERE id = p_order_id;
  RETURN TRUE;
END;
$$;

-- ============================================
-- 7. RPC: cancelar orden (draft/sent -> cancelled)
-- ============================================
CREATE OR REPLACE FUNCTION cancel_purchase_order(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF user_role() NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  SELECT status INTO v_status FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF v_status IN ('received','cancelled') THEN
    RAISE EXCEPTION 'No se puede cancelar una orden %', v_status;
  END IF;

  UPDATE purchase_orders
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_order_id;
  RETURN TRUE;
END;
$$;

-- ============================================
-- 8. RPC: convertir orden a ingreso (draft receipt) y marcar received
--    Crea un stock_receipt draft pre-cargado con los ítems de la OC.
-- ============================================
CREATE OR REPLACE FUNCTION convert_purchase_order_to_receipt(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order RECORD;
  v_receipt_id UUID;
  v_number TEXT;
  v_total NUMERIC(12,2);
  it RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF user_role() NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  SELECT * INTO v_order FROM purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;
  IF v_order.status NOT IN ('sent','draft') THEN
    RAISE EXCEPTION 'Solo se pueden recibir órdenes enviadas o en borrador (estado: %)', v_order.status;
  END IF;
  IF v_order.receipt_id IS NOT NULL THEN
    -- Ya tiene un ingreso asociado: devolverlo
    RETURN v_order.receipt_id;
  END IF;

  SELECT COALESCE(SUM(poi.quantity * COALESCE(poi.unit_cost, 0)), 0)
  INTO v_total
  FROM purchase_order_items poi
  WHERE poi.order_id = p_order_id;

  v_number := next_stock_receipt_number();

  INSERT INTO stock_receipts (receipt_number, status, supplier_name, notes, total_cost, created_by)
  VALUES (v_number, 'draft', v_order.supplier_name, 'Generado desde ' || v_order.order_number, v_total, auth.uid())
  RETURNING id INTO v_receipt_id;

  FOR it IN
    SELECT poi.product_id, poi.quantity, poi.unit_cost
    FROM purchase_order_items poi
    WHERE poi.order_id = p_order_id
  LOOP
    INSERT INTO stock_receipt_items (receipt_id, product_id, quantity, cost_price)
    VALUES (v_receipt_id, it.product_id, it.quantity, it.unit_cost);
  END LOOP;

  UPDATE purchase_orders
  SET receipt_id = v_receipt_id, updated_at = now()
  WHERE id = p_order_id;

  RETURN v_receipt_id;
END;
$$;

-- ============================================
-- 9. RPC: marcar orden como recibida (tras confirmar el ingreso)
-- received_quantity = lo que realmente entró en el ingreso confirmado,
-- no lo pedido (permite detectar faltantes).
-- ============================================
CREATE OR REPLACE FUNCTION mark_purchase_order_received(p_order_id UUID, p_receipt_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt   UUID;
  v_confirmed BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF user_role() NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  SELECT COALESCE(p_receipt_id, po.receipt_id)
    INTO v_receipt
    FROM purchase_orders po
   WHERE po.id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF v_receipt IS NOT NULL THEN
    SELECT (sr.status = 'confirmed') INTO v_confirmed
      FROM stock_receipts sr
     WHERE sr.id = v_receipt;
    v_confirmed := COALESCE(v_confirmed, false);
  END IF;

  IF v_confirmed THEN
    UPDATE purchase_order_items poi
       SET received_quantity = COALESCE((
             SELECT SUM(sri.quantity)
               FROM stock_receipt_items sri
              WHERE sri.receipt_id = v_receipt
                AND sri.product_id = poi.product_id
           ), 0)
     WHERE poi.order_id = p_order_id;
  END IF;

  UPDATE purchase_orders
  SET status = 'received',
      received_at = now(),
      receipt_id = COALESCE(v_receipt, receipt_id),
      updated_at = now()
  WHERE id = p_order_id AND status IN ('sent','draft');

  RETURN TRUE;
END;
$$;

-- ============================================
-- 10. Vista de demanda (helper para el frontend)
-- security_invoker: la vista respeta las RLS del usuario que consulta
-- (sin esto el linter de Supabase la marca como SECURITY DEFINER).
-- No la usa la app; se puede eliminar con DROP VIEW si no se necesita.
-- ============================================
DROP VIEW IF EXISTS v_purchase_order_summary;
CREATE VIEW v_purchase_order_summary
WITH (security_invoker = true) AS
SELECT
  po.id,
  po.order_number,
  po.supplier_id,
  po.supplier_name,
  po.status,
  po.notes,
  po.total_cost,
  po.created_at,
  po.sent_at,
  po.received_at,
  po.receipt_id,
  (SELECT COUNT(*) FROM purchase_order_items WHERE order_id = po.id) AS items_count,
  (SELECT COALESCE(SUM(quantity),0) FROM purchase_order_items WHERE order_id = po.id) AS total_qty
FROM purchase_orders po;

-- ============================================
-- Verificación
-- ============================================
SELECT 'purchase_orders' AS tabla, count(*) AS filas FROM purchase_orders
UNION ALL
SELECT 'purchase_order_items', count(*) FROM purchase_order_items
UNION ALL
SELECT 'suppliers.lead_time_days', count(*) FROM information_schema.columns
  WHERE table_schema='public' AND table_name='suppliers' AND column_name='lead_time_days';

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema='public'
  AND routine_name IN ('compute_replenishment','create_purchase_order','update_purchase_order',
                       'send_purchase_order','cancel_purchase_order','convert_purchase_order_to_receipt',
                       'mark_purchase_order_received')
ORDER BY routine_name;
