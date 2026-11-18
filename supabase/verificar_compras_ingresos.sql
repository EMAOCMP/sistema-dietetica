-- ============================================
-- Verificación (SOLO LECTURA) del circuito
-- Orden de compra -> Ingreso de mercadería
-- Ejecutar en SQL Editor. No modifica datos.
-- ============================================

-- 1) Tablas y columnas clave (columnas_clave debe dar el total esperado)
SELECT 'purchase_orders' AS tabla,
       to_regclass('public.purchase_orders') IS NOT NULL AS existe,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='purchase_orders'
           AND column_name IN ('order_number','total_cost','receipt_id','supplier_name')) AS columnas_clave
UNION ALL
SELECT 'purchase_order_items',
       to_regclass('public.purchase_order_items') IS NOT NULL,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='purchase_order_items'
           AND column_name IN ('quantity','unit_cost','received_quantity'))
UNION ALL
SELECT 'stock_receipts',
       to_regclass('public.stock_receipts') IS NOT NULL,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='stock_receipts'
           AND column_name IN ('receipt_number','total_cost','status'))
UNION ALL
SELECT 'stock_receipt_items',
       to_regclass('public.stock_receipt_items') IS NOT NULL,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name='stock_receipt_items'
           AND column_name IN ('quantity','cost_price','lot_number','expiration_date'));

-- 2) Funciones del circuito (deben aparecer todas; anon_puede debe ser false
--    salvo adjust_stock/add_stock, que validan auth.uid() adentro)
SELECT p.proname AS funcion,
       pg_get_function_identity_arguments(p.oid) AS argumentos,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_puede
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
    'create_purchase_order','update_purchase_order','send_purchase_order',
    'cancel_purchase_order','convert_purchase_order_to_receipt',
    'mark_purchase_order_received','next_stock_receipt_number',
    'confirm_stock_receipt','delete_stock_receipt','adjust_stock','add_stock')
ORDER BY p.proname, argumentos;

-- 2b) La versión instalada debe congelar el costo y calcular el total
SELECT prosrc LIKE '%unit_cost%'  AS guarda_unit_cost,
       prosrc LIKE '%total_cost%' AS calcula_total
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname = 'create_purchase_order';

-- 3) Ubicación por defecto y triggers que mantienen el stock sincronizado
SELECT id, name FROM public.locations ORDER BY name;

SELECT tgname AS trigger, tgrelid::regclass AS tabla
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgrelid IN ('public.inventory'::regclass, 'public.products'::regclass)
ORDER BY tabla, trigger;

-- 4) Desincronizados: products.stock_quantity vs SUM(inventory.quantity)
--    Después de la prueba esta consulta debe volver vacía.
SELECT p.name,
       p.stock_quantity,
       COALESCE(SUM(i.quantity), 0) AS inventario,
       ROUND(COALESCE(p.stock_quantity, 0) - COALESCE(SUM(i.quantity), 0), 3) AS diferencia
FROM public.products p
LEFT JOIN public.inventory i ON i.product_id = p.id
GROUP BY p.id, p.name, p.stock_quantity
HAVING ROUND(COALESCE(p.stock_quantity, 0) - COALESCE(SUM(i.quantity), 0), 3) <> 0
ORDER BY ABS(COALESCE(p.stock_quantity, 0) - COALESCE(SUM(i.quantity), 0)) DESC;

-- 5) Resumen del circuito
SELECT
  (SELECT count(*) FROM public.purchase_orders) AS ordenes,
  (SELECT count(*) FROM public.purchase_orders WHERE status = 'draft') AS oc_borrador,
  (SELECT count(*) FROM public.purchase_orders WHERE status = 'sent') AS oc_enviadas,
  (SELECT count(*) FROM public.purchase_orders WHERE status = 'received') AS oc_recibidas,
  (SELECT count(*) FROM public.stock_receipts WHERE status = 'draft') AS ingresos_borrador,
  (SELECT count(*) FROM public.stock_receipts WHERE status = 'confirmed') AS ingresos_confirmados;
