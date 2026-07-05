// ═══════════════════════════════════════════════════════
// 956 Labs — Cart + Shared UI
// ═══════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// ── Discount Codes — loaded from DB ─────────────────────
// Codes are managed in the admin panel (coupon_codes table).
// Falls back to empty object if the fetch fails.
let _couponMap = {}; // populated on first applyDiscount call
let _dealsCache = null; // active deals from DB

async function _loadCoupons() {
  if (Object.keys(_couponMap).length) return; // already loaded
  try {
    const { data } = await supabase
      .from('coupon_codes')
      .select('code, discount_pct')
      .eq('active', true);
    (data || []).forEach(r => {
      _couponMap[r.code.toUpperCase()] = { pct: Number(r.discount_pct), label: r.code };
    });
  } catch(e) { console.warn('Could not load coupon codes:', e); }
}

async function _loadDeals() {
  if (_dealsCache !== null) return _dealsCache;
  try {
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('deals')
      .select('*')
      .eq('active', true)
      .or('expires_at.is.null,expires_at.gt.' + now);
    _dealsCache = data || [];
  } catch(e) { _dealsCache = []; }
  return _dealsCache;
}

// Returns the best deal discount % for a given cart item array
// Each item: { id, category, price }
export async function getBestDeal(items) {
  const deals = await _loadDeals();
  if (!deals.length || !items.length) return null;
  let best = null;
  for (const deal of deals) {
    let applies = false;
    if (deal.type === 'storewide') {
      applies = true;
    } else if (deal.type === 'category') {
      applies = items.some(i => i.category === deal.scope);
    } else if (deal.type === 'product') {
      applies = items.some(i => i.name === deal.scope);
    }
    if (applies && (!best || deal.discount_pct > best.pct)) {
      best = { pct: Number(deal.discount_pct), label: deal.name };
    }
  }
  return best;
}

let _appliedDiscount = null; // { code, pct, label } or null

window.applyDiscount = async function(code) {
  const key   = (code || '').trim().toUpperCase();
  const errEl = document.getElementById('discount-err');
  const okEl  = document.getElementById('discount-ok');
  if (errEl) errEl.textContent = '';
  if (okEl)  okEl.textContent  = '';
  if (!key) { if (errEl) errEl.textContent = 'Enter a code first.'; return; }
  await _loadCoupons();
  const match = _couponMap[key];
  if (!match) { if (errEl) errEl.textContent = 'Invalid discount code.'; return; }
  _appliedDiscount = { code: match.label, pct: match.pct };
  if (okEl) okEl.textContent = match.pct + '% discount applied!';
  if (typeof window.renderCart === 'function') window.renderCart();
};

window.removeDiscount = function() {
  _appliedDiscount = null;
  const okEl = document.getElementById('discount-ok');
  if (okEl) okEl.textContent = '';
  if (typeof window.renderCart === 'function') window.renderCart();
};

window.getDiscount = function() { return _appliedDiscount; };

// ── Cart (localStorage, keyed per user) ─────────────────
window.Cart = {
  _key: 'bbp_cart_guest',

  async init() {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    this._key = uid ? `bbp_cart_${uid}` : 'bbp_cart_guest';
  },

  get()       { return JSON.parse(localStorage.getItem(this._key) || '[]'); },
  save(items) { localStorage.setItem(this._key, JSON.stringify(items)); },

  add(product) {
    const cached  = window.ProductCache?.[product.id];
    const liveInv = cached?.inventory ?? product.inventory ?? 0;
    if (liveInv <= 0) return { ok: false, err: 'out_of_stock' };

    const items      = this.get();
    const existing   = items.find(i => i.id === product.id && !i.isBundle);
    const currentQty = existing ? existing.qty : 0;
    if (currentQty + 1 > liveInv) return { ok: false, err: 'insufficient_stock', available: liveInv };

    if (existing) existing.qty += 1;
    else items.push({ id: product.id, name: product.name, price: product.price, qty: 1 });
    this.save(items);
    this.updateBadge();
    trackCartUpdate();
    return { ok: true };
  },

  addBundle(bundle) {
    // bundle = { id, name, price (bundle_price), bundleQty (10) }
    const cached  = window.ProductCache?.[bundle.id];
    const liveInv = cached?.inventory ?? 0;
    if (liveInv < bundle.bundleQty) return { ok: false, err: 'insufficient_stock' };

    const items    = this.get();
    const existing = items.find(i => i.id === bundle.id && i.isBundle);
    if (existing) {
      // Already have this bundle — check stock for another bundle of 10
      if ((existing.qty + 1) * bundle.bundleQty > liveInv) return { ok: false, err: 'insufficient_stock' };
      existing.qty += 1;
    } else {
      items.push({
        id:        bundle.id,
        name:      bundle.name + ' (Bundle ×10)',
        price:     bundle.price,
        qty:       1,
        isBundle:  true,
        bundleQty: bundle.bundleQty,
      });
    }
    this.save(items);
    this.updateBadge();
    trackCartUpdate();
    return { ok: true };
  },

  remove(id) {
    this.save(this.get().filter(i => i.id !== id));
    this.updateBadge();
  },

  setQty(id, qty) {
    const items = this.get();
    const item  = items.find(i => i.id === id);
    if (item) { item.qty = Math.max(1, qty); this.save(items); }
    this.updateBadge();
  },

  clear() { this.save([]); this.updateBadge(); },
  total()  { return this.get().reduce((s,i) => s + i.price * i.qty, 0); },
  count()  { return this.get().reduce((s,i) => s + i.qty, 0); },

  updateBadge() {
    const badge = document.getElementById('cart-badge');
    if (!badge) return;
    const n = this.count();
    badge.textContent   = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  },
};

// ── Nav logo ─────────────────────────────────────────────
const NAV_LOGO =
  '<div style="display:flex;align-items:center;gap:9px">'
  + '<img src="img/logo.png" alt="956 Labs" width="38" height="38" style="height:38px;width:38px;object-fit:contain;border-radius:3px;background:#FFFFFF;padding:2px" loading="eager"/>'
  + '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:1.15rem;letter-spacing:.06em;color:#111111;line-height:1">956 <span style="color:#006847">Labs</span></span>'
  + '</div>';

// ── Build Nav ────────────────────────────────────────────
window.buildNav = async function(activePage) {
  const { data } = await supabase.auth.getSession();
  const loggedIn = !!data.session;
  const count    = Cart.count();
  const homeHref = loggedIn ? 'index.html' : 'index.html';

  const centerLinks = loggedIn
    ? '<a href="index.html" class="nav-link' + (activePage==='home'?' active':'') + '">Dashboard</a>'
    + '<a href="index.html" class="nav-link' + (activePage==='shop'?' active':'') + '">Shop</a>'
    + '<a href="orders.html" class="nav-link' + (activePage==='orders'?' active':'') + '">Orders</a>'
    : '';

  const rightSide = loggedIn
    ? '<button onclick="Auth.logout()" class="nav-signout">Sign Out</button>'
    + '<a href="cart.html" class="cart-nav-btn">Cart<span id="cart-badge" class="cart-badge" style="display:' + (count>0?'flex':'none') + '">' + count + '</span></a>'
    : '<button onclick="window.showAuthPopup()" class="nav-signout" style="border-color:#006847;color:#006847">Sign In</button>';

  return '<nav><div class="nav-inner"><a href="' + homeHref + '" class="nav-brand">' + NAV_LOGO + '</a><div class="nav-links">' + centerLinks + '</div><div class="nav-right">' + rightSide + '</div></div></nav>';
};

