-- LIMPIEZA DE INGRESO DE MERCADERÍA (para rehacer la prueba OC -> Ingreso)
-- Borra SOLO ingresos NO confirmados de la prueba y borradores vacíos.
-- No toca stock, movimientos ni productos. Idempotente.
--
-- Nota: en el SQL Editor auth.uid() es NULL, así que delete_stock_receipt()
-- falla con "No autorizado". Por eso acá se borra con SQL directo.
BEGIN;

-- 1) Qué se va a borrar: borradores de la prueba o vacíos sin proveedor.
CREATE TEMP TABLE tmp_limpiar ON COMMIT DROP AS
SELECT r.id
FROM public.stock_receipts r
WHERE r.status <> 'confirmed'
  AND (
    r.notes ILIKE 'Generado desde OC-%'
    OR r.supplier_name = 'PROVEEDOR PRUEBA'
    OR (r.supplier_name IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.stock_receipt_items i
                        WHERE i.receipt_id = r.id))
  );

-- 2) Ítems primero (por si la FK no tuviera ON DELETE CASCADE).
DELETE FROM public.stock_receipt_items i
WHERE i.receipt_id IN (SELECT id FROM tmp_limpiar);

-- 3) Ingresos no confirmados.
DELETE FROM public.stock_receipts r
WHERE r.id IN (SELECT id FROM tmp_limpiar);

-- 4) Dejar la OC de prueba lista para volver a recibir.
--    (Si el ingreso ya estaba confirmado, esto no la toca.)
UPDATE public.purchase_orders po
SET status = 'sent', receipt_id = NULL, received_at = NULL, updated_at = now()
WHERE po.supplier_name = 'PROVEEDOR PRUEBA'
  AND po.status <> 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM public.stock_receipts r WHERE r.id = po.receipt_id);

-- 5) Refrescar el cache de PostgREST (hubo DROP/CREATE de funciones).
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Verificación: la OC debe quedar en 'sent' y sin ingreso asociado.
SELECT po.order_number, po.status, po.receipt_id, po.total_cost
FROM public.purchase_orders po
WHERE po.supplier_name = 'PROVEEDOR PRUEBA'
ORDER BY po.created_at;
