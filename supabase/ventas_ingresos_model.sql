-- ============================================
-- Dietética Vishal - Modelo Ventas + Ingresos (v2)
-- Ejecutar en Supabase SQL Editor DESPUÉS de mvp_stock_model.sql
--   stock_receipts || stock_receipt_items (F5 Ingreso mercadería)
--   payments (si no existe)
--   create_sale() RPC transaccional (F7)
-- Todo defensivo: IF NOT EXISTS, sin romper lo actual.
-- ============================================

BEGIN;

-- ============================================
-- 1. STOCK_RECEIPTS (cabecera de ingreso)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','confirmed','cancelled')),
  supplier_name TEXT,
  notes TEXT,
  total_cost NUMERIC(12,2) DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  confirmed_at TIMESTAMPTZ
);

-- Secuencia simple para número de ingreso (ING-000001...)
CREATE SEQUENCE IF NOT EXISTS stock_receipt_seq START 1;

CREATE OR REPLACE FUNCTION next_stock_receipt_number() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  n INT;
BEGIN
  SELECT nextval('stock_receipt_seq') INTO n;
  RETURN 'ING-' || lpad(n::text, 6, '0');
END;
$$;

-- ============================================
-- 2. STOCK_RECEIPT_ITEMS (renglones del ingreso)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_receipt_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  cost_price NUMERIC(12,2),
  lot_number TEXT,
  expiration_date DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON stock_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_product ON stock_receipt_items(product_id);

-- ============================================
-- 3. PAYMENTS (si no existe; detalle de cobro por venta)
-- ============================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL DEFAULT 'cash',
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  transfer_bank TEXT,
  transfer_account TEXT,
  transfer_ref TEXT,
  card_type TEXT,
  card_brand TEXT,
  card_last4 TEXT,
  card_auth TEXT,
  card_installments INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);

-- ============================================
-- 4. CONFIRM STOCK RECEIPT (aplica el ingreso: items → add_stock)
--    Frontend crea receipt (draft) + items, luego llama a confirmar.
--    Todo en una transacción: si una línea falla, no entra nada.
-- ============================================
CREATE OR REPLACE FUNCTION confirm_stock_receipt(p_receipt_id UUID)
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
    SET status = 'confirmed', confirmed_at = now()
  WHERE id = p_receipt_id;

  RETURN;
END;
$$;

-- ============================================
-- 5. CREATE_SALE() transaccional (F7)
--    Un solo llamado: sale → items → inventory(-) → movements → payment.
--    Si cualquier paso falla, ROLLBACK total (no hay venta a medias).
--    p_items: JSONB array [{product_id, quantity, unit_price, cost_price}]
--    p_payment: JSONB {method, ...detalle transferencia/tarjeta}
-- ============================================
CREATE OR REPLACE FUNCTION create_sale(
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
  p_profit_amount NUMERIC DEFAULT NULL
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

  SELECT id INTO v_loc FROM locations WHERE name = 'Local principal' LIMIT 1;

  -- Cabecera (solo columnas núcleo; el detalle vive en payments)
  INSERT INTO sales (
    user_id, customer_name, customer_doc, customer_iva_cond,
    sale_type, total_amount, net_amount, iva_amount, profit_amount,
    payment_method, dispatch_type, notes, status
  ) VALUES (
    auth.uid(), p_customer_name, p_customer_doc, p_customer_iva_cond,
    p_sale_type, p_total_amount, p_net_amount, p_iva_amount, p_profit_amount,
    COALESCE(p_payment->>'method','cash'), p_dispatch_type, p_notes, 'completed'
  ) RETURNING id INTO v_sale_id;

  -- Ítems + descuento de stock (con bloqueo y validación)
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

  -- Pago
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
-- 6. RLS
-- ============================================
ALTER TABLE stock_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "receipts_select" ON stock_receipts;
CREATE POLICY "receipts_select" ON stock_receipts FOR SELECT USING (true);
DROP POLICY IF EXISTS "receipts_insert" ON stock_receipts;
CREATE POLICY "receipts_insert" ON stock_receipts FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "receipts_update" ON stock_receipts;
CREATE POLICY "receipts_update" ON stock_receipts FOR UPDATE USING (true) WITH CHECK (true);

ALTER TABLE stock_receipt_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "receipt_items_select" ON stock_receipt_items;
CREATE POLICY "receipt_items_select" ON stock_receipt_items FOR SELECT USING (true);
DROP POLICY IF EXISTS "receipt_items_insert" ON stock_receipt_items;
CREATE POLICY "receipt_items_insert" ON stock_receipt_items FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "receipt_items_delete" ON stock_receipt_items;
CREATE POLICY "receipt_items_delete" ON stock_receipt_items FOR DELETE USING (true);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_select" ON payments;
CREATE POLICY "payments_select" ON payments FOR SELECT USING (true);
DROP POLICY IF EXISTS "payments_insert" ON payments;
CREATE POLICY "payments_insert" ON payments FOR INSERT WITH CHECK (true);

REVOKE ALL ON FUNCTION confirm_stock_receipt(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_stock_receipt(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_stock_receipt(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION next_stock_receipt_number() TO authenticated;
GRANT EXECUTE ON FUNCTION next_stock_receipt_number() TO service_role;

COMMIT;

-- Verificación
SELECT 'stock_receipts' AS tabla, COUNT(*) FROM stock_receipts
UNION ALL SELECT 'stock_receipt_items', COUNT(*) FROM stock_receipt_items
UNION ALL SELECT 'payments', COUNT(*) FROM payments;
