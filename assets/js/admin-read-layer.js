// assets/js/admin-read-layer.js
// ============================================================
// Phase 15 — Authenticated-only admin READ layer.
//
// Read-only. No INSERT / UPDATE / DELETE / UPSERT against any business
// table. Every method runs the same auth preflight used by AdminDataLayer
// (Phase 13) BEFORE any network call, and returns a structured error
// (AUTH_REQUIRED / ADMIN_REQUIRED / DB_ERROR) without leaking tokens,
// passwords, or secrets.
//
// Source of truth for column names is supabase/migrations/002_core_schema.sql.
// Source of truth for authorization is supabase/migrations/003_rls_policies.sql
// (Phase 2) plus the profiles.is_admin gate from Phase 11/12.
//
// The legacy localStorage Store API in store-data.js is NOT touched.
// admin.html and admin.js are NOT touched.
// ============================================================

(function () {
  'use strict';

  // ---- internal helpers ----

  function getClient() {
    try {
      if (typeof window === 'undefined') return null;
      var s = window.__supabase;
      if (!s || !s.client) return null;
      return s.client;
    } catch (e) { return null; }
  }

  function okResult(data) { return { ok: true, data: data == null ? null : data }; }
  function authError(code, message) { return { ok: false, error: code, message: message || code, data: null }; }

  // Preflight: client + real Supabase Auth session + AdminAuth.isAdmin() === true.
  // Returns null on success or a structured error object on failure.
  async function preflight() {
    var client = getClient();
    if (!client) return authError('SUPABASE_NOT_CONFIGURED', 'Supabase client is not initialised.');
    var auth = (typeof window !== 'undefined') ? window.AdminAuth : null;
    if (!auth || typeof auth.getCurrentSession !== 'function' || typeof auth.isAdmin !== 'function') {
      return authError('AUTH_MODULE_MISSING', 'AdminAuth module is not loaded.');
    }
    try {
      var sess = await auth.getCurrentSession();
      if (!sess || !sess.user || !sess.user.id) {
        return authError('AUTH_REQUIRED', 'You must be signed in.');
      }
    } catch (e) {
      return authError('AUTH_ERROR', (e && e.message) || 'Could not read the current session.');
    }
    try {
      var r = await auth.isAdmin();
      if (!r || !r.ok || !r.isAdmin) {
        return authError('ADMIN_REQUIRED', 'Your account is not an admin.');
      }
    } catch (e) {
      return authError('AUTH_ERROR', (e && e.message) || 'Admin check failed.');
    }
    return null;
  }

  // Safe error normalization for Supabase/PostgREST error responses.
  function dbError(e) {
    if (!e) return authError('DB_ERROR', 'Unknown database error.');
    var code = e.code || null;
    var msg = e.message || String(e);
    // Common codes: PGRST116 (no rows for .single()), 42501 (permission denied),
    // PGRST301 / PGRST302 (RLS rejected).
    if (code === '42501' || /permission denied/i.test(msg)) {
      return authError('GRANT_OR_RLS_GAP', 'Permission denied: ' + msg);
    }
    return authError(code || 'DB_ERROR', msg);
  }

  // ---- the public surface ----

  var AdminReadLayer = {};
  AdminReadLayer._internal = { isReady: function () { return !!getClient(); }, preflight: preflight };

  // -------- products --------
  AdminReadLayer.products = {
    // Returns a flat list of products. For each product, includes the list
    // of active variants (product_variants) joined by product_id. Does NOT
    // join product_variant_options or product_option_types here; those are
    // reachable through the product's variants[id] -> pvo if needed.
    list: async function () {
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var pr = await client.from('products')
          .select('id, legacy_id, sku, name, short_description, description, category_id, price, old_price, stock, images, featured, is_new, on_sale, most_sold, active, rating, reviews, display_order, extra, created_at, updated_at, variants:product_variants(id, legacy_id, product_id, legacy_type, legacy_value, legacy_swatch, price, stock, image_url, active, display_order, created_at, updated_at)')
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: true });
        if (pr && pr.error) return dbError(pr.error);
        return okResult(Array.isArray(pr.data) ? pr.data : []);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    },

    getById: async function (id) {
      if (!id) return authError('VALIDATION', 'Product id is required.');
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var pr = await client.from('products')
          .select('id, legacy_id, sku, name, short_description, description, category_id, price, old_price, stock, images, featured, is_new, on_sale, most_sold, active, rating, reviews, display_order, extra, created_at, updated_at, variants:product_variants(id, legacy_id, product_id, legacy_type, legacy_value, legacy_swatch, price, stock, image_url, active, display_order, created_at, updated_at)')
          .eq('id', id)
          .maybeSingle();
        if (pr && pr.error) return dbError(pr.error);
        return okResult(pr && pr.data);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    }
  };

  // -------- categories --------
  AdminReadLayer.categories = {
    list: async function () {
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var r = await client.from('categories')
          .select('id, legacy_id, name, description, image_url, icon, parent_id, display_order, active, created_at, updated_at')
          .order('display_order', { ascending: true });
        if (r && r.error) return dbError(r.error);
        return okResult(Array.isArray(r.data) ? r.data : []);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    }
  };

  // -------- settings (singleton) --------
  AdminReadLayer.settings = {
    get: async function () {
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var r = await client.from('settings')
          .select('id, store_name, store_name_en, tagline, primary_color, accent_color, logo_url, favicon_url, contact_email, contact_phone, whatsapp, address, currency, currency_code, facebook, instagram, twitter, tiktok, snapchat, youtube, free_shipping_threshold, default_shipping_cost, hero_slides, announcement, homepage_sections, navigation, footer, invoice, floating_whatsapp, maps_url, extra, created_at, updated_at')
          .eq('id', 1)
          .maybeSingle();
        if (r && r.error) return dbError(r.error);
        return okResult(r && r.data);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    }
  };

  // -------- deliveryAreas (shipping governorates) --------
  AdminReadLayer.deliveryAreas = {
    list: async function () {
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var r = await client.from('delivery_areas')
          .select('id, legacy_id, name, shipping_cost, active, display_order, created_at, updated_at')
          .order('display_order', { ascending: true });
        if (r && r.error) return dbError(r.error);
        return okResult(Array.isArray(r.data) ? r.data : []);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    }
  };

  // -------- offers --------
  AdminReadLayer.offers = {
    list: async function () {
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var r = await client.from('offers')
          .select('id, legacy_id, target_type, target_id, discount_type, discount_value, starts_at, ends_at, active, created_at, updated_at')
          .order('starts_at', { ascending: false });
        if (r && r.error) return dbError(r.error);
        return okResult(Array.isArray(r.data) ? r.data : []);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    }
  };

  // -------- coupons --------
  AdminReadLayer.coupons = {
    list: async function () {
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var r = await client.from('coupons')
          .select('id, legacy_id, code, discount_type, value, min_order, max_uses, used, starts_at, expires_at, active, created_at, updated_at')
          .order('created_at', { ascending: false });
        if (r && r.error) return dbError(r.error);
        return okResult(Array.isArray(r.data) ? r.data : []);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    }
  };

  // -------- orders (admin-only) --------
  AdminReadLayer.orders = {
    list: async function () {
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var r = await client.from('orders')
          .select('id, order_number, customer_name, customer_phone, customer_city, customer_address, customer_extra, notes, status, subtotal, discount, shipping_cost, total, coupon_id, coupon_code, delivery_area_id, delivery_area_name, payment_method, created_at, updated_at')
          .order('created_at', { ascending: false });
        if (r && r.error) {
          console.error('[ReadLayer] orders.list error:', r.error.code, r.error.message, r.error.details, r.error.hint);
          return dbError(r.error);
        }
        var orders = Array.isArray(r.data) ? r.data : [];
        for (var i = 0; i < orders.length; i++) {
          try {
            var itemsR = await client.from('order_items')
              .select('id, order_id, product_id, variant_id, product_name_snapshot, variant_label_snapshot, image_snapshot, unit_price, qty, line_total, options_snapshot, display_order, created_at')
              .eq('order_id', orders[i].id)
              .order('display_order', { ascending: true });
            orders[i].items = (itemsR && itemsR.data) ? itemsR.data : [];
          } catch (e) {
            orders[i].items = [];
          }
        }
        return okResult(orders);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    },

    getById: async function (id) {
      if (!id) return authError('VALIDATION', 'Order id is required.');
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        if (!client) return authError('SUPABASE_NOT_CONFIGURED', 'Supabase client unavailable.');
        var isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        var orderR;
        if (isUUID) {
          orderR = await client.from('orders')
            .select('id, order_number, customer_name, customer_phone, customer_city, customer_address, customer_extra, notes, status, subtotal, discount, shipping_cost, total, coupon_id, coupon_code, delivery_area_id, delivery_area_name, payment_method, created_at, updated_at')
            .eq('id', id)
            .maybeSingle();
        } else {
          orderR = await client.from('orders')
            .select('id, order_number, customer_name, customer_phone, customer_city, customer_address, customer_extra, notes, status, subtotal, discount, shipping_cost, total, coupon_id, coupon_code, delivery_area_id, delivery_area_name, payment_method, created_at, updated_at')
            .eq('order_number', id)
            .maybeSingle();
        }
        if (orderR && orderR.error) {
          console.error('[ReadLayer] getById orders query error:', orderR.error.code, orderR.error.message);
          return dbError(orderR.error);
        }
        if (!orderR || !orderR.data) {
          console.error('[ReadLayer] getById order not found. inputId:', id, 'isUUID:', isUUID, 'response:', JSON.stringify(orderR));
          return authError('NOT_FOUND', 'Order not found for: ' + id);
        }
        var realId = orderR.data.id;
        var itemsR = await client.from('order_items')
          .select('id, order_id, product_id, variant_id, product_name_snapshot, variant_label_snapshot, image_snapshot, unit_price, qty, line_total, options_snapshot, display_order, created_at')
          .eq('order_id', realId)
          .order('display_order', { ascending: true });
        if (itemsR && itemsR.error) {
          console.error('[ReadLayer] getById order_items error:', itemsR.error.code, itemsR.error.message, 'realId:', realId);
          return dbError(itemsR.error);
        }
        return okResult({
          order: orderR.data,
          items: Array.isArray(itemsR.data) ? itemsR.data : []
        });
      } catch (e) {
        console.error('[ReadLayer] getById exception:', e);
        return authError('EXCEPTION', (e && e.message) || String(e));
      }
    }
  };

  // -------- inventory_movements (admin-only) --------
  AdminReadLayer.inventory = {
    list: async function () {
      var fail = await preflight();
      if (fail) return fail;
      try {
        var client = getClient();
        var r = await client.from('inventory_movements')
          .select('id, product_id, variant_id, delta, reason, reference_id, note, created_at')
          .order('created_at', { ascending: false });
        if (r && r.error) return dbError(r.error);
        return okResult(Array.isArray(r.data) ? r.data : []);
      } catch (e) { return authError('EXCEPTION', (e && e.message) || String(e)); }
    }
  };

  if (typeof window !== 'undefined') {
    window.AdminReadLayer = AdminReadLayer;
  }
})();
