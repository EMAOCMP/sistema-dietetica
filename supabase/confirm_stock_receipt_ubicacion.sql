-- ============================================
-- Migración: confirm_stock_receipt() con ubicación de destino
-- Ejecutar en Supabase SQL Editor DESPUÉS de escaner_v3_transaccional.sql
--
-- Cambio: el RPC ahora acepta un tercer parámetro opcional p_location_id.
--   - Si se informa, el stock entra a esa ubicación.
--   - Si es NULL, mantiene el comportamiento anterior ("Local principal").
-- Esto permite elegir a qué depósito/sucursal entra la mercadería desde el front.
-- ============================================

BEGIN;

-- Eliminar versiones anteriores (UUID) y (UUID, TEXT)
DROP FUNCTION IF EXISTS confirm_stock_receipt(UUID);
DROP FUNCTION IF EXISTS confirm_stock_receipt(UUID, TEXT);
DROP FUNCTION IF EXISTS confirm_stock_receipt(UUID, TEXT, UUID);

-- NOTA: todas las columnas van calificadas con alias porque la función
-- devuelve TABLE(product_id, ...) y "product_id" sin calificar es ambiguo
-- (columna vs parámetro de salida).
CREATE FUNCTION confirm_stock_receipt(
  p_receipt_id UUID,
  p_idempotency_key TEXT DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
)
RETURNS TABLE(o_product_id UUID, o_new_quantity NUMERIC, o_previous_quantity NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  it RECORD;
  v_loc UUID;
  v_prev NUMERIC;
  v_new NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO r FROM stock_receipts sr WHERE sr.id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingreso no encontrado';
  END IF;

  -- Idempotencia: ya confirmado con el mismo key → replay sin re-aplicar
  IF r.status = 'confirmed'
     AND p_idempotency_key IS NOT NULL
     AND r.idempotency_key IS NOT DISTINCT FROM p_idempotency_key THEN
    FOR it IN SELECT sri.* FROM stock_receipt_items sri
              WHERE sri.receipt_id = p_receipt_id LOOP
      SELECT COALESCE(SUM(i.quantity), 0) INTO v_new FROM inventory i
      WHERE i.product_id = it.product_id
        AND (p_location_id IS NULL OR i.location_id = p_location_id);
      o_product_id := it.product_id;
      o_new_quantity := COALESCE(v_new, 0);
      o_previous_quantity := GREATEST(COALESCE(v_new, 0) - it.quantity, 0);
      RETURN NEXT;
    END LOOP;
    RETURN;
  END IF;

  IF r.status <> 'draft' THEN
    RAISE EXCEPTION 'El ingreso ya está %', r.status;
  END IF;

  -- Ubicación: la informada, o por defecto "Local principal"
  IF p_location_id IS NOT NULL THEN
    SELECT loc.id INTO v_loc FROM locations loc WHERE loc.id = p_location_id LIMIT 1;
    IF v_loc IS NULL THEN
      RAISE EXCEPTION 'Ubicación de destino no encontrada';
    END IF;
  ELSE
    SELECT loc.id INTO v_loc FROM locations loc
    WHERE loc.name = 'Local principal' LIMIT 1;
    IF v_loc IS NULL THEN
      RAISE EXCEPTION 'No existe ubicación de stock';
    END IF;
  END IF;

  FOR it IN SELECT sri.* FROM stock_receipt_items sri
            WHERE sri.receipt_id = p_receipt_id LOOP
    INSERT INTO inventory (product_id, location_id, quantity, lot_number, expiration_date)
    VALUES (it.product_id, v_loc, 0, it.lot_number, it.expiration_date)
    ON CONFLICT (product_id, location_id) DO NOTHING;

    SELECT i.quantity INTO v_prev FROM inventory i
    WHERE i.product_id = it.product_id AND i.location_id = v_loc FOR UPDATE;

    v_new := v_prev + it.quantity;

    UPDATE inventory i
       SET quantity = v_new,
           lot_number = COALESCE(it.lot_number, i.lot_number),
           expiration_date = COALESCE(it.expiration_date, i.expiration_date),
           updated_at = now()
     WHERE i.product_id = it.product_id AND i.location_id = v_loc;

    INSERT INTO inventory_movements
      (product_id, location_id, type, quantity, previous_quantity, new_quantity,
       reference_type, reference_id, user_id)
    VALUES
      (it.product_id, v_loc, 'purchase', it.quantity, v_prev, v_new,
       'stock_receipt', p_receipt_id::text, auth.uid());

    IF it.cost_price IS NOT NULL THEN
      UPDATE products p SET cost_price = it.cost_price, updated_at = now()
      WHERE p.id = it.product_id;
    END IF;

    o_product_id := it.product_id;
    o_new_quantity := v_new;
    o_previous_quantity := v_prev;
    RETURN NEXT;
  END LOOP;

  UPDATE stock_receipts sr
     SET status = 'confirmed',
         confirmed_at = now(),
         idempotency_key = COALESCE(p_idempotency_key, sr.idempotency_key),
         total_cost = COALESCE((
           SELECT SUM(sri.quantity * COALESCE(sri.cost_price, 0))
           FROM stock_receipt_items sri
           WHERE sri.receipt_id = p_receipt_id
         ), 0)
   WHERE sr.id = p_receipt_id;

  RETURN;
END;
$$;

-- ============================================
-- Permisos (misma política que antes)
-- ============================================
REVOKE ALL ON FUNCTION confirm_stock_receipt(UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_stock_receipt(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_stock_receipt(UUID, TEXT, UUID) TO service_role;

COMMIT;

-- Verificación
SELECT 'confirm_stock_receipt(uuid,text,uuid)' AS rpc,
       to_regprocedure('public.confirm_stock_receipt(uuid,text,uuid)') IS NOT NULL AS ok;
