-- ============================================================
-- Verificación de la demo (SOLO LECTURA) — una sola tabla.
-- Correr después de cada bloque de la prueba.
-- Esperado al final del guion:
--   ventas completadas = 3 · anuladas = 1
--   total vendido = 103620 · efectivo = 54620 · transferencia = 49000
--   stock desincronizado = 0
--   última OC = OC-000001 · estado = received
--   OC estimado = 32500 · real = 23500 · faltante = 1
-- ============================================================
WITH v AS (
  SELECT count(*) FILTER (WHERE status = 'completed')   AS ok,
         count(*) FILTER (WHERE status = 'cancelled')   AS anul,
         COALESCE(sum(total_amount) FILTER (WHERE status = 'completed'), 0) AS total,
         COALESCE(sum(total_amount) FILTER (WHERE status = 'completed'
                    AND payment_method = 'cash'), 0)     AS cash,
         COALESCE(sum(total_amount) FILTER (WHERE status = 'completed'
                    AND payment_method = 'transfer'), 0) AS tr,
         COALESCE(sum(total_amount) FILTER (WHERE status = 'completed'
                    AND payment_method = 'card'), 0)     AS card
  FROM public.sales
),
p AS (
  SELECT count(*) AS prod,
         COALESCE(sum(stock_quantity), 0) AS unidades,
         count(*) FILTER (WHERE COALESCE(stock_quantity, 0)
                              <= COALESCE(min_stock, 5))  AS bajo
  FROM public.products
  WHERE COALESCE(is_active, true)
),
d AS (
  SELECT count(*) AS filas FROM (
    SELECT p.id
    FROM public.products p
    LEFT JOIN (SELECT product_id, sum(quantity) AS q
                 FROM public.inventory GROUP BY 1) i ON i.product_id = p.id
    WHERE ROUND(COALESCE(p.stock_quantity, 0) - COALESCE(i.q, 0), 3) <> 0
  ) x
)
SELECT 'ventas completadas' AS chequeo, v.ok::text AS valor FROM v
UNION ALL SELECT 'ventas anuladas',      v.anul::text FROM v
UNION ALL SELECT 'total vendido',        ROUND(v.total, 2)::text FROM v
UNION ALL SELECT 'efectivo',             ROUND(v.cash, 2)::text FROM v
UNION ALL SELECT 'transferencia',        ROUND(v.tr, 2)::text FROM v
UNION ALL SELECT 'tarjeta',              ROUND(v.card, 2)::text FROM v
UNION ALL SELECT 'productos',            p.prod::text FROM p
UNION ALL SELECT 'stock total',          p.unidades::text FROM p
UNION ALL SELECT 'bajo minimo',          p.bajo::text FROM p
UNION ALL SELECT 'stock desincronizado', d.filas::text FROM d
UNION ALL SELECT 'ultima OC',
       COALESCE((SELECT order_number FROM public.purchase_orders
                  ORDER BY created_at DESC LIMIT 1), '(ninguna)')
UNION ALL SELECT 'estado OC',
       COALESCE((SELECT status FROM public.purchase_orders
                  ORDER BY created_at DESC LIMIT 1), '-')
UNION ALL SELECT 'OC estimado',
       COALESCE((SELECT ROUND(total_cost, 2)::text FROM public.purchase_orders
                  ORDER BY created_at DESC LIMIT 1), '0')
UNION ALL SELECT 'OC real recibido',
       COALESCE((SELECT ROUND(r.total_cost, 2)::text
                   FROM public.purchase_orders po
                   JOIN public.stock_receipts r ON r.id = po.receipt_id
                  ORDER BY po.created_at DESC LIMIT 1), '0')
UNION ALL SELECT 'OC faltante (unidades)',
       COALESCE((SELECT sum(GREATEST(poi.quantity
                          - COALESCE(poi.received_quantity, 0), 0))::text
                   FROM public.purchase_order_items poi
                  WHERE poi.order_id = (SELECT id FROM public.purchase_orders
                                         ORDER BY created_at DESC LIMIT 1)), '0');
