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
-- Paso 2: habilitar extensiones (Dashboard → Database → Extensions):
--   pg_cron y pg_net.
--
-- Paso 3: reemplazar <ANON_KEY> abajo con tu anon key
--   (la misma de .env.local / Site Settings → API).
--
-- Paso 4: ejecutar este archivo en el SQL Editor.
--
-- Qué hace: todos los días a las 04:00 ART (07:00 UTC) llama a la
-- Edge Function, que exporta a JSON las ventas/ítems/pagos/gastos de
-- las últimas 24 h + los últimos 3 cierres de caja + snapshot de
-- productos, y lo sube al bucket privado "backups".
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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyaG51eGd4ZHRmeHBpZmFka2dsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2NDI3NTAsImV4cCI6MjEwNDIxODc1MH0.r1HVEztS0KszXkDCo-GmoLpyoPedXMEjkdD0fVlC2H0'
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
