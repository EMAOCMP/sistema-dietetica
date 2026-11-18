-- ============================================
-- Reconciliación de inventario - Dietética Vishal
-- Ejecutar en SQL Editor. Idempotente (correr dos veces no cambia nada).
--
-- Regla: NO cambia el stock que ves en la app.
-- Toma products.stock_quantity como verdad (es el número que usás y
-- muestran los reportes) y alinea inventory, que es la fuente del
-- modelo nuevo. Deja un movimiento 'adjustment' por cada corrección.
-- ============================================

BEGIN;

DO $$
DECLARE
  v_loc  UUID;
  r      RECORD;
  v_prev NUMERIC;
  v_new  NUMERIC;
  v_fix  INT := 0;
BEGIN
  SELECT id INTO v_loc FROM public.locations WHERE name = 'Local principal' LIMIT 1;
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'No existe la ubicación "Local principal"';
  END IF;

  FOR r IN
    SELECT p.id AS pid,
           COALESCE(p.stock_quantity, 0) AS target,
           COALESCE((SELECT SUM(i.quantity) FROM public.inventory i
                      WHERE i.product_id = p.id), 0) AS current
    FROM public.products p
    WHERE ROUND(COALESCE(p.stock_quantity, 0)
          - COALESCE((SELECT SUM(i.quantity) FROM public.inventory i
                       WHERE i.product_id = p.id), 0), 3) <> 0
  LOOP
    INSERT INTO public.inventory (product_id, location_id, quantity)
    VALUES (r.pid, v_loc, 0)
    ON CONFLICT (product_id, location_id) DO NOTHING;

    SELECT quantity INTO v_prev FROM public.inventory
    WHERE product_id = r.pid AND location_id = v_loc
    FOR UPDATE;

    -- Corrige solo el faltante en Local principal y nunca deja negativo.
    v_new := GREATEST(v_prev + (r.target - r.current), 0);
    IF v_new = v_prev THEN CONTINUE; END IF;

    UPDATE public.inventory
       SET quantity = v_new, updated_at = now()
     WHERE product_id = r.pid AND location_id = v_loc;

    INSERT INTO public.inventory_movements
      (product_id, location_id, type, quantity, previous_quantity, new_quantity,
       reference_type, reference_id, user_id, notes)
    VALUES (r.pid, v_loc, 'adjustment', v_new - v_prev, v_prev, v_new,
            'migration', 'reconciliacion', NULL,
            'Reconciliación: inventario alineado con el stock visible');

    v_fix := v_fix + 1;
  END LOOP;

  RAISE NOTICE 'Productos corregidos: %', v_fix;
END $$;

-- Red de seguridad: sincroniza products.stock_quantity con inventory.
UPDATE public.products p
   SET stock_quantity = COALESCE((
         SELECT SUM(i.quantity) FROM public.inventory i WHERE i.product_id = p.id
       ), 0)
 WHERE p.stock_quantity IS DISTINCT FROM COALESCE((
         SELECT SUM(i.quantity) FROM public.inventory i WHERE i.product_id = p.id
       ), 0);

COMMIT;

-- Resultado: debe devolver 0 filas.
SELECT p.name,
       p.stock_quantity,
       COALESCE(SUM(i.quantity), 0) AS inventario
FROM public.products p
LEFT JOIN public.inventory i ON i.product_id = p.id
GROUP BY p.id, p.name, p.stock_quantity
HAVING ROUND(COALESCE(p.stock_quantity, 0) - COALESCE(SUM(i.quantity), 0), 3) <> 0;
