// ═══════════════════════════════════════════════════════════════
// BigBoyPeps — Products Module
//
// One import, one fetch. Products are loaded from Supabase once
// and cached in window.ProductCache so shop, cart, and dashboard
// all use identical data and rendering without duplicating logic.
//
// Usage:
//   import { loadProducts, getProduct, pepperSVG, miniPepperSVG, heatPips } from './products.js';
//   await loadProducts();              // fetches once, safe to call multiple times
//   const p = getProduct(id);          // lookup by numeric id
//   pepperSVG(p)                       // full-size SVG for shop grid
//   miniPepperSVG(p)                   // small SVG for cart / dashboard thumbnails
//   heatPips(p.potency)             // 5-pip heat meter HTML
// ═══════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// ── Cache ─────────────────────────────────────────────────────
const PRODUCTS_VERSION = '15';
const LS_KEY = 'bbp_products_v15';
const LS_TTL = 5 * 60 * 1000; // 5 minutes — background refresh keeps it fresh
let _loaded = false;

if (window.ProductCache?._version !== PRODUCTS_VERSION) {
  window.ProductCache = { _version: PRODUCTS_VERSION };
  _loaded = false;
} else {
  _loaded = Object.keys(window.ProductCache).filter(k => k !== '_version').length > 0;
}

function _saveToLS(r1data, r2data) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ r1: r1data, r2: r2data, ts: Date.now() }));
  } catch(_) {}
}

function _populateCache(r1data, r2data) {
  window.ProductCache = { _version: PRODUCTS_VERSION };
  (r1data || []).forEach(p => { window.ProductCache[p.id] = p; });
  if (r2data) {
    r2data.forEach(p => {
      if (window.ProductCache[p.id]) {
        window.ProductCache[p.id].description = p.description;
        window.ProductCache[p.id].lab_report  = p.lab_report;
      }
    });
  }
  _loaded = true;
}

async function _fetchFromSupabase() {
  const phase1 = supabase
    .from('products')
    .select('id, name, category, price, potency, badge, thumb_color, shape_key, images, inventory, active, bundle_price')
    .eq('active', true)
    .order('id');

  const phase2 = supabase
    .from('products')
    .select('id, description, lab_report')
    .eq('active', true);

  const [r1, r2] = await Promise.all([phase1, phase2]);

  if (r1.error) { console.error('loadProducts failed:', r1.error.message); return null; }
  if (!r1.data || r1.data.length === 0) { console.warn('loadProducts: 0 rows. Check RLS.'); }
  return { r1: r1.data || [], r2: r2.error ? [] : (r2.data || []) };
}

// Two-phase parallel fetch with localStorage caching.
// On cache hit → instant render, background refresh keeps data fresh.
// On cache miss → fetch from Supabase, save to localStorage.
export async function loadProducts() {
  if (_loaded) return;

  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const { r1, r2, ts } = JSON.parse(raw);
      if (r1?.length && Date.now() - ts < LS_TTL) {
        _populateCache(r1, r2);
        // Background refresh — silent, doesn't block render
        _fetchFromSupabase().then(fresh => {
          if (!fresh) return;
          _populateCache(fresh.r1, fresh.r2);
          _saveToLS(fresh.r1, fresh.r2);
        }).catch(() => {});
        return;
      }
    }
  } catch(_) {}

  // No cache or expired — fetch fresh
  const fresh = await _fetchFromSupabase();
  if (!fresh) return;
  _populateCache(fresh.r1, fresh.r2);
  _saveToLS(fresh.r1, fresh.r2);
}

export function getProduct(id) {
  return window.ProductCache[id] || null;
}

export function allProducts() {
  return Object.values(window.ProductCache).filter(p => typeof p === 'object' && p.id);
}

// ── Heat pip row ──────────────────────────────────────────────
export function heatPips(level) {
  return Array.from({ length: 5 }, (_, i) =>
    `<div class="pip${i < level ? ' on' : ''}"></div>`
  ).join('');
}

// ═══════════════════════════════════════════════════════════════
// SVG Pepper Shapes
// shape_key defines the vial shape for CSS fallback rendering.
// hue is derived from potency for CSS fallback vial color,
// medium are orange, mild are green — consistent everywhere.
// ═══════════════════════════════════════════════════════════════

function hueFromHeat(level) {
  if (level >= 5) return '#CC1F1F';
  if (level >= 3) return '#c05010';
  return '#4a7a20';
}

// Full-size — used in shop grid (200px tall thumbnail)
// Uses real product image if available, falls back to CSS vial shape
export function pepperSVG(product) {
  if (product.images) {
    var _imgSrc = product.images.startsWith('http') ? product.images : 'pdct img/' + product.images;
    return '<img src="' + _imgSrc + '" alt="' + product.name + '" style="width:auto;height:160px;object-fit:contain;object-position:center;position:relative;z-index:1;display:block;margin:auto" />';
  }
  const hue   = hueFromHeat(product.potency);
  const shape = product.shape_key || 'tall';
  return SHAPES_FULL[shape]?.(hue) ?? SHAPES_FULL.tall(hue);
}

export function miniPepperSVG(product) {
  if (product.images) {
    var _miniSrc = product.images.startsWith('http') ? product.images : 'pdct img/' + product.images;
    return '<img src="' + _miniSrc + '" alt="' + product.name + '" style="width:auto;height:52px;object-fit:contain;object-position:center;display:block;margin:auto" />';
  }
  const hue   = hueFromHeat(product.potency);
  const shape = product.shape_key || 'tall';
  return SHAPES_MINI[shape]?.(hue) ?? SHAPES_MINI.tall(hue);
}

