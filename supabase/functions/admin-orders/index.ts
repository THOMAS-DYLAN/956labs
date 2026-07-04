// ═══════════════════════════════════════════════════════════
// Unified Admin Edge Function — BigBoyPeps + 956 Labs
// Handles: orders, products, coupon codes, deals
//
// Deploy: supabase functions deploy admin-orders --no-verify-jwt
// ═══════════════════════════════════════════════════════════
import { serve }        from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "bbpadmin2025";

const cors = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body     = await req.json();
    const { password, action, token } = body;
    const site     = body.site === "956labs" ? "956labs" : "bbp";

    if (password !== ADMIN_PASSWORD) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    // ══════════════════════════════════════════════════
    // ORDERS
    // ══════════════════════════════════════════════════

    if (action === "confirm" && token) {
      let q = sb.from("orders")
        .update({ status: "payment_processed", confirmed_at: new Date().toISOString() })
        .eq("confirm_token", token)
        .in("status", ["processing","pending_cashapp","pending_zelle","pending_bitcoin"]);
      if (site === "956labs") q = q.eq("source_site","956labs");
      else q = q.or("source_site.eq.bbp,source_site.is.null");
      const { data, error } = await q.select("id");
      if (error) throw error;
      return json({ ok: true, updated: data?.length ?? 0 });
    }

    if (!action || action === "listOrders") {
      let q = sb.from("orders").select("*").order("ordered_at", { ascending: false }).limit(200);
      if (site === "956labs") q = q.eq("source_site","956labs");
      else q = q.or("source_site.eq.bbp,source_site.is.null");
      const { data: orders, error } = await q;
      if (error) throw error;
      return json({ orders: orders || [] });
    }

    // ══════════════════════════════════════════════════
    // PRODUCTS
    // ══════════════════════════════════════════════════

    if (action === "getProducts") {
      const { data, error } = await sb
        .from("products")
        .select("id, name, category, price, bundle_price, inventory, active, images")
        .order("id");
      if (error) throw error;
      return json({ products: data || [] });
    }

    if (action === "updateProduct") {
      const { id, price, bundle_price, inventory } = body;
      if (!id) return json({ error: "Missing id" }, 400);
      const updates: Record<string, unknown> = {};
      if (price        !== undefined) updates.price        = Number(price);
      if (bundle_price !== undefined) updates.bundle_price = bundle_price !== null ? Number(bundle_price) : null;
      if (inventory    !== undefined) updates.inventory    = Number(inventory);
      const { error } = await sb.from("products").update(updates).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "addProduct") {
      const { name, category, price, bundle_price, inventory, potency, description, images } = body;
      if (!name || price === undefined) return json({ error: "Missing name or price" }, 400);

      const insertPayload = {
        name,
        category:     category || null,
        price:        Number(price),
        bundle_price: bundle_price ? Number(bundle_price) : null,
        inventory:    Number(inventory) || 0,
        potency:      Number(potency)   || 3,
        description:  description       || null,
        images:       images            || null,
        active:       true,
      };

      console.log("addProduct payload:", JSON.stringify(insertPayload));

      const { data, error } = await sb.from("products").insert(insertPayload).select("id");

      if (error) {
        console.error("addProduct DB error:", error.message, error.details, error.hint, error.code);
        return json({
          error: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        }, 500);
      }

      return json({ ok: true, id: data?.[0]?.id });
    }

    if (action === "uploadImage") {
      const { filename, imageBase64 } = body;
      if (!filename || !imageBase64) return json({ error: "Missing filename or imageBase64" }, 400);

      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "-");

      try {
        // Decode base64 to bytes using a reliable loop (avoids memory issues with atob spread)
        const binaryStr = atob(imageBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const { error: storageError } = await sb.storage
          .from("product-images")
          .upload(safeName, bytes, {
            contentType: "image/png",
            upsert:      true,
          });

        if (storageError) {
          console.error("Storage error:", storageError.message, storageError);
          return json({ error: storageError.message, details: storageError }, 500);
        }

        return json({ ok: true, filename: safeName });
      } catch (uploadErr) {
        console.error("uploadImage error:", String(uploadErr));
        return json({ error: String(uploadErr) }, 500);
      }
    }

    // ══════════════════════════════════════════════════
    // COUPON CODES
    // ══════════════════════════════════════════════════

    if (action === "getCoupons") {
      const { data, error } = await sb
        .from("coupon_codes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ coupons: data || [] });
    }

    if (action === "addCoupon") {
      const { code, discount_pct, uses_limit, expires_at } = body;
      if (!code || !discount_pct) return json({ error: "Missing code or discount_pct" }, 400);
      const { error } = await sb.from("coupon_codes").insert({
        code: code.toUpperCase().trim(),
        discount_pct: Number(discount_pct),
        uses_limit:   uses_limit || null,
        expires_at:   expires_at || null,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "toggleCoupon") {
      const { id, active } = body;
      const { error } = await sb.from("coupon_codes").update({ active }).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "deleteCoupon") {
      const { id } = body;
      const { error } = await sb.from("coupon_codes").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    // ══════════════════════════════════════════════════
    // DEALS
    // ══════════════════════════════════════════════════

    if (action === "getDeals") {
      const { data, error } = await sb
        .from("deals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ deals: data || [] });
    }

    if (action === "addDeal") {
      const { name, type, scope, discount_pct, expires_at } = body;
      if (!name || !type || !discount_pct) return json({ error: "Missing fields" }, 400);
      const { error } = await sb.from("deals").insert({
        name,
        type,
        scope: scope || null,
        discount_pct: Number(discount_pct),
        expires_at:   expires_at || null,
      });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "toggleDeal") {
      const { id, active } = body;
      const { error } = await sb.from("deals").update({ active }).eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "deleteDeal") {
      const { id } = body;
      const { error } = await sb.from("deals").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);

  } catch (err) {
    console.error("admin-orders error:", err);
    return json({ error: String(err) }, 500);
  }
});
