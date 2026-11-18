-- ============================================================
-- Ingreso de mercadería: borradores, cancelados y totales
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
--
-- Qué hace:
--   1. delete_stock_receipt(): borra definitivamente un borrador
--      o un ingreso cancelado (nunca uno confirmado).
--   2. purge_cancelled_receipts(): limpia cancelados viejos.
--   3. Completa total_cost de los borradores existentes.
--   4. Corrige convert_purchase_order_to_receipt() para que el
--      ingreso generado desde una OC ya nazca con su total.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Borrar definitivamente un ingreso NO confirmado
--    (borrador o cancelado). Los ítems se borran en cascada.
--    Si una OC apuntaba a este ingreso, queda con receipt_id NULL.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_stock_receipt(p_receipt_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF public.user_role() NOT IN ('admin','supervisor') THEN
    RAISE EXCEPTION 'Sin permiso';
  END IF;

  SELECT status INTO v_status
  FROM public.stock_receipts
  WHERE id = p_receipt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingreso no encontrado';
  END IF;

  IF v_status = 'confirmed' THEN
    RAISE EXCEPTION 'No se puede borrar un ingreso confirmado: ya movió stock. Anulá el movimiento con un ajuste.';
  END IF;

  DELETE FROM public.stock_receipts WHERE id = p_receipt_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_stock_receipt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_stock_receipt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_stock_receipt(UUID) TO service_role;

-- ------------------------------------------------------------
-- 2. Purgar ingresos cancelados más viejos que N días (default 30)
--    Devuelve cuántos borró. Se puede llamar a mano o desde pg_cron.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_cancelled_receipts(p_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Ojo: el chequeo anterior era `auth.uid() IS NOT NULL AND ...`, así que un
  -- llamador anónimo (sin sesión) pasaba el filtro y podía borrar cancelados.
  -- Ahora se exige sesión + rol admin, sin excepciones.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF public.user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Sin permiso';
  END IF;

  DELETE FROM public.stock_receipts
  WHERE status = 'cancelled'
    AND created_at < now() - make_interval(days => GREATEST(COALESCE(p_days, 30), 1));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- `REVOKE ... FROM PUBLIC` no alcanza en Supabase: los privilegios por defecto
-- del esquema public ya le dieron EXECUTE al rol `anon`. Hay que revocarlo aparte.
REVOKE ALL ON FUNCTION public.purge_cancelled_receipts(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_cancelled_receipts(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_cancelled_receipts(INT) TO service_role;

-- ------------------------------------------------------------
-- 3. Completar el total de los borradores que quedaron en 0
--    (por ejemplo, los generados desde una OC antes de este fix).
-- ------------------------------------------------------------
UPDATE public.stock_receipts r
SET total_cost = COALESCE((
  SELECT SUM(i.quantity * COALESCE(i.cost_price, 0))
  FROM public.stock_receipt_items i
  WHERE i.receipt_id = r.id
), 0)
WHERE r.status = 'draft'
  AND COALESCE(r.total_cost, 0) = 0;

-- ------------------------------------------------------------
-- 4. convert_purchase_order_to_receipt() con total calculado.
--    Misma firma y mismo comportamiento; solo agrega total_cost.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_purchase_order_to_receipt(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_receipt_id UUID;
  v_number TEXT;
  v_total NUMERIC(12,2);
  it RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF public.user_role() NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  SELECT * INTO v_order FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
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
  FROM public.purchase_order_items poi
  WHERE poi.order_id = p_order_id;

  v_number := public.next_stock_receipt_number();

  INSERT INTO public.stock_receipts (receipt_number, status, supplier_name, notes, total_cost, created_by)
  VALUES (v_number, 'draft', v_order.supplier_name, 'Generado desde ' || v_order.order_number, v_total, auth.uid())
  RETURNING id INTO v_receipt_id;

  FOR it IN
    SELECT poi.product_id, poi.quantity, poi.unit_cost
    FROM public.purchase_order_items poi
    WHERE poi.order_id = p_order_id
  LOOP
    INSERT INTO public.stock_receipt_items (receipt_id, product_id, quantity, cost_price)
    VALUES (v_receipt_id, it.product_id, it.quantity, it.unit_cost);
  END LOOP;

  UPDATE public.purchase_orders
  SET receipt_id = v_receipt_id, updated_at = now()
  WHERE id = p_order_id;

  RETURN v_receipt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_purchase_order_to_receipt(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_purchase_order_to_receipt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_purchase_order_to_receipt(UUID) TO service_role;

-- La numeración de ingresos no necesita estar expuesta sin sesión: un anónimo
-- podía hacer avanzar la secuencia y "quemar" números.
REVOKE ALL ON FUNCTION public.next_stock_receipt_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_stock_receipt_number() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_stock_receipt_number() TO service_role;

COMMIT;

-- ============================================================
-- Verificación (todo debe dar true)
-- ============================================================
SELECT 'delete_stock_receipt' AS funcion,
       to_regprocedure('public.delete_stock_receipt(uuid)') IS NOT NULL AS ok
UNION ALL
SELECT 'purge_cancelled_receipts',
       to_regprocedure('public.purge_cancelled_receipts(int)') IS NOT NULL
UNION ALL
SELECT 'convert_purchase_order_to_receipt',
       to_regprocedure('public.convert_purchase_order_to_receipt(uuid)') IS NOT NULL;