function buildNavFromSession(activePage, session) {
  const count = Cart.count();

  const tabs = [
    { href: 'dashboard.html', label: 'Home', icon: '⌂', page: 'home' },
    { href: 'index.html',      label: 'Shop',   icon: '◈', page: 'shop'      },
    { href: 'orders.html',    label: 'Orders', icon: '☰', page: 'orders'    },
  ];

  const navLinks = tabs.map(t =>
    '<a href="' + t.href + '" class="nav-link' + (activePage===t.page?' active':'') + '">'
    + '<span class="nav-icon">' + t.icon + '</span>'
    + '<span class="nav-label">' + t.label + '</span>'
    + '</a>'
  ).join('');

  const cartBadgeHtml = '<span id="cart-badge" class="cart-badge" style="display:' + (count>0?'flex':'none') + '">' + count + '</span>';

  return '<nav aria-label="Main navigation">'
    + '<div class="nav-inner">'
    + '<a href="dashboard.html" class="nav-brand">' + NAV_LOGO + '</a>'
    + '<div class="nav-links">' + navLinks + '</div>'
    + '<div class="nav-right">'
    + '<button onclick="Auth.logout()" class="nav-signout" style="color:#888;border-color:#E0E0E0">Sign Out</button>'
    + '<a href="cart.html" class="cart-nav-btn">'
    + '<span class="nav-icon">⊕</span>'
    + '<span class="nav-label">Cart</span>'
    + cartBadgeHtml
    + '</a>'
    + '</div>'
    + '</div>'
    + '</nav>';
}

window.toggleMobileNav = function() {};
window.closeMobileNav  = function() {};

window.buildBanner = function() {
  return '<div class="research-banner"><p>956 Labs — Rio Grande Valley <span>— Research purposes only · Not for human consumption</span></p></div>';
};

window.buildFooter = async function() {
  const { data } = await supabase.auth.getSession();
  const href = data.session ? 'dashboard.html' : 'index.html';
  return '<footer><div class="footer-inner"><a href="' + href + '" class="footer-brand" style="text-decoration:none;display:flex;align-items:center"><img src="img/logo.png" alt="956 Labs" width="32" height="32" style="height:32px;width:32px;object-fit:contain"></a><div class="footer-copy" style="color:#CE1126">© 2025 956 Labs · For research purposes only</div><div class="footer-links"><a href="information.html" class="footer-link" style="font-family:var(--font-c);font-size:.56rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;text-decoration:none">Research Info</a></div></div></footer>';
};

function buildFooterFromSession() {
  return '<footer><div class="footer-inner"><a href="dashboard.html" class="footer-brand" style="text-decoration:none;display:flex;align-items:center"><img src="img/logo.png" alt="956 Labs" width="32" height="32" style="height:32px;width:32px;object-fit:contain" loading="lazy"></a><div class="footer-copy" style="color:#CE1126">© 2025 956 Labs · For research purposes only</div><div class="footer-links"><a href="information.html" class="footer-link" style="font-family:var(--font-c);font-size:.56rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;text-decoration:none">Research Info</a></div></div></footer>';
}

// ── Placeholder nav — renders instantly before auth ───────
function buildPlaceholderNav() {
  return '<nav aria-label="Main navigation">'
    + '<div class="nav-inner">'
    + '<a href="dashboard.html" class="nav-brand">' + NAV_LOGO + '</a>'
    + '<div class="nav-links" style="opacity:.25;pointer-events:none">'
    + '<span class="nav-link">Home</span>'
    + '<span class="nav-link">Shop</span>'
    + '<span class="nav-link">Orders</span>'
    + '</div>'
    + '<div class="nav-right" style="opacity:.25;pointer-events:none">'
    + '<span class="nav-signout">···</span>'
    + '</div>'
    + '</div>'
    + '</nav>';
}

// ── Public nav — unauthenticated shop/product browsing ───
function buildPublicNav(activePage) {
  var gc = Cart.count();
  var badgeStyle = 'display:' + (gc > 0 ? 'flex' : 'none');
  return '<nav aria-label="Main navigation">'
    + '<div class="nav-inner">'
    + '<a href="index.html" class="nav-brand" style="text-decoration:none">' + NAV_LOGO + '</a>'
    + '<div class="nav-links">'
    + '<a href="index.html" class="nav-link' + (activePage==='shop'?' active':'') + '">'
    + '<span class="nav-icon">◈</span><span class="nav-label">Shop</span></a>'
    + '</div>'
    + '<div class="nav-right">'
    + '<button onclick="window.showAuthPopup()" class="nav-signout" style="border-color:#006847;color:#006847">Sign In</button>'
    + '<button onclick="window.showAuthPopup(function(){ window.location.href=\'cart.html\'; })" class="cart-nav-btn" style="cursor:pointer;border:none">'
    + '<span class="nav-icon">⊕</span><span class="nav-label">Cart</span>'
    + '<span id="cart-badge" class="cart-badge" style="' + badgeStyle + '">' + gc + '</span>'
    + '</button>'
    + '</div>'
    + '</div></nav>';
}

function buildPublicFooter() {
  return '<footer style="background:#F6F6F6;border-top:1px solid #E0E0E0"><div class="footer-inner"><a href="index.html" class="footer-brand" style="text-decoration:none;display:flex;align-items:center"><img src="img/logo.png" alt="956 Labs" width="32" height="32" style="height:32px;width:32px;object-fit:contain" loading="lazy"></a><div class="footer-copy" style="color:#CE1126">© 2025 956 Labs · For research purposes only</div><div class="footer-links"><a href="information.html" class="footer-link" style="font-family:var(--font-c);font-size:.56rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#888;text-decoration:none">Research Info</a></div></div></footer>';
}

// ── BBP Auth popup ───────────────────────────────────────
function buildBBPAuthPopupHTML() {
  var s = 'background:#07111F;border:1px solid #112033;color:#EEF4FF;padding:10px 12px;font-size:14px;font-family:Barlow,sans-serif;width:100%;border-radius:2px;outline:none;box-sizing:border-box';
  return '<div id="auth-popup-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);z-index:500;align-items:center;justify-content:center;padding:20px">'
    + '<div style="background:#07111F;border:1px solid #112033;width:100%;max-width:420px;box-shadow:0 24px 80px rgba(0,0,0,.7)">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #112033;background:#0A1829">'
    + '<span style="font-family:\'Bebas Neue\',sans-serif;font-size:1.15rem;letter-spacing:.06em;color:#EEF4FF">Sign in to continue</span>'
    + '<button onclick="closeAuthPopup()" style="background:none;border:none;font-size:18px;color:#6A8FAD;cursor:pointer;padding:0;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:2px">✕</button>'
    + '</div>'
    + '<div style="display:flex;border-bottom:1px solid #112033">'
    + '<button id="auth-tab-login" onclick="authPopupSwitchTab(\'login\')" style="flex:1;padding:12px;font-family:\'Barlow Condensed\',sans-serif;font-size:.7rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;background:#07111F;border:none;border-bottom:2px solid #006847;color:#006847;cursor:pointer">Sign In</button>'
    + '<button id="auth-tab-register" onclick="authPopupSwitchTab(\'register\')" style="flex:1;padding:12px;font-family:\'Barlow Condensed\',sans-serif;font-size:.7rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;background:#07111F;border:none;border-bottom:2px solid transparent;color:#6A8FAD;cursor:pointer">Register</button>'
    + '</div>'
    + '<div style="padding:20px">'
    // LOGIN
    + '<div id="auth-form-login">'
    + '<div style="margin-bottom:12px"><label style="display:block;font-family:\'Barlow Condensed\',sans-serif;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6A8FAD;margin-bottom:4px">Email</label>'
    + '<input id="popup-login-email" type="email" placeholder="you@example.com" style="' + s + '"/></div>'
    + '<div style="margin-bottom:16px"><label style="display:block;font-family:\'Barlow Condensed\',sans-serif;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6A8FAD;margin-bottom:4px">Password</label>'
    + '<input id="popup-login-pass" type="password" placeholder="••••••••" style="' + s + '"/></div>'
    + '<button onclick="popupDoLogin()" style="width:100%;padding:12px;background:#006847;color:#07111F;font-family:\'Barlow Condensed\',sans-serif;font-size:.75rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;border:none;cursor:pointer;transition:background .18s">Sign In & Continue</button>'
    + '<div id="popup-login-err" style="font-family:\'Barlow Condensed\',sans-serif;font-size:.65rem;color:#CE1126;margin-top:8px;min-height:16px"></div>'
    + '</div>'
    // REGISTER
    + '<div id="auth-form-register" style="display:none">'
    + '<div style="display:flex;gap:10px;margin-bottom:12px">'
    + '<div style="flex:1"><label style="display:block;font-family:\'Barlow Condensed\',sans-serif;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6A8FAD;margin-bottom:4px">First Name</label>'
    + '<input id="popup-reg-first" type="text" placeholder="Jane" style="' + s + '"/></div>'
    + '<div style="flex:1"><label style="display:block;font-family:\'Barlow Condensed\',sans-serif;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6A8FAD;margin-bottom:4px">Last Name</label>'
    + '<input id="popup-reg-last" type="text" placeholder="Smith" style="' + s + '"/></div>'
    + '</div>'
    + '<div style="margin-bottom:12px"><label style="display:block;font-family:\'Barlow Condensed\',sans-serif;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6A8FAD;margin-bottom:4px">Email</label>'
    + '<input id="popup-reg-email" type="email" placeholder="you@example.com" style="' + s + '"/></div>'
    + '<div style="margin-bottom:16px"><label style="display:block;font-family:\'Barlow Condensed\',sans-serif;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6A8FAD;margin-bottom:4px">Password</label>'
    + '<input id="popup-reg-pass" type="password" placeholder="Min. 8 characters" style="' + s + '"/></div>'
    + '<button onclick="popupDoRegister()" style="width:100%;padding:12px;background:#006847;color:#07111F;font-family:\'Barlow Condensed\',sans-serif;font-size:.75rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;border:none;cursor:pointer;transition:background .18s">Create Account & Continue</button>'
    + '<div id="popup-reg-err" style="font-family:\'Barlow Condensed\',sans-serif;font-size:.65rem;color:#CE1126;margin-top:8px;min-height:16px"></div>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '</div>';
}

