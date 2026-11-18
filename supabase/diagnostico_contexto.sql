-- DIAGNÓSTICO: captura el mensaje + CONTEXT real del error al confirmar.
-- Solo lectura efectiva: todo lo que hace la confirmación se revierte
-- al atrapar la excepción (subtransacción).
-- Requiere al menos un ingreso en estado 'draft'.
CREATE OR REPLACE FUNCTION pg_temp.diag_confirm()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_id  UUID;
  v_msg TEXT;
  v_ctx TEXT;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', (SELECT u.id FROM auth.users u ORDER BY u.created_at LIMIT 1),
      'role', 'authenticated'
    )::text,
    true
  );

  SELECT r.id INTO v_id
  FROM public.stock_receipts r
  WHERE r.status = 'draft'
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN
    RETURN 'No hay borradores: creá uno desde la OC (Recibir) y volvé a correr.';
  END IF;

  BEGIN
    PERFORM public.confirm_stock_receipt(v_id, 'diag-contexto', NULL);
    -- Si llegó acá, confirmó bien; forzamos el rollback del bloque.
    RAISE EXCEPTION 'OK: confirmó sin error (cambios revertidos)';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_ctx = PG_EXCEPTION_CONTEXT;
    RETURN 'MENSAJE: ' || v_msg || E'\nCONTEXTO:\n' || COALESCE(v_ctx, '(sin contexto)');
  END;
END;
$$;

SELECT pg_temp.diag_confirm() AS resultado;
