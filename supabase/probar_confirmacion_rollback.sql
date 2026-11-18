-- ============================================================
-- PRUEBA DE CONFIRMACIÓN SIN EFECTOS (diagnóstico)
-- Ejecutar SOLO si "Confirmar ingreso" falla en la app.
-- Requiere que exista al menos un ingreso en estado 'draft'.
--
-- Qué hace: simula una sesión, llama a confirm_stock_receipt y
-- hace ROLLBACK. El stock, los movimientos y el estado NO se
-- guardan: sirve para ver el mensaje de error exacto.
--
-- Si aparece un error, después corré ROLLBACK; por las dudas.
-- ============================================================
BEGIN;

-- Simular sesión: auth.uid() toma el "sub" de estos claims.
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (SELECT u.id FROM auth.users u ORDER BY u.created_at LIMIT 1),
    'role', 'authenticated'
  )::text,
  true
);

-- Confirmar el borrador más reciente y mostrar el error real.
SELECT *
FROM public.confirm_stock_receipt(
  (SELECT r.id FROM public.stock_receipts r
    WHERE r.status = 'draft'
    ORDER BY r.created_at DESC LIMIT 1),
  'diagnostico-rollback',
  NULL
);

-- Nada de esto queda grabado.
ROLLBACK;

-- Estado real del borrador (debe seguir en 'draft').
SELECT r.receipt_number, r.status, r.total_cost,
       (SELECT count(*) FROM public.stock_receipt_items i
         WHERE i.receipt_id = r.id) AS items
FROM public.stock_receipts r
ORDER BY r.created_at DESC;
