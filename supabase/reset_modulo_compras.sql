-- ============================================================
-- RESET de Compras e Ingreso de mercadería (para rehacer la prueba)
--   ⚠️ Borra TODOS los documentos de esos dos módulos.
--      No borra productos, proveedores, ventas ni usuarios.
-- Ejecutar en SQL Editor. Idempotente.
-- ============================================================
BEGIN;

-- 1) Órdenes de compra (ítems primero)
DELETE FROM public.purchase_order_items;
DELETE FROM public.purchase_orders;

-- 2) Ingresos de mercadería (ítems primero)
DELETE FROM public.stock_receipt_items;
DELETE FROM public.stock_receipts;

-- 3) Producto de prueba: stock e historial en cero
DELETE FROM public.inventory_movements m
WHERE m.product_id IN (
  SELECT p.id FROM public.products p WHERE p.name = 'PRODUCTO PRUEBA OC');

DELETE FROM public.inventory i
WHERE i.product_id IN (
  SELECT p.id FROM public.products p WHERE p.name = 'PRODUCTO PRUEBA OC');

-- El trigger trg_inventory_sync_product deja stock_quantity en 0 al borrar
-- las filas de inventory. Igual se fija explícito para no depender de eso.
UPDATE public.products p
SET stock_quantity = 0, cost_price = 1000, updated_at = now()
WHERE p.name = 'PRODUCTO PRUEBA OC';

-- 4) Numeración desde cero: OC-000001 / ING-000001
ALTER SEQUENCE public.purchase_order_seq RESTART WITH 1;
ALTER SEQUENCE public.stock_receipt_seq  RESTART WITH 1;

-- 5) Refrescar cache de PostgREST
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verificación: todo debe quedar en 0.
SELECT
  (SELECT count(*) FROM public.purchase_orders)       AS ordenes,
  (SELECT count(*) FROM public.purchase_order_items)  AS ordenes_items,
  (SELECT count(*) FROM public.stock_receipts)        AS ingresos,
  (SELECT count(*) FROM public.stock_receipt_items)   AS ingresos_items,
  (SELECT count(*) FROM public.products p
    WHERE p.name = 'PRODUCTO PRUEBA OC' AND p.stock_quantity = 0) AS producto_en_cero;
