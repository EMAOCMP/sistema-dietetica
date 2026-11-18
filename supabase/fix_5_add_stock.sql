-- Fix 5/5: add_stock (entrada de mercadería directa)
-- Mismo bug: ON CONFLICT (product_id, location_id) choca con el parámetro de
-- salida product_id. Se renombran las columnas devueltas a o_*.
-- La app no usa esta función (usa adjust_stock), pero queda sana.
BEGIN;

DROP FUNCTION IF EXISTS public.add_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE, TEXT, TEXT);

CREATE FUNCTION public.add_stock(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_cost_price NUMERIC DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_lot_number TEXT DEFAULT NULL,
  p_expiration_date DATE DEFAULT NULL,
  p_reference_type TEXT DEFAULT 'manual',
  p_reference_id TEXT DEFAULT NULL
)
RETURNS TABLE(o_product_id UUID, o_new_quantity NUMERIC, o_previous_quantity NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc  UUID;
  v_prev NUMERIC;
  v_new  NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Cantidad inválida';
  END IF;

  v_loc := p_location_id;
  IF v_loc IS NULL THEN
    SELECT loc.id INTO v_loc FROM locations loc
    WHERE loc.name = 'Local principal' LIMIT 1;
  END IF;
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'No existe ubicación de stock';
  END IF;

  INSERT INTO inventory (product_id, location_id, quantity, lot_number, expiration_date)
  VALUES (p_product_id, v_loc, 0, p_lot_number, p_expiration_date)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT i.quantity INTO v_prev
  FROM inventory i
  WHERE i.product_id = p_product_id AND i.location_id = v_loc
  FOR UPDATE;

  v_new := v_prev + p_quantity;

  UPDATE inventory i
     SET quantity = v_new,
         lot_number = COALESCE(p_lot_number, i.lot_number),
         expiration_date = COALESCE(p_expiration_date, i.expiration_date),
         updated_at = now()
   WHERE i.product_id = p_product_id AND i.location_id = v_loc;

  INSERT INTO inventory_movements
    (product_id, location_id, type, quantity, previous_quantity, new_quantity,
     reference_type, reference_id, user_id)
  VALUES
    (p_product_id, v_loc, 'purchase', p_quantity, v_prev, v_new,
     p_reference_type, p_reference_id, auth.uid());

  IF p_cost_price IS NOT NULL THEN
    UPDATE products p SET cost_price = p_cost_price, updated_at = now()
    WHERE p.id = p_product_id;
  END IF;

  RETURN QUERY SELECT p_product_id, v_new, v_prev;
END;
$$;

NOTIFY pgrst, 'reload schema';
REVOKE ALL ON FUNCTION public.add_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, DATE, TEXT, TEXT) TO service_role;

COMMIT;
