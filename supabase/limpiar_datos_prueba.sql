-- ============================================================
-- Limpieza de datos de prueba — Dietética Vishal
-- Ejecutar en Supabase → SQL Editor.
--
-- Cómo usarlo:
--   1. Correr el bloque 0 para ver qué hay.
--   2. Elegir el bloque que corresponda (1, 2 o 3).
--   3. Ejecutar con ROLLBACK primero y revisar los conteos.
--   4. Si está todo bien, cambiar ROLLBACK por COMMIT.
--
-- No borra usuarios (auth.users / profiles) ni configuración.
-- ============================================================


-- ============================================================
-- 0) VER QUÉ HAY (solo lectura, conteos aproximados)
-- ============================================================
SELECT relname AS tabla,
       n_live_tup AS filas_aprox
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_live_tup DESC, relname;


-- ============================================================
-- 1) BORRAR SOLO MOVIMIENTOS
--    Mantiene productos, clientes, proveedores, precios,
--    categorías, unidades y configuración.
--    Ideal antes de entregar la app si ya cargaste el catálogo.
-- ============================================================
BEGIN;

-- Ventas y cobros
DELETE FROM payments;
DELETE FROM sale_items;
DELETE FROM sales;

-- Ingresos de mercadería y órdenes de compra
DELETE FROM stock_receipt_items;
DELETE FROM stock_receipts;
DELETE FROM purchase_order_items;
DELETE FROM purchase_orders;

-- Movimientos de stock
DELETE FROM stock_movements;
DELETE FROM inventory_movements;

-- Cierres de caja y gastos de prueba
DELETE FROM cash_closes;
DELETE FROM expenses;

-- Numeración (opcional)
UPDATE sale_counters SET last_number = 0 WHERE id = 1;
ALTER SEQUENCE purchase_order_seq RESTART WITH 1;
ALTER SEQUENCE stock_receipt_seq RESTART WITH 1;

-- Verificar el resultado dentro de la transacción
SELECT (SELECT count(*) FROM sales) AS ventas,
       (SELECT count(*) FROM sale_items) AS items_venta,
       (SELECT count(*) FROM stock_receipts) AS ingresos,
       (SELECT count(*) FROM purchase_orders) AS ordenes,
       (SELECT count(*) FROM stock_movements) AS mov_stock;

ROLLBACK;  -- cambiar por COMMIT si los conteos son 0


-- ============================================================
-- 2) DEJAR EL STOCK EN CERO
--    Solo si van a cargar el inventario real desde cero.
--    No toca ventas ni historial: solo cantidades.
-- ============================================================
BEGIN;

UPDATE products SET stock_quantity = 0;
DELETE FROM inventory;

-- Verificación
SELECT count(*) AS productos_con_stock
FROM products
WHERE COALESCE(stock_quantity, 0) <> 0;

ROLLBACK;  -- cambiar por COMMIT


-- ============================================================
-- 3) RESET COMPLETO DEL CATÁLOGO (además del bloque 1)
--    Borra productos, clientes y proveedores de prueba.
--    NO borra: usuarios, categorías, unidades, ubicaciones,
--    medios de pago, IVA, tipos de envío ni configuración de MP.
-- ============================================================
BEGIN;

-- Repetir el bloque 1 primero (o ejecutarlo antes por separado)
DELETE FROM payments;
DELETE FROM sale_items;
DELETE FROM sales;
DELETE FROM stock_receipt_items;
DELETE FROM stock_receipts;
DELETE FROM purchase_order_items;
DELETE FROM purchase_orders;
DELETE FROM stock_movements;
DELETE FROM inventory_movements;
DELETE FROM cash_closes;
DELETE FROM expenses;

-- Catálogo
DELETE FROM product_price_history;
DELETE FROM product_batches;
DELETE FROM product_barcodes;
DELETE FROM inventory;
DELETE FROM products;

DELETE FROM customers;
DELETE FROM suppliers;

-- Verificación
SELECT (SELECT count(*) FROM products) AS productos,
       (SELECT count(*) FROM customers) AS clientes,
       (SELECT count(*) FROM suppliers) AS proveedores;

ROLLBACK;  -- cambiar por COMMIT


-- ============================================================
-- 4) LIMPIAR ONBOARDING (opcional, por usuario de prueba)
--    Hace que los tutoriales vuelvan a aparecer.
-- ============================================================
-- DELETE FROM user_onboarding_progress;


-- ============================================================
-- NO BORRAR (configuración y accesos):
--   profiles, auth.users, user_settings,
--   categories, units, locations,
--   iva_conditions, payment_methods, dispatch_types,
--   transfer_accounts, card_brands, mp_point_config,
--   audit_logs
-- ============================================================
