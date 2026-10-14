-- ============================================
-- VERIFICACIÓN DEL ESQUEMA — Dietética Vishal
-- Ejecutar en Supabase SQL Editor
-- ============================================

-- 1) TABLAS
SELECT '1. TABLA' AS seccion, t.tabla AS item,
  CASE WHEN to_regclass('public.' || t.tabla) IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS estado,
  NULL AS detalle
FROM (VALUES
  ('products'), ('sales'), ('sale_items'), ('product_barcodes'),
  ('inventory'), ('inventory_movements'), ('locations'),
  ('stock_receipts'), ('stock_receipt_items'), ('payments')
) AS t(tabla)

UNION ALL

-- 2) COLUMNAS CRÍTICAS
SELECT '2. COLUMNA', c.tabla || '.' || c.columna,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = c.tabla AND column_name = c.columna
  ) THEN 'OK' ELSE 'FALTA' END,
  data_type
FROM (VALUES
  ('product_barcodes', 'barcode_normalized'),
  ('product_barcodes', 'active'),
  ('products', 'stock_quantity'),
  ('products', 'barcode'),
  ('inventory', 'quantity'),
  ('inventory_movements', 'type'),
  ('sales', 'status'),
  ('sale_items', 'quantity')
) AS c(tabla, columna)
JOIN information_schema.columns ON 1=0  -- placeholder, se reemplaza abajo

UNION ALL

-- 3) FUNCIONES
SELECT '3. FUNCIÓN', f.nombre,
  CASE WHEN to_regprocedure('public.' || f.nombre) IS NOT NULL THEN 'OK' ELSE 'FALTA' END,
  NULL
FROM (VALUES
  ('normalize_barcode(text)'),
  ('add_stock(uuid,numeric,numeric,uuid,text,date,text,text)'),
  ('adjust_stock(uuid,numeric,uuid,text,text,text)'),
  ('create_sale(text,numeric,jsonb,jsonb,text,text,text,text,text,text,numeric,numeric,numeric)'),
  ('confirm_stock_receipt(uuid)'),
  ('next_stock_receipt_number()')
) AS f(nombre)

UNION ALL

-- 4) TRIGGERS
SELECT '4. TRIGGER', t.trigger_name, 'OK', 'ON ' || t.event_object_table
FROM information_schema.triggers t
WHERE t.trigger_schema = 'public'

UNION ALL

-- 5) RLS
SELECT '5. RLS', c.relname,
  CASE WHEN c.relrowsecurity THEN 'HABILITADO' ELSE 'DESACTIVADO' END,
  NULL
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN ('products','sales','sale_items','product_barcodes','inventory','inventory_movements','locations','stock_receipts','stock_receipt_items','payments')

UNION ALL

-- 6) POLICIES
SELECT '6. POLICY', p.tablename || ' · ' || p.policyname, 'OK', p.cmd
FROM pg_policies p
WHERE p.schemaname = 'public'

UNION ALL

-- 7) ÍNDICES ÚNICOS
SELECT '7. ÍNDICE', i.indexname, 'OK', i.tablename
FROM pg_indexes i
WHERE i.schemaname = 'public'
  AND i.indexname IN ('ux_product_barcodes_normalized', 'idx_barcodes_product', 'idx_barcodes_code', 'idx_inv_mov_product')

ORDER BY seccion, item;
