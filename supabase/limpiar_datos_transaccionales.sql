-- ============================================================
-- LIMPIEZA DE DATOS TRANSACCIONALES — Dietética Vishal
-- Para recargar datos reales (productos, ventas, ingresos).
-- Ejecutar en Supabase SQL Editor.
--
-- USAR CON PRECAUCIÓN: borra datos de forma PERMANENTE.
-- Hacer respaldo previo si se quiere conservar algo.
--
-- Tablas CONFIG que NO se tocan:
--   locations, profiles, categories, units, payment_methods,
--   dispatch_types, iva_conditions, card_brands, suppliers, user_settings
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Backup ligero (opcional): contar filas antes de borrar
-- ------------------------------------------------------------
SELECT 'ANTES' AS momento,
       (SELECT count(*) FROM products)              AS products,
       (SELECT count(*) FROM sales)                 AS sales,
       (SELECT count(*) FROM sale_items)            AS sale_items,
       (SELECT count(*) FROM stock_receipts)        AS stock_receipts,
       (SELECT count(*) FROM stock_receipt_items)   AS stock_receipt_items,
       (SELECT count(*) FROM inventory)             AS inventory,
       (SELECT count(*) FROM customers)             AS customers;

-- ------------------------------------------------------------
-- 2. TRUNCATE de tablas transaccionales
--    TRUNCATE en un solo comando ignora FKs entre las tablas
--    listadas y NO dispara triggers a nivel de fila
--    (evita que trg_stock_sale / trg_inventory_sync_product
--    dejen products.stock_quantity con valores fantasma).
-- ------------------------------------------------------------
TRUNCATE
  payments,
  sale_items,
  sales,
  stock_receipt_items,
  stock_receipts,
  inventory_movements,
  inventory,
  product_barcodes,
  product_batches,
  purchase_order_items,
  purchase_orders,
  expenses,
  cash_closes,
  audit_logs,
  customers,
  stock_movements,
  products
RESTART IDENTITY;

-- ------------------------------------------------------------
-- 3. Resetear contadores / secuencias
--    - sale_counters: numeración de tickets de venta (N°)
--    - stock_receipt_seq: numeración de ingresos (ING-000001)
-- ------------------------------------------------------------
UPDATE sale_counters SET last_number = 0 WHERE id = 1;
ALTER SEQUENCE stock_receipt_seq RESTART WITH 1;

-- ------------------------------------------------------------
-- 4. Verificación post-limpieza (debe dar 0 en todo)
-- ------------------------------------------------------------
SELECT 'DESPUÉS' AS momento,
       (SELECT count(*) FROM products)              AS products,
       (SELECT count(*) FROM sales)                 AS sales,
       (SELECT count(*) FROM sale_items)            AS sale_items,
       (SELECT count(*) FROM stock_receipts)        AS stock_receipts,
       (SELECT count(*) FROM stock_receipt_items)   AS stock_receipt_items,
       (SELECT count(*) FROM inventory)             AS inventory,
       (SELECT count(*) FROM customers)             AS customers;

SELECT last_number AS contador_ventas FROM sale_counters WHERE id = 1;
SELECT last_value  AS secuencia_ingresos FROM stock_receipt_seq;

COMMIT;

-- ============================================================
-- NOTAS PARA RECARGAR DATOS
-- ============================================================
-- A) PRODUCTOS: importar desde Productos (CSV/Excel o alta manual).
--    El campo stock_quantity del producto se usa como referencia,
--    pero el stock REAL vivo vive en la tabla `inventory`.
--
-- B) INGRESOS (mercadería recibida): registrarlos desde la vista
--    "Ingreso de mercadería". Al CONFIRMAR, el RPC
--    confirm_stock_receipt llena `inventory` y `inventory_movements`.
--
-- C) VENTAS: registrarlas desde el POS. El RPC create_sale descuenta
--    de `inventory` y registra movimientos.
--
-- D) Si se importan datos crudos (CSV) directo a las tablas y no
--    pasan por los RPCs, hay que poblar `inventory` a mano y luego
--    sincronizar products.stock_quantity con:
--      UPDATE products p
--      SET stock_quantity = COALESCE(
--        (SELECT SUM(i.quantity) FROM inventory i WHERE i.product_id = p.id), 0);
--
-- E) Verificación final: reusar supabase/auditoria_estructura.sql
--    (chequea stock negativo, ingresos huérfanos, ventas sin ítems).
-- ============================================================