function injectAuthPopup() {
  if (!document.getElementById('auth-popup-overlay')) {
    document.body.insertAdjacentHTML('beforeend', buildBBPAuthPopupHTML());
  }
}


// ── Cart abandonment tracking ─────────────────────────────
async function trackCartUpdate() {
  try {
    var items = Cart.get();
    if (!items.length) return; // nothing in cart
    var snapshot = items.map(function(i) {
      return { id: i.id, name: i.name, qty: i.qty, price: i.price, isBundle: !!i.isBundle };
    });
    // Only upsert to DB if logged in — guest carts can't be emailed
    var { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // 956labs always wins — stamp and use 956labs as source
      if (typeof Auth !== 'undefined') Auth.stampSource();
      var userSource = session.user.user_metadata?.source || '956labs';
      await supabase.from('cart_reminders').upsert({
        user_id:          session.user.id,
        email:            session.user.email,
        cart_snapshot:    snapshot,
        last_cart_update: new Date().toISOString(),
        converted:        false,
        source:           userSource,
      }, { onConflict: 'user_id' });
    }
  } catch(e) { console.warn('cart track error:', e); }
}

async function markCartConverted() {
  try {
    var { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from('cart_reminders')
      .update({ converted: true })
      .eq('user_id', session.user.id);
  } catch(e) { console.warn('cart convert error:', e); }
}

// ── Merge guest cart into user cart on login ────────────
function mergeGuestCartToUser(userId) {
  var guestKey   = 'bbp_cart_guest';
  var userKey    = 'bbp_cart_' + userId;
  var guestItems = JSON.parse(localStorage.getItem(guestKey) || '[]');
  if (!guestItems.length) return;
  var userItems  = JSON.parse(localStorage.getItem(userKey) || '[]');
  guestItems.forEach(function(gi) {
    var existing = userItems.find(function(ui) {
      return ui.id === gi.id && (!!ui.isBundle === !!gi.isBundle);
    });
    if (existing) { existing.qty += gi.qty; }
    else { userItems.push(gi); }
  });
  localStorage.setItem(userKey, JSON.stringify(userItems));
  localStorage.removeItem(guestKey);
}

window.showAuthPopup = function(callback) {
  window._authPopupCallback = callback || null;
  injectAuthPopup();
  document.getElementById('auth-popup-overlay').style.display = 'flex';
};

window.closeAuthPopup = function() {
  var el = document.getElementById('auth-popup-overlay');
  if (el) el.style.display = 'none';
};

window.authPopupSwitchTab = function(tab) {
  var lf = document.getElementById('auth-form-login');
  var rf = document.getElementById('auth-form-register');
  var lt = document.getElementById('auth-tab-login');
  var rt = document.getElementById('auth-tab-register');
  var isLogin = tab === 'login';
  if (lf) lf.style.display = isLogin ? 'block' : 'none';
  if (rf) rf.style.display = isLogin ? 'none' : 'block';
  if (lt) { lt.style.borderBottomColor = isLogin ? '#006847' : 'transparent'; lt.style.color = isLogin ? '#006847' : '#6A8FAD'; }
  if (rt) { rt.style.borderBottomColor = isLogin ? 'transparent' : '#006847'; rt.style.color = isLogin ? '#6A8FAD' : '#006847'; }
};

window.popupDoLogin = async function() {
  var email = document.getElementById('popup-login-email')?.value.trim().toLowerCase();
  var pass  = document.getElementById('popup-login-pass')?.value;
  var err   = document.getElementById('popup-login-err');
  if (err) err.textContent = '';
  if (!email || !pass) { if (err) err.textContent = 'Please fill in both fields.'; return; }
  var result = await Auth.login(email, pass);
  if (!result.ok) {
    if (err) err.textContent = result.err === 'email_not_confirmed' ? 'Please confirm your email first.' : result.err;
    return;
  }
  window.closeAuthPopup();
  // Merge any guest cart items into the newly logged-in user cart
  var { data: { session: _s } } = await supabase.auth.getSession();
  if (_s) {
    mergeGuestCartToUser(_s.user.id);
    Cart._key = 'bbp_cart_' + _s.user.id;
    Cart.updateBadge();
  }
  if (window._authPopupCallback) { window._authPopupCallback(); }
  else { window.location.reload(); }
};

window.popupDoRegister = async function() {
  var first = document.getElementById('popup-reg-first')?.value.trim();
  var last  = document.getElementById('popup-reg-last')?.value.trim();
  var email = document.getElementById('popup-reg-email')?.value.trim().toLowerCase();
  var pass  = document.getElementById('popup-reg-pass')?.value;
  var err   = document.getElementById('popup-reg-err');
  if (err) err.textContent = '';
  if (!first || !last || !email || !pass) { if (err) err.textContent = 'Please fill in all fields.'; return; }
  if (pass.length < 8) { if (err) err.textContent = 'Password must be at least 8 characters.'; return; }
  var result = await Auth.register(first, last, email, pass);
  if (!result.ok) { if (err) err.textContent = result.err; return; }
  if (result.needsConfirmation) {
    if (err) { err.style.color = '#5BC75B'; err.textContent = 'Check your email to confirm, then sign in.'; }
    window.authPopupSwitchTab('login');
  } else {
    window.closeAuthPopup();
    if (window._authPopupCallback) { window._authPopupCallback(); }
    else { window.location.reload(); }
  }
};

// ── Page init ─────────────────────────────────────────────
// Pages that require auth (redirect non-users to shop)
var AUTH_PAGES = ['home', 'orders'];

window.initPage = async function(activePage) {
  var navEl    = document.getElementById('nav-mount');
  var bannerEl = document.getElementById('banner-mount');
  var footerEl = document.getElementById('footer-mount');
  if (navEl)    navEl.innerHTML    = buildPlaceholderNav();
  if (bannerEl) bannerEl.innerHTML = window.buildBanner();

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    if (AUTH_PAGES.indexOf(activePage) !== -1) {
      // Dashboard + orders require auth — send to shop
      window.location.replace('index.html');
      return;
    }
    // Public pages (shop, product) — show public nav
    if (navEl)    navEl.innerHTML    = buildPublicNav(activePage);
    if (footerEl) footerEl.innerHTML = buildPublicFooter();
    Cart.updateBadge();
    return;
  }
  Cart._key = 'bbp_cart_' + session.user.id;
  if (navEl)    navEl.innerHTML    = buildNavFromSession(activePage, session);
  if (footerEl) footerEl.innerHTML = buildFooterFromSession();
  Cart.updateBadge();
};

