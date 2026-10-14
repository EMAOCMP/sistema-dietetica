-- ============================================
-- Dietética Vishal - Escáner V3 transaccional
-- Ejecutar en Supabase SQL Editor (después de ventas_ingresos_model.sql).
--   1. cancel_sale() RPC transaccional (reemplaza anulaciones directas)
--   2. Idempotencia base: idempotency_key en sales + stock_receipts,
--      respetada por create_sale() y confirm_stock_receipt().
-- Todo defensivo y re-ejecutable.
-- ============================================

BEGIN;

-- ============================================
-- 1. Columnas de idempotencia
-- ============================================
ALTER TABLE sales ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_sales_idempotency') THEN
    CREATE UNIQUE INDEX ux_sales_idempotency ON sales(idempotency_key) WHERE idempotency_key IS NOT NULL;
  END IF;
END $$;

ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_receipts_idempotency') THEN
    CREATE UNIQUE INDEX ux_receipts_idempotency ON stock_receipts(idempotency_key) WHERE idempotency_key IS NOT NULL;
  END IF;
END $$;

-- ============================================
-- 2. cancel_sale() — anula en una transacción (admin/supervisor).
--    Idempotente: si ya está cancelled, no hace nada.
-- ============================================
CREATE OR REPLACE FUNCTION cancel_sale(p_sale_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
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
  IF user_role() NOT IN ('admin','supervisor') THEN
    RAISE EXCEPTION 'Sin permiso para anular';
  END IF;

  SELECT * INTO r FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF r.status = 'cancelled' THEN
    RETURN;
  END IF;
  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'Estado % no anulable', r.status;
  END IF;

  SELECT id INTO v_loc FROM locations WHERE name = 'Local principal' LIMIT 1;

  UPDATE sales SET status = 'cancelled' WHERE id = p_sale_id;

  FOR it IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    IF v_loc IS NOT NULL THEN
      INSERT INTO inventory (product_id, location_id, quantity)
      VALUES (it.product_id, v_loc, 0)
      ON CONFLICT (product_id, location_id) DO NOTHING;

      SELECT quantity INTO v_prev FROM inventory
      WHERE product_id = it.product_id AND location_id = v_loc FOR UPDATE;

      v_new := COALESCE(v_prev, 0) + it.quantity;

      UPDATE inventory SET quantity = v_new, updated_at = now()
      WHERE product_id = it.product_id AND location_id = v_loc;

      INSERT INTO inventory_movements
        (product_id, location_id, type, quantity, previous_quantity, new_quantity,
         reference_type, reference_id, user_id)
      VALUES
        (it.product_id, v_loc, 'return', it.quantity, v_prev, v_new,
         'sale_cancel', p_sale_id::text, auth.uid());
    END IF;
  END LOOP;
END;
$$;

-- ============================================
-- 3. create_sale() + idempotency_key + p_receipt_number
--    (superset: reemplaza versiones de 13/14 parámetros)
-- ============================================
DROP FUNCTION IF EXISTS create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT);

