// data-layer.js
// Phase 4: a SAFE data-access adapter for Supabase. This module is the
// bridge between the existing application and the Supabase database.
//
// SCOPE (this phase, READ-ONLY):
//   * Exposes window.StoreDataLayer with one method:
//       StoreDataLayer.settings.getStoreSettings()
//   * That method reads only from the Supabase `public.settings` table.
//   * Never inserts, updates, or deletes anything.
//   * Never touches localStorage or sessionStorage.
//   * Never throws; on any failure it returns a controlled result.
//   * Never modifies the existing application: the live storefront and
//     admin still run entirely off localStorage. This file is independent
//     and only used by the dedicated test page in this phase.
//
// CONFIG:
//   The Supabase client is created in supabase-client.js and exposed at
//   window.__supabase.client. The anon key is read from
//   window.SUPABASE_CONFIG (in supabase-config.js, which is git-ignored).
//   If either is missing, the adapter is a controlled no-op.

(function () {
  'use strict';

  // ---- helpers -----------------------------------------------------------

  function makeResult(ok, data, error) {
    return { ok: ok === true, data: data == null ? null : data, error: error == null ? null : error };
  }

  function safe(fn) {
    if (typeof window === 'undefined') return null;
    var s = window.__supabase;
    if (!s || !s.client || !s.client.from) return null;
    try { return s.client; } catch (e) { return null; }
  }

  // ---- public surface ----------------------------------------------------

  var StoreDataLayer = {};

  StoreDataLayer._internal = {
    getClient: function () { return safe(); },
    isReady: function () { return safe() !== null; }
  };

  /**
   * settings.getStoreSettings()
   *
   * Reads the singleton row from the public.settings table and returns
   * the small, safe subset of fields the storefront cares about right now.
   * Does NOT include credentials, secret admin fields, or anything that
   * would leak the admin surface to anonymous users.
   *
   * Result shape:
   *   { ok: true,  data: { storeName, storeNameEn, tagline, currency,
   *                         currencyCode, primaryColor, accentColor,
   *                         contactEmail, contactPhone, whatsapp,
   *                         address, social, freeShippingThreshold,
   *                         defaultShippingCost, mapsUrl, footer },
   *     error: null }
   *   { ok: false, data: null, error: "<message>" }
   */
  StoreDataLayer.settings = {

    getStoreSettings: async function () {
      var client = safe();
      if (!client) {
        return makeResult(false, null, 'Supabase client is not initialised. Ensure supabase-config.js has SUPABASE_URL and SUPABASE_ANON_KEY filled in.');
      }
      try {
        // SELECT only the columns the storefront needs. No INSERT, UPDATE,
        // or DELETE. RLS (settings_select_public) restricts this to the
        // public-readable subset of the row.
        var res = await client
          .from('settings')
          .select('store_name, store_name_en, tagline, currency, currency_code, primary_color, accent_color, logo_url, contact_email, contact_phone, whatsapp, address, facebook, instagram, twitter, tiktok, snapchat, youtube, free_shipping_threshold, default_shipping_cost, maps_url, footer, hero_slides, announcement, homepage_sections, navigation, floating_whatsapp, extra')
          .eq('id', 1)
          .limit(1);
        if (res.error) {
          return makeResult(false, null, (res.error && res.error.message) || String(res.error));
        }
        var row = (res.data && res.data[0]) || null;
        if (!row) {
          return makeResult(false, null, 'No settings row found (public.settings is empty).');
        }
        return makeResult(true, {
          storeName: row.store_name || '',
          storeNameEn: row.store_name_en || '',
          tagline: row.tagline || '',
          logo: row.logo_url || '',
          currency: row.currency || '',
          currencyCode: row.currency_code || '',
          primaryColor: row.primary_color || '',
          accentColor: row.accent_color || '',
          contactEmail: row.contact_email || '',
          contactPhone: row.contact_phone || '',
          whatsapp: row.whatsapp || '',
          address: row.address || '',
          social: {
            facebook: row.facebook || '',
            instagram: row.instagram || '',
            twitter: row.twitter || '',
            tiktok: row.tiktok || '',
            snapchat: row.snapchat || '',
            youtube: row.youtube || ''
          },
          freeShippingThreshold: row.free_shipping_threshold,
          defaultShippingCost: row.default_shipping_cost,
          mapsUrl: row.maps_url || '',
          footer: row.footer || {},
          heroSlides: row.hero_slides || [],
          announcement: row.announcement || {},
          homepageSections: row.homepage_sections || {},
          navigation: row.navigation || [],
          floatingWhatsapp: row.floating_whatsapp || {},
          extra: row.extra || {}
        }, null);
      } catch (e) {
        return makeResult(false, null, (e && e.message) || String(e));
      }
    }

  };

  // ---------------------------------------------------------------------
  // Safe settings cache (Phase 5)
  // ---------------------------------------------------------------------
  // Wraps StoreDataLayer.settings.getStoreSettings() with:
  //   * in-memory TTL (so we don't hammer Supabase on every render)
  //   * SAFE FALLBACK to the existing localStorage Store.getSettings()
  //   * the call is ONLY ever attempted; it never throws into the UI
  //   * it never writes to localStorage, sessionStorage, or Supabase
  // The existing application (which still reads from Store) is
  // completely unaffected. The cache is a *read* convenience only.
  StoreDataLayer.settings._cache = { data: null, expiresAt: 0 };
  StoreDataLayer.settings._ttlMs = 60 * 1000; // 1 minute

  StoreDataLayer.settings.getStoreSettingsCached = async function (opts) {
    opts = opts || {};
    var now = Date.now();
    if (this._cache && this._cache.data && this._cache.expiresAt > now && !opts.force) {
      return makeResult(true, this._cache.data, null);
    }
    // Always keep a handle to the existing local settings so we can fall
    // back even if window.Store is undefined for any reason.
    var localSettings = null;
    try {
      if (typeof window !== 'undefined' && window.Store && typeof window.Store.getSettings === 'function') {
        localSettings = window.Store.getSettings();
      }
    } catch (e) { localSettings = null; }

    // Try Supabase first.
    var remote = null;
    try {
      remote = await this.getStoreSettings();
    } catch (e) { remote = makeResult(false, null, (e && e.message) || String(e)); }

    if (remote && remote.ok && remote.data) {
      this._cache = { data: remote.data, expiresAt: now + this._ttlMs };
      return makeResult(true, remote.data, null);
    }
    // Fallback: localStorage (the live source of truth for the storefront).
    if (localSettings) {
      var mapped = {
        storeName: localSettings.storeName || '',
        storeNameEn: localSettings.storeNameEn || '',
        tagline: localSettings.tagline || '',
        logo: localSettings.logo || '',
        currency: localSettings.currency || '',
        currencyCode: localSettings.currencyCode || '',
        primaryColor: localSettings.primaryColor || '',
        accentColor: localSettings.accentColor || '',
        contactEmail: localSettings.contactEmail || '',
        contactPhone: localSettings.contactPhone || '',
        whatsapp: localSettings.whatsapp || '',
        address: localSettings.address || '',
        social: {
          facebook: (localSettings.facebook || ''),
          instagram: (localSettings.instagram || ''),
          twitter: (localSettings.twitter || ''),
          tiktok: (localSettings.tiktok || ''),
          snapchat: (localSettings.snapchat || ''),
          youtube: (localSettings.youtube || '')
        },
        freeShippingThreshold: localSettings.freeShippingThreshold,
        defaultShippingCost: localSettings.defaultShippingCost,
        mapsUrl: localSettings.mapsUrl || '',
        footer: localSettings.footer || {},
        heroSlides: localSettings.heroSlides || [],
        announcement: localSettings.announcement || {},
        homepageSections: localSettings.homepageSections || {},
        navigation: localSettings.navigation || [],
        floatingWhatsapp: localSettings.floatingWhatsapp || {},
        extra: localSettings.extra || {}
      };
      return makeResult(false, mapped, (remote && remote.error) || 'Supabase unavailable; using local settings.');
    }
    return makeResult(false, null, (remote && remote.error) || 'No settings source available.');
  };

  // ---------------------------------------------------------------------
  // Phase 6 — READ-ONLY products adapter
  // ---------------------------------------------------------------------
  // SELECT only. Never insert/update/delete/upsert. Never writes to
  // localStorage or sessionStorage. The schema and RLS policies in
  // supabase/migrations/ are the only source of truth for what is
  // queryable here; we do not invent columns or relations.
  //
  // Products in localStorage (assets/js/store-data.js) have shape:
  //   { id, name, sku, categoryId, price, oldPrice, stock, images[],
  //     description, shortDescription, featured, isNew, onSale, active,
  //     rating, reviews, variants[], createdAt }
  //
  // In Supabase (002_core_schema.sql), the table public.products has
  // these columns (plus uuid PK and audit cols):
  //   id, legacy_id, sku, name, short_description, description,
  //   category_id (FK -> categories.id, on delete set null),
  //   price numeric(12,2), old_price numeric(12,2), stock int,
  //   images text[], featured bool, is_new bool, on_sale bool,
  //   most_sold bool, active bool, rating numeric(3,2), reviews int,
  //   display_order int, extra jsonb, created_at, updated_at
  //
  // RLS: products_select_public (anon + authenticated) using
  //   (active = true or public.is_admin())
  // so anon reads only active rows.
  //
  // Variants: public.product_variants has product_id FK to products.id.
  // RLS: variants_select_public permits anon read of active variants of
  // active products. The FK relationship is the same one PostgREST uses
  // for embedded-resource selects, so we may request variants via the
  // embedded-resource syntax.
  StoreDataLayer.products = {

    /**
     * Read all active products.
     *
     * Result envelope:
     *   { ok: true,  data: [ {...}, {...}, ... ], error: null }
     *   { ok: true,  data: [], error: null }        // query succeeded, empty
     *   { ok: false, data: null, error: { message, code, details, hint,
     *                                    status, statusText } | string }
     *
     * Each element in data is the RAW row from Supabase (column names in
     * snake_case). No aggressive mapping to the localStorage shape; that
     * belongs to a later phase.
     */
    getProducts: async function () {
      var client = safe();
      if (!client) {
        return makeResult(false, null, 'Supabase client is not initialised. Ensure supabase-config.js has SUPABASE_URL and SUPABASE_ANON_KEY filled in.');
      }
      try {
        // SELECT only the columns the storefront / admin would care
        // about. Never select('*'). The variants sub-select reuses the
        // existing FK relationship product_variants.product_id ->
        // products.id; the same relationship the RLS USING expression
        // already validates. We do not invent a join.
        var res = await client
          .from('products')
          .select('id, legacy_id, sku, name, short_description, description, category_id, price, old_price, stock, images, featured, is_new, on_sale, most_sold, active, rating, reviews, display_order, extra, created_at, updated_at, variants:product_variants(id, legacy_id, product_id, legacy_type, legacy_value, legacy_swatch, price, stock, image_url, active, display_order, created_at, updated_at)')
          .eq('active', true)
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: true });
        if (res.error) {
          // Surface the FULL Supabase/PostgREST error object so the test
          // page can display message / code / details / hint / status.
          return makeResult(false, null, (res.error && typeof res.error === 'object')
            ? {
                message:  res.error.message  || null,
                code:     res.error.code     || null,
                details:  res.error.details  || null,
                hint:     res.error.hint     || null,
                status:   res.error.status   || null,
                statusText: res.error.statusText || null
              }
            : String(res.error));
        }
        // Empty data is a successful query, not an error.
        return makeResult(true, Array.isArray(res.data) ? res.data : [], null);
      } catch (e) {
        return makeResult(false, null, (e && typeof e === 'object' && e.message)
          ? { message: e.message }
          : (e && e.message) || String(e));
      }
    }

  };

  // ---------------------------------------------------------------------
  // Categories (Phase 8: storefront read-only)
  // ---------------------------------------------------------------------
  StoreDataLayer.categories = {

    /**
     * Read all categories from Supabase.
     * Returns raw snake_case rows. Caller must normalize.
     */
    getCategories: async function () {
      var client = safe();
      if (!client) {
        return makeResult(false, null, 'Supabase client is not initialised.');
      }
      try {
        var res = await client
          .from('categories')
          .select('id, legacy_id, name, description, image_url, icon, parent_id, display_order, active, created_at, updated_at')
          .order('display_order', { ascending: true });
        if (res.error) {
          return makeResult(false, null, (res.error && res.error.message) || String(res.error));
        }
        try { console.log('[DEBUG-CAT] Supabase query result:', 'ok=', res && res.ok, 'data_count=', res && res.data && res.data.length, 'error=', res && res.error); } catch(e) {}
        return makeResult(true, Array.isArray(res.data) ? res.data : [], null);
      } catch (e) {
        return makeResult(false, null, (e && e.message) || String(e));
      }
    }

  };

  // ---------------------------------------------------------------------
  // Delivery Areas (storefront read-only)
  // ---------------------------------------------------------------------
  StoreDataLayer.deliveryAreas = {

    /**
     * Read active delivery areas from Supabase.
     * RLS: delivery_areas_select_public allows anon read of active = true rows.
     * Returns raw snake_case rows sorted by display_order.
     */
    getDeliveryAreas: async function () {
      var client = safe();
      if (!client) {
        return makeResult(false, null, 'Supabase client is not initialised.');
      }
      try {
        var res = await client
          .from('delivery_areas')
          .select('id, legacy_id, name, shipping_cost, active, display_order, created_at, updated_at')
          .order('display_order', { ascending: true });
        if (res.error) {
          return makeResult(false, null, (res.error && res.error.message) || String(res.error));
        }
        return makeResult(true, Array.isArray(res.data) ? res.data : [], null);
      } catch (e) {
        return makeResult(false, null, (e && e.message) || String(e));
      }
    }

  };

  // ---------------------------------------------------------------------
  // Orders (storefront read-only)
  // ---------------------------------------------------------------------
  // Reads from public.orders and public.order_items.
  // RLS: orders are readable by authenticated users; anon may need
  //   orders_select_public policy or the user must be logged in.
  // The storefront only reads — never writes orders via this layer.
  StoreDataLayer.orders = {

    /**
     * Normalize a Supabase order row + items into the shape the
     * storefront expects:
     *   { id, date, status, customer: {name,phone,city,address},
     *     items: [...], subtotal, discount, shipping, total, notes,
     *     paymentMethod, coupon }
     */
    _normalize: function (row, items) {
      if (!row) return null;
      var normItems = (items || []).map(function (it) {
        var opts = [];
        try { opts = typeof it.options_snapshot === 'string' ? JSON.parse(it.options_snapshot) : (it.options_snapshot || []); } catch (e) { opts = []; }
        return {
          productId: it.product_id || '',
          variantId: it.variant_id || '',
          name: it.product_name_snapshot || '',
          variant: it.variant_label_snapshot || '',
          qty: Number(it.qty) || 1,
          price: Number(it.unit_price) || 0,
          image: it.image_snapshot || '',
          options: opts
        };
      });
      return {
        id: row.order_number || row.id,
        uuid: row.id,
        date: row.created_at ? row.created_at.slice(0, 10) : '',
        status: row.status || 'ordered',
        customer: {
          name: row.customer_name || '',
          phone: row.customer_phone || '',
          city: row.customer_city || '',
          address: row.customer_address || ''
        },
        items: normItems,
        subtotal: Number(row.subtotal) || 0,
        discount: Number(row.discount) || 0,
        shipping: Number(row.shipping_cost) || 0,
        total: Number(row.total) || 0,
        notes: row.notes || '',
        paymentMethod: row.payment_method || 'cod',
        coupon: row.coupon_code || ''
      };
    },

    /**
     * Fetch a single order by order_number (e.g. 'AK_2026_3').
     * Also fetches order_items in a separate query.
     * Returns { ok, data: normalizedOrder, error }.
     */
    getByOrderNumber: async function (orderNumber) {
      var client = safe();
      if (!client) return makeResult(false, null, 'Supabase client not initialised.');
      try {
        var res = await client.from('orders')
          .select('id, order_number, customer_name, customer_phone, customer_city, customer_address, customer_extra, notes, status, subtotal, discount, shipping_cost, total, coupon_id, coupon_code, delivery_area_id, delivery_area_name, payment_method, created_at, updated_at')
          .eq('order_number', orderNumber)
          .maybeSingle();
        if (res.error) {
          console.error('[StoreDataLayer] orders.getByOrderNumber error:', res.error.code, res.error.message, res.error.details, res.error.hint);
          return makeResult(false, null, res.error.message || String(res.error));
        }
        if (!res.data) return makeResult(false, null, 'Order not found: ' + orderNumber);
        var items = [];
        try {
          var itemsR = await client.from('order_items')
            .select('id, order_id, product_id, variant_id, product_name_snapshot, variant_label_snapshot, image_snapshot, unit_price, qty, line_total, options_snapshot, display_order, created_at')
            .eq('order_id', res.data.id)
            .order('display_order', { ascending: true });
          if (itemsR && itemsR.data) items = itemsR.data;
        } catch (e) {
          console.warn('[StoreDataLayer] orders.getByOrderNumber: failed to fetch items:', e);
        }
        return makeResult(true, this._normalize(res.data, items), null);
      } catch (e) {
        return makeResult(false, null, (e && e.message) || String(e));
      }
    },

    /**
     * Fetch orders by customer phone number.
     * Uses SECURITY DEFINER RPC so anon can read their own orders.
     * Returns { ok, data: [normalizedOrder, ...], error }.
     */
    getByPhone: async function (phone, accessToken) {
      var client = safe();
      if (!client) return makeResult(false, null, 'Supabase client not initialised.');
      try {
        var cleanPhone = phone.replace(/\D/g, '');
        var params = { p_phone: cleanPhone };
        if (accessToken) params.p_access_token = accessToken;
        var res = await client.rpc('get_orders_by_phone', params);
        if (res.error) {
          console.error('[StoreDataLayer] orders.getByPhone RPC error:', res.error.code, res.error.message, res.error.details, res.error.hint);
          return makeResult(false, null, res.error.message || String(res.error));
        }
        var orders = Array.isArray(res.data) ? res.data : [];
        return makeResult(true, orders, null);
      } catch (e) {
        return makeResult(false, null, (e && e.message) || String(e));
      }
    },

    /**
     * Search orders by order_number or phone.
     * Tries order_number first; if no match, tries phone.
     */
    search: async function (query) {
      var client = safe();
      if (!client) return makeResult(false, null, 'Supabase client not initialised.');
      var q = query.trim();
      if (!q) return makeResult(true, [], null);
      // Try order_number first
      try {
        var byNum = await this.getByOrderNumber(q);
        if (byNum.ok && byNum.data) return makeResult(true, [byNum.data], null);
      } catch (e) { /* fall through */ }
      // Try phone
      try {
        var byPhone = await this.getByPhone(q);
        if (byPhone.ok && byPhone.data) return makeResult(true, byPhone.data, null);
      } catch (e) { /* fall through */ }
      return makeResult(true, [], null);
    }
  };

  // ---------------------------------------------------------------------
  // Offers (storefront read-only)
  // ---------------------------------------------------------------------
  StoreDataLayer.offers = {

    /**
     * Fetch active, in-window offers from Supabase.
     * Normalizes rows into the shape Store.getActiveOffersForProduct() expects:
     *   { id, targetType, targetId, discountType, discountValue, startAt, endAt, active }
     */
    getActiveOffers: async function () {
      var client = safe();
      if (!client) return makeResult(false, null, 'Supabase client not initialised.');
      try {
        var res = await client.from('offers')
          .select('id, target_type, target_id, discount_type, discount_value, starts_at, ends_at, active')
          .eq('active', true)
          .lte('starts_at', new Date().toISOString())
          .gte('ends_at', new Date().toISOString());
        if (res.error) {
          console.error('[StoreDataLayer] offers.getActiveOffers error:', res.error.message);
          return makeResult(false, null, res.error.message || String(res.error));
        }
        var rows = Array.isArray(res.data) ? res.data : [];
        var mapped = rows.map(function (o) {
          return {
            id: o.id,
            targetType: o.target_type || 'product',
            targetId: o.target_id || '',
            discountType: o.discount_type || 'percent',
            discountValue: Number(o.discount_value) || 0,
            startAt: o.starts_at || '',
            endAt: o.ends_at || '',
            active: o.active !== false
          };
        });
        return makeResult(true, mapped, null);
      } catch (e) {
        return makeResult(false, null, (e && e.message) || String(e));
      }
    }
  };

  // ---------------------------------------------------------------------
  // Coupons (storefront read-only)
  // ---------------------------------------------------------------------
  StoreDataLayer.coupons = {

    /**
     * Fetch a coupon by code from Supabase.
     * Normalizes to the shape Store.applyCoupon() expects:
     *   { id, code, type, value, minOrder, maxUses, used, expiresAt, active }
     */
    getByCode: async function (code) {
      var client = safe();
      if (!client) return makeResult(false, null, 'Supabase client not initialised.');
      try {
        var res = await client.from('coupons')
          .select('id, code, discount_type, value, min_order, max_uses, used, expires_at, active')
          .ilike('code', code)
          .maybeSingle();
        if (res.error) {
          console.error('[StoreDataLayer] coupons.getByCode error:', res.error.message);
          return makeResult(false, null, res.error.message || String(res.error));
        }
        if (!res.data) return makeResult(false, null, 'Coupon not found.');
        var c = res.data;
        return makeResult(true, {
          id: c.id,
          code: c.code || '',
          type: c.discount_type || 'percent',
          value: Number(c.value) || 0,
          minOrder: Number(c.min_order) || 0,
          maxUses: Number(c.max_uses) || 0,
          used: Number(c.used) || 0,
          expiresAt: c.expires_at ? String(c.expires_at).slice(0, 10) : '',
          active: c.active !== false
        }, null);
      } catch (e) {
        return makeResult(false, null, (e && e.message) || String(e));
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.StoreDataLayer = StoreDataLayer;
  }
})();
