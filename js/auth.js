// ═══════════════════════════════════════════════════════════════
// 956 Labs — Auth & User Data (Supabase)
// ═══════════════════════════════════════════════════════════════

import { supabase } from './supabase.js';

// ── Session Cache ──────────────────────────────────────────────
let _session = null;
let _sessionFetched = false;

async function getSessionCached() {
  if (_sessionFetched) return _session;

  const { data } = await supabase.auth.getSession();
  _session = data.session || null;
  _sessionFetched = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    _session = session;
  });

  return _session;
}

// ═══════════════════════════════════════════════════════════════
// AUTH OBJECT
// ═══════════════════════════════════════════════════════════════

window.Auth = {

  // ── Session ──────────────────────────────────────────────────
  async getSession() {
    return getSessionCached();
  },

  async getUser() {
    const session = await getSessionCached();
    return session?.user || null;
  },

  // ── Profile ──────────────────────────────────────────────────
  async getProfile() {
    const user = await this.getUser();
    if (!user) return null;

    const meta = user.user_metadata || {};

    return {
      id: user.id,
      email: user.email || '',
      first_name: meta.first_name || '',
      last_name: meta.last_name || '',
      phone: meta.phone || '',
      address: meta.address || '',
      city: meta.city || '',
      state: meta.state || '',
      member_since: user.created_at || null,
    };
  },

  // ── Auth Flow ────────────────────────────────────────────────
  async requireLogin() {
    if (window.__BBP_RECOVERY_MODE__) return; // on reset.html — never redirect
    const session = await this.getSession();
    if (!session) window.location.replace('index.html');
  },

  async register(firstName, lastName, email, password) {
    if (password.length < 8) {
      return { ok: false, err: 'Password must be at least 8 characters.' };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName, source: '956labs' },
        emailRedirectTo: 'https://956labs.ctxlabz.com/dashboard.html',
      }
    });

    if (error) return { ok: false, err: error.message };

    // If email confirmation is ON, data.session is null — tell the UI to show the confirm screen
    const needsConfirmation = !data.session;
    return { ok: true, user: data.user, needsConfirmation };
  },

  // ── Source stamping ─────────────────────────────────────────
  // 956labs always wins — stamps '956labs' unconditionally.
  // Accepts an optional userOverride to avoid session cache race on login.
  async stampSource(userOverride = null) {
    try {
      const user = userOverride || await this.getUser();
      if (!user) return;
      if (user.user_metadata?.source === '956labs') return; // already set
      await supabase.auth.updateUser({ data: { ...user.user_metadata, source: '956labs' } });
    } catch(e) { /* non-critical */ }
  },

  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      await this.stampSource(data.user); // pass fresh user directly, avoid cache race
      return { ok: true };
    }
    const msg = error.message.toLowerCase();
    if (msg.includes('email not confirmed') || msg.includes('confirmation')) {
      return { ok: false, err: 'email_not_confirmed' };
    }
    return { ok: false, err: 'Wrong email or password.' };
  },

  async resendConfirmation(email) {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: 'https://956labs.ctxlabz.com/dashboard.html' },
    });
    return error ? { ok: false, err: error.message } : { ok: true };
  },

  async logout() {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  },

  async updateField(key, value) {
    if (key === 'member_since' || key === 'created_at') return;

    const user = await this.getUser();
    if (!user) return;

    if (key === 'email') {
      await supabase.auth.updateUser({ email: value });
      return;
    }

    const meta = user.user_metadata || {};
    await supabase.auth.updateUser({
      data: { ...meta, [key]: value }
    });
  },

  // ── Shipping Addresses ───────────────────────────────────────
  async getAddresses() {
    const user = await this.getUser();
    if (!user) return [];

    const { data } = await supabase
      .from('shipping_addresses')
      .select('*')
      .eq('user_id', user.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    return data || [];
  },

  async getDefaultAddress() {
    const user = await this.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from('shipping_addresses')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .maybeSingle();

    return data || null;
  },

  async saveAddress(address) {
    const user = await this.getUser();
    if (!user) return { ok: false, err: 'Not logged in.' };

    if (address.is_default) {
      await supabase
        .from('shipping_addresses')
        .update({ is_default: false })
        .eq('user_id', user.id);
    }

    const payload = {
      user_id: user.id,
      label: address.label || 'Default',
      first_name: address.first_name || '',
      last_name: address.last_name || '',
      street_line1: address.street_line1 || '',
      street_line2: address.street_line2 || '',
      city: address.city || '',
      state: address.state || '',
      zip: address.zip || '',
      country: address.country || 'United States',
      is_default: address.is_default ?? false,
    };

    if (address.id) {
      const { error } = await supabase
        .from('shipping_addresses')
        .update(payload)
        .eq('id', address.id)
        .eq('user_id', user.id);

      return error ? { ok: false, err: error.message } : { ok: true };
    } else {
      const { error } = await supabase
        .from('shipping_addresses')
        .insert(payload);

      return error ? { ok: false, err: error.message } : { ok: true };
    }
  },

  async deleteAddress(id) {
    const user = await this.getUser();
    if (!user) return;

    await supabase
      .from('shipping_addresses')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);
  },

  // ── Inventory ────────────────────────────────────────────────
  async decrementInventory(productId, qty) {
    const { error } = await supabase.rpc('decrement_inventory', {
      product_id: productId,
      qty
    });
    return error ? { ok: false } : { ok: true };
  },

  async incrementInventory(productId, qty) {
    const { error } = await supabase.rpc('increment_inventory', {
      product_id: productId,
      qty
    });
    return error ? { ok: false } : { ok: true };
  },

  async getInventory(productId) {
    const { data } = await supabase
      .from('products')
      .select('inventory')
      .eq('id', productId)
      .single();

    return data?.inventory ?? 0;
  },

  // ── Orders ───────────────────────────────────────────────────
  async createOrder(order) {
    const user = await this.getUser();
    if (!user) return;

    const { data: orderRow } = await supabase.from('orders').insert({
      user_id: user.id,
      product_id: order.productId,
      product_name: order.name,
      qty: order.qty,
      unit_price: order.price,
      total: order.total,
      status: 'processing',
      shipping_method: order.shipping_method || 'USPS Standard Shipping',
      shipping_carrier: order.shipping_carrier || 'USPS',
      shipping_price: order.shipping_price || 30.00,
      confirm_token:   order.confirm_token   || null,
      order_number:    order.order_number    || null,
      order_subtotal:  order.order_subtotal  || null,
      order_shipping:  order.order_shipping  || null,
      order_total:     order.order_total     || null,
      customer_email:  order.customer_email  || null,
      customer_phone:  order.customer_phone  || null,
      shipping_name:   order.shipping_name   || null,
      shipping_street: order.shipping_street || null,
      shipping_city:   order.shipping_city   || null,
      shipping_state:  order.shipping_state  || null,
      shipping_zip:    order.shipping_zip    || null,
      payment_method:  order.payment_method  || null,
      cashapp_cashtag: order.cashapp_cashtag || null,
      paypal_email:    order.paypal_email    || null,
      paypal_name:     order.paypal_name     || null,
      zelle_handle:    order.zelle_handle    || null,
      bitcoin_handle:  order.bitcoin_handle  || null,
      discount_code:   order.discount_code  || null,
      discount_pct:    order.discount_pct   || null,
      source_site:     order.source_site     || '956labs',
    }).select('id').single();

    if (!order.skipInventory) {
      await supabase.rpc('decrement_inventory', {
        product_id: order.productId,
        qty: order.qty,
      });
    }
    return orderRow?.id || null;
  },

  async getRecentOrders() {
    const user = await this.getUser();
    if (!user) return [];

    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .order('ordered_at', { ascending: false })
      .limit(5);

    return data || [];
  },

  async getAllOrders() {
    const user = await this.getUser();
    if (!user) return [];

    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .order('ordered_at', { ascending: false });

    return data || [];
  },

  // ── Reviews ──────────────────────────────────────────────────
  async submitReview(productId, stars, comment = '', username = '') {
    const user = await this.getUser();
    if (!user) return { ok: false, err: 'Not logged in.' };
    if (stars < 1 || stars > 5) return { ok: false, err: 'Stars must be 1-5.' };

    const { error } = await supabase.from('reviews').upsert({
      user_id: user.id,
      product_id: productId,
      stars,
      comment: comment.trim(),
      username: username.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,product_id' });

    return error ? { ok: false, err: error.message } : { ok: true };
  },

  async getReviews(productId) {
    const user = await this.getUser();

    const { data } = await supabase
      .from('reviews')
      .select('id, user_id, stars, comment, username, updated_at')
      .eq('product_id', productId)
      .not('comment', 'is', null)
      .neq('comment', '');

    return {
      rows: data || [],
      currentUserId: user?.id || null
    };
  },

  async deleteReview(productId) {
    const user = await this.getUser();
    if (!user) return { ok: false };

    const { error } = await supabase
      .from('reviews')
      .delete()
      .eq('user_id', user.id)
      .eq('product_id', productId);

    return error ? { ok: false, err: error.message } : { ok: true };
  },

  async getProductRating(productId) {
    const user = await this.getUser();

    const { data } = await supabase
      .from('reviews')
      .select('stars, user_id')
      .eq('product_id', productId);

    const rows = data || [];
    const count = rows.length;

    const average = count > 0
      ? Math.round((rows.reduce((s, r) => s + r.stars, 0) / count) * 10) / 10
      : 0;

    const userRow = user
      ? rows.find(r => r.user_id === user.id)
      : null;

    return {
      average,
      count,
      userStars: userRow ? userRow.stars : 0
    };
  },

  // ── Waitlist ─────────────────────────────────────────────────
  async joinWaitlist(productId, productName) {
    const user = await this.getUser();
    if (!user) return { ok: false, err: 'not_logged_in' };

    // Check if already on waitlist
    const { data: existing } = await supabase
      .from('waitlist')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', productId)
      .maybeSingle();

    if (existing) return { ok: false, err: 'already_on_waitlist' };

    // Stamp 956labs source on waitlist join
    this.stampSource();

    // Insert waitlist row
    const { error } = await supabase.from('waitlist').insert({
      user_id:    user.id,
      product_id: productId,
      email:      user.email,
      name:       (user.user_metadata?.first_name || '') + ' ' + (user.user_metadata?.last_name || ''),
      notified:   false,
    });

    if (error) return { ok: false, err: error.message };

    // Notify Brandon via Web3Forms
    fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_key: '8eec27a9-6e50-4206-a71a-a2c6f0c4c8bb',
        subject:    '956 Labs Waitlist — ' + productName,
        from_name:  '956 Labs',
        to:         'Brandon.burnell@hotmail.com',
        message:    'New waitlist signup:\nProduct: ' + productName + '\nEmail: ' + user.email,
      })
    }).catch(() => {}); // fire-and-forget

    return { ok: true };
  },

  // ── Utility ──────────────────────────────────────────────────
  formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }
};