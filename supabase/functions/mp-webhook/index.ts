// ============================================================
// Edge Function: mp-webhook
// Recibe notificaciones de Mercado Pago y gestiona el ciclo de
// vida de la venta dirigida por pago:
//   - approved  → finalize_mp_sale()  (descuenta stock + comprobante)
//   - rejected / cancelled → cancel_mp_sale() (cancela, sin stock)
//   - pending / in_process → solo actualiza mp_status
//
// Responde 200 en casos normales para que MP no reintente en loop.
//
// Secrets: MP_ACCESS_TOKEN_TEST, MP_ACCESS_TOKEN (mismos que mp-create-preference)
//          MP_WEBHOOK_SECRET (opcional: si está, valida la firma x-signature)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY se inyectan solos.
//
// Configuración en MP Developers → Webhooks:
//   URL: https://<project-ref>.supabase.co/functions/v1/mp-webhook
//   (Verify JWT debe estar DESACTIVADO)
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-signature, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/**
 * Verifica la firma `x-signature` (HMAC-SHA256) de MP.
 * Si `MP_WEBHOOK_SECRET` no está configurado, no se valida (modo permisivo).
 */
async function verifySignature(req: Request, dataId: string): Promise<boolean> {
  const secret = Deno.env.get("MP_WEBHOOK_SECRET");
  if (!secret) return true;

  const sigHeader = req.headers.get("x-signature") || "";
  const requestId = req.headers.get("x-request-id") || "";
  const parts: Record<string, string> = {};
  for (const piece of sigHeader.split(",")) {
    const i = piece.indexOf("=");
    if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === v1.toLowerCase();
}

/** Consulta un pago en MP. Prueba token de test y luego el de producción. */
async function getPayment(paymentId: string): Promise<any | null> {
  const tokens = [
    Deno.env.get("MP_ACCESS_TOKEN_TEST"),
    Deno.env.get("MP_ACCESS_TOKEN"),
  ].filter(Boolean) as string[];

  for (const token of tokens) {
    try {
      const resp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) return await resp.json();
    } catch { /* probamos con el siguiente token */ }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // 1) Identificar el pago notificado (body o query params)
    let body: Record<string, any> = {};
    try { body = await req.json(); } catch { /* IPN por query string no trae body */ }

    const url = new URL(req.url);
    const paymentId =
      body?.data?.id ||
      url.searchParams.get("data.id") ||
      url.searchParams.get("id");
    const type = body?.type
      || url.searchParams.get("type")
      || url.searchParams.get("topic")
      || "payment";

    if (!paymentId || type !== "payment") {
      return json({ ignored: true, type, paymentId });
    }

    // 1.1) Validar firma del webhook (si MP_WEBHOOK_SECRET está configurado)
    if (!(await verifySignature(req, String(paymentId)))) {
      console.warn("[MP webhook] firma inválida para pago", paymentId);
      return json({ error: "Firma inválida" }, 401);
    }

    // 2) Traer el pago de MP
    const payment = await getPayment(String(paymentId));
    if (!payment) {
      return json({ warning: "Pago no encontrado en MP", paymentId });
    }

    const externalRef: string | undefined = payment.external_reference;
    const mpStatus: string | undefined = payment.status; // pending|in_process|approved|rejected|cancelled...

    if (!externalRef) {
      return json({ warning: "Pago sin external_reference", paymentId, mpStatus });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 3) Localizar la venta por external_reference
    const { data: sale, error: findErr } = await supabase
      .from("sales")
      .select("id, status")
      .eq("mp_external_ref", externalRef)
      .maybeSingle();

    if (findErr) {
      console.error("[MP webhook] error buscando venta:", findErr.message);
      return json({ error: findErr.message });
    }
    if (!sale) {
      return json({ warning: "Venta no encontrada para external_reference", externalRef, mpStatus });
    }

    // 4) Acción según estado del pago
    let action = "updated";
    let rpcError: string | null = null;

    if (mpStatus === "approved") {
      const { error } = await supabase.rpc("finalize_mp_sale", { p_sale_id: sale.id });
      if (error) rpcError = error.message;
      action = "finalized";
    } else if (mpStatus === "rejected" || mpStatus === "cancelled") {
      const { error } = await supabase.rpc("cancel_mp_sale", { p_sale_id: sale.id });
      if (error) rpcError = error.message;
      action = "cancelled";
    } else {
      // pending / in_process: solo reflejar el estado
      const { error } = await supabase
        .from("sales")
        .update({ mp_status: mpStatus })
        .eq("id", sale.id);
      if (error) rpcError = error.message;
    }

    // 5) Guardar siempre los datos del pago (conciliación)
    await supabase
      .from("sales")
      .update({
        mp_payment_id: String(payment.id),
        mp_auth: payment.authorization_code
          ? String(payment.authorization_code)
          : String(payment.id),
      })
      .eq("id", sale.id);

    // Detalle del estado (best-effort: si la columna no existe, se ignora)
    if (payment.status_detail) {
      await supabase
        .from("sales")
        .update({ mp_status_detail: String(payment.status_detail) })
        .eq("id", sale.id);
    }

    return json({
      ok: true,
      action,
      mpStatus,
      paymentId: payment.id,
      externalRef,
      saleId: sale.id,
      ...(rpcError ? { rpcError } : {}),
    });
  } catch (e) {
    console.error("[MP webhook] excepción:", e);
    return json({ error: String(e) });
  }
});
