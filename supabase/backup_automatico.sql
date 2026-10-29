-- ============================================
-- Dietética Vishal - BACKUP AUTOMÁTICO DIARIO
--
-- Paso 1: crear la Edge Function "daily-backup"
--   (archivo: supabase/functions/daily-backup/index.ts)
--   Desde la terminal, con el CLI de Supabase:
--     supabase functions deploy daily-backup --no-verify-jwt
--   O desde el Dashboard: Edge Functions → nueva función "daily-backup"
--   → pegar el archivo → Deploy.
--
-- Paso 2: crear el secret BACKUP_TOKEN en la Edge Function
--   (Dashboard → Edge Functions → daily-backup → Secrets)
--   El valor es un token largo y aleatorio, por ejemplo:
--     openssl rand -hex 32
--
-- Paso 3: habilitar extensiones (Dashboard → Database → Extensions):
--   pg_cron, pg_net y vault.
--
-- Paso 4: guardar el mismo token en Supabase Vault (se ejecuta UNA vez):
--   SELECT vault.create_secret('<PEGAR_AQUI_EL_BACKUP_TOKEN>', 'backup_function_token');
--
-- Paso 5: ejecutar este archivo en el SQL Editor.
--
-- Qué hace: todos los días a las 04:00 ART (07:00 UTC) llama a la
-- Edge Function, que exporta a JSON las ventas/ítems/pagos/gastos de
-- las últimas 24 h + los últimos 3 cierres de caja + snapshot de
-- productos, y lo sube al bucket privado "backups".
--
-- NOTA DE SEGURIDAD: el token NO vive en este archivo. Se lee de
-- Supabase Vault, así que el repositorio no expone ninguna credencial.
-- ============================================

BEGIN;

-- Bucket privado (si ya existe, no hace nada)
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Programación diaria (crón en UTC)
SELECT cron.schedule(
  'daily-backup-supabase',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://frhnuxgxdtfxpifadkgl.supabase.co/functions/v1/daily-backup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'backup_function_token'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

COMMIT;

-- ---------- Verificación ----------
-- Ver el job programado:
--   SELECT jobid, schedule, command FROM cron.job WHERE jobname = 'daily-backup-supabase';
-- Ver errores de ejecución:
--   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'daily-backup-supabase') ORDER BY start_time DESC LIMIT 5;

-- ---------- Desprogramar (si querés cancelar) ----------
-- SELECT cron.unschedule('daily-backup-supabase');