// ── States ────────────────────────────────────────────────
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

// ── Keys ──────────────────────────────────────────────────
// Replace with live Client ID from developer.paypal.com → Apps & Credentials → Live
const PAYPAL_CLIENT_ID  = 'AZSLv66rtWR7MDNObiUvYST-XeQEl4-aDzwxsV42ocY3EGXLLUscQ1l_zmmB4FPOOAkMLU5wlMpsGYUa';
const CASHAPP_USERNAME  = '$CTXLabs';

// ── Shipping options ──────────────────────────────────────────
const SHIPPING_OPTIONS = [
  { id: 'usps', label: 'USPS Standard Shipping', carrier: 'USPS', days: '5–7 business days', price: 15.00 },
  { id: 'ups2', label: 'UPS 2-Day Air',           carrier: 'UPS',  days: '2 business days',  price: 40.00 },
];

function getSelectedShipping() {
  const el = document.getElementById('co-shipping-method');
  const id = el ? el.value : 'usps';
  return SHIPPING_OPTIONS.find(s => s.id === id) || SHIPPING_OPTIONS[0];
}

window.updateShippingTotal = function() {
  const items       = Cart.get();
  const subtotal    = items.reduce((s,i) => s + i.price * i.qty, 0);
  const discount    = _appliedDiscount;
  const discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
  const ship        = getSelectedShipping();
  const el          = document.getElementById('modal-total-val');
  if (el) el.textContent = '$' + (subtotal - discountAmt + ship.price).toFixed(2);
};

// ── Checkout state ────────────────────────────────────────
// ── Open / Close ──────────────────────────────────────────
window.openCheckout = async function() {
  // Require auth before checkout
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.showAuthPopup(function() {
      // After login, retry checkout
      setTimeout(window.openCheckout, 300);
    });
    return;
  }
  const items = Cart.get();
  if (!items.length) return;
  const overlay = document.getElementById('checkout-overlay');
  if (!overlay) return;
  const [profile, addr] = await Promise.all([Auth.getProfile(), Auth.getDefaultAddress()]);
  renderCheckoutModal(items, profile || {}, addr || {});
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  await Promise.all([mountPayPal(), mountCashApp(), mountZelle(), mountBitcoin()]);
};

