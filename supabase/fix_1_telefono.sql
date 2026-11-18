-- ============================================================
-- Fix 1/2 — Teléfono del cliente en la venta
-- Ejecutar en Supabase → SQL Editor. Idempotente.
--
-- El POS manda p_customer_phone a create_sale, pero la función no lo
-- guardaba. Este archivo:
--   1. Agrega la columna sales.customer_phone.
--   2. Crea el RPC set_sale_phone(), que guarda el teléfono en la venta
--      propia del usuario (sirve aunque el vendedor no pueda editar ventas).
--
-- Es corto a propósito: el editor SQL de Supabase cortó el script
-- completo (ajustes_post_revision.sql) en la línea 100 y falló con
-- "unterminated dollar-quoted string".
-- ============================================================

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS customer_phone TEXT;

CREATE OR REPLACE FUNCTION public.set_sale_phone(p_sale_id UUID, p_phone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.sales
     SET customer_phone = NULLIF(regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g'), '')
   WHERE id = p_sale_id
     AND user_id = auth.uid();

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_sale_phone(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sale_phone(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sale_phone(UUID, TEXT) TO service_role;

-- Verificación: las dos filas deben dar true
SELECT 'columna sales.customer_phone' AS chequeo,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sales'
           AND column_name = 'customer_phone'
       ) AS ok
UNION ALL
SELECT 'RPC set_sale_phone',
       to_regprocedure('public.set_sale_phone(uuid,text)') IS NOT NULL;
