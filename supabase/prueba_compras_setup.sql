-- ============================================
-- Datos de prueba: Orden de compra -> Ingreso
-- Ejecutar en SQL Editor. Se puede repetir sin duplicar.
-- Crea un proveedor y un producto con stock 0 y mínimo 5.
-- ============================================

INSERT INTO public.suppliers (name, phone, lead_time_days)
SELECT 'PROVEEDOR PRUEBA', '3435550000', 7
WHERE NOT EXISTS (
  SELECT 1 FROM public.suppliers WHERE name = 'PROVEEDOR PRUEBA'
);

INSERT INTO public.products
  (name, category, unit_type, cost_price, wholesale_price, retail_price,
   stock_quantity, min_stock, supplier_id, is_active)
SELECT 'PRODUCTO PRUEBA OC', 'General', 'unit', 1000, 1500, 1800,
       0, 5, s.id, true
FROM public.suppliers s
WHERE s.name = 'PROVEEDOR PRUEBA'
  AND NOT EXISTS (
    SELECT 1 FROM public.products WHERE name = 'PRODUCTO PRUEBA OC'
  );

SELECT p.name, p.stock_quantity, p.min_stock, s.name AS proveedor
FROM public.products p
LEFT JOIN public.suppliers s ON s.id = p.supplier_id
WHERE p.name = 'PRODUCTO PRUEBA OC';
