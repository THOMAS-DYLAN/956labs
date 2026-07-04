import { serve }        from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  const url   = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return html("Missing token", false);
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await sb
      .from("orders")
      .update({ status: "payment_processed", confirmed_at: new Date().toISOString() })
      .eq("confirm_token", token)
      .eq("status", "processing")
      .select("id");
    if (error) throw error;
    const count = data?.length ?? 0;
    if (count === 0) return html("Already confirmed or not found.", false);
    return html(`${count} item${count !== 1 ? "s" : ""} confirmed.`, true);
  } catch (err) {
    return html("Error: " + String(err), false);
  }
});

function html(message: string, success: boolean): Response {
  const color = success ? "#006847" : "#CE1126";
  const icon  = success ? "✓" : "✗";
  const body  = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${icon} Order ${success?"Confirmed":"Error"}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f6;font-family:Arial,sans-serif;padding:24px}.card{background:#fff;border:1px solid #E0E0E0;padding:40px 48px;text-align:center;max-width:400px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.08)}.icon{font-size:3rem;color:${color};margin-bottom:12px}h1{font-size:1.4rem;color:#111;margin-bottom:8px}p{font-size:.9rem;color:#666;margin-bottom:20px}.close{font-size:.75rem;color:#aaa}</style>
</head><body><div class="card"><div class="icon">${icon}</div><h1>${success?"Payment Confirmed":"Error"}</h1><p>${message}</p><div class="close">This tab will close automatically…</div></div>
<script>setTimeout(function(){window.close();},2500);</script></body></html>`;
  return new Response(body, { status: success?200:400, headers:{"Content-Type":"text/html; charset=utf-8","Access-Control-Allow-Origin":"*"} });
}