// ── Full-size shape library ───────────────────────────────────
const SHAPES_FULL = {
  tall: (c) => `
    <svg width="70" height="110" viewBox="0 0 70 110" fill="none">
      <path d="M35 10C25 10 18 25 18 50C18 78 25 100 35 102C45 100 52 78 52 50C52 25 45 10 35 10Z" fill="${c}" opacity=".8"/>
      <path d="M35 10C34 4 37 1 39 3C41 5 38 8 35 10Z" fill="#555"/>
      <path d="M18 50C12 53 10 64 13 70" fill="${c}" opacity=".5"/>
      <ellipse cx="29" cy="38" rx="3" ry="4" fill="rgba(0,0,0,.3)"/>
      <ellipse cx="41" cy="38" rx="3" ry="4" fill="rgba(0,0,0,.3)"/>
    </svg>`,

  curved: (c) => `
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      <path d="M55 12C68 18 74 36 70 56C66 72 54 82 44 80C34 78 26 64 30 48C34 30 44 10 55 12Z" fill="${c}" opacity=".8"/>
      <path d="M55 12C53 5 57 1 60 4C63 7 58 10 55 12Z" fill="#555"/>
      <path d="M30 48C22 50 18 62 22 68" fill="${c}" opacity=".5"/>
      <ellipse cx="44" cy="40" rx="4" ry="5" fill="rgba(0,0,0,.25)"/>
    </svg>`,

  round: (c) => `
    <svg width="90" height="90" viewBox="0 0 90 90" fill="none">
      <ellipse cx="45" cy="52" rx="26" ry="30" fill="${c}" opacity=".8"/>
      <path d="M45 22C43 16 47 11 50 14C53 17 48 20 45 22Z" fill="#555"/>
      <ellipse cx="37" cy="46" rx="4" ry="5" fill="rgba(0,0,0,.25)"/>
      <ellipse cx="53" cy="46" rx="4" ry="5" fill="rgba(0,0,0,.25)"/>
    </svg>`,

  'birds-eye': (c) => `
    <svg width="100" height="70" viewBox="0 0 100 70" fill="none">
      <path d="M20 52C22 38 32 22 50 14C64 8 76 10 78 18C80 26 68 34 54 36C38 40 28 50 26 62" fill="${c}" opacity=".8"/>
      <path d="M26 62C22 68 18 72 22 70C26 68 28 64 26 62Z" fill="${c}" opacity=".6"/>
      <path d="M78 18C82 14 86 12 84 16C82 20 80 18 78 18Z" fill="#555"/>
    </svg>`,

  bundle: (c) => `
    <svg width="100" height="90" viewBox="0 0 100 90" fill="none">
      <path d="M60 10C70 14 74 28 70 46C66 60 58 70 52 70C46 68 42 58 46 44C50 28 52 12 60 10Z" fill="#2a7a2a" opacity=".75"/>
      <path d="M42 18C34 24 30 40 34 54C36 64 44 72 50 70C46 66 44 56 42 46C40 34 40 22 42 18Z" fill="${c}" opacity=".75"/>
      <path d="M26 28C20 36 20 52 24 62C27 70 34 76 40 74C36 70 34 60 32 50C30 38 28 34 26 28Z" fill="#c07010" opacity=".65"/>
      <path d="M60 10C58 4 62 1 64 4Z" fill="#555"/>
      <path d="M42 18C40 12 43 8 45 11Z" fill="#555"/>
      <path d="M26 28C23 22 26 18 28 21Z" fill="#555"/>
    </svg>`,
};

// ── Mini shape library ────────────────────────────────────────
const SHAPES_MINI = {
  tall: (c) => `
    <svg width="22" height="36" viewBox="0 0 70 110" fill="none">
      <path d="M35 10C25 10 18 25 18 50C18 78 25 100 35 102C45 100 52 78 52 50C52 25 45 10 35 10Z" fill="${c}" opacity=".85"/>
      <path d="M35 10C34 4 37 1 39 3Z" fill="#555"/>
    </svg>`,

  curved: (c) => `
    <svg width="34" height="34" viewBox="0 0 90 90" fill="none">
      <path d="M55 12C68 18 74 36 70 56C66 72 54 82 44 80C34 78 26 64 30 48C34 30 44 10 55 12Z" fill="${c}" opacity=".8"/>
      <path d="M55 12C53 5 57 1 60 4Z" fill="#555"/>
    </svg>`,

  round: (c) => `
    <svg width="32" height="34" viewBox="0 0 90 90" fill="none">
      <ellipse cx="45" cy="52" rx="26" ry="30" fill="${c}" opacity=".8"/>
      <path d="M45 22C43 16 47 11 50 14Z" fill="#555"/>
    </svg>`,

  'birds-eye': (c) => `
    <svg width="38" height="26" viewBox="0 0 100 70" fill="none">
      <path d="M20 52C22 38 32 22 50 14C64 8 76 10 78 18C80 26 68 34 54 36C38 40 28 50 26 62" fill="${c}" opacity=".85"/>
    </svg>`,

  bundle: (c) => `
    <svg width="36" height="32" viewBox="0 0 100 90" fill="none">
      <path d="M60 10C70 14 74 28 70 46C66 60 58 70 52 70Z" fill="#2a7a2a" opacity=".7"/>
      <path d="M42 18C34 24 30 40 34 54C36 64 44 72 50 70Z" fill="${c}" opacity=".8"/>
      <path d="M26 28C20 36 20 52 24 62Z" fill="#c07010" opacity=".6"/>
    </svg>`,
};
