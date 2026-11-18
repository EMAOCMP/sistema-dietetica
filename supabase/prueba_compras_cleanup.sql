-- ============================================
-- Limpieza: datos de prueba Orden de compra -> Ingreso
-- Ejecutar al terminar. Borra SOLO lo creado por la prueba.
-- ============================================

BEGIN;

DO $$
DECLARE
  v_prod UUID;
  v_sup  UUID;
BEGIN
  SELECT id INTO v_prod FROM public.products  WHERE name = 'PRODUCTO PRUEBA OC' LIMIT 1;
  SELECT id INTO v_sup  FROM public.suppliers WHERE name = 'PROVEEDOR PRUEBA'   LIMIT 1;

  IF v_prod IS NOT NULL THEN
    DELETE FROM public.stock_receipt_items   WHERE product_id = v_prod;
    DELETE FROM public.inventory_movements   WHERE product_id = v_prod;
    DELETE FROM public.inventory             WHERE product_id = v_prod;
    DELETE FROM public.purchase_order_items  WHERE product_id = v_prod;
  END IF;

  -- Órdenes e ingresos de la prueba (supplier_name queda denormalizado)
  DELETE FROM public.stock_receipt_items
  WHERE receipt_id IN (
    SELECT id FROM public.stock_receipts WHERE supplier_name = 'PROVEEDOR PRUEBA'
  );
  DELETE FROM public.purchase_orders  WHERE supplier_name = 'PROVEEDOR PRUEBA';
  DELETE FROM public.stock_receipts   WHERE supplier_name = 'PROVEEDOR PRUEBA';

  IF v_prod IS NOT NULL THEN
    DELETE FROM public.products WHERE id = v_prod;
  END IF;
  IF v_sup IS NOT NULL THEN
    DELETE FROM public.suppliers WHERE id = v_sup;
  END IF;
END $$;

COMMIT;