CREATE FUNCTION create_sale(
  p_customer_name TEXT,
  p_total_amount NUMERIC,
  p_items JSONB,
  p_payment JSONB DEFAULT '{"method":"cash"}'::jsonb,
  p_sale_type TEXT DEFAULT 'internal',
  p_dispatch_type TEXT DEFAULT 'pickup',
  p_notes TEXT DEFAULT NULL,
  p_customer_doc TEXT DEFAULT NULL,
  p_customer_iva_cond TEXT DEFAULT 'CF',
  p_customer_phone TEXT DEFAULT NULL,
  p_net_amount NUMERIC DEFAULT NULL,
  p_iva_amount NUMERIC DEFAULT NULL,
  p_profit_amount NUMERIC DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_receipt_number TEXT DEFAULT NULL
) RETURNS TABLE(sale_id UUID, receipt_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_sale_id UUID;
  v_receipt TEXT;
  v_loc UUID;
  it JSONB;
  v_pid UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_cost NUMERIC;
  v_sub NUMERIC;
  v_prev NUMERIC;
  v_new NUMERIC;
  v_method TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Venta sin ítems';
  END IF;
  IF p_total_amount IS NULL OR p_total_amount < 0 THEN
    RAISE EXCEPTION 'Total inválido';
  END IF;

  -- Idempotencia: mismo key repetido → misma venta, sin duplicar
  IF p_idempotency_key IS NOT NULL THEN
    SELECT s.id, s.receipt_number INTO v_sale_id, v_receipt
    FROM sales s WHERE s.idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      sale_id := v_sale_id;
      receipt_number := v_receipt;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT id INTO v_loc FROM locations WHERE name = 'Local principal' LIMIT 1;

  INSERT INTO sales (
    user_id, customer_name, customer_doc, customer_iva_cond,
    sale_type, total_amount, net_amount, iva_amount, profit_amount,
    payment_method, dispatch_type, notes, status, idempotency_key, receipt_number
  ) VALUES (
    auth.uid(), p_customer_name, p_customer_doc, p_customer_iva_cond,
    p_sale_type, p_total_amount, p_net_amount, p_iva_amount, p_profit_amount,
    COALESCE(p_payment->>'method','cash'), p_dispatch_type, p_notes, 'completed',
    p_idempotency_key, NULLIF(p_receipt_number, '')
  ) RETURNING id INTO v_sale_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (it->>'product_id')::uuid;
    v_qty := (it->>'quantity')::numeric;
    v_price := (it->>'unit_price')::numeric;
    v_cost := NULLIF(it->>'cost_price','')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida en ítem';
    END IF;
    v_sub := v_price * v_qty;

    INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, cost_price_at_sale)
    VALUES (v_sale_id, v_pid, v_qty, v_price, v_sub, v_cost);

    IF v_loc IS NOT NULL THEN
      INSERT INTO inventory (product_id, location_id, quantity)
      VALUES (v_pid, v_loc, 0)
      ON CONFLICT (product_id, location_id) DO NOTHING;

      SELECT quantity INTO v_prev FROM inventory
      WHERE product_id = v_pid AND location_id = v_loc FOR UPDATE;

      v_new := COALESCE(v_prev, 0) - v_qty;
      IF v_new < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para %: hay %', v_pid, v_prev;
      END IF;

      UPDATE inventory SET quantity = v_new, updated_at = now()
      WHERE product_id = v_pid AND location_id = v_loc;

      INSERT INTO inventory_movements
        (product_id, location_id, type, quantity, previous_quantity, new_quantity,
         reference_type, reference_id, user_id)
      VALUES
        (v_pid, v_loc, 'sale', -v_qty, v_prev, v_new,
         'sale', v_sale_id::text, auth.uid());
    END IF;
  END LOOP;

  v_method := COALESCE(p_payment->>'method','cash');
  INSERT INTO payments (
    sale_id, method, amount,
    transfer_bank, transfer_account, transfer_ref,
    card_type, card_brand, card_last4, card_auth, card_installments
  ) VALUES (
    v_sale_id, v_method, p_total_amount,
    p_payment->>'transfer_bank', p_payment->>'transfer_account', p_payment->>'transfer_ref',
    p_payment->>'card_type', p_payment->>'card_brand', p_payment->>'card_last4',
    p_payment->>'card_auth', NULLIF(p_payment->>'card_installments','')::int
  );

  SELECT s.receipt_number INTO v_receipt FROM sales s WHERE s.id = v_sale_id;

  sale_id := v_sale_id;
  receipt_number := v_receipt;
  RETURN NEXT;
END;
$$;

-- ============================================
-- 4. confirm_stock_receipt() + idempotency_key (reemplaza anterior)
-- ============================================
DROP FUNCTION IF EXISTS confirm_stock_receipt(UUID);
DROP FUNCTION IF EXISTS confirm_stock_receipt(UUID, TEXT);

