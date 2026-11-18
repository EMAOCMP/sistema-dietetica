-- ============================================================
-- Ajustes posteriores a la revisión del proyecto
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
--
-- ⚠️ Si el editor SQL te corta este archivo (error "unterminated
-- dollar-quoted string"), usá los dos archivos cortos:
--     supabase/fix_1_telefono.sql
--     supabase/fix_2_auditoria.sql
-- Hacen lo mismo y son chicos.
--
-- Qué arregla:
--   1. sales.customer_phone: el POS manda el teléfono del cliente
--      (p_customer_phone) pero create_sale lo descartaba, así que no
--      había forma de reenviar el ticket por WhatsApp desde el historial.
--   2. audit_logs.user_id: el trigger leía current_setting('app.current_user_id'),
--      que nunca se setea → todas las filas quedaban sin autor. Ahora usa
--      auth.uid(). Además se auditan ingresos y órdenes de compra.
--   3. Permisos: las funciones no quedan expuestas al rol `anon`
--      (Supabase le da EXECUTE por privilegios por defecto del esquema).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Teléfono del cliente en la venta
-- ------------------------------------------------------------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- Misma firma de 15 parámetros: solo agrega customer_phone al INSERT.
CREATE OR REPLACE FUNCTION public.create_sale(
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
SET search_path = public
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
    user_id, customer_name, customer_doc, customer_iva_cond, customer_phone,
    sale_type, total_amount, net_amount, iva_amount, profit_amount,
    payment_method, dispatch_type, notes, status, idempotency_key, receipt_number
  ) VALUES (
    auth.uid(), p_customer_name, p_customer_doc, p_customer_iva_cond,
    NULLIF(regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9]', '', 'g'), ''),
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

REVOKE ALL ON FUNCTION public.create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sale(TEXT, NUMERIC, JSONB, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 1b. RPC corto para guardar el teléfono en la venta propia
--     (respaldo por si create_sale no se puede redefinir)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_sale_phone(p_sale_id UUID, p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  UPDATE public.sales
     SET customer_phone = NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '')
   WHERE id = p_sale_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_sale_phone(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sale_phone(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sale_phone(UUID, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 2. Auditoría con autor real
--    Antes: current_setting('app.current_user_id') → siempre NULL.
--    Ahora: auth.uid() (y la variable como respaldo para jobs).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id TEXT;
  v_uuid UUID;
BEGIN
  v_id := COALESCE(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id');
  -- audit_logs.record_id es UUID: si la tabla usa otra PK, se guarda NULL.
  IF v_id IS NOT NULL THEN
    BEGIN
      v_uuid := v_id::uuid;
    EXCEPTION WHEN others THEN
      v_uuid := NULL;
    END;
  END IF;

  INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, user_id)
  VALUES (
    TG_TABLE_NAME,
    v_uuid,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
    COALESCE(auth.uid(), NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Nunca bloquear la operación de negocio por un fallo de auditoría.
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Ventas y productos ya estaban; se suman ingresos y órdenes de compra
-- para poder responder "quién borró este ingreso".
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales', 'products', 'stock_receipts', 'purchase_orders'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()',
        'trg_audit_' || t, t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verificación (todo debe dar true)
-- ============================================================
SELECT 'sales.customer_phone' AS chequeo,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'customer_phone'
       ) AS ok
UNION ALL
SELECT 'RPC set_sale_phone',
       to_regprocedure('public.set_sale_phone(uuid,text)') IS NOT NULL
UNION ALL
SELECT 'create_sale persiste el teléfono',
       position(
         'customer_phone'
         IN pg_get_functiondef('public.create_sale(text,numeric,jsonb,jsonb,text,text,text,text,text,text,numeric,numeric,numeric,text,text)'::regprocedure)
       ) > 0
UNION ALL
SELECT 'audit_trigger usa auth.uid()',
       position('auth.uid()' IN pg_get_functiondef('public.audit_trigger()'::regprocedure)) > 0
UNION ALL
SELECT 'triggers de auditoría (espera 4)',
       (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_audit_%' AND NOT tgisinternal) >= 4;
