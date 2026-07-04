// ═══════════════════════════════════════════════════════════
// Weekly Email — Unified Supabase Edge Function
// Sends branded weekly update to each user based on their
// signup source (bbp → BigBoyPeps email, 956labs → 956 Labs email).
// Falls back to order history, then defaults to bbp.
//
// Deploy: supabase functions deploy weekly-email --no-verify-jwt
// Schedule: Run via pg_cron every Monday at 9am CT
//   SELECT cron.schedule('weekly-email','0 14 * * 1',
//     $$SELECT net.http_post(
//       url := 'https://utqviljholfvpfztfuvx.supabase.co/functions/v1/weekly-email',
//       headers := '{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb,
//       body := '{}'::jsonb) AS request_id$$);
// ═══════════════════════════════════════════════════════════

import { serve }        from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Brand config ─────────────────────────────────────────
const BRANDS: Record<string, {
  name: string;
  from: string;
  shopUrl: string;
  unsubBase: string;
  headerBg: string;
  accentBg: string;
}> = {
  bbp: {
    name:        "BigBoyPeps",
    from:        "noreply@bigboypeps.com",
    shopUrl:     "https://bigboypeps.com/shop.html",
    unsubBase:   "https://bigboypeps.com/supabase/functions/v1/unsubscribe",
    headerBg:    "#006847",
    accentBg:    "#CE1126",
  },
  "956labs": {
    name:        "956 Labs",
    from:        "noreply@bigboypeps.com",
    shopUrl:     "https://956labs.bigboypeps.com/index.html",
    unsubBase:   "https://utqviljholfvpfztfuvx.supabase.co/functions/v1/unsubscribe",
    headerBg:    "#006847",
    accentBg:    "#CE1126",
  },
};

