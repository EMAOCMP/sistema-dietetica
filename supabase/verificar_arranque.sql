-- Chequeo de arranque (SOLO LECTURA) — devuelve una sola tabla.
-- Esperado con la base limpia:
--   usuarios = 1 | perfiles admin = 1 | stock desincronizado = 0
--   productos, ventas, ingresos, OC, inventario = 0
--   próximo ticket / OC / ingreso = 1
SELECT 'usuarios' AS chequeo,
       (SELECT count(*) FROM auth.users)::text AS valor
UNION ALL SELECT 'perfiles admin',
       (SELECT count(*) FROM public.profiles WHERE role = 'admin')::text
UNION ALL SELECT 'email admin',
       COALESCE((SELECT string_agg(email, ', ') FROM public.profiles WHERE role = 'admin'), '(ninguno)')
UNION ALL SELECT 'ubicaciones',
       (SELECT count(*) FROM public.locations)::text
UNION ALL SELECT 'medios de pago',
       (SELECT count(*) FROM public.payment_methods)::text
UNION ALL SELECT 'categorias',
       (SELECT count(*) FROM public.categories)::text
UNION ALL SELECT 'unidades',
       (SELECT count(*) FROM public.units)::text
UNION ALL SELECT 'proveedores',
       (SELECT count(*) FROM public.suppliers)::text
UNION ALL SELECT 'productos',
       (SELECT count(*) FROM public.products)::text
UNION ALL SELECT 'clientes',
       (SELECT count(*) FROM public.customers)::text
UNION ALL SELECT 'ventas',
       (SELECT count(*) FROM public.sales)::text
UNION ALL SELECT 'ingresos',
       (SELECT count(*) FROM public.stock_receipts)::text
UNION ALL SELECT 'ordenes de compra',
       (SELECT count(*) FROM public.purchase_orders)::text
UNION ALL SELECT 'filas de inventario',
       (SELECT count(*) FROM public.inventory)::text
UNION ALL SELECT 'stock desincronizado',
       (SELECT count(*) FROM (
          SELECT p.id
            FROM public.products p
            LEFT JOIN (
              SELECT product_id, SUM(quantity) AS q
                FROM public.inventory
               GROUP BY product_id
            ) i ON i.product_id = p.id
           WHERE COALESCE(i.q, 0) <> COALESCE(p.stock_quantity, 0)
        ) d)::text
UNION ALL SELECT 'proximo ticket',
       (COALESCE((SELECT last_number FROM public.sale_counters WHERE id = 1), 0) + 1)::text
UNION ALL SELECT 'proxima OC',
       (last_value + CASE WHEN is_called THEN 1 ELSE 0 END)::text
  FROM public.purchase_order_seq
UNION ALL SELECT 'proximo ingreso',
       (last_value + CASE WHEN is_called THEN 1 ELSE 0 END)::text
  FROM public.stock_receipt_seq;
