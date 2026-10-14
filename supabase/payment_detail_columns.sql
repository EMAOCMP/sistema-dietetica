-- ============================================
-- Dietética Vishal - Detalle de pago (transfer/tarjeta)
-- Ejecutar en Supabase SQL Editor
-- ============================================

ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_bank TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_account TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS transfer_ref TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS card_type TEXT CHECK (card_type IS NULL OR card_type IN ('debit', 'credit'));
ALTER TABLE sales ADD COLUMN IF NOT EXISTS card_brand TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS card_last4 TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS card_auth TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS card_installments INT DEFAULT 1;

-- Verificación
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'sales'
  AND column_name IN ('transfer_bank', 'transfer_account', 'transfer_ref',
    'card_type', 'card_brand', 'card_last4', 'card_auth', 'card_installments')
ORDER BY column_name;
