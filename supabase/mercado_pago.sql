-- ============================================================
-- MERCADO PAGO — Nivel B (Checkout Pro via Edge Function)
-- Ejecutar en: SQL Editor de Supabase
-- Idempotente: se puede re-ejecutar sin problemas.
-- ============================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS mp_auth TEXT;             -- N° de operación / autorización MP
ALTER TABLE sales ADD COLUMN IF NOT EXISTS mp_link TEXT;             -- init_point de la preferencia
ALTER TABLE sales ADD COLUMN IF NOT EXISTS mp_preference_id TEXT;    -- ID de preferencia MP
ALTER TABLE sales ADD COLUMN IF NOT EXISTS mp_status TEXT;           -- pending / approved / rejected

COMMENT ON COLUMN sales.mp_auth IS 'N° de operación / autorización MP (ingresado o notificado)';
COMMENT ON COLUMN sales.mp_link IS 'Link de pago init_point generado para la venta';
COMMENT ON COLUMN sales.mp_preference_id IS 'ID de preferencia Mercado Pago (conciliación / webhook)';
COMMENT ON COLUMN sales.mp_status IS 'Estado MP: pending | approved | rejected';

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sales' AND column_name LIKE 'mp_%'
ORDER BY column_name;
