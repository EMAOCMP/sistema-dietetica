-- ============================================================
-- VERIFICADOR FLUJO MP (venta dirigida por pago)
-- Ejecutar en: SQL Editor de Supabase. Idempotente / sin datos residuales.
--
-- PART A → tabla de estructura (✅ / ❌ / ⚠️)
-- PART B → smoke test de los 3 RPCs: crea pendiente → verifica stock
--           intacto → finaliza (stock descontado + comprobante) →
--           idempotencia → cancela. Devuelve una TABLA de resultados
--           y todo se revierte con ROLLBACK.
-- ============================================================

-- ============ PART A — ESTRUCTURA (solo lectura) ============
SELECT orden, area, chequeo, estado, detalle
FROM (
  -- 1) Columnas mp_* en sales (espera 7)
  SELECT 1 AS orden, 'MP' AS area, 'Columnas mp_* en sales (espera 7)' AS chequeo,
         CASE WHEN COUNT(*) = 7 THEN '✅ OK'
              ELSE '❌ FALTAN ' || (7 - COUNT(*)) || '/7 — correr mp_pending_sale_flow.sql' END AS estado,
         COALESCE(STRING_AGG(column_name, ', ' ORDER BY column_name), 'ninguna') AS detalle
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sales'
    AND column_name IN ('mp_auth','mp_link','mp_preference_id','mp_status','mp_external_ref','mp_payment_id','mp_status_detail')

  UNION ALL
  -- 2) discount_amount
  SELECT 2, 'MP', 'sales.discount_amount', CASE WHEN COUNT(*)=1 THEN '✅ OK' ELSE '❌ FALTA' END,
         'para totales con descuento'
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='sales' AND column_name='discount_amount'

  UNION ALL
  -- 3) RPCs nuevos del flujo
  SELECT 3, 'RPC', 'RPCs MP (espera 3): create/finalize/cancel',
         CASE WHEN COUNT(*)=3 THEN '✅ OK' ELSE '❌ FALTAN ' || (3-COUNT(*)) || '/3 — correr mp_pending_sale_flow.sql' END,
         COALESCE(STRING_AGG(p.proname, ', ' ORDER BY p.proname), 'ninguna')
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('create_mp_pending_sale','finalize_mp_sale','cancel_mp_sale')

  UNION ALL
  -- 4) RPCs base (create_sale / cancel_sale)
  SELECT 4, 'RPC', 'RPC base (create_sale, cancel_sale)',
         CASE WHEN COUNT(*)=2 THEN '✅ OK' ELSE '⚠️ FALTAN ' || (2-COUNT(*)) || '/2' END,
         'checkout normal'
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('create_sale','cancel_sale')

  UNION ALL
  -- 5) Tablas requeridas (cuenta las que FALTAN)
  SELECT 5, 'Base', 'Tablas requeridas (espera 7)',
         CASE WHEN COUNT(*)=0 THEN '✅ OK' ELSE '❌ FALTAN ' || COUNT(*) || '/7: ' ||
              STRING_AGG(t, ', ') END,
         'sales, sale_items, payments, inventory, inventory_movements, locations, sale_counters'
  FROM (SELECT unnest(ARRAY['sales','sale_items','payments','inventory','inventory_movements','locations','sale_counters']) AS t) x
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables it
    WHERE it.table_schema='public' AND it.table_name=x.t)

  UNION ALL
  -- 6) Realtime en sales (el POS escucha cambios de estado)
  SELECT 6, 'Realtime', 'sales en publicación supabase_realtime',
         CASE WHEN COUNT(*)=1 THEN '✅ OK' ELSE '❌ NO — correr realtime_sales.sql' END,
         'necesario para el aviso "Pago aprobado" en el POS'
  FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sales'

  UNION ALL
  -- 7) Restricciones CHECK en sales que puedan bloquear estados
  SELECT 7, 'MP', 'Sin CHECK que bloquee pending_payment / mercadopago',
         CASE WHEN COUNT(*)=0 THEN '✅ OK' ELSE '⚠️ REVISAR: ' || COUNT(*) || ' constraint(s)' END,
         COALESCE(STRING_AGG(conname || ' → ' || pg_get_constraintdef(oid), ' | ' ORDER BY conname), 'ninguna')
  FROM pg_constraint
  WHERE conrelid='public.sales'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) ~* 'status|payment_method'

  UNION ALL
  -- 8) Location 'Local principal' (finalize descuenta ahí)
  SELECT 8, 'Base', 'Location "Local principal" (destino del stock)',
         CASE WHEN COUNT(*)>=1 THEN '✅ OK' ELSE '⚠️ FALTA — finalize no descontaría stock' END,
         'usada por finalize_mp_sale'
  FROM locations WHERE name='Local principal'

  UNION ALL
  -- 9) SECURITY DEFINER en los RPCs nuevos
  SELECT 9, 'RPC', 'RPCs nuevos con SECURITY DEFINER',
         CASE WHEN COUNT(*)=3 THEN '✅ OK' ELSE '⚠️ ' || COUNT(*) || '/3 (puede fallar por RLS)' END,
         'acceso a tablas más allá del RLS'
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('create_mp_pending_sale','finalize_mp_sale','cancel_mp_sale')
    AND p.prosecdef

  UNION ALL
  -- 10) Índice para que el webhook encuentre la venta
  SELECT 10, 'MP', 'Índice sales.mp_external_ref',
         CASE WHEN COUNT(*)>=1 THEN '✅ OK' ELSE '⚠️ FALTA (lento, no bloquea)' END,
         'lookup del webhook'
  FROM pg_indexes
  WHERE schemaname='public' AND tablename='sales' AND indexname='idx_sales_mp_external_ref'
) a
ORDER BY orden;

