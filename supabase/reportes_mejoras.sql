-- ============================================
-- Dietética Vishal - MEJORAS DE REPORTES
-- Ejecutar en Supabase SQL Editor. Idempotente (se puede correr varias veces).
--
-- 1) expenses: gastos del negocio (alquiler, servicios, insumos…)
--    → permite pasar de "ganancia bruta" (margen de mercadería) a
--      "ganancia neta" en el reporte diario/semanal/mensual.
-- 2) sales.discount_amount / sale_items.discount_amount:
--    descuentos explícitos (hoy solo quedan embebidos en el total,
--    lo que impide cuadrar la ganancia por categoría con la total).
--
-- Requisito: que exista la función user_role() de roles_permisos.sql
-- ============================================

BEGIN;

-- ---------- 1) GASTOS ----------
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spent_on DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  category TEXT NOT NULL DEFAULT 'otro',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_spent_on ON expenses (spent_on);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select" ON expenses;
CREATE POLICY "expenses_select" ON expenses
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "expenses_insert" ON expenses;
CREATE POLICY "expenses_insert" ON expenses
  FOR INSERT WITH CHECK (user_role() IN ('admin','supervisor'));

DROP POLICY IF EXISTS "expenses_update" ON expenses;
CREATE POLICY "expenses_update" ON expenses
  FOR UPDATE USING (user_role() IN ('admin','supervisor'))
  WITH CHECK (user_role() IN ('admin','supervisor'));

DROP POLICY IF EXISTS "expenses_delete" ON expenses;
CREATE POLICY "expenses_delete" ON expenses
  FOR DELETE USING (user_role() = 'admin');

-- ---------- 2) DESCUENTOS EXPLÍCITOS ----------
-- El POS ya envía estos valores (best-effort): si corrés este SQL,
-- los descuentos quedan persistidos y la ganancia por categoría
-- se cuadra con la ganancia total de la venta.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

COMMIT;

-- ---------- Verificación ----------
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'expenses' AND column_name IN ('id','spent_on','description','amount','category','payment_method','user_id'))
    OR (table_name IN ('sales','sale_items') AND column_name = 'discount_amount')
  )
ORDER BY table_name, column_name;
