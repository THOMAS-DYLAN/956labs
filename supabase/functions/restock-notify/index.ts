// ═══════════════════════════════════════════════════════════════
// 956 Labs — Restock Notify Edge Function
// Supabase Edge Function (Deno runtime)
// ═══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Environment variables
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const FROM_EMAIL = 'noreply@956labs.ctxlabz.com';

// Types
interface ProductRow {
  id: string;
  name: string;
  inventory: number;
}

interface WebhookPayload {
  record: ProductRow;
  old_record: ProductRow | null;
}

interface WaitlistEntry {
  id: string;
  email: string;
  name: string | null;
}

// Main handler
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const payload: WebhookPayload = await req.json();

    const newRow = payload.record;
    const oldRow = payload.old_record;

    // Only trigger on 0 → positive inventory
    if (!newRow || (oldRow?.inventory ?? 0) > 0 || newRow.inventory <= 0) {
      return new Response('No action needed', { status: 200 });
    }

    const productId = newRow.id;
    const productName = newRow.name;

    // Supabase client
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY
    );

    // Fetch waitlist
    const { data: waitlist, error: wErr } = await supabase
      .from('waitlist')
      .select('id, email, name')
      .eq('product_id', productId)
      .eq('notified', false);

    if (wErr) {
      throw new Error(`Waitlist query failed: ${wErr.message}`);
    }

    const typedWaitlist = (waitlist ?? []) as WaitlistEntry[];

    if (typedWaitlist.length === 0) {
      return new Response('No waitlist entries', { status: 200 });
    }

    // Send emails
    const results = await Promise.allSettled(
      typedWaitlist.map((entry: WaitlistEntry) =>
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: entry.email,
            subject: `${productName} is back in stock — 956 Labs`,
            html: buildEmail(
              entry.name?.trim() || 'there',
              productName
            ),
          }),
        })
      )
    );

    const failed = results.filter(
      (r: PromiseSettledResult<Response>) => r.status === 'rejected'
    ).length;

    if (failed > 0) {
      console.error(`${failed} emails failed to send`);
    }

    // Mark notified
    const ids = typedWaitlist.map((e: WaitlistEntry) => e.id);

    await supabase
      .from('waitlist')
      .update({
        notified: true,
        notified_at: new Date().toISOString(),
      })
      .in('id', ids);

    return new Response(
      JSON.stringify({
        sent: typedWaitlist.length - failed,
        failed,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

  } catch (err: unknown) {
    console.error('restock-notify error:', err);

    const message =
      err instanceof Error
        ? err.message
        : 'Unknown error';

    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

// Email template
function buildEmail(
  firstName: string,
  productName: string
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#0c0c0c;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0c0c0c;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#141414;border:1px solid #2a2a2a;max-width:560px;width:100%;">

          <tr>
            <td style="background:#CC1F1F;padding:24px 36px;">
              <p style="margin:0;font-size:22px;font-weight:900;letter-spacing:4px;text-transform:uppercase;color:#fff;">
                BIGBOYPEPS
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:36px;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:4px;text-transform:uppercase;color:#CC1F1F;">
                Back In Stock
              </p>

              <h1 style="margin:0 0 20px;font-size:28px;font-weight:900;color:#ffffff;line-height:1.1;">
                Hey ${firstName},<br/>it's back.
              </h1>

              <p style="margin:0 0 28px;font-size:15px;color:#aaaaaa;line-height:1.7;">
                <strong style="color:#ffffff;">${productName}</strong>
                is back in stock.
              </p>

              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#CC1F1F;">
                    <a href="https://956labs.ctxlabz.com/index.html"
                      style="display:inline-block;padding:14px 32px;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#ffffff;text-decoration:none;">
                      Shop Now →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}