window.closeCheckout = function() {
  const overlay = document.getElementById('checkout-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
};

// ── Shipping rules ────────────────────────────────────────
// ── Shipping validation ───────────────────────────────────
const SHIP_RULES = [
  { id:'co-first',   err:'err-first',   test: v => v.length >= 1,               msg:'Required'        },
  { id:'co-last',    err:'err-last',    test: v => v.length >= 1,               msg:'Required'        },
  { id:'co-address', err:'err-address', test: v => v.length >= 3,               msg:'Required'        },
  { id:'co-city',    err:'err-city',    test: v => v.length >= 1,               msg:'Required'        },
  { id:'co-zip',     err:'err-zip',     test: v => /^\d{5}(-\d{4})?$/.test(v),  msg:'Enter valid ZIP' },
  { id:'co-state',   err:'err-state',   test: v => v !== '',                    msg:'Select a state'  },
  { id:'co-phone',   err:'err-phone',   test: v => /^[+]?[\d\s\-\(\)]{7,}$/.test(v), msg:'Enter valid phone number' },
];

function shippingValid() {
  return SHIP_RULES.every(r => {
    const el = document.getElementById(r.id);
    return el && r.test(el.value.trim());
  });
}

window.validateShipping = function() {
  SHIP_RULES.forEach(r => {
    const el    = document.getElementById(r.id);
    const errEl = document.getElementById(r.err);
    if (!el || !errEl) return;
    const val = el.value.trim();
    errEl.textContent = !r.test(val) && val.length > 0 ? r.msg : '';
  });
  // PayPal SDK handles payment UI — no card button to update
};

// ── Capture shipping from form ────────────────────────────
function captureShipping() {
  var method = getSelectedShipping();
  return {
    first_name:      document.getElementById('co-first')?.value.trim()   || '',
    last_name:       document.getElementById('co-last')?.value.trim()    || '',
    street_line1:    document.getElementById('co-address')?.value.trim() || '',
    city:            document.getElementById('co-city')?.value.trim()    || '',
    state:           document.getElementById('co-state')?.value          || '',
    zip:             document.getElementById('co-zip')?.value.trim()     || '',
    country:         document.getElementById('co-country')?.value        || 'United States',
    phone:           document.getElementById('co-phone')?.value.trim()   || '',
    saveAddr:        document.getElementById('co-save-addr')?.checked    ?? true,
    shipping_method: method.label,
    shipping_carrier:method.carrier,
    shipping_price:  method.price,
  };
}

// ── Render checkout modal ─────────────────────────────────
function renderCheckoutModal(items, profile, addr) {
  const subtotal    = items.reduce((s,i) => s + i.price * i.qty, 0);
  const discount    = _appliedDiscount;
  const discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
  const discounted  = subtotal - discountAmt;
  const defaultShip = SHIPPING_OPTIONS[0];
  const orderTotal  = discounted + defaultShip.price;

  var stateOptions = STATES.map(function(s) {
    return '<option' + ((addr.state || profile.state) === s ? ' selected' : '') + '>' + s + '</option>';
  }).join('');

  var orderRows = items.map(function(i) {
    return '<div class="modal-order-row"><span class="modal-order-name">' + i.name + '<span class="modal-order-qty"> &times; ' + i.qty + '</span></span><span class="modal-order-price">$' + (i.price*i.qty).toFixed(2) + '</span></div>';
  }).join('');

  document.getElementById('checkout-modal').innerHTML =
    '<div class="modal-head">'
    + '<div class="modal-title">Checkout</div>'
    + '<button class="modal-close" onclick="closeCheckout()">&#x2715;</button>'
    + '</div>'
    + '<div class="modal-body">'

    // ── SHIPPING ──────────────────────────────────────────
    + '<div class="modal-section">'
    + '<div class="modal-section-title">Shipping Address <span class="req-note">* required</span></div>'
    + '<div class="form-row">'
    + '<div class="form-field"><label>First Name *</label><input id="co-first" type="text" placeholder="Jane" value="' + (profile.first_name||'') + '" oninput="validateShipping()"/><div class="field-err" id="err-first"></div></div>'
    + '<div class="form-field"><label>Last Name *</label><input id="co-last" type="text" placeholder="Smith" value="' + (profile.last_name||'') + '" oninput="validateShipping()"/><div class="field-err" id="err-last"></div></div>'
    + '</div>'
    + '<div class="form-field"><label>Street Address *</label><input id="co-address" type="text" placeholder="123 Main St" value="' + (addr.street_line1||'') + '" oninput="validateShipping()"/><div class="field-err" id="err-address"></div></div>'
    + '<div class="form-row">'
    + '<div class="form-field"><label>City *</label><input id="co-city" type="text" placeholder="Austin" value="' + (addr.city||'') + '" oninput="validateShipping()"/><div class="field-err" id="err-city"></div></div>'
    + '<div class="form-field"><label>ZIP *</label><input id="co-zip" type="text" placeholder="78701" maxlength="10" value="' + (addr.zip||'') + '" oninput="validateShipping()"/><div class="field-err" id="err-zip"></div></div>'
    + '</div>'
    + '<div class="form-row">'
    + '<div class="form-field"><label>State *</label><select id="co-state" onchange="validateShipping()"><option value="">— Select —</option>' + stateOptions + '</select><div class="field-err" id="err-state"></div></div>'
    + '<div class="form-field"><label>Country</label><select id="co-country"><option>United States</option><option>Canada</option><option>Other</option></select></div>'
    + '</div>'
    + '<div class="form-field" style="margin-top:8px"><label>Phone Number <span style="font-weight:400;color:var(--smoke);font-size:.6rem;letter-spacing:.06em;text-transform:none"> *</span></label><input id="co-phone" type="tel" placeholder="(555) 000-0000" value="' + (profile.phone||'') + '" style="width:100%" /></div><div id=\"err-phone\" style=\"font-size:.62rem;color:#00875A;font-family:var(--font-c);letter-spacing:.06em;min-height:14px\"></div>'
    + '<label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-family:var(--font-c);font-size:.65rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--smoke);cursor:pointer"><input type="checkbox" id="co-save-addr" checked style="width:14px;height:14px;accent-color:var(--red)"/> Save address to my account</label>'
    + '</div>'

    // ── ORDER SUMMARY ─────────────────────────────────────
    + '<div class="modal-section">'
    + '<div class="modal-section-title">Order Summary</div>'
    + orderRows
    + '<div class="modal-order-row" style="color:var(--smoke);border-top:1px solid var(--border);margin-top:4px;padding-top:10px"><span>Subtotal</span><span>$' + subtotal.toFixed(2) + '</span></div>'
    + (discount ? '<div class="modal-order-row" style="color:#5BC75B;padding-top:4px"><span>' + discount.code + ' (' + discount.pct + '% off)</span><span>-$' + discountAmt.toFixed(2) + '</span></div>' : '')
    + '<div class="modal-order-row" style="color:var(--smoke);padding-top:6px">'
    + '<span style="font-family:var(--font-c);font-size:.63rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase">Shipping</span>'
    + '<select id="co-shipping-method" onchange="updateShippingTotal()" style="background:var(--card);color:var(--light);border:1px solid var(--border);padding:6px 10px;font-size:.8rem;outline:none;cursor:pointer;max-width:220px">'
    + SHIPPING_OPTIONS.map(function(s) { return '<option value="' + s.id + '">$' + s.price.toFixed(2) + ' — ' + s.label + ' (' + s.days + ')</option>'; }).join('')
    + '</select>'
    + '</div>'
    + '<div class="modal-total-row"><span class="modal-total-label">Total</span><span class="modal-total-val" id="modal-total-val">$' + orderTotal.toFixed(2) + '</span></div>'
    + '</div>'

    // ── DISCOUNT CODE ─────────────────────────────────────
    + '<div class="modal-section" style="padding-top:16px;padding-bottom:16px">'
    + '<div class="modal-section-title" style="margin-bottom:10px">Discount Code</div>'
    + '<div style="display:flex;gap:8px">'
    + '<input id="modal-discount-input" type="text" placeholder="Enter code" style="flex:1;background:var(--card);border:1px solid var(--border);color:var(--white);padding:10px 12px;font-family:var(--font-c);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;outline:none;transition:border-color .18s" onfocus="this.style.borderColor=\'var(--red)\'" onblur="this.style.borderColor=\'var(--border)\'" />'
    + '<button onclick="applyDiscountInModal()" style="padding:10px 16px;font-family:var(--font-c);font-size:.68rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:var(--red);color:var(--white);white-space:nowrap;transition:background .18s;flex-shrink:0" onmouseover="this.style.background=\'var(--red-hot)\'" onmouseout="this.style.background=\'var(--red)\'">Apply</button>'
    + '</div>'
    + '<div id="modal-discount-err" style="font-family:var(--font-c);font-size:.65rem;font-weight:700;letter-spacing:.08em;color:var(--red);margin-top:6px;min-height:18px"></div>'
    + '<div id="modal-discount-ok"  style="font-family:var(--font-c);font-size:.65rem;font-weight:700;letter-spacing:.08em;color:#5BC75B;margin-top:2px;display:none"></div>'
    + '</div>'

    // ── PAYMENT ───────────────────────────────────────────
    + '<div class="modal-section">'
    + '<div class="modal-section-title">Payment Method</div>'
    + '<div id="paypal-button-container"></div>'
    + '<div id="cashapp-container" style="margin-top:10px"></div>'
    + '<div id="zelle-container" style="margin-top:10px"></div>'
    + '<div id="bitcoin-container" style="margin-top:10px"></div>'
    + '</div>'

    + '<p class="modal-disclaimer">All products are sold for research purposes only and not intended for human consumption.</p>'
    + '</div>';
}



// ── Apply discount from within the checkout modal ────────────
window.applyDiscountInModal = async function() {
  await _loadCoupons();
  var input  = document.getElementById('modal-discount-input');
  var errEl  = document.getElementById('modal-discount-err');
  var okEl   = document.getElementById('modal-discount-ok');
  if (!input) return;
  var code = input.value.trim().toUpperCase();
  errEl.textContent = '';
  okEl.style.display = 'none';

  if (!code) { errEl.textContent = 'Please enter a code.'; return; }

  var found = _couponMap[code];
  if (!found) { errEl.textContent = 'Invalid discount code.'; return; }

  _appliedDiscount = { code: code, pct: found.pct, label: found.label };

  // Update the order summary rows + total in the modal live
  var items     = Cart.get();
  var subtotal  = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var discAmt   = Math.round(subtotal * found.pct) / 100;
  var ship      = getSelectedShipping().price;
  var newTotal  = subtotal - discAmt + ship;

  var totalEl = document.getElementById('modal-total-val');
  if (totalEl) totalEl.textContent = '$' + newTotal.toFixed(2);

  // Inject/update discount row in Order Summary
  var existingRow = document.getElementById('modal-discount-row');
  if (existingRow) {
    existingRow.querySelector('span:last-child').textContent = '-$' + discAmt.toFixed(2);
  } else {
    var subtotalRow = document.querySelector('.modal-order-row');
    if (subtotalRow && subtotalRow.parentNode) {
      var discRow = document.createElement('div');
      discRow.id = 'modal-discount-row';
      discRow.className = 'modal-order-row';
      discRow.style.cssText = 'color:#5BC75B;padding-top:4px';
      discRow.innerHTML = '<span>' + code + ' (' + found.pct + '% off)</span><span>-$' + discAmt.toFixed(2) + '</span>';
      subtotalRow.parentNode.insertBefore(discRow, subtotalRow.nextSibling);
    }
  }
  okEl.textContent  = found.label + ' — ' + found.pct + '% off applied';
  okEl.style.display = 'block';
  input.value = '';
  input.disabled = true;
  input.style.opacity = '.5';

  // Re-mount payment buttons so the charged total reflects the discount
  Promise.all([mountPayPal(), mountCashApp()]);
};

// ── Mount PayPal buttons ──────────────────────────────────
async function mountPayPal() {
  var container = document.getElementById('paypal-button-container');
  if (!container) return;

  if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === 'YOUR_PAYPAL_CLIENT_ID_HERE') {
    container.innerHTML = '<div style="padding:14px 18px;border:1px solid var(--border);background:var(--card);text-align:center"><p style="font-family:var(--font-c);font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--smoke)">PayPal available at launch</p></div>';
    return;
  }

  try {
    container.innerHTML = '<p style="font-family:var(--font-c);font-size:.68rem;text-align:center;color:var(--smoke);padding:12px 0">Loading PayPal…</p>';

    if (!window.paypal) {
      await new Promise(function(resolve, reject) {
        var existing = document.querySelector('script[src*="paypal.com/sdk"]');
        if (existing) existing.remove();
        var script = document.createElement('script');
        script.src = 'https://www.paypal.com/sdk/js?client-id=' + PAYPAL_CLIENT_ID + '&currency=USD&intent=capture&components=buttons&enable-funding=card,venmo,paylater&disable-funding=credit';
        script.onload  = resolve;
        script.onerror = function() { reject(new Error('PayPal SDK failed to load')); };
        document.head.appendChild(script);
      });
    }

    container.innerHTML = '';

    var items       = Cart.get();
    var subtotal    = items.reduce(function(s,i) { return s + (Number(i.price)||0) * (Number(i.qty)||1); }, 0);
    var ship        = getSelectedShipping().price || 0;
    var discount    = _appliedDiscount;
    var discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
    var total       = Math.max(0.01, subtotal + ship - discountAmt).toFixed(2);

    var buttons = window.paypal.Buttons({
      style: { layout:'vertical', color:'blue', shape:'rect', label:'pay', height:48 },

      onClick: function(data, actions) {
        if (!shippingValid()) {
          SHIP_RULES.forEach(function(r) {
            var el    = document.getElementById(r.id);
            var errEl = document.getElementById(r.err);
            if (el && errEl && !r.test(el.value.trim())) errEl.textContent = r.msg;
          });
          return actions.reject();
        }
        return actions.resolve();
      },

      createOrder: function(data, actions) {
        return actions.order.create({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { value: total, currency_code: 'USD' } }],
        });
      },

      onApprove: async function(data, actions) {
        var shippingData = captureShipping();
        container.innerHTML = '<p style="font-family:var(--font-c);font-size:.68rem;text-align:center;color:var(--smoke);padding:12px 0">Processing payment…</p>';
        var captureResult = await actions.order.capture();
        var payerEmail = captureResult?.payer?.email_address || '';
        var payerName  = (captureResult?.payer?.name?.given_name || '') + ' ' + (captureResult?.payer?.name?.surname || '');
        shippingData.paypal_email = payerEmail.trim();
        shippingData.paypal_name  = payerName.trim();
        await finishOrder(shippingData);
      },

      onError: function(err) {
        console.error('PayPal error:', err);
        container.innerHTML = '<p style="color:#00875A;font-size:.72rem;text-align:center;font-family:var(--font-c);padding:12px 0">Payment failed — please try again.</p>';
      },

      onCancel: function() {},
    });

    if (buttons.isEligible()) {
      await buttons.render('#paypal-button-container');
    } else {
      container.innerHTML = '<p style="color:var(--smoke);font-size:.72rem;text-align:center;font-style:italic;padding:12px 0">PayPal unavailable — please use card.</p>';
    }

  } catch(err) {
    console.error('mountPayPal failed:', err);
    container.innerHTML = '<div style="padding:14px;border:1px solid var(--border);background:var(--card);text-align:center"><p style="font-family:var(--font-c);font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--smoke)">PayPal available at launch</p></div>';
  }
}

