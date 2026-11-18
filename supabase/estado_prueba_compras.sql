-- Estado final de la prueba OC -> Ingreso (SOLO LECTURA).
-- Devuelve una sola fila con OC, ingreso, stock y movimiento.
SELECT po.order_number            AS oc,
       po.status                  AS oc_estado,
       r.receipt_number           AS ingreso,
       r.status                   AS ingreso_estado,
       r.total_cost               AS total,
       p.name                     AS producto,
       p.stock_quantity           AS stock,
       COALESCE((SELECT SUM(i.quantity) FROM public.inventory i
                  WHERE i.product_id = p.id), 0) AS inventario,
       p.cost_price               AS costo,
       (SELECT count(*) FROM public.inventory_movements m
         WHERE m.product_id = p.id
           AND m.reference_type = 'stock_receipt') AS movimientos
FROM public.purchase_orders po
JOIN public.stock_receipts r      ON r.id = po.receipt_id
JOIN public.stock_receipt_items s ON s.receipt_id = r.id
JOIN public.products p            ON p.id = s.product_id
WHERE po.supplier_name = 'PROVEEDOR PRUEBA';
