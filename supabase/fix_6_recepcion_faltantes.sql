-- Fix 6/6: recepción honesta (faltantes)
-- Problema: mark_purchase_order_received copiaba lo PEDIDO a received_quantity
-- (received_quantity = quantity), así que una entrega incompleta quedaba
-- registrada como completa. Ahora se suma lo que realmente entró en el ingreso
-- confirmado; los productos que no llegaron quedan en 0.
-- No toca stock (ya lo aplica confirm_stock_receipt). Idempotente.
BEGIN;

CREATE OR REPLACE FUNCTION public.mark_purchase_order_received(
  p_order_id UUID,
  p_receipt_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt   UUID;
  v_confirmed BOOLEAN := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF user_role() NOT IN ('admin','supervisor') THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  SELECT COALESCE(p_receipt_id, po.receipt_id)
    INTO v_receipt
    FROM purchase_orders po
   WHERE po.id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden no encontrada'; END IF;

  IF v_receipt IS NOT NULL THEN
    SELECT (sr.status = 'confirmed') INTO v_confirmed
      FROM stock_receipts sr
     WHERE sr.id = v_receipt;
    v_confirmed := COALESCE(v_confirmed, false);
  END IF;

  -- Solo con un ingreso confirmado: lo pedido que no entró queda en 0,
  -- y lo que entró de más no se recorta (GREATEST no aplica acá).
  IF v_confirmed THEN
    UPDATE purchase_order_items poi
       SET received_quantity = COALESCE((
             SELECT SUM(sri.quantity)
               FROM stock_receipt_items sri
              WHERE sri.receipt_id = v_receipt
                AND sri.product_id = poi.product_id
           ), 0)
     WHERE poi.order_id = p_order_id;
  END IF;

  UPDATE purchase_orders
     SET status = 'received',
         received_at = now(),
         receipt_id = COALESCE(v_receipt, receipt_id),
         updated_at = now()
   WHERE id = p_order_id
     AND status IN ('sent','draft');

  RETURN TRUE;
END;
$$;

NOTIFY pgrst, 'reload schema';
REVOKE ALL ON FUNCTION public.mark_purchase_order_received(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_purchase_order_received(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_purchase_order_received(UUID, UUID) TO service_role;

-- Backfill: órdenes ya recibidas toman el recibido real del ingreso confirmado.
-- Idempotente: si el ingreso fue completo, el valor no cambia.
UPDATE purchase_order_items poi
   SET received_quantity = COALESCE((
         SELECT SUM(sri.quantity)
           FROM stock_receipt_items sri
          WHERE sri.receipt_id = po.receipt_id
            AND sri.product_id = poi.product_id
       ), 0)
  FROM purchase_orders po
 WHERE po.id = poi.order_id
   AND po.status = 'received'
   AND po.receipt_id IS NOT NULL
   AND EXISTS (
         SELECT 1 FROM stock_receipts sr
          WHERE sr.id = po.receipt_id AND sr.status = 'confirmed'
       );

COMMIT;
