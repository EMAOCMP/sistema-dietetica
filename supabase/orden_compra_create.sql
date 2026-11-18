-- ============================================
-- Crear orden de compra (RPC) - Dietética Vishal
-- Ejecutar en SQL Editor. Idempotente.
--
-- Congela el costo unitario de cada línea y calcula total_cost
-- (lo usan el mensaje de WhatsApp y el ingreso de mercadería).
-- ============================================

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.purchase_order_seq START 1;

-- Se borran todas las versiones instaladas para no dejar sobrecargas ambiguas.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'create_purchase_order'
  LOOP
    EXECUTE 'DROP FUNCTION ' || r.sig;
  END LOOP;
END $$;

CREATE FUNCTION public.create_purchase_order(
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

REVOKE ALL ON FUNCTION public.create_purchase_order(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(UUID, TEXT, TEXT, JSONB) TO service_role;

COMMIT;
