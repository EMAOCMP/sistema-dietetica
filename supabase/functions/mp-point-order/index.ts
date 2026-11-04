// ============================================================
// Edge Function: mp-point-order
//
// Mercado Pago POINT (terminal Point Smart 1 / Point Smart 2).
// Crea "orders" de cobro que se envian a la terminal, la que recibe
// el pago del cliente (tarjeta, contactless o QR).
//
// API de MP: POST /v1/orders  (Orders API, la nueva)
//
// Acciones (p_action):
//   list      -> lista las terminales de la cuenta
//   create    -> crea la order para una venta pendiente
//   status    -> consulta el estado de la order
//   simulate  -> simula el estado final (SOLO pruebas, sin terminal)
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

/** Token de MP segun el modo pedido (test por defecto). */
function mpToken(mode: "test" | "prod" = "test"): string | null {
  if (mode === "prod") return Deno.env.get("MP_ACCESS_TOKEN") || null;
  return Deno.env.get("MP_ACCESS_TOKEN_TEST") || Deno.env.get("MP_ACCESS_TOKEN") || null;
}

/** Header de idempotencia para que MP no duplique la orden. */
function idempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Lista las terminales de la cuenta. */
async function listTerminals(mode: "test" | "prod") {
  const token = mpToken(mode);
  if (!token) return { error: "Falta MP_ACCESS_TOKEN_TEST", terminals: [] };

  const resp = await fetch("https://api.mercadopago.com/terminals/v1/list", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: `MP ${resp.status}: ${err?.message || "no se pudo listar"}`, terminals: [] };
  }
  const data = await resp.json();
  return { terminals: data?.results ?? data?.terminals ?? [] };
}

/** Amount con EXACTAMENTE 2 decimales, como string (requisito de la API). */
function mpAmount(value: number): string {
  return Number(value).toFixed(2);
}