CREATE FUNCTION confirm_stock_receipt(p_receipt_id UUID, p_idempotency_key TEXT DEFAULT NULL)
RETURNS TABLE(product_id UUID, new_quantity NUMERIC, previous_quantity NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER
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

  SELECT * INTO r FROM stock_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingreso no encontrado';
  END IF;

  -- Idempotencia: ya confirmado con el mismo key → replay sin re-aplicar
  IF r.status = 'confirmed'
     AND p_idempotency_key IS NOT NULL
     AND r.idempotency_key IS NOT DISTINCT FROM p_idempotency_key THEN
    FOR it IN SELECT * FROM stock_receipt_items WHERE receipt_id = p_receipt_id LOOP
      SELECT quantity INTO v_new FROM inventory WHERE product_id = it.product_id LIMIT 1;
      product_id := it.product_id;
      new_quantity := COALESCE(v_new, 0);
      previous_quantity := COALESCE(v_new, 0) - it.quantity;
      RETURN NEXT;
    END LOOP;
    RETURN;
  END IF;

  IF r.status <> 'draft' THEN
    RAISE EXCEPTION 'El ingreso ya está %', r.status;
  END IF;

  SELECT id INTO v_loc FROM locations WHERE name = 'Local principal' LIMIT 1;
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'No existe ubicación de stock';
  END IF;

  FOR it IN SELECT * FROM stock_receipt_items WHERE receipt_id = p_receipt_id LOOP
    INSERT INTO inventory (product_id, location_id, quantity, lot_number, expiration_date)
    VALUES (it.product_id, v_loc, 0, it.lot_number, it.expiration_date)
    ON CONFLICT (product_id, location_id) DO NOTHING;

    SELECT quantity INTO v_prev FROM inventory
    WHERE product_id = it.product_id AND location_id = v_loc FOR UPDATE;

    v_new := v_prev + it.quantity;

    UPDATE inventory
      SET quantity = v_new,
          lot_number = COALESCE(it.lot_number, lot_number),
          expiration_date = COALESCE(it.expiration_date, expiration_date),
          updated_at = now()
    WHERE product_id = it.product_id AND location_id = v_loc;

    INSERT INTO inventory_movements
      (product_id, location_id, type, quantity, previous_quantity, new_quantity,
       reference_type, reference_id, user_id)
    VALUES
      (it.product_id, v_loc, 'purchase', it.quantity, v_prev, v_new,
       'stock_receipt', p_receipt_id::text, auth.uid());

    IF it.cost_price IS NOT NULL THEN
      UPDATE products SET cost_price = it.cost_price, updated_at = now()
      WHERE id = it.product_id;
    END IF;

    product_id := it.product_id;
    new_quantity := v_new;
    previous_quantity := v_prev;
    RETURN NEXT;
  END LOOP;

  UPDATE stock_receipts
    SET status = 'confirmed', confirmed_at = now(),
        idempotency_key = COALESCE(p_idempotency_key, idempotency_key)
  WHERE id = p_receipt_id;

  RETURN;
END;
$$;

-- ============================================
-- 5. Permisos
-- ============================================
REVOKE ALL ON FUNCTION cancel_sale(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_stock_receipt(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_sale(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_stock_receipt(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_sale(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION confirm_stock_receipt(UUID, TEXT) TO service_role;

COMMIT;

-- Verificación
SELECT 'cancel_sale' AS rpc, to_regprocedure('public.cancel_sale(uuid)') IS NOT NULL AS ok
UNION ALL SELECT 'create_sale', to_regprocedure('public.create_sale(text,numeric,jsonb,jsonb,text,text,text,text,text,text,numeric,numeric,numeric,text,text)') IS NOT NULL
UNION ALL SELECT 'confirm_stock_receipt', to_regprocedure('public.confirm_stock_receipt(uuid,text)') IS NOT NULL;
SELECT COUNT(*) AS versiones_viejas_create_sale FROM pg_proc
WHERE proname = 'create_sale' AND pronargs < 15;
