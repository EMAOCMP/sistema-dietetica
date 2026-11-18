-- ============================================================
-- Dejar UN SOLO usuario: nekrok22k@gmail.com como admin
-- Borra el resto de usuarios de Authentication y sus perfiles
-- (los ajustes y el onboarding de esos usuarios caen por cascade).
-- ⚠️ IRREVERSIBLE. La primera consulta muestra qué hay antes.
-- Ejecutar en SQL Editor.
-- ============================================================
BEGIN;

-- 0) Ver qué hay (queda en el resultado; guardalo si necesitás recrear)
SELECT u.id,
       u.email,
       u.email_confirmed_at,
       u.last_sign_in_at,
       p.role,
       p.email AS profile_email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
ORDER BY u.created_at;

-- 1) Limpieza: todo menos el admin
DO $$
DECLARE
  v_email CONSTANT text := 'nekrok22k@gmail.com';
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(v_email);
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No existe un usuario con %. Creálo primero en Authentication → Users.', v_email;
  END IF;

  DELETE FROM public.profiles WHERE id <> v_id;
  DELETE FROM auth.users      WHERE id <> v_id;

  -- Email confirmado: evita "Email not confirmed" al iniciar sesión
  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at = now()
  WHERE id = v_id;

  -- Rol admin (la fila ya existe si venías usando la app)
  UPDATE public.profiles
  SET role = 'admin', email = v_email
  WHERE id = v_id;

  -- Si faltaba el perfil, se crea
  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.profiles (id, email, role) VALUES (v_id, v_email, 'admin');
    EXCEPTION WHEN not_null_violation THEN
      RAISE EXCEPTION
        'Falta el perfil y profiles pide columnas obligatorias. Creálo en Table Editor con id=%, email=%, role=admin', v_id, v_email;
    END;
  END IF;
END $$;

-- 2) Verificación: debe quedar una sola fila
SELECT u.email,
       u.email_confirmed_at,
       p.role,
       (SELECT count(*) FROM auth.users) AS usuarios_totales
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id;

COMMIT;

-- ============================================================
-- SI NO TE ACORDÁS LA CONTRASEÑA
--   Opción A (recomendada): Dashboard → Authentication → Users →
--     ⋯ → Reset password (te manda el mail).
--   Opción B: descomentar y correr aparte, cambiando la clave.
--     Requiere pgcrypto (Supabase ya lo trae en `extensions`).
--
-- UPDATE auth.users
-- SET encrypted_password = extensions.crypt('CambiarEstaClave123!',
--                            extensions.gen_salt('bf')),
--     updated_at = now()
-- WHERE lower(email) = lower('nekrok22k@gmail.com');
-- ============================================================
