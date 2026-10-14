-- ============================================
-- Dietética Vishal - Transferencia entre ubicaciones
-- Ejecutar en Supabase SQL Editor.
--   transfer_stock(): baja en origen, alta en destino,
--   movimientos transfer_out / transfer_in en un solo commit.
-- ============================================

BEGIN;

-- Notas en movimientos (si no existe todavía)
ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE OR REPLACE FUNCTION transfer_stock(
  p_product_id UUID,
  p_from_location_id UUID,
  p_to_location_id UUID,
  p_quantity NUMERIC,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_prev NUMERIC;
  v_new NUMERIC;
  v_moved NUMERIC := 0;
  v_line JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_from_location_id = p_to_location_id THEN
    RAISE EXCEPTION 'Origen y destino deben ser distintos';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  -- Idempotencia: si ya se ejecutó esta key, no repetir
  IF p_idempotency_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM inventory_movements WHERE reference_id = 'tx:' || p_idempotency_key
    LIMIT 1
  ) THEN
    RETURN jsonb_build_object('status', 'already_done', 'moved', 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM locations WHERE id = p_from_location_id)
     OR NOT EXISTS (SELECT 1 FROM locations WHERE id = p_to_location_id) THEN
    RAISE EXCEPTION 'Ubicación inexistente';
  END IF;

  -- Asegurar filas
  INSERT INTO inventory (product_id, location_id, quantity)
  VALUES (p_product_id, p_from_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;
  INSERT INTO inventory (product_id, location_id, quantity)
  VALUES (p_product_id, p_to_location_id, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  -- Baja en origen (con lock de fila)
  SELECT quantity INTO v_prev FROM inventory
  WHERE product_id = p_product_id AND location_id = p_from_location_id
  FOR UPDATE;

  IF COALESCE(v_prev, 0) < p_quantity THEN
    RAISE EXCEPTION 'Stock insuficiente en origen: hay %, se piden %', v_prev, p_quantity;
  END IF;

  v_new := v_prev - p_quantity;
  UPDATE inventory SET quantity = v_new, updated_at = now()
  WHERE product_id = p_product_id AND location_id = p_from_location_id;

  INSERT INTO inventory_movements
    (product_id, location_id, type, quantity, previous_quantity, new_quantity,
     reference_type, reference_id, user_id)
  VALUES
    (p_product_id, p_from_location_id, 'transfer_out', -p_quantity, v_prev, v_new,
     'transfer', COALESCE('tx:' || p_idempotency_key, gen_random_uuid()::text), auth.uid());

  -- Alta en destino
  SELECT quantity INTO v_prev FROM inventory
  WHERE product_id = p_product_id AND location_id = p_to_location_id
  FOR UPDATE;

  v_new := COALESCE(v_prev, 0) + p_quantity;
  UPDATE inventory SET quantity = v_new, updated_at = now()
  WHERE product_id = p_product_id AND location_id = p_to_location_id;

  INSERT INTO inventory_movements
    (product_id, location_id, type, quantity, previous_quantity, new_quantity,
     reference_type, reference_id, user_id, notes)
  VALUES
    (p_product_id, p_to_location_id, 'transfer_in', p_quantity, v_prev, v_new,
     'transfer', COALESCE('tx:' || p_idempotency_key, gen_random_uuid()::text), auth.uid(), p_notes);

  -- products.stock_quantity se mantiene como total (no cambia con transferencias)
  v_moved := p_quantity;
  RETURN jsonb_build_object('status', 'ok', 'moved', v_moved);
END;
$$;

REVOKE ALL ON FUNCTION transfer_stock(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_stock(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION transfer_stock(UUID, UUID, UUID, NUMERIC, TEXT, TEXT) TO service_role;

COMMIT;

SELECT to_regprocedure('public.transfer_stock(uuid,uuid,uuid,numeric,text,text)') IS NOT NULL AS transfer_stock_ok;