/** Normaliza el external_reference: max 64 chars, solo letras/numeros/-/_ */
function safeExternalRef(ref: string): string {
  return ref.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    if (!(await isAuthenticated(req))) {
      return json({ error: "Sesión inválida o expirada" }, 401);
    }

    let body: Record<string, any> = {};
    try { body = await req.json(); } catch { /* body vacío */ }

    const action = String(body?.p_action ?? "create");
    const mode: "test" | "prod" = body?.p_mode === "prod" ? "prod" : "test";

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // =========================================================
    // list: terminales disponibles
    // =========================================================
    if (action === "list") {
      const r = await listTerminals(mode);
      if (r.error) return json({ error: r.error, terminals: [] }, 502);
      return json({ ok: true, terminals: r.terminals });
    }

    const saleId = String(body?.p_sale_id ?? body?.sale_id ?? "").trim();

    // =========================================================
    // create: crea la order para una venta pendiente
    // =========================================================
    if (action === "create") {
      if (!saleId) return json({ error: "Falta p_sale_id" }, 400);

      const token = mpToken(mode);
      if (!token) return json({ error: "Falta MP_ACCESS_TOKEN_TEST" }, 503);

      // 1) Leer la venta
      const { data: sale, error: saleErr } = await admin
        .from("sales")
        .select("id, status, total_amount, mp_external_ref, mp_order_id, customer_name")
        .eq("id", saleId)
        .maybeSingle();
      if (saleErr) return json({ error: saleErr.message }, 500);
      if (!sale) return json({ error: "Venta no encontrada" }, 404);
      if (sale.status === "completed") {
        return json({ ok: true, action: "already-completed", saleId });
      }
      if (sale.status === "cancelled") {
        return json({ ok: true, action: "already-cancelled", saleId });
      }
      if (sale.mp_order_id) {
        return json({
          ok: true, action: "order-exists", saleId, orderId: sale.mp_order_id,
        });
      }

      const externalRef = safeExternalRef(sale.mp_external_ref || `SALE-${saleId}`);
      if (!externalRef) return json({ error: "La venta no tiene mp_external_ref válido" }, 400);

      // 2) Terminal: la que manda el request o la configurada activa
      let terminalId = String(body?.terminal_id ?? "").trim();
      let printOnTerminal = String(body?.print_on_terminal ?? "seller_ticket");
      let defaultMethod: string | null = body?.default_payment_method ?? null;

      if (!terminalId) {
        const { data: cfg } = await admin
          .from("mp_point_config")
          .select("terminal_id, print_on_terminal, default_payment_method")
          .eq("active", true)
          .limit(1)
          .maybeSingle();
        if (!cfg) {
          return json({
            error: "No hay terminal Point configurada",
            detalle: "Configurala en Configuración > Mercado Pago > Terminal Point, o pasa terminal_id.",
          }, 400);
        }
        terminalId = cfg.terminal_id;
        printOnTerminal = cfg.print_on_terminal || printOnTerminal;
        defaultMethod = cfg.default_payment_method ?? defaultMethod;
      }

      // 3) Crear la order (payload minimo, segun la guia de MP)
      const orderPayload: Record<string, unknown> = {
        type: "point",
        external_reference: externalRef,
        expiration_time: "PT10M",
        transactions: {
          payments: [{ amount: mpAmount(Number(sale.total_amount || 0)) }],
        },
        config: {
          point: {
            terminal_id: terminalId,
            print_on_terminal: printOnTerminal,
          },
        },
        description: `Venta ${externalRef}`.slice(0, 150),
      };
      if (defaultMethod) {
        orderPayload.config = {
          ...(orderPayload.config as any),
          payment_method: { default_type: defaultMethod },
        };
      }

      const resp = await fetch("https://api.mercadopago.com/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Idempotency-Key": idempotencyKey(),
        },
        body: JSON.stringify(orderPayload),
      });

      const order = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error("[mp-point-order] MP error:", resp.status, JSON.stringify(order));
        return json({
          error: `MP ${resp.status}: ${order?.message || "no se pudo crear la order"}`,
          detalle: order,
        }, 502);
      }

      const orderId = order?.id ?? null;
      const paymentId = order?.transactions?.payments?.[0]?.id ?? null;

      // 4) Guardar el id de la order en la venta
      await admin
        .from("sales")
        .update({
          mp_order_id: orderId,
          mp_payment_id: paymentId,
          mp_preference_id: orderId,
          mp_link: order?.init_point ?? order?.sandbox_init_point ?? null,
        })
        .eq("id", saleId);

      return json({
        ok: true,
        action: "order-created",
        saleId,
        orderId,
        paymentId,
        status: order?.status ?? null,
        terminalId,
        amount: mpAmount(Number(sale.total_amount || 0)),
        // Si el cliente quiere ver el QR/estado de la order:
        detalle: order,
      });
    }

    // =========================================================
    // status: consulta el estado de la order
    // =========================================================
    if (action === "status") {
      const orderId = String(body?.order_id ?? body?.p_order_id ?? "").trim();
      if (!orderId) return json({ error: "Falta order_id" }, 400);

      const token = mpToken(mode);
      if (!token) return json({ error: "Falta MP_ACCESS_TOKEN_TEST" }, 503);

      const resp = await fetch(
        `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return json({ error: `MP ${resp.status}: ${data?.message || "no se pudo consultar"}` }, 502);
      }
      return json({ ok: true, order: data, status: data?.status ?? null });
    }

    // =========================================================
    // simulate: simula el estado final (SOLO con token de prueba)
    // =========================================================
    if (action === "simulate") {
      const orderId = String(body?.order_id ?? body?.p_order_id ?? "").trim();
      const target = String(body?.status ?? "processed");
      if (!orderId) return json({ error: "Falta order_id" }, 400);

      // Nunca simular en produccion.
      if (mode === "prod") {
        return json({ error: "La simulacion solo se permite en modo prueba" }, 400);
      }
      const token = mpToken("test");
      if (!token) return json({ error: "Falta MP_ACCESS_TOKEN_TEST" }, 503);

      const resp = await fetch(
        `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            status: target,
            payment_method_type: body?.payment_method_type ?? "credit_card",
            installments: Number(body?.installments ?? 1),
            payment_method_id: body?.payment_method_id ?? "visa",
            status_detail: body?.status_detail ?? "accredited",
          }),
        },
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return json({ error: `MP ${resp.status}: ${err?.message || "no se pudo simular"}` }, 502);
      }
      return json({
        ok: true,
        action: "simulated",
        orderId,
        status: target,
        detalle: "MP tarda hasta 10s en aplicar el estado y avisar por webhook",
      });
    }

    return json({ error: `Acción desconocida: ${action}` }, 400);
  } catch (e) {
    console.error("[mp-point-order] error:", e);
    return json({ error: String(e) }, 500);
  }
});
