-- ============================================
-- Dietética Vishal — RESTRICCIÓN DE "GESTIÓN DE USUARIOS Y PERMISOS"
-- Ejecutar en Supabase → SQL Editor (después de roles_permisos.sql).
--
-- Problema que corrige
-- --------------------
-- La política `profiles_select` de roles_permisos.sql permite que CUALQUIER
-- usuario autenticado lea TODA la tabla `profiles` (email + rol de todo el
-- equipo). La UI ya oculta "Usuarios y Actividad" al vendedor, pero sin esta
-- política un vendedor podía leer los perfiles llamando directo a la API:
--   GET /rest/v1/profiles?select=email,role
--
-- Regla nueva
-- -----------
--   vendedor   → SELECT solo su propia fila (auth.uid()).
--   supervisor → SELECT todas las filas (necesita la vista de usuarios).
--   admin      → SELECT todas + cambiar roles + borrar.
--
-- También cierra una escalada de privilegios: el alta propia solo puede
-- crear perfiles con role = 'vendedor' (antes un vendedor sin perfil podía
-- insertarse a sí mismo con role = 'admin').
--
-- Idempotente: se puede correr las veces que haga falta.
-- ⚠️ Si volvés a correr `roles_permisos.sql`, volvé a correr ESTE archivo
--    (ese script borra y recrea todas las policies de `profiles`).
-- ============================================

BEGIN;

-- ------------------------------------------------------------
-- 0) Helper de rol (por si este archivo se corre solo)
--    SECURITY DEFINER: lee `profiles` sin pasar por RLS y evita recursión.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT role FROM public.profiles WHERE id = auth.uid()), 'vendedor');
$$;

REVOKE ALL ON FUNCTION public.user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_role() TO service_role;

-- ------------------------------------------------------------
-- 1) SELECT — propio perfil + (admin | supervisor) ven todo
-- ------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select"           ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_all"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own"       ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_managers"  ON public.profiles;

-- Cada usuario ve su propia fila (lo necesita el arranque de la app).
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Solo quienes gestionan usuarios ven el padrón completo.
CREATE POLICY "profiles_select_managers" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.user_role() IN ('admin', 'supervisor'));

-- ------------------------------------------------------------
-- 2) INSERT — alta propia, y SOLO como vendedor
--    (el cliente inserta su perfil en el primer login: App.fetchProfile)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_insert_own"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND role = 'vendedor');

-- ------------------------------------------------------------
-- 3) UPDATE / DELETE — solo admin (cambiar roles, borrar)
--    Alta de admin sigue siendo por SQL Editor / service_role, que
--    no pasan por RLS (ver setup_admin_y_vault.sql).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_update_admin" ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.user_role() = 'admin')
  WITH CHECK (public.user_role() = 'admin');

DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.user_role() = 'admin');

COMMIT;

-- ============================================
-- VERIFICACIÓN
-- ============================================
-- 1) Políticas resultantes sobre `profiles` (deben ser 4, sin "profiles_select"):
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY cmd, policyname;

-- 2) RLS activo:
SELECT relname, relrowsecurity AS rls_activo
FROM pg_class
WHERE oid = 'public.profiles'::regclass;

-- 3) Prueba manual (opcional):
--    - Login como VENDEDOR y ejecutar en la consola del navegador:
--        await supabase.from('profiles').select('email, role')
--      → debe devolver SOLO su propia fila.
--    - Login como SUPERVISOR/ADMIN:
--      → devuelve todo el equipo.
--    - Cualquier intento del vendedor de UPDATE/DELETE → 0 filas afectadas.

-- ============================================
-- ROLLBACK (solo si hiciera falta volver atrás)
-- ============================================
-- BEGIN;
-- DROP POLICY IF EXISTS "profiles_select_own"      ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_select_managers" ON public.profiles;
-- DROP POLICY IF EXISTS "profiles_insert_own"      ON public.profiles;
-- CREATE POLICY "profiles_select" ON public.profiles
--   FOR SELECT USING (auth.uid() IS NOT NULL);
-- CREATE POLICY "profiles_insert_own" ON public.profiles
--   FOR INSERT WITH CHECK (id = auth.uid());
-- COMMIT;

-- ============================================
-- OPCIONAL — nombres en el historial de stock para el vendedor
-- ============================================
-- Al restringir `profiles`, ProductsView ya no puede resolver el `full_name`
-- de OTROS usuarios al abrir "Movimientos" de un producto (solo ve el propio).
-- La UI lo maneja sin romperse (oculta el autor). Si querés que el vendedor
-- vea el nombre del autor sin exponer emails ni roles, creá este RPC y usalo
-- en ProductsView (`openMoves → resolveNames`):
--
-- CREATE OR REPLACE FUNCTION public.staff_names()
-- RETURNS TABLE (id UUID, full_name TEXT)
-- LANGUAGE sql STABLE SECURITY DEFINER AS $$
--   SELECT p.id, p.full_name FROM public.profiles p;
-- $$;
-- REVOKE ALL ON FUNCTION public.staff_names() FROM PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.staff_names() TO authenticated;
