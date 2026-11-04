// ============================================================
// Edge Function: mp-check-payment
//
// Respaldo del webhook de Mercado Pago.
// Cuando el webhook no llega (o llega tarde), el POS llama a esta
// funcion que consulta el estado real del pago en MP y finaliza o
// cancela la venta.
//
// Hace la MISMA logica que mp-webhook, pero:
//   - no exige firma x-signature (la llamada viene de la app, con JWT)
//   - busca el pago por external_reference o por preference_id
//
// Secrets: MP_ACCESS_TOKEN_TEST, MP_ACCESS_TOKEN
//          (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY se inyectan solos)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Valida el JWT del usuario contra el servicio de Auth. */
async function isAuthenticated(req: Request): Promise<boolean> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return false;

  const { data, error } = await createClient(url, anonKey).auth.getUser(token);
  return !error && !!data?.user;
}

/** Tokens de MP: primero el de prueba, despues el de produccion. */
function mpTokens(): string[] {
  return [
    Deno.env.get("MP_ACCESS_TOKEN_TEST"),
    Deno.env.get("MP_ACCESS_TOKEN"),
  ].filter(Boolean) as string[];
}

/** Busca el pago en MP por external_reference. */
async function findPaymentByExternalRef(
  externalRef: string,
  preferenceId: string | null,
): Promise<any | null> {
  for (const token of mpTokens()) {
    const headers = { Authorization: `Bearer ${token}` };

    // 1) Busqueda directa por external_reference
    try {
      const url =
        `https://api.mercadopago.com/v1/payments?external_reference=${encodeURIComponent(externalRef)}&limit=1`;
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.results?.length) return data.results[0];
      }
    } catch { /* probamos con el siguiente metodo */ }

    // 2) Via preference_id -> payment_id
    if (preferenceId) {
      try {
        const resp = await fetch(
          `https://api.mercadopago.com/v1/checkout/preferences/${encodeURIComponent(preferenceId)}`,
          { headers },
        );
        if (resp.ok) {
          const pref = await resp.json();
          const pid =
            pref?.payment_id ??
            pref?.payments?.[0]?.id ??
            pref?.last_updated?.id ??
            null;
          if (pid) {
            const r2 = await fetch(
              `https://api.mercadopago.com/v1/payments/${encodeURIComponent(String(pid))}`,
              { headers },
            );
            if (r2.ok) return await r2.json();
          }
        }
      } catch { /* probamos con el siguiente metodo */ }
    }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

    // Solo usuarios autenticados (la app).
    if (!(await isAuthenticated(req))) {
      return json({ error: "Sesión inválida o expirada" }, 401);
    }

    let body: Record<string, any> = {};
    try { body = await req.json(); } catch { /* body vacio */ }
    const saleId = String(body?.p_sale_id ?? body?.sale_id ?? "").trim();
    if (!saleId) return json({ error: "Falta p_sale_id" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Leer la venta
    const { data: sale, error: saleErr } = await admin
      .from("sales")
      .select("id, status, mp_external_ref, mp_preference_id, mp_payment_id")
      .eq("id", saleId)
      .maybeSingle();
    if (saleErr) return json({ error: saleErr.message }, 500);
    if (!sale) return json({ error: "Venta no encontrada" }, 404);

    // 2) Si ya esta resuelta, no hay nada que hacer
    if (sale.status === "completed") {
      return json({ ok: true, action: "already-completed", status: sale.status, saleId });
    }
    if (sale.status === "cancelled") {
      return json({ ok: true, action: "already-cancelled", status: sale.status, saleId });
    }

    const externalRef: string | null = sale.mp_external_ref ?? null;
    if (!externalRef) {
      return json({ error: "La venta no tiene mp_external_ref" }, 400);
    }

    // 3) Consultar el pago real en MP
    const payment = await findPaymentByExternalRef(
      externalRef,
      sale.mp_preference_id ?? null,
    );
    if (!payment) {
      return json({
        ok: false,
        action: "not-found-in-mp",
        status: sale.status,
        saleId,
        detalle: "MP todavia no reporta el pago (puede estar pendiente o usando otra cuenta)",
      });
    }

    const mpStatus: string = payment.status || "pending";

    // 4) Conciliar siempre el id del pago
    const mpAuth = payment.authorization_code || payment.id;
    await admin
      .from("sales")
      .update({
        mp_payment_id: String(payment.id),
        mp_auth: mpAuth,
        mp_status_detail: payment.status_detail ?? null,
      })
      .eq("id", saleId);

    // 5) Accion segun el estado
    if (mpStatus === "approved") {
      const { error: finErr } = await admin.rpc("finalize_mp_sale", { p_sale_id: saleId });
      if (finErr) return json({ error: finErr.message }, 500);
      return json({
        ok: true, action: "finalized", status: "completed",
        saleId, mpStatus, paymentId: String(payment.id),
      });
    }

    if (mpStatus === "rejected" || mpStatus === "cancelled") {
      const { error: canErr } = await admin.rpc("cancel_mp_sale", { p_sale_id: saleId });
      if (canErr) return json({ error: canErr.message }, 500);
      return json({
        ok: true, action: "cancelled", status: "cancelled",
        saleId, mpStatus, paymentId: String(payment.id),
      });
    }

    // pending / in_process: solo actualiza el estado
    await admin.from("sales").update({ mp_status: mpStatus }).eq("id", saleId);
    return json({
      ok: true, action: "still-pending", status: sale.status,
      saleId, mpStatus, paymentId: String(payment.id),
    });
  } catch (e) {
    console.error("[mp-check-payment] error:", e);
    return json({ error: String(e) }, 500);
  }
});
