-- ============================================================
-- Preparación de la prueba — deja solo lo necesario.
-- Borra el proveedor de prueba SOLO si no tiene productos ni OC.
-- No toca usuarios, configuración ni el proveedor real.
-- ============================================================
BEGIN;

DELETE FROM public.suppliers s
WHERE s.name = 'PROVEEDOR PRUEBA'
  AND NOT EXISTS (SELECT 1 FROM public.products p        WHERE p.supplier_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.supplier_id = s.id);

COMMIT;

-- Control: deben quedar "emanuel" y "Distribuidora del Norte"
SELECT name, phone FROM public.suppliers ORDER BY name;
