-- Pedido vs recibido en órdenes recibidas (SOLO LECTURA).
-- Sirve para ver faltantes por línea y cuánto costó lo que no llegó.
SELECT po.order_number                                  AS oc,
       r.receipt_number                                 AS ingreso,
       p.name                                           AS producto,
       poi.quantity                                     AS pedido,
       poi.received_quantity                            AS recibido,
       GREATEST(poi.quantity - poi.received_quantity, 0) AS faltante,
       ROUND(GREATEST(poi.quantity - poi.received_quantity, 0)
             * COALESCE(poi.unit_cost, 0), 2)           AS costo_faltante
FROM public.purchase_orders po
JOIN public.purchase_order_items poi ON poi.order_id = po.id
JOIN public.products p               ON p.id = poi.product_id
LEFT JOIN public.stock_receipts r    ON r.id = po.receipt_id
WHERE po.status = 'received'
ORDER BY po.created_at DESC, p.name;