// ── Cash App ──────────────────────────────────────────────
function mountCashApp() {
  var container = document.getElementById('cashapp-container');
  if (!container) return;

  var items       = Cart.get();
  var subtotal    = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var ship        = getSelectedShipping().price;
  var discount    = _appliedDiscount;
  var discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
  var total       = Math.max(0.01, subtotal + ship - discountAmt).toFixed(2);

  container.innerHTML =
    '<button id="cashapp-btn" onclick="showCashAppInput()" style="width:100%;height:48px;background:#00D632;color:#000;border:none;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:var(--font-c);font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;transition:opacity .18s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">'
    + '<svg width="20" height="20" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#00D632"/><path d="M22.5 9.5L16 16m0 0L9.5 9.5M16 16l6.5 6.5M16 16l-6.5 6.5" stroke="#000" stroke-width="2.5" stroke-linecap="round"/></svg>'
    + 'Pay $' + total + ' with Cash App'
    + '</button>'
    + '<div id="cashapp-input-wrap" style="display:none;margin-top:10px">'
    + '<label style="font-family:var(--font-c);font-size:.6rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px">Your $Cashtag <span style="color:#00875A">*</span></label>'
    + '<input id="cashapp-cashtag" type="text" placeholder="$YourCashTag" style="width:100%;background:#FFFFFF;border:1px solid #D8D8D8;color:#111;padding:10px 12px;font-size:16px;font-family:var(--font-b);outline:none;box-sizing:border-box;margin-bottom:6px" />'
    + '<div id="err-cashtag" style="font-size:.62rem;color:#00875A;font-family:var(--font-c);min-height:14px;margin-bottom:6px"></div>'
    + '<button onclick="payCashApp()" style="width:100%;height:46px;background:#00D632;color:#000;border:none;border-radius:4px;cursor:pointer;font-family:var(--font-c);font-size:.76rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Confirm & Send to Cash App →</button>'
    + '<p style="font-size:.62rem;color:var(--smoke);text-align:center;margin-top:6px;font-style:italic;font-family:var(--font-c);letter-spacing:.06em">Send $' + total + ' to ' + CASHAPP_USERNAME + ' in Cash App</p>'
    + '</div>';
}


window.showCashAppInput = function() {
  var wrap = document.getElementById('cashapp-input-wrap');
  var btn  = document.getElementById('cashapp-btn');
  if (wrap) wrap.style.display = 'block';
  if (btn)  btn.style.display  = 'none';
  setTimeout(function() {
    var input = document.getElementById('cashapp-cashtag');
    if (input) input.focus();
  }, 50);
};




function mountZelle() {
  var container = document.getElementById('zelle-container');
  if (!container) return;

  var items       = Cart.get();
  var subtotal    = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var ship        = getSelectedShipping().price;
  var discount    = _appliedDiscount;
  var discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
  var total       = Math.max(0.01, subtotal + ship - discountAmt).toFixed(2);

  container.innerHTML =
    '<button id="zelle-btn" onclick="showZelleInput()" style="width:100%;height:48px;background:#6D1ED4;color:#fff;border:none;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:var(--font-c);font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;transition:opacity .18s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">'
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 5h11.5L4 19h16M13 5l-4 7" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    + 'Pay $' + total + ' with Zelle'
    + '</button>'
    + '<div id="zelle-input-wrap" style="display:none;margin-top:10px">'
    + '<label style="font-family:var(--font-c);font-size:.6rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px">Your Zelle Phone or Email <span style="color:#006847">*</span></label>'
    + '<input id="zelle-handle" type="text" placeholder="(555) 555-5555 or email@bank.com" style="width:100%;background:#FFFFFF;border:1px solid #D8D8D8;color:#111;padding:10px 12px;font-size:16px;font-family:var(--font-b);outline:none;box-sizing:border-box;margin-bottom:6px" />'
    + '<div id="err-zelle" style="font-size:.62rem;color:#CE1126;font-family:var(--font-c);min-height:14px;margin-bottom:6px"></div>'
    + '<button onclick="payZelle()" style="width:100%;height:46px;background:#6D1ED4;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:var(--font-c);font-size:.76rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Confirm & Send via Zelle →</button>'
    + '<p style="font-size:.62rem;color:var(--smoke);text-align:center;margin-top:6px;font-style:italic;font-family:var(--font-c);letter-spacing:.06em">Send $' + total + ' to (254) 589-3596 in your bank app</p>'
    + '</div>';
}

window.showZelleInput = function() {
  var wrap = document.getElementById('zelle-input-wrap');
  var btn  = document.getElementById('zelle-btn');
  if (wrap) wrap.style.display = 'block';
  if (btn)  btn.style.display  = 'none';
  setTimeout(function() {
    var input = document.getElementById('zelle-handle');
    if (input) input.focus();
  }, 50);
};

