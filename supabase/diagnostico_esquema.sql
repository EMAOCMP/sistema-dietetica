-- ============================================
-- Dietética Vishal - DIAGNÓSTICO DE ESQUEMA (v2)
-- Pegar en SQL Editor y Run. Copiar y pegar el resultado.
-- No falla aunque falten tablas (usa to_regclass + EXECUTE condicional).
-- ============================================

CREATE TEMP TABLE _diag (objeto text, tipo text, estado text, detalle text);

-- Estado de cada tabla (existencia)
INSERT INTO _diag (objeto, tipo, estado) VALUES
 ('products', 'tabla', CASE WHEN to_regclass('public.products') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('product_barcodes', 'tabla', CASE WHEN to_regclass('public.product_barcodes') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('stock_movements', 'tabla legado', CASE WHEN to_regclass('public.stock_movements') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('locations', 'tabla nueva', CASE WHEN to_regclass('public.locations') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('inventory', 'tabla nueva', CASE WHEN to_regclass('public.inventory') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('inventory_movements', 'tabla nueva', CASE WHEN to_regclass('public.inventory_movements') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('card_brands', 'tabla', CASE WHEN to_regclass('public.card_brands') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('customers', 'tabla', CASE WHEN to_regclass('public.customers') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('suppliers', 'tabla', CASE WHEN to_regclass('public.suppliers') IS NOT NULL THEN 'OK' ELSE 'FALTA' END);

-- Row counts de las que existen (no rompe si falta alguna)
DO $$
BEGIN
  IF to_regclass('public.products') IS NOT NULL THEN
    EXECUTE 'INSERT INTO _diag VALUES (''products'',''count'',''OK'', (SELECT count(*)::text FROM products))';
  END IF;
  IF to_regclass('public.product_barcodes') IS NOT NULL THEN
    EXECUTE 'INSERT INTO _diag VALUES (''product_barcodes'',''count'',''OK'', (SELECT count(*)::text FROM product_barcodes))';
  END IF;
  IF to_regclass('public.stock_movements') IS NOT NULL THEN
    EXECUTE 'INSERT INTO _diag VALUES (''stock_movements'',''count'',''OK'', (SELECT count(*)::text FROM stock_movements))';
  END IF;
  IF to_regclass('public.locations') IS NOT NULL THEN
    EXECUTE 'INSERT INTO _diag VALUES (''locations'',''count'',''OK'', (SELECT count(*)::text FROM locations))';
  END IF;
  IF to_regclass('public.inventory') IS NOT NULL THEN
    EXECUTE 'INSERT INTO _diag VALUES (''inventory'',''count'',''OK'', (SELECT count(*)::text FROM inventory))';
  END IF;
  IF to_regclass('public.inventory_movements') IS NOT NULL THEN
    EXECUTE 'INSERT INTO _diag VALUES (''inventory_movements'',''count'',''OK'', (SELECT count(*)::text FROM inventory_movements))';
  END IF;
  IF to_regclass('public.card_brands') IS NOT NULL THEN
    EXECUTE 'INSERT INTO _diag VALUES (''card_brands'',''count'',''OK'', (SELECT count(*)::text FROM card_brands))';
  END IF;
END $$;

-- Columnas clave de products (vías information_schema, nunca falla)
INSERT INTO _diag (objeto, tipo, estado)
SELECT 'products.' || column_name, 'columna', 'SI'
FROM information_schema.columns
WHERE table_schema='public' AND table_name='products'
  AND column_name IN ('id','name','barcode','stock_quantity','unit_type','min_stock',
                      'cost_price','wholesale_price','retail_price','category',
                      'expiry_date','supplier_id','is_active');

-- Columnas de product_barcodes (si existe)
INSERT INTO _diag (objeto, tipo, estado)
SELECT 'product_barcodes.' || column_name, 'columna', 'SI'
FROM information_schema.columns
WHERE table_schema='public' AND table_name='product_barcodes';

-- Funciones
INSERT INTO _diag (objeto, tipo, estado) VALUES
 ('normalize_barcode', 'funcion', CASE WHEN to_regprocedure('public.normalize_barcode(text)') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('add_stock', 'funcion RPC', CASE WHEN to_regprocedure('public.add_stock(uuid,numeric,numeric,uuid,text,date,text,text)') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('adjust_stock', 'funcion RPC', CASE WHEN to_regprocedure('public.adjust_stock(uuid,numeric,uuid,text,text,text)') IS NOT NULL THEN 'OK' ELSE 'FALTA' END),
 ('sync_products_stock', 'funcion trigger', CASE WHEN to_regprocedure('public.sync_products_stock()') IS NOT NULL THEN 'OK' ELSE 'FALTA' END);

-- Triggers
INSERT INTO _diag (objeto, tipo, estado)
SELECT tgname, 'trigger', 'SI'
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname IN ('trg_barcode_normalized','trg_inventory_sync_product')
  AND NOT t.tgisinternal;

-- Índices
INSERT INTO _diag (objeto, tipo, estado)
SELECT indexname, 'indice', 'SI'
FROM pg_indexes
WHERE schemaname='public' AND indexname IN ('ux_product_barcodes_normalized','idx_barcodes_active');

-- RLS habilitada por tabla
INSERT INTO _diag (objeto, tipo, estado)
SELECT tablename, 'RLS', CASE WHEN rowsecurity THEN 'SI' ELSE 'NO' END
FROM pg_tables
WHERE schemaname='public' AND tablename IN
  ('products','product_barcodes','locations','inventory','inventory_movements');

-- Reporte final
SELECT objeto, tipo, estado, detalle FROM _diag ORDER BY tipo, objeto;
DROP TABLE IF EXISTS _diag;