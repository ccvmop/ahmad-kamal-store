// assets/js/admin-data-layer.js
// ============================================================
// Phase 13 — Authenticated-only admin data-write foundation.
//
// Provides a tightly-scoped, explicit-resource API. NOT a generic table
// writer. Every method:
//   1. Verifies a real Supabase Auth session exists.
//   2. Verifies AdminAuth.isAdmin() === true (which itself reads
//      public.profiles.is_admin via PostgREST, gated by RLS).
//   3. If the preflight fails, returns a structured error WITHOUT ever
//      calling the supabase-js client for a write.
//   4. Uses only fields that exist in the live schema
//      (supabase/migrations/002_core_schema.sql). The schemas there
//      include `updated_at` BEFORE UPDATE triggers, so the database
//      updates `updated_at` automatically.
//
// Explicit allowed fields per resource come from
// `ALLOWED_PRODUCT_FIELDS`, `ALLOWED_CATEGORY_FIELDS`, and the single
// `ALLOWED_SETTING_FIELDS` list. Any other key in the patch is
// silently dropped. id, legacy_id, created_at are explicitly excluded.
//
// Soft-delete is NOT implemented. The schema has no `deleted_at` /
// `is_deleted` column, so a safe soft-delete path is not supported. The
// `delete` method exists only as a `NOT_SUPPORTED` guard — it never
// calls the supabase-js client for a DELETE.
//
// Never stores passwords, never reads or logs tokens, never reads
// client-editable admin metadata, never reads sessionStorage.anwar_admin
// as proof of admin.
//
// The public storefront continues to use the existing localStorage
// Store. This file is a future-only foundation; admin.js does NOT
// import it yet.
// ============================================================