serve(async (req) => {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    // ── 1. Get all confirmed users ────────────────────────
    const testEmail = new URL(req.url).searchParams.get("test");
    const testSite  = new URL(req.url).searchParams.get("site") || "bbp";

    let users: { email: string; id: string; source?: string }[];

    if (testEmail) {
      users = [{ email: testEmail, id: "test-uid", source: testSite }];
      console.log("TEST MODE — sending to:", testEmail, "as site:", testSite);
    } else {
      const { data: authData, error: uErr } = await sb.auth.admin.listUsers();
      if (uErr) throw uErr;
      users = authData.users
        .filter(u =>
          u.email_confirmed_at &&
          u.email &&
          u.app_metadata?.subscribed !== false
        )
        .map(u => ({
          email:  u.email!,
          id:     u.id,
          source: (u.user_metadata?.source as string) || undefined,
        }));
    }

    if (!users.length) {
      return new Response(JSON.stringify({ sent: 0, msg: "No confirmed users" }), { status: 200 });
    }

    // ── 2. Resolve source for users without metadata ──────
    // Batch-fetch latest order source for users missing metadata source
    const unknownIds = users.filter(u => !u.source).map(u => u.id);
    const sourceMap: Record<string, string> = {};

    if (unknownIds.length) {
      // Get most recent order per user_id to determine their primary site
      const { data: orders } = await sb
        .from("orders")
        .select("user_id, source_site")
        .in("user_id", unknownIds)
        .order("ordered_at", { ascending: false });

      for (const o of orders ?? []) {
        if (o.user_id && o.source_site && !sourceMap[o.user_id]) {
          sourceMap[o.user_id] = o.source_site;
        }
      }
    }

    // Assign resolved source (metadata → order history → default bbp)
    const resolvedUsers = users.map(u => ({
      ...u,
      source: u.source || sourceMap[u.id] || "bbp",
    }));

    // ── 3. Pull products ──────────────────────────────────
    const { data: products } = await sb
      .from("products")
      .select("name, price, bundle_price, inventory, category")
      .eq("active", true)
      .order("inventory", { ascending: true });

    const inStock  = products?.filter(p => p.inventory > 0)  ?? [];
    const lowStock = products?.filter(p => p.inventory > 0 && p.inventory <= 5) ?? [];
    const bundles  = products?.filter(p => p.bundle_price && p.inventory >= 10) ?? [];
    const oos      = products?.filter(p => p.inventory === 0) ?? [];

    // ── 4. Build HTML per brand ───────────────────────────
    const week = new Date().toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric"
    });

    const productRow = (p: { name: string; price: number; inventory: number }) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial,sans-serif;font-size:13px;color:#222">${p.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial,sans-serif;font-size:13px;color:#444;text-align:right">$${p.price.toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial,sans-serif;font-size:13px;color:${p.inventory <= 5 ? '#CE1126' : '#006847'};text-align:right;font-weight:700">${p.inventory} left</td>
      </tr>`;

    const bundleRow = (p: { name: string; bundle_price: number; inventory: number }) =>
      `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial,sans-serif;font-size:13px;color:#222">${p.name} <span style="background:#006847;color:#fff;font-size:10px;padding:2px 6px;border-radius:2px;margin-left:6px">Bundle ×10</span></td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial,sans-serif;font-size:13px;color:#006847;text-align:right;font-weight:700">$${p.bundle_price.toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:Arial,sans-serif;font-size:13px;color:#444;text-align:right">${Math.floor(p.inventory / 10)} bundles</td>
      </tr>`;

    const buildHtml = (brand: typeof BRANDS[string]) => `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff">

    <!-- Header -->
    <div style="background:${brand.headerBg};padding:28px 32px">
      <h1 style="margin:0;font-family:'Bebas Neue',Arial,sans-serif;font-size:2rem;letter-spacing:.08em;color:#fff;line-height:1">${brand.name}</h1>
      <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,.7);letter-spacing:.1em;text-transform:uppercase">Weekly Research Update · ${week}</p>
    </div>

    <!-- Discount banner -->
    <div style="background:${brand.accentBg};padding:12px 32px;text-align:center">
      <p style="margin:0;font-size:13px;color:#fff;font-weight:700;letter-spacing:.05em">
        Use code <span style="background:#fff;color:${brand.accentBg};padding:2px 8px;border-radius:2px;font-weight:900;font-size:14px">DYLAN10</span> for 10% off your order
      </p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px">
      <p style="font-size:14px;color:#444;line-height:1.7;margin-top:0">
        Here's your weekly update from ${brand.name}. All products are for <strong>research purposes only</strong>.
      </p>

      ${inStock.length ? `
      <!-- In Stock -->
      <h2 style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#006847;border-bottom:2px solid #006847;padding-bottom:6px;margin-top:24px">
        In Stock (${inStock.length} products)
      </h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee">
        <thead>
          <tr style="background:#f9f9f9">
            <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;font-weight:700">Product</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;font-weight:700">Price</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;font-weight:700">Stock</th>
          </tr>
        </thead>
        <tbody>
          ${inStock.map(productRow).join("")}
        </tbody>
      </table>` : ""}

      ${bundles.length ? `
      <!-- Bundles -->
      <h2 style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#CE1126;border-bottom:2px solid #CE1126;padding-bottom:6px;margin-top:28px">
        Bundle Deals
      </h2>
      <p style="font-size:13px;color:#666;margin-top:4px;margin-bottom:12px">Save big with bundles of 10 vials at a discounted rate.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee">
        <thead>
          <tr style="background:#f9f9f9">
            <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;font-weight:700">Bundle</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;font-weight:700">Bundle Price</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888;font-weight:700">Available</th>
          </tr>
        </thead>
        <tbody>
          ${bundles.map(bundleRow).join("")}
        </tbody>
      </table>` : ""}

      ${lowStock.length ? `
      <!-- Low Stock Alert -->
      <div style="margin-top:24px;background:#fff5f5;border:1px solid #ffcccc;border-left:3px solid #CE1126;padding:12px 16px;border-radius:2px">
        <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#CE1126">⚠ Low Stock Alert</p>
        <p style="margin:6px 0 0;font-size:13px;color:#444">${lowStock.map(p => p.name).join(", ")} — order soon before they sell out.</p>
      </div>` : ""}

      ${oos.length ? `
      <!-- Out of Stock -->
      <p style="margin-top:20px;font-size:13px;color:#888">
        <strong>Currently out of stock:</strong> ${oos.map(p => p.name).join(", ")}. Join the waitlist on the product page to be notified when they return.
      </p>` : ""}

      <!-- CTA -->
      <div style="text-align:center;margin-top:32px">
        <a href="${brand.shopUrl}" style="display:inline-block;background:#006847;color:#fff;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:14px 32px;text-decoration:none;border-radius:3px">
          Shop Now →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f6f6f6;border-top:1px solid #eee;padding:20px 32px;text-align:center">
      <p style="margin:0;font-size:11px;color:#999;line-height:1.6">
        ${brand.name} · For research purposes only · Not for human consumption<br>
        You're receiving this because you have an account with us.<br>
        <a href="${brand.unsubBase}?uid=__UNSUBSCRIBE_UID__" style="color:#999">Unsubscribe</a>
      </p>
    </div>

  </div>
</body>
</html>`;

    // Pre-build both HTML templates (placeholders replaced per-user)
    const htmlTemplates: Record<string, string> = {
      bbp:      buildHtml(BRANDS.bbp),
      "956labs": buildHtml(BRANDS["956labs"]),
    };

    // ── 5. Send to all users ──────────────────────────────
    let sent = 0, failed = 0;
    const BATCH = 50;

    for (let i = 0; i < resolvedUsers.length; i += BATCH) {
      const batch = resolvedUsers.slice(i, i + BATCH);

      for (const user of batch) {
        const brand    = BRANDS[user.source] ?? BRANDS.bbp;
        const template = htmlTemplates[user.source] ?? htmlTemplates.bbp;
        const html     = template.replace("__UNSUBSCRIBE_UID__", user.id);
        const week     = new Date().toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric"
        });

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({
            from:    `${brand.name} <${brand.from}>`,
            to:      [user.email],
            subject: `${brand.name} Weekly Update — ${week}`,
            html,
          }),
        });

        if (res.ok) { sent++; }
        else { failed++; console.error("Resend failed:", user.email, user.source, await res.text()); }
      }

      if (i + BATCH < resolvedUsers.length) await new Promise(r => setTimeout(r, 500));
    }

    return new Response(JSON.stringify({ sent, failed, total: resolvedUsers.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("weekly-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
