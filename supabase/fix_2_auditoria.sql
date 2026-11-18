-- ============================================================
-- Fix 2/2 — Auditoría con autor real
-- Ejecutar en Supabase → SQL Editor. Idempotente.
--
-- Antes el trigger leía current_setting('app.current_user_id'), que
-- nunca se seteaba: todas las filas quedaban con user_id NULL.
-- Ahora usa auth.uid(). Se auditan ventas, productos, ingresos y OC.
--
-- Es corto a propósito (ver fix_1_telefono.sql).
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id TEXT;
  v_uuid UUID;
BEGIN
  v_id := COALESCE(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id');

  -- audit_logs.record_id es UUID: si la PK no es UUID, se guarda NULL.
  IF v_id IS NOT NULL THEN
    BEGIN
      v_uuid := v_id::uuid;
    EXCEPTION WHEN others THEN
      v_uuid := NULL;
    END;
  END IF;

  INSERT INTO public.audit_logs (table_name, record_id, action, old_data, new_data, user_id)
  VALUES (
    TG_TABLE_NAME,
    v_uuid,
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    COALESCE(auth.uid(), NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  -- Un fallo de auditoría nunca bloquea la operación de negocio.
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Triggers en las tablas que importan para "quién hizo esto".
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales', 'products', 'stock_receipts', 'purchase_orders'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_audit_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()',
        'trg_audit_' || t, t
      );
    END IF;
  END LOOP;
END $$;

-- Verificación: las dos filas deben dar true
SELECT 'audit_trigger usa auth.uid()' AS chequeo,
       position('auth.uid()' IN pg_get_functiondef('public.audit_trigger()'::regprocedure)) > 0 AS ok
UNION ALL
SELECT 'triggers de auditoría (esperado 4)',
       (SELECT count(*) FROM pg_trigger
        WHERE tgname LIKE 'trg_audit_%' AND NOT tgisinternal) >= 4;
