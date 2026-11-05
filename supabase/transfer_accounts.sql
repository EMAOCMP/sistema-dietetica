-- ============================================================
-- Dietética Vishal - Catálogo de cuentas destino (alias) para transferencias
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS transfer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE transfer_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transfer_accounts_select" ON transfer_accounts;
CREATE POLICY "transfer_accounts_select" ON transfer_accounts
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "transfer_accounts_write" ON transfer_accounts;
CREATE POLICY "transfer_accounts_write" ON transfer_accounts
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "transfer_accounts_update" ON transfer_accounts;
CREATE POLICY "transfer_accounts_update" ON transfer_accounts
  FOR UPDATE USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "transfer_accounts_delete" ON transfer_accounts;
CREATE POLICY "transfer_accounts_delete" ON transfer_accounts
  FOR DELETE USING (user_role() = 'admin');

-- Verificación
SELECT count(*) AS cuentas_cargadas FROM transfer_accounts WHERE is_active;
