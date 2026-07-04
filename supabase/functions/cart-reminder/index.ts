// ═══════════════════════════════════════════════════════════
// Cart Reminder Edge Function
// Runs daily via pg_cron — sends abandonment emails on schedule:
//   Reminder 1: 7 days after last cart update
//   Reminder 2: 7 days after reminder 1
//   Reminder 3: 30 days after reminder 2
//   Reminder 4+: every 30 days after that
//
// Deploy: supabase functions deploy cart-reminder
// ═══════════════════════════════════════════════════════════

import { serve }        from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL     = "noreply@bigboypeps.com";
const STORE_NAME     = "956 Labs";
const SHOP_URL       = "https://956labs.bigboypeps.com/index.html";

// Days between reminders: [first, second, third, monthly...]
const REMINDER_DELAYS = [7, 7, 30]; // after 3rd, every 30 days

serve(async (req) => {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const now = new Date();
    const testEmail = new URL(req.url).searchParams.get("test");

    let reminders: any[];

    if (testEmail) {
      reminders = [{
        id: "test", user_id: "test-uid", email: testEmail,
        source: 'bbp', reminder_count: 0, last_reminder: null,
        last_cart_update: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        cart_snapshot: [
          { name: "Semaglutide 10mg", qty: 2, price: 16, isBundle: false },
          { name: "BPC-157 10mg",     qty: 1, price: 45, isBundle: false },
        ],
      }];
    } else {
      const { data, error } = await sb
        .from("cart_reminders")
        .select("*")
        .eq("converted", false)
        .not("cart_snapshot", "is", null);
      if (error) throw error;
      reminders = data ?? [];
    }

    if (!reminders.length) {
      return new Response(JSON.stringify({ sent: 0, msg: "No active carts" }), { status: 200 });
    }

    let sent = 0, skipped = 0;

    for (const row of reminders) {
      const cartItems = row.cart_snapshot as Array<{ name: string; qty: number; price: number; isBundle?: boolean }>;
      if (!cartItems?.length) continue;

      // Determine if it's time to send
      const count       = row.reminder_count as number;
      const delayDays   = REMINDER_DELAYS[Math.min(count, REMINDER_DELAYS.length - 1)];
      const delayMs     = delayDays * 24 * 60 * 60 * 1000;
      const lastActivity = new Date(row.last_reminder ?? row.last_cart_update);
      const msSinceLast  = now.getTime() - lastActivity.getTime();

      if (msSinceLast < delayMs && row.id !== 'test') { skipped++; continue; }

      // Build email
      const subject = count === 0
        ? `You left something behind — ${STORE_NAME}`
        : count === 1
        ? `Still thinking it over? — ${STORE_NAME}`
        : `Your cart is waiting — ${STORE_NAME}`;

      const itemRows = cartItems.map(i =>
        `<tr>
          <td style="padding:8px 16px;border-bottom:1px solid #eee;font-size:13px;color:#222">${i.name}${i.isBundle ? " <span style='background:#006847;color:#fff;font-size:10px;padding:1px 5px;border-radius:2px'>BUNDLE</span>" : ""}</td>
          <td style="padding:8px 16px;border-bottom:1px solid #eee;font-size:13px;color:#444;text-align:center">×${i.qty}</td>
          <td style="padding:8px 16px;border-bottom:1px solid #eee;font-size:13px;color:#111;text-align:right;font-weight:700">$${(i.price * i.qty).toFixed(2)}</td>
        </tr>`
      ).join("");

      const total = cartItems.reduce((sum, i) => sum + i.price * i.qty, 0);

      const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff">

  <div style="background:#111;padding:24px 32px;display:flex;align-items:center;gap:12px">
    <span style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1.8rem;letter-spacing:.08em;color:#fff">956 <span style="color:#006847">Labs</span></span>
  </div>

  <div style="padding:32px">
    <p style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#006847;margin:0 0 8px">Your Cart</p>
    <h2 style="font-family:Arial,sans-serif;font-size:22px;font-weight:900;color:#111;margin:0 0 16px">
      ${count === 0 ? "You left something in your cart." : count === 1 ? "Still thinking it over?" : "Your cart is still waiting."}
    </h2>
    <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 24px">
      ${count === 0
        ? "You added items to your cart but didn't complete your order. They're still available — but stock moves fast."
        : "Just a reminder that your cart is saved and ready when you are. Items are research-grade and for licensed purposes only."
      }
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #eee;margin-bottom:24px">
      <thead>
        <tr style="background:#f9f9f9">
          <th style="padding:8px 16px;text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888">Product</th>
          <th style="padding:8px 16px;text-align:center;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888">Qty</th>
          <th style="padding:8px 16px;text-align:right;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#888">Price</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding:8px 16px;font-size:12px;color:#888">Discount <span style="background:#006847;color:#fff;font-size:10px;padding:1px 6px;border-radius:2px;font-weight:700;letter-spacing:.06em">DYLAN10</span></td>
          <td style="padding:8px 16px;font-size:13px;color:#006847;text-align:right;font-weight:700">-$${(total * 0.10).toFixed(2)}</td>
        </tr>
        <tr>
          <td colspan="2" style="padding:10px 16px;font-size:13px;font-weight:700;color:#111;border-top:1px solid #eee">Total with DYLAN10</td>
          <td style="padding:10px 16px;font-size:16px;font-weight:900;color:#006847;text-align:right;border-top:1px solid #eee">$${(total * 0.90).toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>

  </div>

  <!-- CTA block — full-width background breaks Gmail signature detection -->
  <div style="background:${row.source === '956labs' ? '#006847' : '#111111'};padding:28px 32px;text-align:center">
    <p style="margin:0 0 16px;font-size:13px;color:#cccccc;line-height:1.6">Ready to complete your order? Use code <strong style="color:${row.source === '956labs' ? '#ffffff' : '#006847'}">DYLAN10</strong> for 10% off.</p>
    <a href="${row.source === '956labs' ? 'https://956labs.bigboypeps.com/index.html' : SHOP_URL}" style="display:inline-block;background:#006847;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:14px 36px;text-decoration:none;border-radius:3px">
      Complete My Order →
    </a>
  </div>

  <div style="background:#f6f6f6;padding:16px 32px;text-align:center;border-top:2px solid #CE1126">
    <p style="margin:0;font-size:11px;color:#999999;line-height:1.6">
      For research purposes only &middot; Not for human consumption<br>
      <a href="https://956labs.bigboypeps.com/index.html?unsubscribe=${row.user_id}" style="color:#bbbbbb;text-decoration:underline">Unsubscribe</a>
    </p>
  </div>

  <div style="display:none">
  </div>

</div></div>
</body>
</html>`;

      // Send email
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from:    `${STORE_NAME} <${FROM_EMAIL}>`,
          to:      [row.email],
          subject,
          html,
        }),
      });

      if (res.ok) {
        // Update reminder count and timestamp
        if (row.id !== "test") {
        await sb
          .from("cart_reminders")
          .update({
            last_reminder:  now.toISOString(),
            reminder_count: count + 1,
          })
          .eq("id", row.id);
      }
        sent++;
      } else {
        console.error("Resend failed:", await res.text());
      }
    }

    return new Response(JSON.stringify({ sent, skipped }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("cart-reminder error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
