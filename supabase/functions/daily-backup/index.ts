// ============================================================
// Edge Function: daily-backup
// Exporta a JSON las ventas de las últimas 24 h (con ítems y
// pagos), gastos, últimos 3 cierres de caja y un snapshot de
// productos, y lo sube al bucket privado "backups".
//
// Despliegue:
//   supabase functions deploy daily-backup --no-verify-jwt
// Programación: supabase/backup_automatico.sql (pg_cron a las 04 ART).
// Variables (automáticas en Supabase): SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ error: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 503);

    const admin = createClient(url, key);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const stamp = new Date().toISOString().slice(0, 10);

    const safe = async <T>(label: string, p: PromiseLike<{ data: T | null; error: any }>): Promise<T> => {
      const { data, error } = await p;
      if (error) console.warn(`[backup] ${label}:`, error.message || error);
      return (data ?? []) as T;
    };

    const sales = await safe<any[]>("sales",
      admin.from("sales").select("*").gte("created_at", since).order("created_at"));
    const saleIds = sales.map((s) => s.id);

    let items: any[] = [];
    let payments: any[] = [];
    if (saleIds.length > 0) {
      items = await safe<any[]>("sale_items",
        admin.from("sale_items").select("*").in("sale_id", saleIds));
      payments = await safe<any[]>("payments",
        admin.from("payments").select("*").in("sale_id", saleIds));
    }

    const expenses = await safe<any[]>("expenses",
      admin.from("expenses").select("*").gte("created_at", since));

    const cashCloses = await safe<any[]>("cash_closes",
      admin.from("cash_closes").select("*").order("business_date", { ascending: false }).limit(3));

    const products = await safe<any[]>("products",
      admin.from("products")
        .select("id, name, barcode, category, unit_type, cost_price, wholesale_price, retail_price, stock_quantity, min_stock, is_active, expiry_date, supplier_id"));

    const payload = {
      generated_at: new Date().toISOString(),
      window_start: since,
      counts: {
        sales: sales.length,
        sale_items: items.length,
        payments: payments.length,
        expenses: expenses.length,
        cash_closes: cashCloses.length,
        products: products.length,
      },
      sales,
      sale_items: items,
      payments,
      expenses,
      cash_closes: cashCloses,
      products,
    };

    const path = `backup-${stamp}.json`;
    const { error: upErr } = await admin.storage
      .from("backups")
      .upload(path, JSON.stringify(payload), {
        contentType: "application/json",
        upsert: true,
      });
    if (upErr) return json({ error: `Upload falló: ${upErr.message}` }, 500);

    return json({ ok: true, path, counts: payload.counts });
  } catch (e) {
    console.error("[backup] error inesperado:", e);
    return json({ error: String(e) }, 500);
  }
});