window.payZelle = async function() {
  var handle   = (document.getElementById('zelle-handle')?.value.trim() || '');
  var errEl    = document.getElementById('err-zelle');
  if (!handle) {
    if (errEl) errEl.textContent = 'Please enter your Zelle phone or email.';
    return;
  }
  if (errEl) errEl.textContent = '';

  var items        = Cart.get();
  var subtotal     = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var ship         = getSelectedShipping().price;
  var shippingData = captureShipping();
  shippingData.zelle_handle = handle;
  shippingData.payment_method = 'zelle';

  if (!shippingValid()) {
    SHIP_RULES.forEach(function(r) {
      var el    = document.getElementById(r.id);
      var errEl = document.getElementById(r.err);
      if (el && errEl && !r.test(el.value.trim())) errEl.textContent = r.msg;
    });
    return;
  }

  // Open Zelle — try app deeplink on mobile, fall back to web
  var zelleUrl = /Mobi|Android/i.test(navigator.userAgent)
    ? 'zelle://send?phone=' + encodeURIComponent('2545893596')
    : 'https://enroll.zellepay.com/pay-with-zelle';
  window.open(zelleUrl, '_blank');

  var btn = document.getElementById('zelle-btn') || document.querySelector('[onclick="payZelle()"]');
  if (btn) {{ btn.disabled = true; btn.textContent = 'Awaiting Payment Verification…'; btn.style.background = '#888'; }}
  await finishOrder(shippingData, 'pending_zelle');
};

function mountBitcoin() {
  var container = document.getElementById('bitcoin-container');
  if (!container) return;

  var items       = Cart.get();
  var subtotal    = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var ship        = getSelectedShipping().price;
  var discount    = _appliedDiscount;
  var discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
  var total       = Math.max(0.01, subtotal + ship - discountAmt).toFixed(2);

  container.innerHTML =
    '<button id="bitcoin-btn" onclick="showBitcoinInput()" style="width:100%;height:48px;background:#F7931A;color:#fff;border:none;border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;font-family:var(--font-c);font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;transition:opacity .18s" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">'
    + '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm1 14.5V18h-2v-1.5c-1.66-.34-3-1.52-3-3s1.34-2.66 3-3V9h2v1.5c1.66.34 3 1.52 3 3s-1.34 2.66-3 3z" fill="#fff"/></svg>'
    + 'Pay $' + total + ' with Bitcoin'
    + '</button>'
    + '<div id="bitcoin-input-wrap" style="display:none;margin-top:10px">'
    + '<label style="font-family:var(--font-c);font-size:.6rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px">Your Cash App or BTC Address <span style="color:#006847">*</span></label>'
    + '<input id="bitcoin-handle" type="text" placeholder="$CTXLabs or bc1q..." style="width:100%;background:#FFFFFF;border:1px solid #D8D8D8;color:#111;padding:10px 12px;font-size:16px;font-family:var(--font-b);outline:none;box-sizing:border-box;margin-bottom:6px" />'
    + '<div id="err-bitcoin" style="font-size:.62rem;color:#006847;font-family:var(--font-c);min-height:14px;margin-bottom:6px"></div>'
    + '<button onclick="payBitcoin()" style="width:100%;height:46px;background:#F7931A;color:#fff;border:none;border-radius:4px;cursor:pointer;font-family:var(--font-c);font-size:.76rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Confirm & Send Bitcoin →</button>'
    + '<p style="font-size:.62rem;color:var(--smoke);text-align:center;margin-top:6px;font-style:italic;font-family:var(--font-c);letter-spacing:.06em">Send BTC to $CTXLabs via Cash App · USD equivalent: $' + total + '</p>'
    + '</div>';
}

window.showBitcoinInput = function() {
  var wrap = document.getElementById('bitcoin-input-wrap');
  var btn  = document.getElementById('bitcoin-btn');
  if (wrap) wrap.style.display = 'block';
  if (btn)  btn.style.display  = 'none';
  setTimeout(function() {
    var input = document.getElementById('bitcoin-handle');
    if (input) input.focus();
  }, 50);
};

window.payBitcoin = async function() {
  var handle = (document.getElementById('bitcoin-handle')?.value.trim() || '');
  var errEl  = document.getElementById('err-bitcoin');
  if (!handle) {
    if (errEl) errEl.textContent = 'Please enter your Cash App or Bitcoin address.';
    return;
  }
  if (errEl) errEl.textContent = '';

  var items        = Cart.get();
  var subtotal     = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var ship         = getSelectedShipping().price;
  var shippingData = captureShipping();
  shippingData.bitcoin_handle = handle;
  shippingData.payment_method = 'bitcoin';

  if (!shippingValid()) {
    SHIP_RULES.forEach(function(r) {
      var el    = document.getElementById(r.id);
      var errEl = document.getElementById(r.err);
      if (el && errEl && !r.test(el.value.trim())) errEl.textContent = r.msg;
    });
    return;
  }

  // Open Cash App to send Bitcoin
  window.open('https://cash.app/' + '$CTXLabs', '_blank');

  var btn = document.querySelector('[onclick="payBitcoin()"]');
  if (btn) {{ btn.disabled = true; btn.textContent = 'Awaiting Payment Verification…'; btn.style.background = '#888'; }}
  await finishOrder(shippingData, 'pending_bitcoin');
};
window.payCashApp = async function() {
  if (!shippingValid()) {
    SHIP_RULES.forEach(function(r) {
      var el    = document.getElementById(r.id);
      var errEl = document.getElementById(r.err);
      if (el && errEl && !r.test(el.value.trim())) errEl.textContent = r.msg;
    });
    return;
  }

  var cashtag    = (document.getElementById('cashapp-cashtag')?.value.trim() || '');
  var cashtagErr = document.getElementById('err-cashtag');
  if (!cashtag) {
    if (cashtagErr) cashtagErr.textContent = 'Please enter your $Cashtag.';
    return;
  }
  if (cashtagErr) cashtagErr.textContent = '';
  if (!cashtag.startsWith('$')) cashtag = '$' + cashtag;

  var items       = Cart.get();
  var subtotal    = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var ship        = getSelectedShipping().price;
  var discount    = _appliedDiscount;
  var discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
  var total       = Math.max(0.01, subtotal + ship - discountAmt).toFixed(2);
  var shippingData = captureShipping();
  shippingData.cashapp_cashtag = cashtag;

  if (!shippingValid()) {
    SHIP_RULES.forEach(function(r) {
      var el    = document.getElementById(r.id);
      var errEl = document.getElementById(r.err);
      if (el && errEl && !r.test(el.value.trim())) errEl.textContent = r.msg;
    });
    return;
  }
  // Open Cash App but DON'T auto-confirm — mark as pending
  window.open('https://cash.app/' + CASHAPP_USERNAME, '_blank');

  // Save order as pending verification
  var btn = document.getElementById('cashapp-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Awaiting Payment Verification…';
    btn.style.background = '#888';
  }
  await finishOrder(shippingData, 'pending_cashapp');
};

