-- ============================================
-- Dietética Vishal - AUDITORÍA DE ESTRUCTURA (v3)
-- Pegar entero en SQL Editor → Run. Devuelve 4 tablas:
--   1) objetos (tablas/funciones) con OK / FALTA
--   2) políticas RLS por tabla
--   3) columnas de tablas nuevas
--   4) sanidad de datos (duplicados, stock negativo, etc.)
-- No falla aunque falte algo (todo defensivo).
-- ============================================

-- ---------- 1. OBJETOS ----------
CREATE TEMP TABLE _obj (objeto text, tipo text, estado text);

INSERT INTO _obj (objeto, tipo, estado)
SELECT t, 'tabla', CASE WHEN to_regclass('public.'||t) IS NOT NULL THEN 'OK' ELSE '**FALTA**' END
FROM (VALUES
  ('products'),('product_barcodes'),('card_brands'),('customers'),('suppliers'),
  ('locations'),('inventory'),('inventory_movements'),('stock_movements'),
  ('sales'),('sale_items'),('payments'),('stock_receipts'),('stock_receipt_items'),
  ('cash_closes'),('sale_counters'),('profiles')
) AS v(t);

INSERT INTO _obj (objeto, tipo, estado)
SELECT f, 'funcion', CASE WHEN to_regprocedure('public.'||f) IS NOT NULL THEN 'OK' ELSE '**FALTA**' END
FROM (VALUES
  ('normalize_barcode(text)'),
  ('user_role()'),
  ('sync_products_stock()'),
  ('add_stock(uuid,numeric,numeric,uuid,text,date,text,text)'),
  ('adjust_stock(uuid,numeric,uuid,text,text,text)'),
  ('next_stock_receipt_number()'),
  ('create_sale(text,numeric,jsonb,jsonb,text,text,text,text,text,text,numeric,numeric,numeric,text,text)'),
  ('confirm_stock_receipt(uuid,text)'),
  ('cancel_sale(uuid)'),
  ('transfer_stock(uuid,uuid,uuid,numeric,text,text)')
) AS v(f);

-- Firmas viejas que NO deberían quedar (si aparecen = OK 0)
INSERT INTO _obj (objeto, tipo, estado)
SELECT 'create_sale(' || pronargs || ' args)', 'version vieja',
       CASE WHEN pronargs < 15 THEN '**QUITAR**' ELSE 'ok' END
FROM pg_proc WHERE proname = 'create_sale' AND pronamespace = 'public'::regnamespace;

-- ---------- 2. RLS + POLÍTICAS ----------
CREATE TEMP TABLE _rls (tabla text, rls text, politicas int);
INSERT INTO _rls
SELECT c.relname,
       CASE WHEN c.relrowsecurity THEN 'SI' ELSE '**NO**' END,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relname IN ('products','product_barcodes','locations','inventory','inventory_movements',
                    'sales','sale_items','payments','stock_receipts','stock_receipt_items',
                    'cash_closes','sale_counters','card_brands','customers','suppliers',
                    'stock_movements','profiles')
ORDER BY c.relname;

-- ---------- 3. COLUMNAS CLAVE ----------
CREATE TEMP TABLE _col (tabla text, columnas_ok int, columnas_faltan text);
DO $$
DECLARE
  v_ok int; v_missing text;
  spec RECORD;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('sales', ARRAY['id','receipt_number','idempotency_key','status','payment_method','net_amount','iva_amount']),
      ('stock_receipts', ARRAY['id','status','idempotency_key','receipt_number']),
      ('inventory_movements', ARRAY['id','type','previous_quantity','new_quantity','reference_type','reference_id','notes']),
      ('cash_closes', ARRAY['business_date','cash_expected','cash_counted','difference']),
      ('sale_counters', ARRAY['id','last_number']),
      ('inventory', ARRAY['product_id','location_id','quantity'])
    ) AS s(tabla, cols)
  LOOP
    SELECT count(*) INTO v_ok FROM information_schema.columns
    WHERE table_schema='public' AND table_name=spec.tabla AND column_name = ANY(spec.cols);
    SELECT string_agg(t.c, ', ') INTO v_missing FROM unnest(spec.cols) AS t(c)
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns x
                      WHERE x.table_schema='public' AND x.table_name=spec.tabla AND x.column_name=t.c);
    INSERT INTO _col VALUES (spec.tabla, v_ok, COALESCE(v_missing, '-'));
  END LOOP;
END $$;

-- ---------- 4. SANIDAD DE DATOS ----------
CREATE TEMP TABLE _san (chequeo text, resultado text);
DO $$
DECLARE
  n int;
  chk RECORD;
BEGIN
  FOR chk IN
    SELECT * FROM (VALUES
      ('receipts duplicados', 'SELECT count(*) FROM (SELECT receipt_number FROM sales WHERE receipt_number IS NOT NULL GROUP BY receipt_number HAVING count(*)>1) d'),
      ('ventas con stock negativo en inventario', 'SELECT count(*) FROM inventory WHERE quantity < 0'),
      ('movimientos sin producto', 'SELECT count(*) FROM inventory_movements WHERE product_id IS NULL'),
      ('ingresos huérfanos (ítems sin lote)', 'SELECT count(*) FROM stock_receipt_items i JOIN stock_receipts r ON r.id=i.receipt_id WHERE r.status=''confirmed'' AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.reference_type=''stock_receipt'' AND m.reference_id=r.id::text)'),
      ('ventas completadas sin ítems', 'SELECT count(*) FROM sales s WHERE s.status=''completed'' AND NOT EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id=s.id)'),
      ('ubicaciones sin nombre', 'SELECT count(*) FROM locations WHERE name IS NULL OR length(trim(name))=0')
    ) AS s(chequeo, sql)
  LOOP
    EXECUTE chk.sql INTO n;
    INSERT INTO _san VALUES (chk.chequeo,
      CASE WHEN n = 0 THEN 'OK (0)' ELSE '**' || n || ' hallazgos**' END);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _san VALUES ('error al chequear', SQLERRM);
END $$;

-- ---------- REPORTES ----------
SELECT '=== 1. OBJETOS ===' AS seccion;
SELECT * FROM _obj ORDER BY tipo, objeto;
SELECT '=== 2. RLS ===' AS seccion;
SELECT * FROM _rls;
SELECT '=== 3. COLUMNAS ===' AS seccion;
SELECT * FROM _col;
SELECT '=== 4. SANIDAD ===' AS seccion;
SELECT * FROM _san;
