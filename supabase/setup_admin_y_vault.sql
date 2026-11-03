-- ============================================
-- Dietética Vishal - SETUP ÚNICO
--
-- Hace TODO en un solo Run:
--   1. Habilita la extensión de Supabase Vault
--   2. Genera un token aleatorio y lo guarda en Vault
--   3. Te da el usuario principal como ADMIN
--   4. Te muestra el token para copiarlo a las Edge Functions
--
-- ⚠️ ANTES DE CORRER: cambiá el email en la línea "admin_email"
--    (abajo, marked como <<< CAMBIÁ ACÚ >>>).
--
-- Es idempotente: podés volver a ejecutarlo.
-- ============================================

-- ------------------------------------------------------------
-- 1) Extensión Vault
--    Va dentro de un bloque con EXCEPTION: si la extensión no se puede
--    habilitar, NO se aborta el resto del script (el paso de Vault
--    simplemente va a quedar marcado como error).
-- ------------------------------------------------------------
DO $ext$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS supabase_vault;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS vault;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'No se pudo habilitar la extension de Vault: %', SQLERRM;
    END;
  END;
END $ext$;

-- ------------------------------------------------------------
-- 2) Tabla temporal para el resultado
-- ------------------------------------------------------------
DROP TABLE IF EXISTS _setup_out;
CREATE TEMP TABLE _setup_out (
  token    text,
  vault    text,
  admin    text,
  perfiles text
);

-- ------------------------------------------------------------
-- 3) Vault + Admin
-- ------------------------------------------------------------
DO $setup$
DECLARE
  admin_email CONSTANT text := 'nekrok22k@gmail.com';  -- <<< CAMBIÁ ACÚ si tu email es otro >>>
  tok        text := replace(gen_random_uuid()::text, '-', '');
  v_estado   text := 'pendiente';
  a_estado   text := 'pendiente';
  p_list     text := '';
  n_upd      int;
BEGIN
  -- ---------- Guardar el token en Vault ----------
  BEGIN
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'backup_function_token') THEN
      PERFORM vault.update_secret(
        'backup_function_token', tok,
        'Token de invocacion de la Edge Function daily-backup'
      );
      v_estado := 'ACTUALIZADO (el secret ya existia)';
    ELSE
      PERFORM vault.create_secret(
        tok, 'backup_function_token',
        'Token de invocacion de la Edge Function daily-backup'
      );
      v_estado := 'CREADO';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: borrar y recrear (algunas versiones no traen update_secret).
    BEGIN
      PERFORM vault.delete_secret('backup_function_token');
      PERFORM vault.create_secret(
        tok, 'backup_function_token',
        'Token de invocacion de la Edge Function daily-backup'
      );
      v_estado := 'CREADO (tras recrear)';
    EXCEPTION WHEN OTHERS THEN
      v_estado := 'ERROR: ' || SQLERRM;
    END;
  END;

  -- ---------- Dar de alta el rol admin ----------
  BEGIN
    UPDATE profiles SET role = 'admin' WHERE lower(email) = lower(admin_email);
    GET DIAGNOSTICS n_upd = ROW_COUNT;
    IF n_upd > 0 THEN
      a_estado := 'OK: ' || admin_email || ' -> admin';
    ELSE
      a_estado := 'NO ENCONTRADO: ' || admin_email || ' (mira la columna "perfiles")';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    a_estado := 'ERROR: ' || SQLERRM;
  END;

  -- ---------- Listar los perfiles existentes ----------
  BEGIN
    SELECT string_agg(
      '  - ' || p.email || '  [' || coalesce(p.role, 'sin rol') || ']',
      E'\n' ORDER BY p.created_at
    ) INTO p_list
    FROM profiles p;
  EXCEPTION WHEN OTHERS THEN
    p_list := '  (no se pudieron leer: ' || SQLERRM || ')';
  END;

  INSERT INTO _setup_out VALUES (tok, v_estado, a_estado, coalesce(p_list, '  (sin perfiles)'));
END $setup$;

-- ------------------------------------------------------------
-- 4) Resultado
-- ------------------------------------------------------------
SELECT
  token AS "COPIÁ_ESTE_TOKEN_EN_EDGE_FUNCTIONS",
  vault AS "ESTADO_VAULT",
  admin AS "ESTADO_ADMIN",
  perfiles AS "PERFILES_ACTUALES"
FROM _setup_out;

-- ------------------------------------------------------------
-- 5) Verificacion del secret (NO muestra el valor)
-- ------------------------------------------------------------
SELECT name, description, created_at
FROM vault.secrets
WHERE name = 'backup_function_token';
