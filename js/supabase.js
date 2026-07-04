// ═══════════════════════════════════════════════════════
// 956 Labs — Supabase Client
//
// SETUP: Replace YOUR_ANON_KEY_HERE with your anon/public
// key from: Supabase → Project Settings → API → anon key
// Never commit the real key to a public repo.
// ═══════════════════════════════════════════════════════

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://utqviljholfvpfztfuvx.supabase.co',
  'sb_publishable_QMnUkvFkxKjGY2G6qeL_GA_Kel0HQae'
);
