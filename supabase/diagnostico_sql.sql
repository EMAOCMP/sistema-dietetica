-- ============================================================
-- DIAGNÓSTICO SQL (SOLO LECTURA) - Dietética Vishal
-- Ejecutar cada bloque por separado y pegar el resultado.
-- No modifica nada.
-- ============================================================


-- ============================================================
-- BLOQUE 1: reporte compacto (funciones, columnas, triggers,
-- policies, secuencias, conteos y stock desincronizado)
-- ============================================================
WITH fns AS (
  SELECT p.proname,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosecdef AS secdef,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
         p.prosrc
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN (
      'create_purchase_order','update_purchase_order','send_purchase_order',
      'cancel_purchase_order','convert_purchase_order_to_receipt',
      'mark_purchase_order_received','compute_replenishment',
      'next_stock_receipt_number','confirm_stock_receipt','delete_stock_receipt',
      'add_stock','adjust_stock','transfer_stock'
    )
),
lineas AS (
  SELECT 0 AS orden, 'TABLA' AS seccion, t AS item,
         CASE WHEN to_regclass('public.' || t) IS NULL THEN 'FALTA' ELSE 'OK' END AS detalle
  FROM unnest(ARRAY['purchase_orders','purchase_order_items','stock_receipts',
                    'stock_receipt_items','inventory','inventory_movements',
                    'products','locations']) AS u(t)

  UNION ALL
  SELECT 1, 'FUNCION', proname || '(' || args || ')',
         'secdef=' || secdef || ' | anon=' || anon || ' | auth=' || auth ||
         ' | unit_cost=' || (prosrc LIKE '%unit_cost%') ||
         ' | total_cost=' || (prosrc LIKE '%total_cost%') ||
         ' | notes=' || (prosrc LIKE '%notes%') AS detalle
  FROM fns

  UNION ALL
  SELECT 2, 'COLUMNA', table_name || '.' || column_name,
         data_type || ' | null=' || is_nullable || ' | default=' || COALESCE(column_default, '-')
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (table_name, column_name) IN (
      ('purchase_orders','order_number'), ('purchase_orders','total_cost'),
      ('purchase_orders','receipt_id'), ('purchase_orders','supplier_name'),
      ('purchase_orders','supplier_id'), ('purchase_orders','status'),
      ('purchase_order_items','unit_cost'), ('purchase_order_items','quantity'),
      ('purchase_order_items','received_quantity'),
      ('stock_receipts','receipt_number'), ('stock_receipts','total_cost'),
      ('stock_receipts','status'), ('stock_receipts','supplier_name'),
      ('inventory_movements','notes'), ('inventory_movements','reference_type'),
      ('inventory_movements','previous_quantity'), ('inventory_movements','new_quantity')
    )

  UNION ALL
  SELECT 3, 'TRIGGER', tgrelid::regclass || ' · ' || tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t
  WHERE NOT tgisinternal
    AND tgrelid IN ('public.inventory'::regclass, 'public.products'::regclass,
                    'public.sales'::regclass, 'public.stock_receipts'::regclass,
                    'public.purchase_orders'::regclass)

  UNION ALL
  SELECT 4, 'POLICY', tablename || ' · ' || policyname,
         cmd || ' | ' || COALESCE(qual, with_check, '-')
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('purchase_orders','purchase_order_items','stock_receipts','stock_receipt_items')

  UNION ALL
  SELECT 5, 'SECUENCIA', sequencename, 'last_value=' || COALESCE(last_value::text, 'sin usar')
  FROM pg_sequences
  WHERE schemaname = 'public' AND sequencename IN ('purchase_order_seq', 'stock_receipt_seq')

  UNION ALL
  SELECT 6, 'CONTEO', 'purchase_orders', count(*)::text FROM public.purchase_orders
  UNION ALL SELECT 6, 'CONTEO', 'purchase_order_items', count(*)::text FROM public.purchase_order_items
  UNION ALL SELECT 6, 'CONTEO', 'stock_receipts', count(*)::text FROM public.stock_receipts
  UNION ALL SELECT 6, 'CONTEO', 'stock_receipt_items', count(*)::text FROM public.stock_receipt_items
  UNION ALL SELECT 6, 'CONTEO', 'inventory_movements', count(*)::text FROM public.inventory_movements
  UNION ALL SELECT 6, 'CONTEO', 'products', count(*)::text FROM public.products
  UNION ALL SELECT 6, 'CONTEO', 'inventory', count(*)::text FROM public.inventory
  UNION ALL SELECT 6, 'CONTEO', 'locations', count(*)::text FROM public.locations

  UNION ALL
  SELECT 7, 'DESINCRONIZADO', p.name,
         'stock=' || COALESCE(p.stock_quantity, 0) || ' | inventario=' || COALESCE(SUM(i.quantity), 0)
  FROM public.products p
  LEFT JOIN public.inventory i ON i.product_id = p.id
  GROUP BY p.id, p.name, p.stock_quantity
  HAVING ROUND(COALESCE(p.stock_quantity, 0) - COALESCE(SUM(i.quantity), 0), 3) <> 0

  UNION ALL
  SELECT 8, 'UBICACION', name, id::text FROM public.locations
)
SELECT seccion, item, detalle
FROM lineas
ORDER BY orden, seccion, item;


-- ============================================================
-- BLOQUE 2: código fuente de las funciones clave
-- (una fila por función; copiá el contenido de la columna codigo)
-- ============================================================
SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS funcion,
       pg_get_functiondef(p.oid) AS codigo
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
    'create_purchase_order',
    'convert_purchase_order_to_receipt',
    'adjust_stock',
    'confirm_stock_receipt'
  )
ORDER BY 1;
