// ═══════════════════════════════════════════════════════════
// Unsubscribe Edge Function
// GET /functions/v1/unsubscribe?uid=USER_ID
// Sets app_metadata.subscribed = false on auth.users
// Deploy: supabase functions deploy unsubscribe
// No SQL migration needed — uses auth.users app_metadata
// ═══════════════════════════════════════════════════════════

import { serve }        from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL     = "https://bigboypeps.com";

serve(async (req) => {
  const url = new URL(req.url);
  const uid = url.searchParams.get("uid");

  if (!uid) {
    return new Response(JSON.stringify({ error: "Missing uid" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Set subscribed = false in app_metadata (service-role only, user can't override)
    const { error } = await sb.auth.admin.updateUserById(uid, {
      app_metadata: { subscribed: false },
    });

    if (error) throw error;

    // Redirect back to site with confirmation flag
    return new Response(null, {
      status: 302,
      headers: { "Location": `${SITE_URL}/index.html?unsubscribed=1` },
    });

  } catch (err) {
    console.error("Unsubscribe error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