// ── Order notification (shared by finishOrder + test button) ──
async function sendOrderNotification(items, shipping, profile, paymentStatus, confirmToken) {
  paymentStatus = paymentStatus || 'paid';
  var isPending = ['pending_cashapp','pending_zelle','pending_bitcoin'].includes(paymentStatus);
  var pmLabel   = paymentStatus === 'pending_zelle' ? 'Zelle' : paymentStatus === 'pending_bitcoin' ? 'Bitcoin' : 'Cash App';
  var confirmUrl = 'https://utqviljholfvpfztfuvx.supabase.co/functions/v1/confirm-order?token=' + (confirmToken || '');
  var discount   = _appliedDiscount;
  var subtotal   = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
  var discounted = subtotal - discountAmt;
  var shipPrice  = shipping.shipping_price || 15;
  var orderTotal = discounted + shipPrice;
  var itemList   = items.map(function(i) {
    return i.qty + 'x ' + i.name + ' @ $' + Number(i.price).toFixed(2);
  }).join('\n');

  await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      access_key:  '8eec27a9-6e50-4206-a71a-a2c6f0c4c8bb',
      subject:     (paymentStatus === 'pending_cashapp' ? '⚠ CASH APP — UNVERIFIED' : paymentStatus === 'pending_zelle' ? '⚠ ZELLE — UNVERIFIED' : paymentStatus === 'pending_bitcoin' ? '⚠ BITCOIN — UNVERIFIED' : '✅ New Order') + ' — 956 Labs',
      from_name:   '956 Labs Store',
      name:        (shipping.first_name || '') + ' ' + (shipping.last_name || ''),
      email:       profile?.email || 'unknown',
      message:
        '=== NEW ORDER ===\n' + (isPending ? '⚠ PAYMENT UNVERIFIED — ' + pmLabel + '. Verify $' + orderTotal.toFixed(2) + ' received before shipping.\n' +
        'Handle: ' + (shipping.cashapp_cashtag || shipping.zelle_handle || shipping.bitcoin_handle || '—') + '\n' : '') + '\n' +
        'CUSTOMER\n' +
        'Name: '  + (shipping.first_name || '') + ' ' + (shipping.last_name || '') + '\n' +
        'Email: ' + (profile?.email || 'unknown') + '\n' +
        (shipping.phone ? 'Phone: ' + shipping.phone + '\n' : '') +
        (shipping.paypal_email ? 'PayPal: ' + shipping.paypal_name + ' <' + shipping.paypal_email + '>\n' : '') +
        (shipping.cashapp_cashtag ? 'CashApp $Cashtag: ' + shipping.cashapp_cashtag + '\n' : '') +
        '\n' +
        'SHIPPING ADDRESS\n' +
        (shipping.street_line1 || '') + '\n' +
        (shipping.city || '') + ', ' + (shipping.state || '') + ' ' + (shipping.zip || '') + '\n' +
        (shipping.country || 'United States') + '\n\n' +
        'SHIPPING METHOD\n' +
        (shipping.shipping_method || 'USPS Standard') + '\n' +
        'Shipping Cost: $' + Number(shipPrice).toFixed(2) + '\n\n' +
        'ITEMS ORDERED\n' + itemList + '\n\n' +
        'Subtotal: $' + subtotal.toFixed(2) + '\n' +
        (shipping.paypal_email ? 'PayPal: ' + shipping.paypal_name + ' (' + shipping.paypal_email + ')\n' : '') +
        (shipping.cashapp_cashtag ? 'Customer $Cashtag: ' + shipping.cashapp_cashtag + '\n' : '') +
        (discount ? 'Discount (' + discount.code + ' ' + discount.pct + '%): -$' + discountAmt.toFixed(2) + '\n' : '') +
        'Shipping: $' + Number(shipPrice).toFixed(2) + '\n' +
        'TOTAL: $'    + orderTotal.toFixed(2) + '\n\n' +
        '——————————————————\n' +
        '✅ CONFIRM PAYMENT: ' + confirmUrl + '\n' +
        '(Click to mark as Payment Processed)\n',
    }),
  });
}

// ── Finish order ──────────────────────────────────────────
async function finishOrder(shipping, paymentStatus, skipInventory) {
  if (!shipping) shipping = {};
  paymentStatus = paymentStatus || 'paid';
  skipInventory = skipInventory || false;
  var items = Cart.get();

  if (shipping.saveAddr && shipping.street_line1) {
    await Auth.saveAddress({
      label:        'Default',
      first_name:   shipping.first_name,
      last_name:    shipping.last_name,
      street_line1: shipping.street_line1,
      city:         shipping.city,
      state:        shipping.state,
      zip:          shipping.zip,
      country:      shipping.country || 'United States',
      is_default:   true,
    });
  }

  var subtotal    = items.reduce(function(s,i) { return s + i.price * i.qty; }, 0);
  var discount    = _appliedDiscount;
  var discountAmt = discount ? Math.round(subtotal * discount.pct) / 100 : 0;
  var shipPrice   = shipping.shipping_price || 15;
  var orderTotal  = subtotal - discountAmt + shipPrice;

  // ── Save orders + decrement inventory ─────────────────────
  // Generate shared identifiers for this entire checkout
  var confirmToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  var orderNumber  = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36));
  var orderIds = [];

  var profile = await Auth.getProfile();

  try {
    for (var i = 0; i < items.length; i++) {
      var item         = items[i];
      var isBundle     = !!item.isBundle;
      var actualQty    = isBundle ? item.qty * (item.bundleQty || 10) : item.qty;
      var unitPrice    = isBundle ? item.price / (item.bundleQty || 10) : item.price;
      var orderId = await Auth.createOrder({
        productId:        item.id,
        name:             item.name,
        qty:              actualQty,
        price:            unitPrice,
        total:            item.price * item.qty,
        shipping_method:  shipping.shipping_method,
        shipping_carrier: shipping.shipping_carrier,
        confirm_token:    confirmToken,
        order_number:     orderNumber,
        skipInventory:    skipInventory,
        order_subtotal:   subtotal,
        order_shipping:   shipPrice,
        order_total:      orderTotal,
        discount_code:    _appliedDiscount ? _appliedDiscount.label : null,
        discount_pct:     _appliedDiscount ? _appliedDiscount.pct   : null,
        shipping_price:   shipping.shipping_price,
        customer_email:   profile ? profile.email : null,
        customer_phone:   shipping.phone || null,
        shipping_name:    (shipping.first_name || '') + ' ' + (shipping.last_name || ''),
        shipping_street:  shipping.street_line1 || null,
        shipping_city:    shipping.city || null,
        shipping_state:   shipping.state || null,
        shipping_zip:     shipping.zip || null,
        payment_method:   paymentStatus === 'pending_cashapp' ? 'cashapp' : paymentStatus === 'pending_zelle' ? 'zelle' : paymentStatus === 'pending_bitcoin' ? 'bitcoin' : 'paypal',
        cashapp_cashtag:  shipping.cashapp_cashtag || null,
        paypal_email:     shipping.paypal_email    || null,
        paypal_name:      shipping.paypal_name     || null,
        zelle_handle:     shipping.zelle_handle    || null,
        bitcoin_handle:   shipping.bitcoin_handle  || null,
        source_site:      window.CART_SOURCE || '956labs',
      });
      if (orderId) orderIds.push(orderId);
    }
  } catch(e) {
    console.error('Order save failed:', e);
  }

  // ── Send notification via shared function ──────────────────
  try {
    await sendOrderNotification(items, shipping, profile, paymentStatus, confirmToken);
  } catch(e) {
    console.error('Order notification failed:', e);
  }

  document.getElementById('checkout-modal').innerHTML =
    '<div class="modal-head"><div class="modal-title">Order Placed</div><button class="modal-close" onclick="closeCheckout()">&#x2715;</button></div>'
    + '<div class="order-success">'
    + '<div class="order-success-icon">✓</div>'
    + '<h2>Order Confirmed.</h2>'
    + '<p>Your order is confirmed and on its way.<br/>Handle with appropriate care and caution.</p>'
    + '<a href="dashboard.html" style="display:inline-block;margin-top:24px;font-family:var(--font-c);font-size:.75rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;background:var(--red);color:var(--white);padding:12px 28px;clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,7px 100%,0 calc(100% - 7px))">Back to Dashboard</a>'
    + '</div>';

  Cart.clear();
  markCartConverted();
  if (typeof window.renderCart === 'function') window.renderCart();
}
