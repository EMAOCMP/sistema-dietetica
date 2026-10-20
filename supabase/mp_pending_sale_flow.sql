-- ============================================================
-- MERCADO PAGO — Venta dirigida por pago (pending → approved)
-- Ejecutar en: SQL Editor de Supabase
-- Idempotente.
--
-- Flujo:
--   1. El POS llama a create_mp_pending_sale() al generar el link:
--      crea la venta en estado 'pending_payment' CON sus ítems,
--      pero SIN descontar stock ni asignar comprobante.
--   2. Cuando MP aprueba el pago, el webhook llama a finalize_mp_sale():
--      descuenta stock, asigna comprobante, pasa a 'completed'/'approved'.
--   3. Si MP rechaza el pago, el webhook llama a cancel_mp_sale():
--      la venta pasa a 'cancelled'/'rejected' (no toca stock).
-- ============================================================

-- Asegurar columna de descuento (por si no corrió reportes_mejoras.sql)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ============================================
-- 1. create_mp_pending_sale — crea venta pendiente (sin stock)
-- ============================================
DROP FUNCTION IF EXISTS create_mp_pending_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT);

CREATE FUNCTION create_mp_pending_sale(
  p_customer_name TEXT,
  p_total_amount NUMERIC,
  p_items JSONB,
  p_payment JSONB DEFAULT '{}'::jsonb,
  p_sale_type TEXT DEFAULT 'internal',
  p_dispatch_type TEXT DEFAULT 'pickup',
  p_notes TEXT DEFAULT NULL,
  p_customer_doc TEXT DEFAULT NULL,
  p_customer_iva_cond TEXT DEFAULT 'CF',
  p_customer_phone TEXT DEFAULT NULL,
  p_net_amount NUMERIC DEFAULT NULL,
  p_iva_amount NUMERIC DEFAULT NULL,
  p_profit_amount NUMERIC DEFAULT NULL,
  p_discount_amount NUMERIC DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_mp_link TEXT DEFAULT NULL,
  p_mp_preference_id TEXT DEFAULT NULL,
  p_mp_external_ref TEXT DEFAULT NULL
) RETURNS TABLE(sale_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_sale_id UUID;
  it JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Venta sin ítems';
  END IF;
  IF p_total_amount IS NULL OR p_total_amount <= 0 THEN
    RAISE EXCEPTION 'Total inválido';
  END IF;

  -- Idempotencia: mismo key → misma venta pendiente, sin duplicar
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_sale_id FROM sales WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      sale_id := v_sale_id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  INSERT INTO sales (
    user_id, customer_name, customer_doc, customer_iva_cond,
    sale_type, total_amount, net_amount, iva_amount, profit_amount, discount_amount,
    payment_method, dispatch_type, notes, status, idempotency_key,
    mp_status, mp_link, mp_preference_id, mp_external_ref
  ) VALUES (
    auth.uid(), p_customer_name, p_customer_doc, p_customer_iva_cond,
    p_sale_type, p_total_amount, p_net_amount, p_iva_amount, p_profit_amount, COALESCE(p_discount_amount, 0),
    'mercadopago', p_dispatch_type, p_notes, 'pending_payment', p_idempotency_key,
    'pending', p_mp_link, p_mp_preference_id, p_mp_external_ref
  ) RETURNING id INTO v_sale_id;

  -- Ítems (sin tocar stock todavía)
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, cost_price_at_sale)
    VALUES (
      v_sale_id,
      (it->>'product_id')::uuid,
      (it->>'quantity')::numeric,
      (it->>'unit_price')::numeric,
      (it->>'quantity')::numeric * (it->>'unit_price')::numeric,
      NULLIF(it->>'cost_price','')::numeric
    );
  END LOOP;

  sale_id := v_sale_id;
  RETURN NEXT;
END;
$$;

-- ============================================
-- 2. finalize_mp_sale — aprueba: descuenta stock + comprobante
-- ============================================
DROP FUNCTION IF EXISTS finalize_mp_sale(UUID);

CREATE FUNCTION finalize_mp_sale(p_sale_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
  v_total NUMERIC;
  v_user UUID;
  v_loc UUID;
  it RECORD;
  v_prev NUMERIC;
  v_new NUMERIC;
  v_counter BIGINT;
  v_receipt TEXT;
BEGIN
  SELECT status, total_amount, user_id INTO v_status, v_total, v_user
  FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta % no encontrada', p_sale_id;
  END IF;
  -- Idempotente: si ya está completada, no repetir
  IF v_status = 'completed' THEN
    RETURN TRUE;
  END IF;
  IF v_status NOT IN ('pending_payment','pending') THEN
    RAISE EXCEPTION 'Venta en estado inválido para finalizar: %', v_status;
  END IF;

  SELECT id INTO v_loc FROM locations WHERE name = 'Local principal' LIMIT 1;

  -- Descontar stock por cada ítem
  FOR it IN SELECT product_id, quantity FROM sale_items WHERE sale_id = p_sale_id LOOP
    IF v_loc IS NOT NULL THEN
      INSERT INTO inventory (product_id, location_id, quantity)
      VALUES (it.product_id, v_loc, 0)
      ON CONFLICT (product_id, location_id) DO NOTHING;

      SELECT quantity INTO v_prev FROM inventory
      WHERE product_id = it.product_id AND location_id = v_loc FOR UPDATE;

      v_new := COALESCE(v_prev, 0) - it.quantity;
      IF v_new < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para %: hay %', it.product_id, v_prev;
      END IF;

      UPDATE inventory SET quantity = v_new, updated_at = now()
      WHERE product_id = it.product_id AND location_id = v_loc;

      INSERT INTO inventory_movements
        (product_id, location_id, type, quantity, previous_quantity, new_quantity,
         reference_type, reference_id, user_id)
      VALUES
        (it.product_id, v_loc, 'sale', -it.quantity, v_prev, v_new,
         'sale', p_sale_id::text, v_user);
    END IF;
  END LOOP;

  -- Registrar el pago (se confirma recién ahora)
  INSERT INTO payments (sale_id, method, amount)
  VALUES (p_sale_id, 'mercadopago', v_total)
  ON CONFLICT DO NOTHING;

  -- Asignar N° de comprobante
  INSERT INTO sale_counters (id, last_number) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
  UPDATE sale_counters SET last_number = last_number + 1
  WHERE id = 1 RETURNING last_number INTO v_counter;
  v_receipt := '0001-' || LPAD(v_counter::text, 8, '0');

  UPDATE sales
  SET status = 'completed',
      mp_status = 'approved',
      receipt_number = COALESCE(receipt_number, v_receipt)
  WHERE id = p_sale_id;

  RETURN TRUE;
END;
$$;

-- ============================================
-- 3. cancel_mp_sale — rechaza: cancela sin tocar stock
-- ============================================
DROP FUNCTION IF EXISTS cancel_mp_sale(UUID);

CREATE FUNCTION cancel_mp_sale(p_sale_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  -- Idempotente
  IF v_status = 'cancelled' THEN
    RETURN TRUE;
  END IF;
  IF v_status NOT IN ('pending_payment','pending') THEN
    RETURN FALSE;
  END IF;

  UPDATE sales
  SET status = 'cancelled',
      mp_status = 'rejected'
  WHERE id = p_sale_id;

  RETURN TRUE;
END;
$$;

-- Verificación
SELECT p.proname AS funcion
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_mp_pending_sale','finalize_mp_sale','cancel_mp_sale')
ORDER BY p.proname;