-- ============================================================
-- PART B — SMOKE TEST → TABLA DE RESULTADOS (todo se revierte)
-- ============================================================
BEGIN;

DROP TABLE IF EXISTS pg_temp.smoke_results;
CREATE TEMP TABLE smoke_results (paso text, detalle text) ON COMMIT DROP;

DO $$
DECLARE
  v_user uuid; v_product uuid; v_loc uuid; v_key text;
  v_pending uuid; v_pending2 uuid; v_dup uuid;
  v_status text; v_receipt text; v_mp_status text;
  v_s0 numeric; v_s1 numeric; v_s2 numeric; v_s3 numeric;
  v_n_items int; v_n_pay int; v_n_move int;
BEGIN
  -- 0) Preparación
  BEGIN
    SELECT id INTO v_user FROM auth.users ORDER BY created_at LIMIT 1;
    IF v_user IS NULL THEN RAISE EXCEPTION 'No hay usuarios en auth.users'; END IF;
    SELECT id INTO v_product FROM products ORDER BY id LIMIT 1;
    IF v_product IS NULL THEN RAISE EXCEPTION 'No hay productos para probar'; END IF;
    SELECT id INTO v_loc FROM locations WHERE name='Local principal' LIMIT 1;
    IF v_loc IS NULL THEN RAISE EXCEPTION 'Falta location "Local principal"'; END IF;

    PERFORM set_config('request.jwt.claims',
           json_build_object('sub', v_user::text, 'role','authenticated')::text, true);

    INSERT INTO inventory (product_id, location_id, quantity)
    VALUES (v_product, v_loc, 10)
    ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = GREATEST(inventory.quantity, 10);
    SELECT quantity INTO v_s0 FROM inventory WHERE product_id=v_product AND location_id=v_loc;

    INSERT INTO smoke_results VALUES
      ('0) Preparación', 'OK — producto con stock inicial = ' || v_s0 || ' (se revierte)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO smoke_results VALUES ('0) Preparación', '❌ FALLÓ: ' || SQLERRM); RETURN;
  END;

  -- 1) Crear pendiente: NO debe tocar stock ni comprobante
  --    (con montos, igual que lo manda el POS)
  BEGIN
    v_key := 'smoke-' || gen_random_uuid();
    SELECT sale_id INTO v_pending FROM create_mp_pending_sale(
      p_customer_name   := 'SMOKE TEST (se revierte)',
      p_total_amount    := 10,
      p_items           := jsonb_build_array(jsonb_build_object(
                              'product_id', v_product, 'quantity', 2, 'unit_price', 5, 'cost_price', 4)),
      p_net_amount      := 8.26,
      p_iva_amount      := 1.74,
      p_profit_amount   := 3,
      p_idempotency_key := v_key,
      p_mp_external_ref := 'SMOKE-' || gen_random_uuid()
    );
    IF v_pending IS NULL THEN RAISE EXCEPTION 'no devolvió sale_id'; END IF;

    SELECT status, receipt_number INTO v_status, v_receipt
    FROM sales WHERE id=v_pending;
    IF v_status <> 'pending_payment' THEN
      RAISE EXCEPTION 'esperaba pending_payment, llegó: %', v_status; END IF;
    IF v_receipt IS NOT NULL THEN
      RAISE EXCEPTION 'no debe tener comprobante, llegó: %', v_receipt; END IF;

    SELECT quantity INTO v_s1 FROM inventory WHERE product_id=v_product AND location_id=v_loc;
    IF v_s1 <> v_s0 THEN
      RAISE EXCEPTION 'el stock SÍ cambió al crear pendiente: % -> %', v_s0, v_s1; END IF;

    SELECT COUNT(*) INTO v_n_items FROM sale_items WHERE sale_id=v_pending;
    INSERT INTO smoke_results VALUES
      ('1) Crear pendiente (sin tocar stock)',
       'OK — pending_payment, comprobante NULL, ítems=' || v_n_items ||
       ', stock intacto=' || v_s1);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO smoke_results VALUES ('1) Crear pendiente', '❌ FALLÓ: ' || SQLERRM); RETURN;
  END;

  -- 2) Idempotencia de creación
  BEGIN
    SELECT sale_id INTO v_dup FROM create_mp_pending_sale(
      p_customer_name := 'SMOKE DUP', p_total_amount := 10,
      p_items := jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2,'unit_price',5)),
      p_idempotency_key := v_key);
    IF v_dup IS DISTINCT FROM v_pending THEN
      RAISE EXCEPTION 'creó venta duplicada %', v_dup; END IF;
    SELECT COUNT(*) INTO v_n_items FROM sales WHERE idempotency_key=v_key;
    IF v_n_items <> 1 THEN RAISE EXCEPTION 'debe haber 1 venta con ese key, hay %', v_n_items; END IF;
    INSERT INTO smoke_results VALUES
      ('2) Idempotencia al crear', 'OK — mismo key = misma venta (sin duplicado)');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO smoke_results VALUES ('2) Idempotencia al crear', '❌ FALLÓ: ' || SQLERRM); RETURN;
  END;

  -- 3) Finalizar (aprobar): descuenta stock una vez + comprobante + pago
  BEGIN
    IF NOT finalize_mp_sale(v_pending) THEN RAISE EXCEPTION 'devolvió false'; END IF;
    SELECT status, receipt_number, mp_status INTO v_status, v_receipt, v_mp_status
    FROM sales WHERE id=v_pending;
    IF v_status <> 'completed' OR v_mp_status <> 'approved' OR v_receipt IS NULL THEN
      RAISE EXCEPTION 'incorrecto: status=% mp=% receipt=%', v_status, v_mp_status, v_receipt; END IF;
    SELECT quantity INTO v_s2 FROM inventory WHERE product_id=v_product AND location_id=v_loc;
    IF v_s2 <> v_s0 - 2 THEN
      RAISE EXCEPTION 'stock mal descontado: esperaba %, hay %', v_s0-2, v_s2; END IF;
    SELECT COUNT(*) INTO v_n_pay FROM payments WHERE sale_id=v_pending AND method='mercadopago';
    SELECT COUNT(*) INTO v_n_move FROM inventory_movements
      WHERE reference_type='sale' AND reference_id=v_pending::text;
    IF v_n_pay = 0 THEN RAISE EXCEPTION 'no se registró el pago'; END IF;
    INSERT INTO smoke_results VALUES
      ('3) Finalizar (aprobar)',
       'OK — completed/approved, comprobante=' || v_receipt ||
       ', stock ' || v_s0 || ' → ' || v_s2 || ', pagos=' || v_n_pay ||
       ', movimientos=' || v_n_move);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO smoke_results VALUES ('3) Finalizar (aprobar)', '❌ FALLÓ: ' || SQLERRM); RETURN;
  END;

  -- 4) Finalizar 2ª vez: NO debe descontar de nuevo
  BEGIN
    IF NOT finalize_mp_sale(v_pending) THEN RAISE EXCEPTION '2ª vez devolvió false'; END IF;
    SELECT quantity INTO v_s3 FROM inventory WHERE product_id=v_product AND location_id=v_loc;
    IF v_s3 <> v_s2 THEN RAISE EXCEPTION 'hubo DOBLE descuento: % → %', v_s2, v_s3; END IF;
    INSERT INTO smoke_results VALUES
      ('4) Finalizar 2ª vez (idempotente)', 'OK — no descontó dos veces (stock=' || v_s3 || ')');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO smoke_results VALUES ('4) Finalizar 2ª vez (idempotente)', '❌ FALLÓ: ' || SQLERRM); RETURN;
  END;

  -- 5) Rechazar: cancelar otro pendiente sin tocar stock
  BEGIN
    SELECT sale_id INTO v_pending2 FROM create_mp_pending_sale(
      p_customer_name := 'SMOKE RECHAZO', p_total_amount := 7,
      p_items := jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1,'unit_price',7)),
      p_idempotency_key := 'smoke-' || gen_random_uuid());
    IF NOT cancel_mp_sale(v_pending2) THEN RAISE EXCEPTION 'devolvió false'; END IF;
    SELECT status, mp_status INTO v_status, v_mp_status FROM sales WHERE id=v_pending2;
    IF v_status <> 'cancelled' OR v_mp_status <> 'rejected' THEN
      RAISE EXCEPTION 'incorrecto: status=% mp=%', v_status, v_mp_status; END IF;
    SELECT quantity INTO v_s3 FROM inventory WHERE product_id=v_product AND location_id=v_loc;
    IF v_s3 <> v_s2 THEN RAISE EXCEPTION 'cancelar tocó el stock: % → %', v_s2, v_s3; END IF;
    INSERT INTO smoke_results VALUES
      ('5) Cancelar (rechazo)',
       'OK — creada SIN montos (COALESCE) → cancelled/rejected, stock intacto=' || v_s3);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO smoke_results VALUES ('5) Cancelar (rechazo)', '❌ FALLÓ: ' || SQLERRM); RETURN;
  END;

  -- 6) Resumen
  INSERT INTO smoke_results VALUES
    ('6) Resultado', '✅ SMOKE TEST OK — todo se revierte con ROLLBACK');
END $$;

SELECT paso, detalle FROM smoke_results ORDER BY paso;

ROLLBACK;
