-- Verificación de la prueba OC -> Ingreso (SOLO LECTURA).
-- Ejecutar después de confirmar el ingreso en la app.
SELECT 'ORDEN' AS documento, po.order_number AS numero, po.status AS estado,
       po.total_cost AS total, po.receipt_id IS NOT NULL AS tiene_ingreso,
       (SELECT count(*) FROM public.purchase_order_items WHERE order_id = po.id) AS items
FROM public.purchase_orders po
WHERE po.supplier_name = 'PROVEEDOR PRUEBA'
UNION ALL
SELECT 'INGRESO', r.receipt_number, r.status, r.total_cost, NULL,
       (SELECT count(*) FROM public.stock_receipt_items WHERE receipt_id = r.id)
FROM public.stock_receipts r
WHERE r.supplier_name = 'PROVEEDOR PRUEBA'
ORDER BY 1;

-- Todos los ingresos: detecta borradores vacíos o duplicados.
SELECT r.receipt_number, r.status, r.supplier_name,
       COALESCE(r.total_cost, 0) AS total,
       (SELECT count(*) FROM public.stock_receipt_items i WHERE i.receipt_id = r.id) AS items,
       r.notes, r.created_at, r.confirmed_at
FROM public.stock_receipts r
ORDER BY r.created_at;

SELECT p.name, p.stock_quantity, p.cost_price, p.min_stock,
       COALESCE((SELECT SUM(i.quantity) FROM public.inventory i
                  WHERE i.product_id = p.id), 0) AS inventario
FROM public.products p
WHERE p.name = 'PRODUCTO PRUEBA OC';

SELECT m.type, m.quantity, m.previous_quantity, m.new_quantity,
       m.reference_type, m.notes, m.created_at
FROM public.inventory_movements m
JOIN public.products p ON p.id = m.product_id
WHERE p.name = 'PRODUCTO PRUEBA OC'
ORDER BY m.created_at;
