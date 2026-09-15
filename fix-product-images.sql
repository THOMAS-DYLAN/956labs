-- ═══════════════════════════════════════════════════════════════
-- CTXLabz / 956 Labs — Product Image Fixes
-- Supabase project: Big Boy Pep (utqviljholfvpfztfuvx)
-- Table: public.products
-- Generated: 2026-09-15
--
-- Both storefronts (CTXLabz + 956 Labs) read images from this SAME
-- products table, so any fix here applies to both sites at once.
-- ═══════════════════════════════════════════════════════════════

-- 1) BPC-157 10mg (id 2) — images column points to a file that does
--    not exist on either site ("bpc-157-5mg.png"). The real file on
--    disk in both "pdct img" folders is "bpc-157-10mg.png", which
--    matches the product name/dose. Safe fix:
UPDATE public.products
SET images = 'bpc-157-10mg.png'
WHERE id = 2;

-- 2) Triz 40mg (id 98) — images column points to "triz-30mg.png",
--    which does not exist anywhere. The only Triz photo that exists
--    is "triz-10mg.png" (label on the vial literally reads "TRIZ 10 mg"),
--    which I've now copied into both sites' "pdct img" folders.
--    NOTE: the product is named/priced as "Triz 40mg" but the only
--    photo says 10mg — that's a real data mismatch, not just a
--    filename issue. This statement wires up the image so it at
--    least displays instead of falling back to the generic vial icon,
--    but you should confirm whether the product should actually be
--    renamed to "Triz 10mg" (and re-priced/re-inventoried to match)
--    or whether it needs its own real 40mg photo taken.
UPDATE public.products
SET images = 'triz-10mg.png'
WHERE id = 98;

-- 3) Wolverine 20mg (id 99) — images column points to
--    "vigil-80-20mg.png", which does not exist on either site at all.
--    Right now this renders as a broken image icon on the storefront.
--    Setting it to NULL makes it fall back to the styled CSS vial
--    shape instead, until a real photo exists. Uncomment when ready:
-- UPDATE public.products
-- SET images = NULL
-- WHERE id = 99;

-- ═══════════════════════════════════════════════════════════════
-- Products with NO photo at all (images IS NULL) — these already
-- fall back cleanly to the CSS vial icon, so no SQL fix needed,
-- just listed here as a to-do for product photography:
--   90  DSIP
--   91  Glutathione
--   92  IGF 1MG
--   93  MT-1
--   94  MT-2
--   95  5 AMINO
--   96  VIP 5MG
--   97  NAD 500
--   100 CAG 5mg
--   101 LL-37 10mg
-- ═══════════════════════════════════════════════════════════════

-- Verify after running:
-- SELECT id, name, images FROM public.products ORDER BY id;
