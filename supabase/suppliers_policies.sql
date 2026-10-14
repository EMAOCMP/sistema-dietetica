-- Policies abiertas para suppliers (app interna, usuarios autenticados = staff)
CREATE POLICY "suppliers_select" ON suppliers
  FOR SELECT USING (true);

CREATE POLICY "suppliers_insert" ON suppliers
  FOR INSERT WITH CHECK (true);

CREATE POLICY "suppliers_update" ON suppliers
  FOR UPDATE USING (true) WITH CHECK (true);

-- Verificación
SELECT policyname, cmd AS operacion
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'suppliers'
ORDER BY policyname;
