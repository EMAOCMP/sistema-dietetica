-- ============================================================
-- Historial y Trazabilidad
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
--
-- Qué hace:
--   1. Guarda quién anuló una venta, cuándo y por qué
--      (sales.cancelled_at / cancelled_by / cancel_reason).
--   2. cancel_sale(id, motivo): misma lógica de antes + motivo.
--   3. sales_history_summary(): totales exactos del filtro
--      (sin el tope de 1000 filas de la API).
--   4. Índices para que el historial pagine rápido.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Metadatos de anulación
-- ------------------------------------------------------------
-- OJO: al agregar `cancelled_by`, `sales` pasa a tener DOS claves foráneas
-- hacia `profiles` (`user_id` y `cancelled_by`). Por eso todas las consultas
-- que embeben el vendedor deben desambiguar con el nombre del FK:
--     profiles!sales_user_id_fkey (full_name)
-- Sin ese `!` PostgREST responde PGRST201
-- ("more than one relationship was found for 'sales' and 'profiles'").
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_user_created ON public.sales(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_status_created ON public.sales(status, created_at DESC);
-- idx_sales_created se omite: es idéntico a idx_sales_created_at
-- (sales(created_at DESC), creado en schema_improvements.sql).

-- ------------------------------------------------------------
-- 2. Anular venta con motivo
--    Misma transacción que antes: marca la venta y devuelve
--    el stock con movimientos en inventory_movements.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_sale(UUID);
DROP FUNCTION IF EXISTS public.cancel_sale(UUID, TEXT);

CREATE FUNCTION public.cancel_sale(p_sale_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  it RECORD;
  v_loc UUID;
  v_prev NUMERIC;
  v_new NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF public.user_role() NOT IN ('admin','supervisor') THEN
    RAISE EXCEPTION 'Sin permiso para anular';
  END IF;

  SELECT * INTO r FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Venta no encontrada';
  END IF;
  IF r.status = 'cancelled' THEN
    RETURN;
  END IF;
  IF r.status <> 'completed' THEN
    RAISE EXCEPTION 'Estado % no anulable', r.status;
  END IF;

  SELECT id INTO v_loc FROM public.locations WHERE name = 'Local principal' LIMIT 1;

  UPDATE public.sales
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancel_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = p_sale_id;

  FOR it IN SELECT * FROM public.sale_items WHERE sale_id = p_sale_id LOOP
    IF v_loc IS NOT NULL THEN
      INSERT INTO public.inventory (product_id, location_id, quantity)
      VALUES (it.product_id, v_loc, 0)
      ON CONFLICT (product_id, location_id) DO NOTHING;

      SELECT quantity INTO v_prev FROM public.inventory
      WHERE product_id = it.product_id AND location_id = v_loc FOR UPDATE;

      v_new := COALESCE(v_prev, 0) + it.quantity;

      UPDATE public.inventory SET quantity = v_new, updated_at = now()
      WHERE product_id = it.product_id AND location_id = v_loc;

      INSERT INTO public.inventory_movements
        (product_id, location_id, type, quantity, previous_quantity, new_quantity,
         reference_type, reference_id, user_id)
      VALUES
        (it.product_id, v_loc, 'return', it.quantity, v_prev, v_new,
         'sale_cancel', p_sale_id::text, auth.uid());
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sale(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sale(UUID, TEXT) TO service_role;

-- ------------------------------------------------------------
-- 3. Totales exactos del filtro del historial
--    Evita traer las ventas al navegador solo para sumar.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sales_history_summary(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_payment TEXT DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  p_dispatch TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_sale_ids UUID[] DEFAULT NULL
)
RETURNS TABLE(ventas BIGINT, facturacion NUMERIC, ganancia NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(s.status, 'completed') <> 'cancelled' OR p_status = 'cancelled')::BIGINT,
    COALESCE(SUM(s.total_amount) FILTER (WHERE COALESCE(s.status, 'completed') <> 'cancelled' OR p_status = 'cancelled'), 0),
    COALESCE(SUM(s.profit_amount) FILTER (WHERE COALESCE(s.status, 'completed') <> 'cancelled' OR p_status = 'cancelled'), 0)
  FROM public.sales s
  WHERE (p_from IS NULL OR s.created_at >= p_from)
    AND (p_to IS NULL OR s.created_at <= p_to)
    AND (p_user_id IS NULL OR s.user_id = p_user_id)
    AND (p_payment IS NULL OR COALESCE(s.payment_method, 'cash') = p_payment)
    AND (p_type IS NULL OR s.sale_type = p_type)
    AND (p_dispatch IS NULL OR COALESCE(s.dispatch_type, 'pickup') = p_dispatch)
    AND (p_status IS NULL OR COALESCE(s.status, 'completed') = p_status)
    AND (
      p_search IS NULL
      OR btrim(p_search) = ''
      OR s.receipt_number ILIKE '%' || p_search || '%'
      OR s.customer_name ILIKE '%' || p_search || '%'
      OR COALESCE(s.customer_doc, '') ILIKE '%' || p_search || '%'
      OR s.total_amount::text = replace(p_search, ',', '.')
      OR (p_sale_ids IS NOT NULL AND s.id = ANY(p_sale_ids))
    );
$$;

REVOKE ALL ON FUNCTION public.sales_history_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_history_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_history_summary(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID[]) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verificación (todo debe dar true)
-- ============================================================
SELECT 'cancel_sale(uuid,text)' AS funcion,
       to_regprocedure('public.cancel_sale(uuid,text)') IS NOT NULL AS ok
UNION ALL
SELECT 'sales_history_summary',
       to_regprocedure('public.sales_history_summary(timestamptz,timestamptz,uuid,text,text,text,text,text,uuid[])') IS NOT NULL
UNION ALL
SELECT 'sales.cancelled_at',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'cancelled_at'
       )
UNION ALL
SELECT 'sales.cancel_reason',
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'cancel_reason'
       );
