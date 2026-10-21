-- ============================================================
-- REALTIME — tabla sales
-- Ejecutar en: SQL Editor de Supabase
-- Idempotente.
--
-- Necesario para que el POS reciba el UPDATE de la venta cuando
-- el webhook de Mercado Pago la finaliza/cancela (pago aprobado
-- o rechazado) sin recargar la página.
--
-- El POS además tiene polling cada 3s como respaldo, así que si
-- esto no se ejecuta igual funciona (pero más lento).
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'sales'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
  END IF;
END $$;

-- Verificación
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'sales';
