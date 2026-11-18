-- ============================================
-- Dietética Vishal - Motivo visible en los ajustes de stock
-- Ejecutar en Supabase SQL Editor (después de mvp_stock_model.sql).
--
-- adjust_stock() recibía p_reason pero no lo guardaba, así que el historial
-- del producto mostraba solo "Ajuste". Ahora lo escribe en
-- inventory_movements.notes: conteo físico, entrada/salida manual,
-- importación, fusión de duplicados, etc.
--
-- Importante: las columnas van calificadas con alias porque la función
-- devuelve TABLE(product_id, ...) y "product_id" sin calificar es ambiguo
-- (columna vs parámetro de salida) → "column reference is ambiguous".
-- ============================================

BEGIN;

ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE OR REPLACE FUNCTION public.adjust_stock(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_location_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT 'adjustment',
  p_reference_id TEXT DEFAULT NULL
) RETURNS TABLE(o_product_id UUID, o_new_quantity NUMERIC, o_previous_quantity NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc UUID;
  v_prev NUMERIC;
  v_new NUMERIC;
  v_type TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
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

  INSERT INTO inventory (product_id, location_id, quantity)
  VALUES (p_product_id, v_loc, 0)
  ON CONFLICT (product_id, location_id) DO NOTHING;

  SELECT i.quantity INTO v_prev
  FROM inventory i
  WHERE i.product_id = p_product_id AND i.location_id = v_loc
  FOR UPDATE;

  v_new := v_prev + p_quantity;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente: actual %', v_prev;
  END IF;

  v_type := CASE
    WHEN p_quantity > 0 AND COALESCE(p_reference_type, 'adjustment') = 'loss' THEN 'loss'
    ELSE 'adjustment'
  END;

  UPDATE inventory i
     SET quantity = v_new, updated_at = now()
   WHERE i.product_id = p_product_id AND i.location_id = v_loc;

  INSERT INTO inventory_movements
    (product_id, location_id, type, quantity, previous_quantity, new_quantity,
     reference_type, reference_id, user_id, notes)
  VALUES
    (p_product_id, v_loc, v_type, p_quantity, v_prev, v_new,
     p_reference_type, p_reference_id, auth.uid(),
     NULLIF(btrim(COALESCE(p_reason, '')), ''));

  RETURN QUERY SELECT p_product_id, v_new, v_prev;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_stock(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, NUMERIC, UUID, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
