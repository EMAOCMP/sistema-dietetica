-- ============================================================
-- Demo: pasa la cuenta operativa a supervisor.
-- Supervisor puede vender, anular, generar/enviar OC, cerrar caja
-- y ver reportes. No puede cambiar roles ni dar de baja productos.
-- ============================================================
BEGIN;

UPDATE public.profiles
SET role = 'supervisor'
WHERE email = 'nekrok22@outlook.es'
  AND role = 'vendedor';

COMMIT;

SELECT email, full_name, role FROM public.profiles ORDER BY role, email;