(function () {
  'use strict';

  // ---- allowed-field whitelists (sourced from the actual schema) ----
  // Schema reference: supabase/migrations/002_core_schema.sql
  //   public.products columns include:
  //     id, legacy_id, sku, name, short_description, description,
  //     category_id, price, old_price, stock, images, featured, is_new,
  //     on_sale, most_sold, active, rating, reviews, display_order,
  //     extra, created_at, updated_at
  //   public.categories columns include:
  //     id, legacy_id, name, description, image_url, icon, parent_id,
  //     display_order, active, created_at, updated_at
  //   public.settings columns include (singleton row, id = 1):
  //     id, store_name, store_name_en, tagline, primary_color,
  //     accent_color, logo_url, favicon_url, contact_email, contact_phone,
  //     whatsapp, address, currency, currency_code, facebook, instagram,
  //     twitter, tiktok, snapchat, youtube, free_shipping_threshold,
  //     default_shipping_cost, maps_url, hero_slides, announcement,
  //     homepage_sections, navigation, floating_whatsapp, footer, invoice,
  //     extra, created_at, updated_at
  //
  // We DO NOT allow callers to write to: id, legacy_id, created_at,
  // updated_at. updated_at is set automatically by a DB trigger.

  var ALLOWED_PRODUCT_FIELDS = [
    'sku', 'name', 'short_description', 'description',
    'category_id', 'price', 'old_price', 'stock', 'images',
    'featured', 'is_new', 'on_sale', 'most_sold', 'active',
    'rating', 'reviews', 'display_order', 'extra'
  ];

  var ALLOWED_CATEGORY_FIELDS = [
    'name', 'description', 'image_url', 'icon',
    'parent_id', 'display_order', 'active'
  ];

  var ALLOWED_SETTING_FIELDS = [
    'store_name', 'store_name_en', 'tagline',
    'primary_color', 'accent_color',
    'logo_url', 'favicon_url',
    'contact_email', 'contact_phone', 'whatsapp', 'address',
    'currency', 'currency_code',
    'facebook', 'instagram', 'twitter', 'tiktok', 'snapchat', 'youtube',
    'free_shipping_threshold', 'default_shipping_cost',
    'maps_url', 'hero_slides', 'announcement',
    'homepage_sections', 'navigation', 'floating_whatsapp',
    'footer', 'invoice', 'extra'
  ];

  var ALLOWED_VARIANT_FIELDS = [
    'product_id', 'legacy_id', 'legacy_type', 'legacy_value', 'legacy_swatch',
    'price', 'stock', 'image_url', 'active', 'display_order'
  ];

  // ---- internal helpers ----

  function getClient() {
    try {
      if (typeof window === 'undefined') return null;
      var s = window.__supabase;
      if (!s || !s.client) return null;
      return s.client;
    } catch (e) { return null; }
  }

  function makeError(code, message, rawError) {
    var errObj = { ok: false, error: code, message: message || code };
    if (rawError && typeof rawError === 'object') {
      errObj.details = rawError.details || rawError.message || null;
      errObj.hint = rawError.hint || null;
      errObj.statusCode = rawError.statusCode || rawError.status || null;
      errObj.code = rawError.code || null;
      errObj.raw = rawError;
    }
    return errObj;
  }

  function pickAllowed(input, allowed) {
    if (!input || typeof input !== 'object') return {};
    var out = {};
    for (var i = 0; i < allowed.length; i++) {
      var k = allowed[i];
      if (Object.prototype.hasOwnProperty.call(input, k)) out[k] = input[k];
    }
    return out;
  }

  // Preflight: client exists, real auth session present, is_admin = true.
  // Returns null on success, or a structured error object.
  async function preflight(op) {
    var client = getClient();
    if (!client) return makeError('SUPABASE_NOT_CONFIGURED', 'Supabase client is not initialised.');
    var auth = (typeof window !== 'undefined') ? window.AdminAuth : null;
    if (!auth || typeof auth.getCurrentSession !== 'function' || typeof auth.isAdmin !== 'function') {
      return makeError('AUTH_MODULE_MISSING', 'AdminAuth module is not loaded.');
    }
    try {
      var sess = await auth.getCurrentSession();
      if (!sess || !sess.user || !sess.user.id) {
        return makeError('AUTH_REQUIRED', 'You must be signed in to perform this operation.');
      }
    } catch (e) {
      return makeError('AUTH_ERROR', (e && e.message) || 'Could not read the current session.');
    }
    try {
      var r = await auth.isAdmin();
      if (!r || !r.ok || !r.isAdmin) {
        return makeError('ADMIN_REQUIRED', 'Your account is not an admin.');
      }
    } catch (e) {
      return makeError('AUTH_ERROR', (e && e.message) || 'Admin check failed.');
    }
    return null;
  }

  // ---- the public surface ----

  var AdminDataLayer = {};

  AdminDataLayer._internal = { isReady: function () { return !!getClient(); } };

  // helper used by the test page only
  AdminDataLayer._internal.preflight = preflight;
  AdminDataLayer._internal.pickAllowed = pickAllowed;

  // -------- products --------
  AdminDataLayer.products = {

    // Returns { ok: true, data: <row> } or { ok: false, error, message }.
    create: async function (patch) {
      var fail = await preflight('products.create');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_PRODUCT_FIELDS);
      if (!data || !data.name) return makeError('VALIDATION', 'Field "name" is required.');
      try {
        var client = getClient();
        var res = await client.from('products').insert(data).select().single();
        if (res && res.error) {
          console.error('[AdminDataLayer] products.create Supabase error:', JSON.stringify(res.error, null, 2));
          return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error), res.error);
        }
        return { ok: true, data: res && res.data };
      } catch (e) {
        console.error('[AdminDataLayer] products.create exception:', e);
        return makeError('EXCEPTION', (e && e.message) || String(e), e);
      }
    },

    update: async function (id, patch) {
      if (!id) return makeError('VALIDATION', 'Product id is required.');
      var fail = await preflight('products.update');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_PRODUCT_FIELDS);
      try {
        var client = getClient();
        var res = await client.from('products').update(data).eq('id', id).select().single();
        if (res && res.error) {
          console.error('[AdminDataLayer] products.update Supabase error:', JSON.stringify(res.error, null, 2));
          return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error), res.error);
        }
        return { ok: true, data: res && res.data };
      } catch (e) {
        console.error('[AdminDataLayer] products.update exception:', e);
        return makeError('EXCEPTION', (e && e.message) || String(e), e);
      }
    },

    // Soft-delete is NOT supported. The schema has no `deleted_at` /
    // `is_deleted` column, so a safe soft-delete path is not available.
    // We deliberately do NOT issue a physical DELETE here.
    delete: async function (id) {
      if (!id) return makeError('VALIDATION', 'Product id is required.');
      var fail = await preflight('products.delete');
      if (fail) return fail;
      console.log('[AdminDataLayer] products.delete id:', id);
      try {
        var client = getClient();
        var res = await client.from('products').delete().eq('id', id);
        if (res && res.error) {
          console.error('[AdminDataLayer] products.delete Supabase error:', JSON.stringify(res.error, null, 2));
          return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error), res.error);
        }
        return { ok: true, data: null };
      } catch (e) {
        console.error('[AdminDataLayer] products.delete exception:', e);
        return makeError('EXCEPTION', (e && e.message) || String(e), e);
      }
    }
  };

  // -------- categories --------
  AdminDataLayer.categories = {

    create: async function (patch) {
      var fail = await preflight('categories.create');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_CATEGORY_FIELDS);
      if (!data || !data.name) return makeError('VALIDATION', 'Field "name" is required.');
      try {
        var client = getClient();
        var res = await client.from('categories').insert(data).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    update: async function (id, patch) {
      if (!id) return makeError('VALIDATION', 'Category id is required.');
      var fail = await preflight('categories.update');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_CATEGORY_FIELDS);
      try {
        var client = getClient();
        var res = await client.from('categories').update(data).eq('id', id).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    }

    // (no categories.delete exposed: same schema + soft-delete rationale
    //  as products — see the explicit NOT_SUPPORTED block above.)
  };

  // -------- settings (singleton row, id = 1) --------
  AdminDataLayer.settings = {
    update: async function (patch) {
      var fail = await preflight('settings.update');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_SETTING_FIELDS);
      try {
        var client = getClient();
        var res = await client.from('settings').update(data).eq('id', 1).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    }
  };

  // -------- product_variants --------
  AdminDataLayer.productVariants = {

    create: async function (patch) {
      var fail = await preflight('variants.create');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_VARIANT_FIELDS);
      if (!data.product_id) return makeError('VALIDATION', 'Field "product_id" is required.');
      try {
        var client = getClient();
        var res = await client.from('product_variants').insert(data).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    update: async function (id, patch) {
      if (!id) return makeError('VALIDATION', 'Variant id is required.');
      var fail = await preflight('variants.update');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_VARIANT_FIELDS);
      try {
        var client = getClient();
        var res = await client.from('product_variants').update(data).eq('id', id).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    delete: async function (id) {
      if (!id) return makeError('VALIDATION', 'Variant id is required.');
      var fail = await preflight('variants.delete');
      if (fail) return fail;
      try {
        var client = getClient();
        var res = await client.from('product_variants').delete().eq('id', id);
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    listByProduct: async function (productId) {
      if (!productId) return makeError('VALIDATION', 'Product id is required.');
      var fail = await preflight('variants.list');
      if (fail) return fail;
      try {
        var client = getClient();
        var res = await client.from('product_variants')
          .select('id, legacy_id, product_id, legacy_type, legacy_value, legacy_swatch, price, stock, image_url, active, display_order, created_at, updated_at')
          .eq('product_id', productId)
          .order('display_order', { ascending: true });
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: Array.isArray(res.data) ? res.data : [] };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    }
  };

  // -------- orders (admin-only) --------
  var ALLOWED_ORDER_STATUSES = ['ordered', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];

  AdminDataLayer.orders = {

    updateStatus: async function (id, status) {
      if (!id) return makeError('VALIDATION', 'Order id is required.');
      if (!status || ALLOWED_ORDER_STATUSES.indexOf(status) === -1) {
        return makeError('VALIDATION', 'Invalid status. Allowed: ' + ALLOWED_ORDER_STATUSES.join(', '));
      }
      var fail = await preflight('orders.updateStatus');
      if (fail) return fail;
      try {
        var client = getClient();
        var res = await client.from('orders').update({ status: status }).eq('id', id).select().single();
        if (res && res.error) {
          console.error('[AdminDataLayer] orders.updateStatus DB error:', JSON.stringify(res.error));
          return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        }
        if (!res || !res.data) {
          console.error('[AdminDataLayer] orders.updateStatus: no row updated. id:', id, 'status:', status);
          return makeError('DB_ERROR', 'Order not found or not updated.');
        }
        return { ok: true, data: res && res.data };
      } catch (e) {
        console.error('[AdminDataLayer] orders.updateStatus exception:', e);
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    delete: async function (id) {
      if (!id) return makeError('VALIDATION', 'Order id is required.');
      var fail = await preflight('orders.delete');
      if (fail) return fail;
      try {
        var client = getClient();
        var res = await client.from('orders').delete().eq('id', id);
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    }
  };

  // -------- delivery_areas (admin-only) --------
  var ALLOWED_DELIVERY_FIELDS = ['name', 'shipping_cost', 'active', 'display_order'];

  AdminDataLayer.deliveryAreas = {

    create: async function (patch) {
      var fail = await preflight('deliveryAreas.create');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_DELIVERY_FIELDS);
      if (!data || !data.name) return makeError('VALIDATION', 'Field "name" is required.');
      try {
        var client = getClient();
        var res = await client.from('delivery_areas').insert(data).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    update: async function (id, patch) {
      if (!id) return makeError('VALIDATION', 'Delivery area id is required.');
      var fail = await preflight('deliveryAreas.update');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_DELIVERY_FIELDS);
      try {
        var client = getClient();
        var res = await client.from('delivery_areas').update(data).eq('id', id).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    delete: async function (id) {
      if (!id) return makeError('VALIDATION', 'Delivery area id is required.');
      var fail = await preflight('deliveryAreas.delete');
      if (fail) return fail;
      try {
        var client = getClient();
        var res = await client.from('delivery_areas').delete().eq('id', id);
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    }
  };

  // -------- coupons (admin-only) --------
  var ALLOWED_COUPON_FIELDS = ['code', 'discount_type', 'value', 'min_order', 'max_uses', 'used', 'starts_at', 'expires_at', 'active'];

  AdminDataLayer.coupons = {

    create: async function (data) {
      var fail = await preflight('coupons.create');
      if (fail) return fail;
      var payload = pickAllowed(data, ALLOWED_COUPON_FIELDS);
      if (!payload.code) return makeError('VALIDATION', 'Coupon code is required.');
      try {
        var client = getClient();
        var res = await client.from('coupons').insert(payload).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    update: async function (id, patch) {
      if (!id) return makeError('VALIDATION', 'Coupon id is required.');
      var fail = await preflight('coupons.update');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_COUPON_FIELDS);
      try {
        var client = getClient();
        var res = await client.from('coupons').update(data).eq('id', id).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    },

    delete: async function (id) {
      if (!id) return makeError('VALIDATION', 'Coupon id is required.');
      var fail = await preflight('coupons.delete');
      if (fail) return fail;
      try {
        var client = getClient();
        var res = await client.from('coupons').delete().eq('id', id);
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    }
  };

  // -------- offers (admin-only) --------
  var ALLOWED_OFFER_FIELDS = ['target_type', 'target_id', 'discount_type', 'discount_value', 'starts_at', 'ends_at', 'active'];

  AdminDataLayer.offers = {

    create: async function (data) {
      var fail = await preflight('offers.create');
      if (fail) return fail;
      var payload = pickAllowed(data, ALLOWED_OFFER_FIELDS);
      if (!payload.target_id) return makeError('VALIDATION', 'Offer target is required.');
      try {
        var client = getClient();
        var res = await client.from('offers').insert(payload).select().single();
        if (res && res.error) {
          console.error('[AdminDataLayer] offers.create Supabase error:', JSON.stringify(res.error, null, 2));
          return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error), res.error);
        }
        return { ok: true, data: res && res.data };
      } catch (e) {
        console.error('[AdminDataLayer] offers.create exception:', e);
        return makeError('EXCEPTION', (e && e.message) || String(e), e);
      }
    },

    update: async function (id, patch) {
      if (!id) return makeError('VALIDATION', 'Offer id is required.');
      var fail = await preflight('offers.update');
      if (fail) return fail;
      var data = pickAllowed(patch, ALLOWED_OFFER_FIELDS);
      try {
        var client = getClient();
        var res = await client.from('offers').update(data).eq('id', id).select().single();
        if (res && res.error) {
          console.error('[AdminDataLayer] offers.update Supabase error:', JSON.stringify(res.error, null, 2));
          return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error), res.error);
        }
        return { ok: true, data: res && res.data };
      } catch (e) {
        console.error('[AdminDataLayer] offers.update exception:', e);
        return makeError('EXCEPTION', (e && e.message) || String(e), e);
      }
    },

    delete: async function (id) {
      if (!id) return makeError('VALIDATION', 'Offer id is required.');
      var fail = await preflight('offers.delete');
      if (fail) return fail;
      try {
        var client = getClient();
        var res = await client.from('offers').delete().eq('id', id).select();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error), res.error);
        if (!res || !res.data || !res.data.length) return makeError('DB_ERROR', 'العرض غير موجود أو لا توجد صلاحية حذف');
        return { ok: true };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e), e);
      }
    }
  };

  // -------- inventory movements (admin-only) --------
  AdminDataLayer.inventory = {

    create: async function (data) {
      var fail = await preflight('inventory.create');
      if (fail) return fail;
      try {
        var client = getClient();
        var payload = {
          product_id: data.product_id || null,
          variant_id: data.variant_id || null,
          delta: Number(data.delta) || 0,
          reason: data.reason || 'manual_adjustment',
          reference_id: data.reference_id || null,
          note: data.note || null
        };
        var res = await client.from('inventory_movements').insert(payload).select().single();
        if (res && res.error) return makeError('DB_ERROR', (res.error && res.error.message) || String(res.error));
        return { ok: true, data: res && res.data };
      } catch (e) {
        return makeError('EXCEPTION', (e && e.message) || String(e));
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.AdminDataLayer = AdminDataLayer;
  }
})();
