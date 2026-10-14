-- ============================================
-- Dietética Vishal - Tickets correlativos reales
-- Ejecutar en Supabase SQL Editor.
--   1. sale_counters (para nextReceiptNumber con compare-and-swap)
--   2. UNIQUE parcial en sales.receipt_number (solo si no hay duplicados)
--   3. create_sale() acepta p_receipt_number y lo guarda
-- Re-ejecutable y defensivo.
-- ============================================

BEGIN;

-- ============================================
-- 1. sale_counters
-- ============================================
CREATE TABLE IF NOT EXISTS sale_counters (
  id INT PRIMARY KEY,
  last_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO sale_counters (id, last_number)
SELECT 1, COALESCE(MAX((regexp_match(receipt_number, '-(\d+)$'))[1]::bigint), 0)
FROM sales WHERE receipt_number IS NOT NULL
ON CONFLICT (id) DO NOTHING;

ALTER TABLE sale_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "counters_all" ON sale_counters;
CREATE POLICY "counters_all" ON sale_counters FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- 2. UNIQUE en receipt_number (solo si no hay duplicados actuales)
-- ============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sales WHERE receipt_number IS NOT NULL
    GROUP BY receipt_number HAVING COUNT(*) > 1 LIMIT 1
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ux_sales_receipt_number') THEN
      CREATE UNIQUE INDEX ux_sales_receipt_number ON sales(receipt_number) WHERE receipt_number IS NOT NULL;
    END IF;
  ELSE
    RAISE NOTICE 'Hay receipts duplicados: no se crea el índice único. Normalizar antes de reintentar.';
  END IF;
END $$;

-- ============================================
-- 3. create_sale() con p_receipt_number
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

REVOKE ALL ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

COMMIT;

-- Verificación
SELECT 'sale_counters' AS objeto, COUNT(*) AS filas FROM sale_counters
UNION ALL SELECT 'max_receipt_actual', COALESCE(MAX((regexp_match(receipt_number, '-(\d+)$'))[1]::bigint), 0) FROM sales WHERE receipt_number IS NOT NULL
UNION ALL SELECT 'ux_receipt_activo', COUNT(*) FROM pg_indexes WHERE schemaname='public' AND indexname='ux_sales_receipt_number';
SELECT to_regprocedure('public.create_sale(text,numeric,jsonb,jsonb,text,text,text,text,text,text,numeric,numeric,numeric,text,text)') IS NOT NULL AS create_sale_ok;
