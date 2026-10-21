-- ============================================================
-- MERCADO PAGO — Webhook (conciliación de pagos)
-- Ejecutar en: SQL Editor de Supabase
-- Idempotente: se puede re-ejecutar sin problemas.
--
-- Agrega las columnas que el webhook mp-webhook usa para
-- encontrar la venta y guardar el estado del pago.
-- ============================================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS mp_external_ref TEXT;    -- external_reference (conciliación)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS mp_payment_id TEXT;      -- id del pago en MP
ALTER TABLE sales ADD COLUMN IF NOT EXISTS mp_status_detail TEXT;   -- ej. accredited, cc_rejected_insufficient_amount

COMMENT ON COLUMN sales.mp_external_ref IS 'external_reference de MP usado por el webhook para encontrar la venta';
COMMENT ON COLUMN sales.mp_payment_id IS 'ID del pago en Mercado Pago (notificación webhook)';
COMMENT ON COLUMN sales.mp_status_detail IS 'Detalle del estado del pago según Mercado Pago';

CREATE INDEX IF NOT EXISTS idx_sales_mp_external_ref ON sales(mp_external_ref);

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sales' AND column_name LIKE 'mp_%'
ORDER BY column_name;
