-- ============================================
-- Dietética Vishal - Cierre de caja
-- Ejecutar en Supabase SQL Editor.
--   cash_closes: arqueo diario (esperado vs contado por día)
-- ============================================

BEGIN;

CREATE TABLE IF NOT EXISTS cash_closes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date DATE NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  sales_count INT NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_expected NUMERIC(12,2) NOT NULL DEFAULT 0,
  transfer_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  card_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_counted NUMERIC(12,2) NOT NULL DEFAULT 0,
  difference NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(business_date)
);

ALTER TABLE cash_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "closes_select" ON cash_closes;
CREATE POLICY "closes_select" ON cash_closes FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "closes_insert" ON cash_closes;
CREATE POLICY "closes_insert" ON cash_closes FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "closes_update" ON cash_closes;
CREATE POLICY "closes_update" ON cash_closes FOR UPDATE USING (user_role() IN ('admin','supervisor')) WITH CHECK (user_role() IN ('admin','supervisor'));
DROP POLICY IF EXISTS "closes_delete" ON cash_closes;
CREATE POLICY "closes_delete" ON cash_closes FOR DELETE USING (user_role() = 'admin');

COMMIT;

SELECT 'cash_closes' AS tabla, COUNT(*) FROM cash_closes;
