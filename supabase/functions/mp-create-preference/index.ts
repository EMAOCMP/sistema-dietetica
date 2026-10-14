// ============================================================
// Edge Function: mp-create-preference
// Crea una preferencia de Checkout Pro en Mercado Pago.
//
// Modos:
//   - "test": usa MP_ACCESS_TOKEN_TEST (no cobra dinero real)
//   - "prod": usa MP_ACCESS_TOKEN (cobros REALES)
// El modo se resuelve: body.mode > secret MP_MODE > "test" (seguro por defecto).
//
// Secrets (Dashboard → Edge Functions → mp-create-preference → Secrets):
//   MP_ACCESS_TOKEN       = APP_USR-...        (producción)
//   MP_ACCESS_TOKEN_TEST  = APP_USR-...        (prueba)
//   MP_MODE               = "test" | "prod"    (opcional, default "test")
// ============================================================

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

type MpMode = "test" | "prod";

/** Resuelve el modo: body.mode > secret MP_MODE > "test" (seguro por defecto). */
function resolveMode(requested: unknown): MpMode {
  if (requested === "prod" || requested === "test") return requested;
  return Deno.env.get("MP_MODE") === "prod" ? "prod" : "test";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { title, amount, quantity = 1, external_reference, mode: requestedMode } = await req.json();
    if (!title || typeof amount !== "number" || amount <= 0) {
      return json({ error: "Se requieren title y amount > 0" }, 400);
    }

    const mode = resolveMode(requestedMode);
    const token = mode === "test"
      ? Deno.env.get("MP_ACCESS_TOKEN_TEST")
      : Deno.env.get("MP_ACCESS_TOKEN");
    if (!token) {
      // 200 + error en body para que supabase-js lo lea y el front muestre el motivo exacto.
      return json({
        error: mode === "test"
          ? "Falta el secret MP_ACCESS_TOKEN_TEST (Dashboard → Edge Functions → Secrets). Estás en modo PRUEBA."
          : "Falta el secret MP_ACCESS_TOKEN (Dashboard → Edge Functions → Secrets). Modo PRODUCCIÓN.",
        mode,
      }, 200);
    }

    // Origin del navegador que llama (para back_urls de retorno)
    const originHeader = req.headers.get("origin");
    const origin = originHeader && !originHeader.startsWith("null")
      ? new URL(originHeader).origin
      : new URL(req.url).origin;

    // MP rechaza back_urls http:// o IPs privadas (localhost, Tailscale).
    // Solo enviamos back_urls + auto_return cuando el origen es https válido
    // (producción con dominio). El pago funciona igual sin ellos.
    const isHttpsOrigin = origin.startsWith("https://");

    const preference: Record<string, unknown> = {
      items: [
        {
          title: String(title).slice(0, 60),
          quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
          unit_price: Math.round(Number(amount) * 100) / 100,
          currency_id: "ARS",
        },
      ],
      external_reference: external_reference ? String(external_reference).slice(0, 255) : undefined,
      statement_descriptor: "DIETETICA VISHAL",
    };

    if (isHttpsOrigin) {
      preference.back_urls = {
        success: `${origin}/?mp=success`,
        failure: `${origin}/?mp=failure`,
        pending: `${origin}/?mp=pending`,
      };
      preference.auto_return = "approved";
    }

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(preference),
    });

    const data = await resp.json();
    // MP devuelve init_point / sandbox_init_point (snake_case).
    if (!resp.ok || !data?.init_point) {
      console.error("[MP] error API:", resp.status, JSON.stringify(data));
      // 200 + error en body para que el front muestre el motivo real (token inválido, etc.).
      return json({
        error: data?.message || `Error API Mercado Pago (HTTP ${resp.status}). Revisá que el Access Token sea válido y corresponda al modo (${mode}).`,
        details: data,
        mode,
      }, 200);
    }

    return json({
      initPoint: data.init_point,
      sandboxInitPoint: data.sandbox_init_point || data.init_point,
      preferenceId: data.id,
      mode,
      isTest: mode === "test",
    });
  } catch (e) {
    console.error("[MP] excepción:", e);
    return json({ error: String(e) }, 500);
  }
});
