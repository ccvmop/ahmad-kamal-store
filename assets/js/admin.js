/* =========================================================
   Ahmad Kamal Store - Admin Dashboard App
   ========================================================= */

const Admin = {
  view: 'dashboard',
  params: {},
  loggedIn: false,

  // Phase 16: Supabase ↔ Store field-name adapter
  _sbReady: false,
  _productsCache: [],
  _categoriesCache: [],
  _settingsCache: null,
  _debouncedFilterProducts: null,
  _prodPage: 1,
  _prodPP: 50,
  _prodFiltered: null,

  _hasSupabase() {
    try {
      var s = (typeof window !== 'undefined') ? window.__supabase : null;
      return !!(s && s.client);
    } catch (e) { return false; }
  },

  _hasAdminAuth() {
    try {
      return !!(typeof window !== 'undefined' && window.AdminAuth && typeof window.AdminAuth.getCurrentSession === 'function');
    } catch (e) { return false; }
  },

  _hasAdminReadLayer() {
    try {
      return !!(typeof window !== 'undefined' && window.AdminReadLayer);
    } catch (e) { return false; }
  },

  _hasAdminDataLayer() {
    try {
      return !!(typeof window !== 'undefined' && window.AdminDataLayer);
    } catch (e) { return false; }
  },

  // Normalize a Supabase product row → Store-like shape
  _normProduct(p) {
    if (!p) return null;
    var imgs = Array.isArray(p.images) ? p.images : (p.images ? [p.images] : []);
    var catId = p.category_id || '';
    try {
      var cats = this._categoriesCache || [];
      for (var ci = 0; ci < cats.length; ci++) {
        if (cats[ci].uuid === catId) { catId = cats[ci].id; break; }
      }
    } catch (e) {}
    return {
      id: p.legacy_id || p.id,
      uuid: p.id,
      legacyId: p.legacy_id,
      sku: p.sku || '',
      name: p.name || '',
      shortDescription: p.short_description || '',
      description: p.description || '',
      categoryId: catId,
      price: Number(p.price) || 0,
      oldPrice: Number(p.old_price) || 0,
      stock: Number(p.stock) || 0,
      images: imgs,
      featured: !!p.featured,
      isNew: !!p.is_new,
      onSale: !!p.on_sale,
      mostSold: !!p.most_sold,
      active: p.active !== false,
      rating: Number(p.rating) || 0,
      reviews: Number(p.reviews) || 0,
      displayOrder: Number(p.display_order) || 0,
      extra: p.extra || {},
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      variants: (Array.isArray(p.variants) ? p.variants : []).map(function (v) {
        return {
          id: v.legacy_id || v.id,
          uuid: v.id,
          type: v.legacy_type || 'size',
          value: v.legacy_value || '',
          swatch: v.legacy_swatch || '',
          price: Number(v.price) || 0,
          stock: Number(v.stock) || 0,
          image: v.image_url || '',
          active: v.active !== false,
          displayOrder: Number(v.display_order) || 0
        };
      })
    };
  },

  // Normalize a Store-like product → Supabase patch (snake_case)
  _denormProduct(d) {
    if (!d) return {};
    // Resolve category: try UUID lookup first, then try finding category by legacy_id in cache
    var catUuid = this._legacyIdToUuid(d.categoryId);
    // If _legacyIdToUuid returned the raw value (no match found), try direct cache lookup
    if (catUuid === d.categoryId && d.categoryId) {
      try {
        var cats = this._categoriesCache || [];
        for (var ci = 0; ci < cats.length; ci++) {
          if (cats[ci].id === d.categoryId && cats[ci].uuid) { catUuid = cats[ci].uuid; break; }
        }
      } catch (e) {}
    }
    return {
      name: d.name,
      sku: d.sku || '',
      short_description: d.shortDescription || '',
      description: d.description || '',
      category_id: catUuid || d.categoryId || null,
      price: Number(d.price) || 0,
      old_price: Number(d.oldPrice) || 0,
      stock: Number.isFinite(Number(d.stock)) ? Number(d.stock) : 1000,
      images: d.images || [],
      featured: !!d.featured,
      is_new: !!d.isNew,
      on_sale: !!d.onSale,
      most_sold: !!d.mostSold,
      active: d.active !== false,
      display_order: Number(d.displayOrder) || 0,
      extra: d.extra || {}
    };
  },

  _normCategory(c) {
    if (!c) return null;
    return {
      id: c.legacy_id || c.id,
      uuid: c.id,
      legacyId: c.legacy_id,
      name: c.name || '',
      description: c.description || '',
      image: c.image_url || '',
      icon: c.icon || '\u{1F4E6}',
      parent: null,
      _parentUuid: c.parent_id || null,
      order: Number(c.display_order) || 0,
      active: c.active !== false
    };
  },

  _denormCategory(d) {
    if (!d) return {};
    return {
      name: d.name,
      description: d.description || '',
      image_url: d.image || '',
      icon: d.icon || '\u{1F4E6}',
      parent_id: d.parent || null,
      display_order: Number(d.order) || 0,
      active: d.active !== false
    };
  },

  _uuidToLegacyId(uuid) {
    if (!uuid) return uuid;
    try {
      var cats = this._categoriesCache || [];
      for (var i = 0; i < cats.length; i++) {
        if (cats[i].uuid === uuid) return cats[i].id;
      }
    } catch (e) {}
    return uuid;
  },

  _legacyIdToUuid(legacyId) {
    if (!legacyId) return legacyId;
    try {
      var cats = this._categoriesCache || [];
      for (var i = 0; i < cats.length; i++) {
        if (cats[i].id === legacyId) return cats[i].uuid;
      }
    } catch (e) {}
    return legacyId;
  },

  _productUuidToLegacyId(uuid) {
    if (!uuid) return uuid;
    try {
      var prods = this._productsCache || [];
      for (var i = 0; i < prods.length; i++) {
        if (prods[i].uuid === uuid) return prods[i].id;
      }
    } catch (e) {}
    return uuid;
  },

  _productLegacyIdToUuid(legacyId) {
    if (!legacyId) return legacyId;
    try {
      var prods = this._productsCache || [];
      for (var i = 0; i < prods.length; i++) {
        if (prods[i].id === legacyId) return prods[i].uuid;
      }
    } catch (e) {}
    return legacyId;
  },

  _normSettings(s) {
    if (!s) return null;
    return {
      storeName: s.store_name || '',
      storeNameEn: s.store_name_en || '',
      tagline: s.tagline || '',
      logo: s.logo_url || '',
      primaryColor: s.primary_color || '#14b8a6',
      accentColor: s.accent_color || '#1a1a1a',
      contactEmail: s.contact_email || '',
      contactPhone: s.contact_phone || '',
      whatsapp: s.whatsapp || '',
      address: s.address || '',
      currency: s.currency || '\u062F.\u0623',
      currencyCode: s.currency_code || 'JOD',
      facebook: s.facebook || '',
      instagram: s.instagram || '',
      twitter: s.twitter || '',
      tiktok: s.tiktok || '',
      snapchat: s.snapchat || '',
      youtube: s.youtube || '',
      mapsUrl: s.maps_url || '',
      freeShippingThreshold: Number(s.free_shipping_threshold) || 0,
      defaultShippingCost: Number(s.default_shipping_cost) || 0,
      heroSlides: s.hero_slides || [],
      announcement: s.announcement || {},
      homepageSections: s.homepage_sections || {},
      navigation: s.navigation || [],
      floatingWhatsapp: s.floating_whatsapp || {},
      footer: s.footer || {},
      invoice: s.invoice || {},
      colors: (s.extra && s.extra.colors) || {},
      decorativeBackground: (s.extra && s.extra.decorativeBackground) || { enabled: true },
      extra: s.extra || {}
    };
  },

  _denormSettings(d) {
    if (!d) return {};
    return {
      store_name: d.storeName,
      store_name_en: d.storeNameEn,
      tagline: d.tagline,
      logo_url: d.logo,
      primary_color: d.primaryColor,
      accent_color: d.accentColor,
      contact_email: d.contactEmail,
      contact_phone: d.contactPhone,
      whatsapp: d.whatsapp,
      address: d.address,
      currency: d.currency,
      currency_code: d.currencyCode,
      facebook: d.facebook,
      instagram: d.instagram,
      twitter: d.twitter,
      tiktok: d.tiktok,
      snapchat: d.snapchat,
      youtube: d.youtube,
      maps_url: d.mapsUrl,
      free_shipping_threshold: d.freeShippingThreshold,
      default_shipping_cost: d.defaultShippingCost,
      hero_slides: d.heroSlides,
      announcement: d.announcement,
      homepage_sections: d.homepageSections,
      navigation: d.navigation,
      floating_whatsapp: d.floatingWhatsapp,
      footer: d.footer,
      invoice: d.invoice,
      extra: Object.assign({}, d.extra || {}, { colors: d.colors, decorativeBackground: d.decorativeBackground })
    };
  },

  // Phase 17: Normalize a Supabase order row → Store-like shape
  _normOrderFromDB(o, items) {
    if (!o) return null;
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
      id: o.order_number || o.id,
      uuid: o.id,
      date: o.created_at ? o.created_at.slice(0, 10) : '',
      customer: {
        name: o.customer_name || '',
        phone: o.customer_phone || '',
        city: o.customer_city || '',
        address: o.customer_address || ''
      },
      items: normItems,
      subtotal: Number(o.subtotal) || 0,
      discount: Number(o.discount) || 0,
      shipping: Number(o.shipping_cost) || 0,
      total: Number(o.total) || 0,
      status: o.status || 'ordered',
      paymentMethod: o.payment_method || 'cod',
      notes: o.notes || '',
      coupon: o.coupon_code || ''
    };
  },

  _normOrdersFromDB(rows, itemsByOrder) {
    var map = itemsByOrder || {};
    return (rows || []).map(function (o) {
      var items = map[o.id] || o.items || [];
      return Admin._normOrderFromDB(o, items);
    });
  },

  // Phase 18: Normalize a Supabase coupon row → Store-like shape
  _normCouponFromDB(c) {
    if (!c) return null;
    return {
      id: c.id,
      code: c.code || '',
      type: c.discount_type || 'percent',
      value: Number(c.value) || 0,
      minOrder: Number(c.min_order) || 0,
      maxUses: Number(c.max_uses) || 0,
      used: Number(c.used) || 0,
      expiresAt: c.expires_at ? String(c.expires_at).slice(0, 10) : '',
      active: c.active !== false
    };
  },

  // Phase 18: Denormalize a Store-like coupon → Supabase patch
  _denormCoupon(d) {
    if (!d) return {};
    return {
      code: (d.code || '').toUpperCase(),
      discount_type: d.type || 'percent',
      value: Number(d.value) || 0,
      min_order: Number(d.minOrder) || 0,
      max_uses: Number(d.maxUses) || 100,
      used: Number(d.used) || 0,
      expires_at: d.expiresAt || null,
      active: d.active !== false
    };
  },

  // Phase 18: Normalize a Supabase offer row → Store-like shape
  _normOfferFromDB(o) {
    if (!o) return null;
    var startStr = o.starts_at ? String(o.starts_at) : '';
    var endStr = o.ends_at ? String(o.ends_at) : '';
    return {
      id: o.id,
      targetType: o.target_type || 'product',
      targetId: o.target_id || '',
      discountType: o.discount_type || 'percent',
      discountValue: Number(o.discount_value) || 0,
      startAt: startStr.slice(0, 10),
      endAt: endStr.slice(0, 10),
      startTime: startStr.slice(11, 16) || '00:00',
      endTime: endStr.slice(11, 16) || '23:59',
      active: o.active !== false
    };
  },

  // Phase 18: Denormalize a Store-like offer → Supabase patch
  _denormOffer(d) {
    if (!d) return {};
    function fmtTs(val, fallback) {
      if (!val) return null;
      if (val.indexOf('T') > -1) return val.length <= 19 ? val : val.slice(0, 19);
      return val + 'T' + (fallback || '00:00') + ':00';
    }
    return {
      target_type: d.targetType || 'product',
      target_id: d.targetId || '',
      discount_type: d.discountType || 'percent',
      discount_value: Number(d.discountValue) || 0,
      starts_at: fmtTs(d.startAt, d.startTime || '00:00'),
      ends_at: fmtTs(d.endAt, d.endTime || '23:59'),
      active: d.active !== false
    };
  },

  // Phase 23: Compute stats from normalized orders/products (Supabase or Store)
  _computeStats(orders, products, categories) {
    var validOrders = orders.filter(function (o) { return o.status !== 'cancelled'; });
    var totalRevenue = validOrders.reduce(function (s, o) { return s + (Number(o.total) || 0); }, 0);
    var totalOrders = orders.length;
    var deliveredOrders = orders.filter(function (o) { return o.status === 'delivered'; }).length;
    var cancelledOrders = orders.filter(function (o) { return o.status === 'cancelled'; }).length;
    var totalProducts = products.length;
    var totalCustomers = new Set(orders.map(function (o) { return (o.customer && o.customer.phone) || ''; }).filter(Boolean)).size;
    var lowStockProducts = products.filter(function (p) { return p.stock < 5; }).length;
    var costRatio = 0.6;
    var totalCost = validOrders.reduce(function (s, o) {
      return s + (o.items || []).reduce(function (ss, i) { return ss + ((Number(i.price) || 0) * costRatio * (Number(i.qty) || 1)); }, 0);
    }, 0);
    var totalProfit = totalRevenue - totalCost;
    var bestSellers = {};
    validOrders.forEach(function (o) { (o.items || []).forEach(function (i) { bestSellers[i.productId] = (bestSellers[i.productId] || 0) + (Number(i.qty) || 1); }); });
    var topProducts = Object.entries(bestSellers).map(function (e) { return { product: products.find(function (p) { return p.id === e[0]; }), qty: e[1] }; }).filter(function (x) { return x.product; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);
    var salesByDay = {};
    var last30 = []; for (var i = 0; i < 30; i++) { var d = new Date(); d.setDate(d.getDate() - (29 - i)); last30.push(d.toISOString().slice(0, 10)); }
    last30.forEach(function (d) { salesByDay[d] = 0; });
    validOrders.forEach(function (o) { if (salesByDay[o.date] !== undefined) salesByDay[o.date] += Number(o.total) || 0; });
    var salesByCategory = {};
    validOrders.forEach(function (o) { (o.items || []).forEach(function (i) { var p = products.find(function (pp) { return pp.id === i.productId; }); if (p) { var c = categories.find(function (cc) { return cc.id === p.categoryId; }); var name = c ? c.name : 'أخرى'; salesByCategory[name] = (salesByCategory[name] || 0) + (Number(i.qty) || 1) * (Number(i.price) || 0); } }); });
    return { totalRevenue: totalRevenue, totalProfit: totalProfit, totalCost: totalCost, totalOrders: totalOrders, deliveredOrders: deliveredOrders, cancelledOrders: cancelledOrders, totalProducts: totalProducts, totalCustomers: totalCustomers, lowStockProducts: lowStockProducts, topProducts: topProducts, salesByDay: salesByDay, salesByCategory: salesByCategory, last30: last30 };
  },

  // Async data loaders: try Supabase first, fall back to Store
  async _loadProducts() {
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.products.list();
        if (r && r.ok && Array.isArray(r.data)) {
          this._productsCache = r.data.map(this._normProduct);
          console.log('[Admin] Products loaded from Supabase:', this._productsCache.length);
          return this._productsCache;
        }
        console.warn('[Admin] Products: Supabase read failed, falling back to localStorage. Error:', r && r.error);
      } catch (e) { console.warn('[Admin] Products: Supabase exception, falling back to localStorage:', e); }
    }
    this._productsCache = Store.getProducts();
    console.log('[Admin] Products loaded from localStorage:', this._productsCache.length);
    return this._productsCache;
  },

  async _loadCategories() {
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.categories.list();
        if (r && r.ok && Array.isArray(r.data)) {
          this._categoriesCache = r.data.map(this._normCategory);
          var uuidMap = {};
          this._categoriesCache.forEach(function (c) { if (c.uuid) uuidMap[c.uuid] = c.id; });
          this._categoriesCache.forEach(function (c) {
            if (c._parentUuid) { c.parent = uuidMap[c._parentUuid] || c._parentUuid; }
          });
          console.log('[Admin] Categories loaded from Supabase:', this._categoriesCache.length);
          return this._categoriesCache;
        }
        console.warn('[Admin] Categories: Supabase read failed, falling back to localStorage. Error:', r && r.error);
      } catch (e) { console.warn('[Admin] Categories: Supabase exception, falling back to localStorage:', e); }
    }
    this._categoriesCache = Store.getCategories();
    console.log('[Admin] Categories loaded from localStorage:', this._categoriesCache.length);
    return this._categoriesCache;
  },

  async _loadSettings() {
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.settings.get();
        if (r && r.ok && r.data) {
          this._settingsCache = this._normSettings(r.data);
          console.log('[Admin] Settings loaded from Supabase');
          return this._settingsCache;
        }
        console.warn('[Admin] Settings: Supabase read failed, falling back to localStorage. Error:', r && r.error);
      } catch (e) { console.warn('[Admin] Settings: Supabase exception, falling back to localStorage:', e); }
    }
    this._settingsCache = Store.getSettings();
    console.log('[Admin] Settings loaded from localStorage');
    return this._settingsCache;
  },

  async _loadAll() {
    // Categories MUST load first — products depend on _categoriesCache
    // for UUID→legacy_id resolution.
    await this._loadCategories();
    await Promise.all([this._loadProducts(), this._loadSettings()]);
    this._sbReady = true;
    console.log('[Admin] Data loaded — categories:', this._categoriesCache.length, 'products:', this._productsCache.length);
  },

  _showError(msg) {
    Utils.toast(msg, 'error');
  },

  _mapAuthError(code) {
    var m = {
      AUTH_REQUIRED: '\u064A\u062C\u0628 \u062A\u0633\u062C\u064A\u0644 \u0627\u0644\u062F\u062E\u0648\u0644 \u0623\u0648\u0644\u0627\u064B.',
      ADMIN_REQUIRED: '\u0647\u0630\u0627 \u0627\u0644\u062D\u0633\u0627\u0628 \u0644\u064A\u0633 \u0644\u062F\u064A\u0647 \u0635\u0644\u0627\u062D\u064A\u0629 \u0625\u062F\u0627\u0631\u0629 \u0627\u0644\u0645\u062A\u062C\u0631.',
      GRANT_OR_RLS_GAP: '\u0644\u0627 \u062A\u0648\u062C\u062F \u0635\u0644\u0627\u062D\u064A\u0629 \u0643\u0627\u0641\u064A\u0629 \u0644\u062A\u0646\u0641\u064A\u0630 \u0627\u0644\u0639\u0645\u0644\u064A\u0629.',
      DB_ERROR: '\u062D\u062F\u062B \u062E\u0637\u0623 \u0623\u062B\u0646\u0627\u0621 \u062D\u0641\u0638 \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A.',
      VALIDATION: '\u0628\u064A\u0627\u0646\u0627\u062A \u063A\u064A\u0631 \u0635\u0627\u0644\u062D\u0629.'
    };
    return m[code] || '\u062C\u0631\u062E \u0623\u062D\u062F\u062B \u062E\u0637\u0623.';
  },

  init() {
    // Phase 16: guard — only run full init on the actual admin page.
    // Test pages load admin.js for adapter access but must not have
    // their body replaced by the admin login/layout.
    if (!/admin\.html$/.test(location.pathname)) {
      return; // not on the admin page; skip init
    }
    // Phase 11: authentication now goes through window.AdminAuth (Supabase
    // Auth + profiles.is_admin). The old sessionStorage / FNV-1a gate is
    // no longer trusted. The Store.migrateAdminCredentialsIfNeeded()
    // call below only ensures the existing localStorage "anwar_admin_creds"
    // entry is present; the admin gate no longer reads from it.
    try { Store.migrateAdminCredentialsIfNeeded(); } catch (e) {}
    this._debouncedFilterProducts = Utils.debounce(() => this.filterProducts(), 300);
    this._adminAuthCheck();
    window.addEventListener('hashchange', () => this.route());
    // Phase 11: single Supabase auth state listener. When the user signs
    // in or out in another tab (or this tab), re-evaluate the admin gate.
    try {
      var sb = (typeof window !== 'undefined') ? window.__supabase : null;
      if (sb && sb.client && sb.client.auth && typeof sb.client.auth.onAuthStateChange === 'function') {
        var self = this;
        var sub = sb.client.auth.onAuthStateChange(function () {
          try { self._adminAuthCheck(); } catch (e) { /* never throw from listener */ }
        });
        // supabase-js >= 1.x returns { data: { subscription } }.
        this._supabaseAuthUnsub = (sub && sub.data && sub.data.subscription) ? sub.data.subscription : (sub && typeof sub.unsubscribe === 'function' ? sub : null);
      }
    } catch (e) { /* never throw */ }
  },

  // Phase 11: replace the old localStorage/sessionStorage gate with
  // a Supabase Auth + profiles.is_admin check. This is async and never
  // throws. The old `anwar_admin` sessionStorage flag is intentionally
  // IGNORED here.
  _adminAuthCheck: async function () {
    try {
      var auth = (typeof window !== 'undefined') ? window.AdminAuth : null;
      if (!auth) { this.renderLogin(); return; }
      var sess = await auth.getCurrentSession();
      if (!sess || !sess.user || !sess.user.id) { this.renderLogin(); return; }
      var r = await auth.isAdmin();
      if (r && r.ok && r.isAdmin) {
        this.loggedIn = true;
        await this._loadAll();
        this.renderLayout();
        this.route();
      } else {
        this._renderAccessDenied(r && r.reason);
      }
    } catch (e) {
      this.renderLogin();
    }
  },

  // Phase 11: friendly "access denied" page (signed in but not admin).
  _renderAccessDenied: function (reason) {
    document.body.className = 'login-wrap';
    var safeReason = (typeof reason === 'string' && reason.length < 200) ? reason : 'not_authorized';
    document.body.innerHTML = '<div class="login-card" style="max-width:480px;text-align:center">'
      + '<div class="login-logo" style="background:#dc2626">!</div>'
      + '<h1>الوصول مرفوض</h1>'
      + '<p>هذا الحساب مصادق عليه لكنه غير مخوّل بالدخول إلى لوحة التحكم.</p>'
      + '<p class="muted" style="font-size:12px;direction:ltr;text-align:left;word-break:break-all">reason: ' + String(safeReason).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]) || ''; }) + '</p>'
      + '<button class="btn btn-primary btn-block btn-lg" id="ad-logout">تسجيل الخروج</button>'
      + '</div>';
    var self = this;
    var b = document.getElementById('ad-logout');
    if (b) b.addEventListener('click', function () { self.logout(); });
  },

  renderLogin() {
    document.body.className = 'login-wrap';
    document.body.innerHTML = `
      <div class="login-card">
        <div class="login-logo">أ</div>
        <h1>لوحة التحكم</h1>
        <p>معرض أحمد كمال — دخول الإدارة</p>
        <div class="form-group">
          <label class="form-label">البريد الإلكتروني (Email)</label>
          <input class="form-control" id="login-user" type="email" autocomplete="email" placeholder="admin@example.com">
        </div>
        <div class="form-group">
          <label class="form-label">كلمة المرور</label>
          <input class="form-control" id="login-pass" type="password" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-block btn-lg" onclick="Admin.doLogin()">${Utils.icon('check', 16)} دخول</button>
        <div style="text-align:center;margin-top:16px">
          <a href="#" onclick="Admin.doForgotPassword(); return false;" style="color:#2563eb;font-size:14px;text-decoration:none">نسيت كلمة المرور؟</a>
        </div>
      </div>
    `;
    document.getElementById('login-pass').addEventListener('keypress', e => { if (e.key === 'Enter') this.doLogin(); });
  },

  doLogin: async function () {
    // Phase 11: the only auth path is Supabase Auth via window.AdminAuth.
    var u = document.getElementById('login-user');
    var p = document.getElementById('login-pass');
    if (!u || !p) { Utils.toast('بيانات الدخول غير صحيحة', 'error'); return; }
    var auth = (typeof window !== 'undefined') ? window.AdminAuth : null;
    if (!auth) { Utils.toast('Supabase client is not configured', 'error'); return; }
    try {
      var r = await auth.signIn(u.value, p.value);
      if (r && r.ok) {
        this.loggedIn = true;
        this.renderLayout();
        this.route();
      } else {
        Utils.toast((r && r.message) || 'بيانات الدخول غير صحيحة', 'error');
      }
    } catch (e) {
      Utils.toast('بيانات الدخول غير صحيحة', 'error');
    }
  },

  doForgotPassword: async function () {
    var u = document.getElementById('login-user');
    var email = u ? u.value.trim() : '';
    if (!email) {
      Utils.toast('أدخل بريدك الإلكتروني أولاً', 'error');
      return;
    }
    var auth = (typeof window !== 'undefined') ? window.AdminAuth : null;
    if (!auth) { Utils.toast('Supabase client is not configured', 'error'); return; }
    try {
      var r = await auth.resetPassword(email);
      if (r && r.ok) {
        Utils.toast(r.message || 'تم الإرسال — تحقق من بريدك الإلكتروني', 'success');
      } else {
        Utils.toast((r && r.message) || 'فشل إرسال رابط إعادة التعيين', 'error');
      }
    } catch (e) {
      Utils.toast('فشل إرسال رابط إعادة التعيين', 'error');
    }
  },

  logout: async function () {
    // Phase 11: clear the Supabase session. Do NOT touch
    // sessionStorage.anwar_admin as the source of auth (it is no longer
    // authoritative). We still remove it if present so a stale flag
    // cannot linger.
    try {
      var auth = (typeof window !== 'undefined') ? window.AdminAuth : null;
      if (auth) await auth.signOut();
    } catch (e) { /* never throw */ }
    try { sessionStorage.removeItem('anwar_admin'); } catch (e) {}
    this.loggedIn = false;
    location.reload();
  },

  renderLayout() {
    document.body.className = 'admin-body';
    const s = this._settingsCache || Store.getSettings();
    const stats = Store.getStats();
    const logoHtml = s.logo ? `<img src="${Utils.escapeUrl(s.logo)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : Utils.escapeHtml((s.storeName || 'A').charAt(0));
    document.body.innerHTML = `
      <aside class="admin-sidebar" id="admin-sidebar">
        <div class="brand">
          <div class="brand-logo">${logoHtml}</div>
          <div>لوحة التحكم<small style="color:rgba(255,255,255,.5)">معرض أحمد كمال</small></div>
        </div>
        <div class="nav-section">
          <div class="nav-title">الرئيسية</div>
          <a href="#dashboard" data-nav="dashboard" class="active">${Utils.icon('dashboard', 18)} لوحة المعلومات</a>
          <a href="#analytics" data-nav="analytics">${Utils.icon('chart', 18)} التحليلات</a>
        </div>
        <div class="nav-section">
          <div class="nav-title">المتجر</div>
          <a href="#products" data-nav="products">${Utils.icon('box', 18)} المنتجات <span class="badge">${stats.totalProducts}</span></a>
          <a href="#categories" data-nav="categories">${Utils.icon('grid', 18)} الفئات</a>
          <a href="#orders" data-nav="orders">${Utils.icon('package', 18)} الطلبات <span class="badge">${stats.totalOrders}</span></a>
          <a href="#customers" data-nav="customers">${Utils.icon('user', 18)} العملاء</a>
          <a href="#delivery" data-nav="delivery">${Utils.icon('truck', 18)} مناطق التوصيل</a>
        </div>
        <div class="nav-section">
          <div class="nav-title">المحتوى</div>
          <a href="#sections" data-nav="sections">${Utils.icon('list', 18)} أقسام الصفحة الرئيسية</a>
          <a href="#hero" data-nav="hero">${Utils.icon('image', 18)} البانر الرئيسي</a>
          <a href="#announcement" data-nav="announcement">${Utils.icon('plus', 18)} بانر الإعلان</a>
          <a href="#navigation" data-nav="navigation">${Utils.icon('menu', 18)} القائمة الرئيسية</a>
        </div>
        <div class="nav-section">
          <div class="nav-title">التسويق</div>
          <a href="#coupons" data-nav="coupons">${Utils.icon('tag', 18)} الكوبونات</a>
          <a href="#offers" data-nav="offers">${Utils.icon('tag', 18)} العروض والخصومات</a>
        </div>
        <div class="nav-section">
          <div class="nav-title">الفاتورة</div>
          <a href="#invoice" data-nav="invoice">${Utils.icon('invoice', 18)} الفاتورة</a>
        </div>
        <div class="nav-section">
          <div class="nav-title">النظام</div>
          <a href="#settings" data-nav="settings">${Utils.icon('settings', 18)} الإعدادات</a>
          <a href="index.html" target="_blank">${Utils.icon('eye', 18)} عرض المتجر</a>
          <a href="#" onclick="Admin.logout();return false">${Utils.icon('close', 18)} تسجيل الخروج</a>
        </div>
      </aside>

      <div class="admin-main">
        <div class="admin-topbar">
          <div style="display:flex;align-items:center;gap:14px">
            <button class="icon-btn menu-toggle" onclick="document.getElementById('admin-sidebar').classList.toggle('open')">${Utils.icon('menu', 20)}</button>
            <h2 id="page-title">لوحة المعلومات</h2>
          </div>
          <div class="actions">
            <button id="notif-bell" class="notif-bell" onclick="Admin.openOrdersAndMarkSeen()" title="إشعارات الطلبات">
              ${Utils.icon('bell', 22)}
              <span id="notif-badge" class="notif-badge" style="display:none">0</span>
            </button>
            <span style="font-size:13px;color:var(--text-2)">مرحباً، <strong>المدير</strong></span>
            <div class="user">
              <div class="admin-avatar">م</div>
            </div>
          </div>
        </div>
        <div class="admin-content" id="admin-content"></div>
      </div>

      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal" id="modal"><div class="modal-head"><h3 id="modal-title">Modal</h3><button class="icon-btn" onclick="Admin.closeModal()">${Utils.icon('close', 18)}</button></div><div class="modal-body" id="modal-body"></div><div class="modal-foot" id="modal-foot"></div></div>
      </div>
      <div class="toast-wrap"></div>
    `;
    this.refreshNotificationBell();
    this._startBellPolling();
  },

  refreshNotificationBell() {
    const bell = document.getElementById('notif-bell');
    const badge = document.getElementById('notif-badge');
    if (!bell || !badge) return;
    const unseen = (Store.getUnseenOrders && Store.getUnseenOrders()) || [];
    const count = unseen.length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? 'grid' : 'none';
    bell.classList.toggle('has-new', count > 0);
  },

  _startBellPolling() {
    if (this._bellPollTimer) clearInterval(this._bellPollTimer);
    var self = this;
    this._bellPollTimer = setInterval(async function () {
      try {
        var sb = (typeof window !== 'undefined') ? window.__supabase : null;
        if (!sb || !sb.client) return;
        var res = await sb.client.from('orders').select('id, order_number, customer_name, customer_phone, status, total, created_at').order('created_at', { ascending: false });
        if (res.error || !Array.isArray(res.data)) return;
        var seenAt = Store.getOrdersSeenAt();
        var newOrders = res.data.filter(function (o) {
          return new Date(o.created_at).getTime() > seenAt;
        });
        if (newOrders.length === 0) return;
        var db = JSON.parse(localStorage.getItem('anwar_store_v2') || '{}');
        if (!db.orders) db.orders = [];
        newOrders.forEach(function (o) {
          var exists = db.orders.find(function (x) { return x.id === o.order_number; });
          if (!exists) {
            db.orders.push({
              id: o.order_number,
              date: o.created_at ? o.created_at.slice(0, 10) : '',
              status: o.status || 'ordered',
              customer: { name: o.customer_name || '', phone: o.customer_phone || '', city: '', address: '' },
              items: [],
              subtotal: 0, discount: 0, shipping: 0,
              total: Number(o.total) || 0,
              notes: '', paymentMethod: 'cod', coupon: '',
              notifiedAt: Date.now()
            });
          }
        });
        localStorage.setItem('anwar_store_v2', JSON.stringify(db));
        Store._clearDBCache();
        self.refreshNotificationBell();
      } catch (e) { /* silent */ }
    }, 15000);
  },

  refreshSidebarBadge(overrides) {
    try {
      var stats = Store.getStats();
      if (overrides && typeof overrides.totalOrders === 'number') stats.totalOrders = overrides.totalOrders;
      if (overrides && typeof overrides.totalProducts === 'number') stats.totalProducts = overrides.totalProducts;
      var sidebar = document.getElementById('admin-sidebar');
      if (!sidebar) return;
      var links = sidebar.querySelectorAll('a[data-nav]');
      links.forEach(function (a) {
        var nav = a.getAttribute('data-nav');
        var badge = a.querySelector('.badge');
        if (!badge) return;
        if (nav === 'orders') badge.textContent = stats.totalOrders;
        else if (nav === 'products') badge.textContent = stats.totalProducts;
      });
    } catch (e) {}
  },

  openOrdersAndMarkSeen() {
    Store.markOrdersSeen(Date.now());
    this.refreshNotificationBell();
    location.hash = 'orders';
  },

  route() {
    if (!this.loggedIn) return;
    const hash = location.hash.slice(1) || 'dashboard';
    const [view, ...params] = hash.split('/');
    this.view = view;
    this.params = params;
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.remove('active'));
    const nav = document.querySelector(`[data-nav="${view}"]`);
    if (nav) nav.classList.add('active');
    document.getElementById('admin-sidebar').classList.remove('open');

    const titles = { dashboard: 'لوحة المعلومات', analytics: 'التحليلات والإحصائيات', products: 'المنتجات', categories: 'الفئات', orders: 'الطلبات', customers: 'العملاء', coupons: 'الكوبونات والخصومات', offers: 'العروض والخصومات', settings: 'إعدادات المتجر', hero: 'البانر الرئيسي', announcement: 'بانر الإعلان', sections: 'أقسام الصفحة الرئيسية', navigation: 'القائمة الرئيسية', delivery: 'مناطق التوصيل', invoice: 'الفاتورة' };
    document.getElementById('page-title').textContent = titles[view] || 'لوحة التحكم';

    if (view === 'dashboard') this.viewDashboard();
    else if (view === 'analytics') this.viewAnalytics();
    else if (view === 'products') this.viewProducts();
    else if (view === 'categories') this.viewCategories();
    else if (view === 'orders') this.viewOrders();
    else if (view === 'customers') this.viewCustomers();
    else if (view === 'coupons') this.viewCoupons();
    else if (view === 'offers') this.viewOffers();
    else if (view === 'settings') this.viewSettings();
    else if (view === 'hero') this.viewHero();
    else if (view === 'announcement') this.viewAnnouncement();
    else if (view === 'sections') this.viewSections();
    else if (view === 'navigation') this.viewNavigation();
    else if (view === 'delivery') this.viewDelivery();
    else if (view === 'invoice') this.viewInvoice();

    this.refreshNotificationBell();
  },

  /* ===== DASHBOARD ===== */
  async viewDashboard() {
    var orders = Store.getOrders();
    var stats = Store.getStats();
    var fromSupabase = false;
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.orders.list();
        if (r && r.ok && Array.isArray(r.data)) {
          orders = this._normOrdersFromDB(r.data);
          fromSupabase = true;
        }
      } catch (e) { /* fall through to Store */ }
    }
    var products = this._productsCache || await this._loadProducts();
    var cats = this._categoriesCache || await this._loadCategories();
    if (fromSupabase) {
      stats = this._computeStats(orders, products, cats);
    }
    this.refreshSidebarBadge({ totalOrders: orders.length, totalProducts: products.length });
    const recentOrders = orders.slice(0, 5);
    const lowStock = products.filter(p => p.stock < 5);

    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>مرحباً بك في لوحة التحكم</h1><p>إليك نظرة عامة على أداء متجرك</p></div></div>

      <div class="stat-grid">
        <div class="stat-card"><div class="icon">${Utils.icon('invoice', 22)}</div><div class="label">إجمالي الإيرادات</div><div class="value">${Utils.formatPrice(stats.totalRevenue)}</div><div class="change up">إجمالي المبيعات</div></div>
        <div class="stat-card"><div class="icon">${Utils.icon('chart', 22)}</div><div class="label">صافي الربح</div><div class="value" style="color:var(--primary-dark)">${Utils.formatPrice(stats.totalProfit)}</div><div class="change up">تقدير بعد التكاليف</div></div>
        <div class="stat-card"><div class="icon">${Utils.icon('package', 22)}</div><div class="label">إجمالي الطلبات</div><div class="value">${Utils.formatNumber(stats.totalOrders)}</div><div class="change up">${stats.deliveredOrders} مكتمل</div></div>
        <div class="stat-card"><div class="icon">${Utils.icon('user', 22)}</div><div class="label">العملاء</div><div class="value">${Utils.formatNumber(stats.totalCustomers)}</div><div class="change up">عملاء فريدون</div></div>
      </div>

      <div class="charts-row">
        <div class="panel">
          <div class="panel-head"><h3>المبيعات (آخر 30 يوم)</h3><a href="#analytics" class="btn btn-outline btn-sm">التفاصيل</a></div>
          <div class="panel-body">
            <div class="chart-bars" id="sales-chart"></div>
            <div class="chart-labels" id="sales-labels"></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>حالة الطلبات</h3></div>
          <div class="panel-body">
            <div class="donut">
              <svg width="160" height="160" viewBox="0 0 160 160" id="orders-donut"></svg>
              <div class="donut-legend" id="donut-legend"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="split-2">
        <div class="panel">
          <div class="panel-head"><h3>أحدث الطلبات</h3><a href="#orders" class="btn btn-outline btn-sm">عرض الكل</a></div>
          <div class="panel-body p0">
            <div class="table-wrap"><table class="data">
              <thead><tr><th>رقم الطلب</th><th>العميل</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead>
              <tbody>
                ${recentOrders.map(o => `
                  <tr>
                    <td><strong>${o.id}</strong><br><span style="font-size:11px;color:var(--text-3)">${Utils.formatDate(o.date)}</span></td>
                    <td>${Utils.escapeHtml(o.customer.name)}</td>
                    <td><strong>${Utils.formatPrice(o.total)}</strong></td>
                    <td><span class="tag ${Utils.statusColor(o.status)}">${Utils.statusLabel(o.status)}</span></td>
                    <td><button class="icon-btn" onclick="location.hash='orders'">${Utils.icon('eye', 14)}</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>الأكثر مبيعاً</h3></div>
          <div class="panel-body">
            ${stats.topProducts.length ? stats.topProducts.map((tp, i) => `
              <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
                <div style="width:24px;height:24px;border-radius:50%;background:var(--primary);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700">${i + 1}</div>
                <img src="${Utils.escapeUrl(this._resolveImg(tp.product.images[0]))}" style="width:40px;height:40px;border-radius:8px;object-fit:cover" loading="lazy">
                <div style="flex:1">
                  <div style="font-weight:600;font-size:13px">${Utils.escapeHtml(tp.product.name)}</div>
                  <div style="font-size:12px;color:var(--text-2)">${tp.qty} مبيعات</div>
                </div>
                <strong style="font-size:13px">${Utils.formatPrice(tp.product.price)}</strong>
              </div>
            `).join('') : '<div class="empty-state">لا توجد مبيعات بعد</div>'}
          </div>
        </div>
      </div>

      ${lowStock.length ? `
      <div class="panel">
        <div class="panel-head"><h3>تنبيه: منتجات منخفضة المخزون</h3><a href="#products" class="btn btn-outline btn-sm">إدارة المنتجات</a></div>
        <div class="panel-body p0">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>المنتج</th><th>SKU</th><th>المخزون</th><th>السعر</th></tr></thead>
            <tbody>
              ${lowStock.slice(0, 5).map(p => `<tr><td><div style="display:flex;gap:10px;align-items:center"><img src="${Utils.escapeUrl(this._resolveImg(p.images[0]))}" class="thumb"><strong>${Utils.escapeHtml(p.name)}</strong></div></td><td>${Utils.escapeHtml(p.sku)}</td><td><span class="stock-cell ${p.stock === 0 ? 'out' : 'low'}">${p.stock === 0 ? 'نفذ' : p.stock}</span></td><td>${Utils.formatPrice(p.price)}</td></tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>` : ''}
    `;
    this.renderSalesChart(stats);
    this.renderOrdersDonut(orders);
  },

  renderSalesChart(stats) {
    const max = Math.max(...Object.values(stats.salesByDay), 100);
    const chart = document.getElementById('sales-chart');
    const labels = document.getElementById('sales-labels');
    if (!chart) return;
    chart.innerHTML = Object.values(stats.salesByDay).map(v => `<div class="chart-bar" style="height:${(v / max) * 100}%"><div class="tooltip">${Utils.formatPrice(v)}</div></div>`).join('');
    labels.innerHTML = Object.keys(stats.salesByDay).map(d => `<span>${new Date(d).getDate()}</span>`).join('');
  },

  renderOrdersDonut(ordersOverride) {
    const orders = ordersOverride || Store.getOrders();
    const groups = {
      'تم التسليم': orders.filter(o => o.status === 'delivered').length,
      'بالطريق': orders.filter(o => o.status === 'out_for_delivery').length,
      'قيد التحضير': orders.filter(o => o.status === 'preparing' || o.status === 'received').length,
      'جديد': orders.filter(o => o.status === 'ordered').length,
      'ملغي': orders.filter(o => o.status === 'cancelled').length
    };
    const total = Math.max(1, Object.values(groups).reduce((a, b) => a + b, 0));
    const colors = ['#16a34a', '#8b5cf6', '#f59e0b', '#2563eb', '#dc2626'];
    let offset = 0;
    const r = 60, c = 2 * Math.PI * r;
    const svg = document.getElementById('orders-donut');
    svg.innerHTML = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="#f3f4f6" stroke-width="22"/>` + Object.entries(groups).map(([k, v], i) => {
      const len = (v / total) * c;
      const el = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${colors[i]}" stroke-width="22" stroke-dasharray="${len} ${c}" stroke-dashoffset="${-offset}"/>`;
      offset += len;
      return el;
    }).join('') + `<text x="80" y="80" text-anchor="middle" dy="6" font-size="22" font-weight="800" fill="#1a1a1a">${total}</text><text x="80" y="98" text-anchor="middle" font-size="11" fill="#6b6b6b">طلب</text>`;
    document.getElementById('donut-legend').innerHTML = Object.entries(groups).map(([k, v], i) => `<div><span class="dot" style="background:${colors[i]}"></span> ${k} (${v})</div>`).join('');
  },

  /* ===== ANALYTICS ===== */
  async viewAnalytics() {
    var stats = Store.getStats();
    var orders = Store.getOrders();
    var fromSupabase = false;
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.orders.list();
        if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
          orders = this._normOrdersFromDB(r.data);
          fromSupabase = true;
        }
      } catch (e) { /* fall through to Store */ }
    }
    var products = this._productsCache || await this._loadProducts();
    var cats = this._categoriesCache || await this._loadCategories();
    if (fromSupabase) {
      stats = this._computeStats(orders, products, cats);
    }
    const months = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const monthlySales = months.map((_, i) => {
      const filtered = orders.filter(o => new Date(o.date).getMonth() === i && o.status !== 'cancelled');
      return filtered.reduce((s, o) => s + o.total, 0);
    });

    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>التحليلات والإحصائيات</h1><p>تحليل شامل لأداء المتجر</p></div></div>

      <div class="stat-grid">
        <div class="stat-card"><div class="icon">${Utils.icon('invoice', 22)}</div><div class="label">إجمالي المبيعات</div><div class="value">${Utils.formatPrice(stats.totalRevenue)}</div></div>
        <div class="stat-card"><div class="icon">${Utils.icon('check', 22)}</div><div class="label">الطلبات المكتملة</div><div class="value">${Utils.formatNumber(stats.deliveredOrders)}</div></div>
        <div class="stat-card"><div class="icon">${Utils.icon('close', 22)}</div><div class="label">الطلبات الملغاة</div><div class="value">${Utils.formatNumber(stats.cancelledOrders)}</div></div>
        <div class="stat-card"><div class="icon">${Utils.icon('invoice', 22)}</div><div class="label">متوسط قيمة الطلب</div><div class="value">${Utils.formatPrice(stats.totalOrders ? stats.totalRevenue / (stats.totalOrders - stats.cancelledOrders) : 0)}</div></div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>المبيعات الشهرية</h3></div>
        <div class="panel-body">
          <div class="chart-bars" style="height:280px" id="monthly-chart"></div>
          <div class="chart-labels" id="monthly-labels"></div>
        </div>
      </div>

      <div class="split-2">
        <div class="panel">
          <div class="panel-head"><h3>أفضل 5 منتجات مبيعاً</h3></div>
          <div class="panel-body">
            ${stats.topProducts.length ? stats.topProducts.map((tp, i) => {
              const max = stats.topProducts[0].qty;
              return `<div style="margin-bottom:16px">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:13px;font-weight:600">${i + 1}. ${Utils.escapeHtml(tp.product.name)}</span><strong>${tp.qty} مبيعات</strong></div>
                <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div style="width:${(tp.qty / max) * 100}%;height:100%;background:linear-gradient(90deg,var(--primary),var(--primary-dark));border-radius:4px"></div></div>
              </div>`;
            }).join('') : '<div class="empty-state">لا توجد مبيعات</div>'}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>المبيعات حسب الفئة</h3></div>
          <div class="panel-body">
            ${Object.keys(stats.salesByCategory).length ? Object.entries(stats.salesByCategory).map(([cat, val]) => {
              const max = Math.max(...Object.values(stats.salesByCategory));
              return `<div style="margin-bottom:14px">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span style="font-size:13px">${Utils.escapeHtml(cat)}</span><strong>${Utils.formatPrice(val)}</strong></div>
                <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div style="width:${(val / max) * 100}%;height:100%;background:var(--accent);border-radius:4px"></div></div>
              </div>`;
            }).join('') : '<div class="empty-state">لا توجد بيانات</div>'}
          </div>
        </div>
      </div>
    `;
    const max = Math.max(...monthlySales, 100);
    document.getElementById('monthly-chart').innerHTML = monthlySales.map(v => `<div class="chart-bar" style="height:${(v / max) * 100}%"><div class="tooltip">${Utils.formatPrice(v)}</div></div>`).join('');
    document.getElementById('monthly-labels').innerHTML = months.map(m => `<span>${m}</span>`).join('');
  },

  /* ===== PRODUCTS ===== */
  async viewProducts() {
    const products = this._productsCache || await this._loadProducts();
    const cats = this._categoriesCache || await this._loadCategories();
    this._prodFiltered = null;
    this._prodPage = 1;
    const shown = products.slice(0, this._prodPP);
    const hasMore = shown.length < products.length;
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head">
        <div><h1>المنتجات</h1><p>إدارة جميع منتجات المتجر (${products.length} منتج)</p></div>
        <button class="btn btn-primary" onclick="Admin.productForm()">${Utils.icon('plus', 16)} إضافة منتج</button>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div class="filter-bar">
            <input type="text" id="prod-search" placeholder="بحث في المنتجات..." oninput="Admin._debouncedFilterProducts()">
            <select id="prod-cat-filter" onchange="Admin.filterProducts()">
              <option value="">جميع الفئات</option>
              ${cats.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('')}
            </select>
            <select id="prod-status-filter" onchange="Admin.filterProducts()">
              <option value="">جميع الحالات</option>
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </select>
          </div>
        </div>
        <div class="panel-body p0">
          <div class="table-wrap"><table class="data" id="products-table">
            <thead><tr>
              <th>المنتج</th><th>SKU</th><th>الفئة</th><th>السعر</th><th>المخزون</th><th>الحالة</th><th>الإجراءات</th>
            </tr></thead>
            <tbody id="products-tbody">
              ${shown.map(p => this.productRow(p)).join('')}
            </tbody>
          </table></div>
          <div id="prod-pagination" style="padding:12px;text-align:center">${hasMore ? `<button class="btn btn-outline btn-sm" onclick="Admin.prodLoadMore()">تحميل المزيد (${products.length - shown.length} متبقي)</button>` : ''}</div>
        </div>
      </div>
    `;
  },

  productRow(p) {
    const cats = this._categoriesCache || [];
    const cat = cats.find(c => c.id === p.categoryId) || cats.find(c => c.uuid === p.categoryId);
    var thumbSrc = Utils.escapeUrl(this._resolveImg(p.images[0]));
    return `<tr data-product-id="${p.id}">
      <td><div style="display:flex;gap:10px;align-items:center"><img src="${thumbSrc || 'https://via.placeholder.com/44'}" class="thumb" loading="lazy"><div><strong>${Utils.escapeHtml(p.name)}</strong><br><span style="font-size:11px;color:var(--text-3)">${Utils.escapeHtml(p.shortDescription || '')}</span></div></div></td>
      <td>${Utils.escapeHtml(p.sku || '—')}</td>
      <td>${cat ? Utils.escapeHtml(cat.name) : '—'}</td>
      <td><strong>${Utils.formatPrice(p.price)}</strong>${p.oldPrice > p.price ? `<br><span style="font-size:11px;color:var(--danger);text-decoration:line-through">${Utils.formatPrice(p.oldPrice)}</span>` : ''}</td>
      <td><span class="stock-cell ${p.stock === 0 ? 'out' : p.stock < 5 ? 'low' : ''}">${p.stock === 0 ? 'نفذ' : p.stock + ' قطعة'}</span></td>
      <td>${p.active ? '<span class="tag tag-green">نشط</span>' : '<span class="tag tag-gray">معطل</span>'} ${p.featured ? '<span class="tag tag-gold">مميز</span>' : ''}</td>
      <td><div class="actions">
        <button onclick="Admin.productForm('${p.id}')" title="تعديل">${Utils.icon('edit', 14)}</button>
        <button onclick="Admin.toggleProductActive('${p.id}')" title="تفعيل/تعطيل" class="success">${Utils.icon(p.active ? 'close' : 'check', 14)}</button>
        <button onclick="Admin.deleteProduct('${p.id}')" title="حذف" class="danger">${Utils.icon('trash', 14)}</button>
      </div></td>
    </tr>`;
  },

  filterProducts() {
    const q = document.getElementById('prod-search').value.toLowerCase();
    const cat = document.getElementById('prod-cat-filter').value;
    const status = document.getElementById('prod-status-filter').value;
    let products = this._productsCache || [];
    if (q) products = products.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    if (cat) products = products.filter(p => p.categoryId === cat);
    if (status === 'active') products = products.filter(p => p.active);
    if (status === 'inactive') products = products.filter(p => !p.active);
    this._prodFiltered = products;
    this._prodPage = 1;
    var shown = products.slice(0, this._prodPP);
    var hasMore = shown.length < products.length;
    document.getElementById('products-tbody').innerHTML = shown.map(p => this.productRow(p)).join('');
    var pag = document.getElementById('prod-pagination');
    if (pag) pag.innerHTML = hasMore ? `<button class="btn btn-outline btn-sm" onclick="Admin.prodLoadMore()">تحميل المزيد (${products.length - shown.length} متبقي)</button>` : '';
  },

  prodLoadMore() {
    this._prodPage++;
    var source = this._prodFiltered || this._productsCache || [];
    var shown = source.slice(0, this._prodPage * this._prodPP);
    var hasMore = shown.length < source.length;
    document.getElementById('products-tbody').innerHTML = shown.map(p => this.productRow(p)).join('');
    var pag = document.getElementById('prod-pagination');
    if (pag) pag.innerHTML = hasMore ? `<button class="btn btn-outline btn-sm" onclick="Admin.prodLoadMore()">تحميل المزيد (${source.length - shown.length} متبقي)</button>` : '';
  },

  async toggleProductActive(id) {
    const p = (this._productsCache || []).find(x => x.id === id);
    if (!p) return;
    var newState = !p.active;
    if (this._hasAdminDataLayer()) {
      try {
        var uuid = p.uuid || this._productLegacyIdToUuid(id);
        var r = await window.AdminDataLayer.products.update(uuid, { active: newState });
        if (r && r.ok) {
          p.active = newState;
          console.log('[Admin] Product', id, 'toggled to', newState ? 'active' : 'inactive');
          Utils.toast(newState ? 'تم تفعيل المنتج' : 'تم تعطيل المنتج');
          this.filterProducts();
          return;
        }
        this._showError(this._mapAuthError(r && r.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.updateProduct(id, { active: newState });
      p.active = newState;
      Utils.toast(newState ? 'تم تفعيل المنتج' : 'تم تعطيل المنتج');
      this.filterProducts();
    }
  },

  async deleteProduct(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المنتج نهائياً؟ سيتم حذف المنتج وصوره وخياراته من قاعدة البيانات.')) return;
    if (this._hasAdminDataLayer()) {
      try {
        var p = (this._productsCache || []).find(x => x.id === id);
        var uuid = (p && p.uuid) || this._productLegacyIdToUuid(id);
        console.log('[Admin] Deleting product:', id, 'UUID:', uuid);
        // Delete variants from DB first
        if (p && p.variants && p.variants.length > 0) {
          for (var dvi = 0; dvi < p.variants.length; dvi++) {
            try {
              var vUuid = p.variants[dvi].uuid;
              if (vUuid) await window.AdminDataLayer.productVariants.delete(vUuid);
            } catch (e) { console.warn('[Admin] Failed to delete variant:', e); }
          }
        }
        // Actual DELETE from products table
        var client = window.__supabase && window.__supabase.client;
        if (!client) { this._showError('Supabase client not available'); return; }
        var r = await client.from('products').delete().eq('id', uuid);
        if (r && r.error) {
          console.error('[Admin] Product delete failed:', JSON.stringify(r.error));
          this._showError('فشل حذف المنتج: ' + (r.error.message || r.error.details || r.error.hint || 'خطأ غير معروف'));
          return;
        }
        // DB success — now clean Storage images
        if (p && p.images && p.images.length > 0 && typeof window.SupabaseStorage === 'object') {
          for (var si = 0; si < p.images.length; si++) {
            try {
              var imgPath = typeof window.SupabaseStorage.extractStoragePath === 'function'
                ? window.SupabaseStorage.extractStoragePath(p.images[si]) : null;
              if (imgPath) await window.SupabaseStorage.deleteFile(imgPath);
            } catch (e) {}
          }
        }
        if (p && p.variants && p.variants.length > 0 && typeof window.SupabaseStorage === 'object') {
          for (var vi = 0; vi < p.variants.length; vi++) {
            try {
              var vImg = p.variants[vi].image;
              if (vImg && typeof window.SupabaseStorage.extractStoragePath === 'function') {
                var vPath = window.SupabaseStorage.extractStoragePath(vImg);
                if (vPath) await window.SupabaseStorage.deleteFile(vPath);
              }
            } catch (e) {}
          }
        }
        console.log('[Admin] Product deleted from Supabase:', id);
        // Remove from local cache
        if (this._productsCache) {
          this._productsCache = this._productsCache.filter(function (x) { return x.id !== id; });
        }
        Utils.toast('تم حذف المنتج نهائياً');
        this.filterProducts();
        return;
      } catch (e) {
        console.error('[Admin] deleteProduct error:', e);
        this._showError('حدث خطأ غير متوقع أثناء حذف المنتج.');
      }
    } else {
      Store.deleteProduct(id);
      Utils.toast('تم حذف المنتج', 'warn');
      this.filterProducts();
    }
  },

  async productForm(id = null) {
    const cats = this._categoriesCache || await this._loadCategories();
    var p;
    if (id) {
      p = (this._productsCache || []).find(x => x.id === id);
      if (!p) { Utils.toast('المنتج غير موجود', 'error'); return; }
      console.log('[Admin] Editing product:', id, 'UUID:', p.uuid, 'categoryId:', p.categoryId, 'images:', p.images.length);
    } else {
      p = { name: '', sku: '', price: 0, oldPrice: 0, stock: 1000, images: [], description: '', shortDescription: '', categoryId: '', active: true, featured: false, isNew: true, onSale: false, variants: [] };
    }
    this.editingProduct = p;
    this.openModal({
      title: id ? 'تعديل المنتج' : 'إضافة منتج جديد',
      body: `
        <div class="tabs">
          <div class="tab active" data-tab="general" onclick="Admin.switchTab(this)">البيانات الأساسية</div>
          <div class="tab" data-tab="media" onclick="Admin.switchTab(this)">الصور</div>
          <div class="tab" data-tab="variants" onclick="Admin.switchTab(this)">الخيارات</div>
          <div class="tab" data-tab="seo" onclick="Admin.switchTab(this)">إعدادات إضافية</div>
        </div>
        <div class="tab-pane" data-pane="general">
          <div class="form-row">
            <div class="form-group"><label class="form-label">اسم المنتج <span class="req">*</span></label><input class="form-control" id="f-name" value="${Utils.escapeHtml(p.name)}"></div>
            <div class="form-group"><label class="form-label">رمز SKU</label><input class="form-control" id="f-sku" value="${Utils.escapeHtml(p.sku || '')}"></div>
          </div>
          <div class="form-group"><label class="form-label">الوصف المختصر</label><input class="form-control" id="f-short" value="${Utils.escapeHtml(p.shortDescription || '')}"></div>
          <div class="form-group"><label class="form-label">الوصف الكامل</label><textarea class="form-control" id="f-desc" rows="4">${Utils.escapeHtml(p.description || '')}</textarea></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">الفئة <span class="req">*</span></label><select class="form-control" id="f-cat"><option value="">اختر الفئة</option>${cats.map(c => {
              var isSelected = p.categoryId === c.id || p.categoryId === c.uuid;
              return `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`;
            }).join('')}</select></div>
            <div class="form-group"><label class="form-label">السعر <span class="req">*</span></label><input class="form-control" type="number" id="f-price" step="0.01" min="0" value="${p.price}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">السعر القديم (للخصم)</label><input class="form-control" type="number" id="f-oldprice" step="0.01" min="0" value="${p.oldPrice || 0}"></div>
            <div class="form-group"><label class="form-label">الكمية المتوفرة <span class="req">*</span></label><input class="form-control" type="number" id="f-stock" step="1" min="0" value="${p.stock}"></div>
          </div>
        </div>
        <div class="tab-pane hide" data-pane="media">
          <div class="image-uploader" id="img-uploader" onclick="document.getElementById('img-input').click()">
            <div style="font-size:30px;color:var(--primary)">📸</div>
            <p style="margin-top:8px;font-weight:600">انقر أو اسحب الصور هنا</p>
            <p style="font-size:12px;color:var(--text-2)">يدعم JPG, PNG, WebP</p>
            <input type="file" id="img-input" accept="image/*" multiple style="display:none">
          </div>
          <div class="image-list" id="image-list"></div>
          <p class="form-help">يمكنك أيضاً لصق روابط صور مباشرة</p>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input class="form-control" id="img-url" placeholder="https://...">
            <button class="btn btn-outline" onclick="Admin.addImageUrl()">إضافة</button>
          </div>
        </div>
        <div class="tab-pane hide" data-pane="variants">
          <p class="muted mb-2" style="font-size:13px">الخيارات اختيارية. أضف اللون، القياس، الحجم، أو الوزن. كل خيار يمكن أن يكون له سعر ومخزون مستقل وصورة اختيارية.</p>
          <div id="variants-list"></div>
          <button class="btn btn-outline mt-2" onclick="Admin.addVariant()">${Utils.icon('plus', 14)} إضافة خيار</button>
        </div>
        <div class="tab-pane hide" data-pane="seo">
          <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="f-active" ${p.active ? 'checked' : ''}> <span>منشط (يظهر في المتجر)</span></label></div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="f-featured" ${p.featured ? 'checked' : ''}> <span>منتج مميز</span></label></div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="f-new" ${p.isNew ? 'checked' : ''}> <span>منتج جديد</span></label></div>
          <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="f-sale" ${p.onSale ? 'checked' : ''}> <span>عرض خاص / تخفيض</span></label></div>
        </div>
      `,
      foot: `<button class="btn btn-outline" onclick="Admin.closeModal()">إلغاء</button>
             <button class="btn btn-primary" onclick="Admin.saveProduct('${id || ''}')">${Utils.icon('check', 16)} حفظ المنتج</button>`
    });
    this.productImages = [...(p.images || [])];
    this._originalProductImages = [...(p.images || [])];
    this.productVariants = JSON.parse(JSON.stringify(p.variants || []));
    // Tag each variant as "customized" (price differs from base) or "default" (follows base).
    // For new products, all variants default to following the base. For existing products,
    // a variant is considered customized if its saved price differs from the saved base price.
    const editingBase = Number(p && p.price);
    (this.productVariants || []).forEach(v => {
      const vp = Number(v && v.price);
      v._isCustomPrice = Number.isFinite(vp) && Number.isFinite(editingBase) && vp !== editingBase;
    });
    // Wire the base price input to live-update non-customized variant price fields.
    setTimeout(() => {
      const baseEl = document.getElementById('f-price');
      if (baseEl) {
        baseEl.addEventListener('input', () => this.onBasePriceChange());
      }
      this.renderImages(); this.renderVariants(); this.bindImageUploader();
    }, 50);
  },

  switchTab(el) {
    el.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hide'));
    document.querySelector(`[data-pane="${el.dataset.tab}"]`).classList.remove('hide');
  },

  _resolveImg(val) {
    if (val && typeof val === 'object' && val instanceof File) {
      return URL.createObjectURL(val);
    }
    if (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.resolveImageUrl === 'function') {
      return window.SupabaseStorage.resolveImageUrl(val);
    }
    return val || '';
  },
  renderImages() {
    const list = document.getElementById('image-list');
    if (!list) return;
    var self = this;
    list.innerHTML = this.productImages.map(function (img, i) {
      var src = self._resolveImg(img);
      var isFile = img && typeof img === 'object' && img instanceof File;
      return '<div class="image-item"><img src="' + Utils.escapeUrl(src) + '">' +
        (isFile ? '<span class="upload-badge" style="position:absolute;top:4px;right:4px;background:var(--primary);color:#fff;font-size:10px;padding:2px 6px;border-radius:4px">جديد</span>' : '') +
        '<button class="remove" onclick="Admin.removeImage(' + i + ')">' + Utils.icon('close', 12) + '</button>' +
        (i === 0 ? '<span class="primary-badge">رئيسية</span>' : '') +
        '</div>';
    }).join('');
  },
  addImageUrl() {
    const url = document.getElementById('img-url').value.trim();
    if (url) { this.productImages.push(url); this.renderImages(); document.getElementById('img-url').value = ''; }
  },
  removeImage(i) {
    var img = this.productImages[i];
    if (typeof img === 'string' && typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.resolveImageUrl === 'function') {
      var resolved = window.SupabaseStorage.resolveImageUrl(img);
      if (resolved && resolved !== img && resolved.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(resolved); } catch (e) {}
      }
    }
    this.productImages.splice(i, 1);
    this.renderImages();
  },
  bindImageUploader() {
    var self = this;
    var up = document.getElementById('img-uploader');
    var input = document.getElementById('img-input');
    input.addEventListener('change', function (e) {
      Array.from(e.target.files).forEach(function (f) {
        var err = (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.validateFile === 'function')
          ? window.SupabaseStorage.validateFile(f) : null;
        if (err) { Utils.toast(err, 'error'); return; }
        self.productImages.push(f);
        self.renderImages();
      });
      input.value = '';
    });
    up.addEventListener('dragover', function (e) { e.preventDefault(); up.classList.add('dragover'); });
    up.addEventListener('dragleave', function () { up.classList.remove('dragover'); });
    up.addEventListener('drop', function (e) {
      e.preventDefault();
      up.classList.remove('dragover');
      Array.from(e.dataTransfer.files).forEach(function (f) {
        var err = (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.validateFile === 'function')
          ? window.SupabaseStorage.validateFile(f) : null;
        if (err) { Utils.toast(err, 'error'); return; }
        if (f.type && f.type.indexOf('image/') === 0) {
          self.productImages.push(f);
          self.renderImages();
        }
      });
    });
  },

  renderVariants() {
    const list = document.getElementById('variants-list');
    if (!list) return;
    if (!this.productVariants.length) { list.innerHTML = '<div class="muted" style="text-align:center;padding:20px">لا توجد خيارات. اضغط "إضافة خيار" لإنشاء خيارات مثل المقاس أو اللون. الخيارات اختيارية تماماً.</div>'; return; }
    var self = this;
    list.innerHTML = this.productVariants.map((v, i) => {
      var imgSrc = Utils.escapeUrl(self._resolveImg(v.image));
      var escapedSrc = imgSrc ? imgSrc.replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';
      return `
      <div class="variant-row">
        <select onchange="Admin.updateVariant(${i},'type',this.value)">
          <option value="color" ${v.type === 'color' ? 'selected' : ''}>اللون</option>
          <option value="size" ${v.type === 'size' ? 'selected' : ''}>القياس (مقاس)</option>
          <option value="dimension" ${v.type === 'dimension' ? 'selected' : ''}>الحجم</option>
          <option value="weight" ${v.type === 'weight' ? 'selected' : ''}>الوزن</option>
        </select>
        <input value="${v.value || ''}" placeholder="القيمة (مثال: M، أحمر، 50مل)" onchange="Admin.updateVariant(${i},'value',this.value)">
        ${v.type === 'color' ? `<div class="color-input"><input type="color" value="${v.swatch || '#000000'}" onchange="Admin.updateVariant(${i},'swatch',this.value)"><input type="text" value="${v.swatch || ''}" placeholder="#hex" onchange="Admin.updateVariant(${i},'swatch',this.value)"></div>` : '<span></span>'}
        <input type="number" step="0.01" min="0" value="${(Number.isFinite(v.price) ? v.price : 0)}" placeholder="السعر" onchange="Admin.setVariantPrice(${i},this.value)">
        <input type="number" step="1" min="0" value="${(Number.isFinite(v.stock) ? v.stock : 0)}" placeholder="المخزون" onchange="Admin.updateVariant(${i},'stock',Math.round(Admin.numInput(this.value)))">
        <div class="variant-image">
          ${v.image ? `<img src="${imgSrc}" alt="" style="cursor:zoom-in" onclick="Admin.openVariantLightbox('${escapedSrc}')" title="اضغط لعرض الصورة بحجم أكبر"><button type="button" class="remove" onclick="Admin.updateVariant(${i},'image','')" title="إزالة الصورة">${Utils.icon('close', 10)}</button>` : '<span class="muted" style="font-size:11px">لا توجد صورة</span>'}
          <button type="button" class="btn btn-outline btn-sm" onclick="Admin.pickVariantImage(${i})" title="رفع صورة">${Utils.icon('image', 12)}</button>
        </div>
        <span class="remove" onclick="Admin.removeVariant(${i})" title="حذف الخيار">${Utils.icon('trash', 16)}</span>
      </div>`;
    }).join('');
  },
  addVariant() {
    const np = this.editingProduct && this.editingProduct.price;
    const basePrice = (Number.isFinite(np) && np >= 0) ? np : 0;
    this.productVariants.push({ id: 'v_' + Date.now() + Math.random().toString(36).slice(2, 6), type: 'size', value: '', price: basePrice, stock: 1000, image: '' });
    this.renderVariants();
  },
  pickVariantImage(i) {
    var self = this;
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
    inp.onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var err = (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.validateFile === 'function')
        ? window.SupabaseStorage.validateFile(f) : null;
      if (err) { Utils.toast(err, 'error'); return; }
      self.updateVariant(i, 'image', f);
    };
    inp.click();
  },
  updateVariant(i, key, val) {
    this.productVariants[i][key] = val;
    if (key === 'type' || key === 'image') this.renderVariants();
  },
  removeVariant(i) { this.productVariants.splice(i, 1); this.renderVariants(); },

  async saveProduct(id) {
    var self = this;
    var num = function (el) {
      var v = parseFloat(el && el.value);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    };
    var data = {
      name: document.getElementById('f-name').value.trim(),
      sku: document.getElementById('f-sku').value.trim(),
      shortDescription: document.getElementById('f-short').value.trim(),
      description: document.getElementById('f-desc').value.trim(),
      categoryId: document.getElementById('f-cat').value,
      price: num(document.getElementById('f-price')),
      oldPrice: num(document.getElementById('f-oldprice')),
      stock: +document.getElementById('f-stock').value || 0,
      images: this.productImages || [],
      active: document.getElementById('f-active').checked,
      featured: document.getElementById('f-featured').checked,
      isNew: document.getElementById('f-new').checked,
      onSale: document.getElementById('f-sale').checked
    };
    if (!data.name) return Utils.toast('اسم المنتج مطلوب', 'error');
    if (!data.categoryId) return Utils.toast('الفئة مطلوبة', 'error');

    console.log('[Admin] saveProduct called — id:', id, 'images count:', data.images.length);
    console.log('[Admin] Images before upload:', data.images.map(function (img) { return img instanceof File ? 'FILE:' + img.name : img; }));

    var canUpload = typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.uploadProductImage === 'function';

    if (this._hasAdminDataLayer()) {
      try {
        // Phase 1: Upload new product images (File objects) to Storage
        var uploadedProductUrls = [];
        if (canUpload) {
          var pendingIndices = [];
          for (var pi = 0; pi < data.images.length; pi++) {
            if (data.images[pi] && typeof data.images[pi] === 'object' && data.images[pi] instanceof File) {
              pendingIndices.push(pi);
            }
          }
          if (pendingIndices.length > 0) {
            console.log('[Admin] Uploading', pendingIndices.length, 'new image(s)...');
            for (var ui = 0; ui < pendingIndices.length; ui++) {
              var idx = pendingIndices[ui];
              var file = data.images[idx];
              // Resolve product UUID for Storage path
              var productId = null;
              if (id) {
                // Try to get UUID directly from cached product
                var cachedProd = (self._productsCache || []).find(function (x) { return x.id === id; });
                productId = (cachedProd && cachedProd.uuid) || self._productLegacyIdToUuid(id) || id;
              } else {
                productId = 'tmp_' + Date.now();
              }
              console.log('[Admin] Uploading image', idx, 'to product path:', productId);
              var uploadRes = await window.SupabaseStorage.uploadProductImage(file, productId);
              if (uploadRes.ok) {
                console.log('[Admin] Image uploaded successfully:', uploadRes.url);
                data.images[idx] = uploadRes.url;
                uploadedProductUrls.push(uploadRes.url);
              } else {
                console.error('[Admin] Image upload failed:', uploadRes.error);
                // Clean up previously uploaded images from this save attempt
                for (var ci = 0; ci < uploadedProductUrls.length; ci++) {
                  var path = window.SupabaseStorage.extractStoragePath(uploadedProductUrls[ci]);
                  if (path) await window.SupabaseStorage.deleteFile(path);
                }
                return Utils.toast('فشل رفع الصورة: ' + (uploadRes.error || 'خطأ غير معروف'), 'error');
              }
            }
            self.productImages = data.images;
          }
        }

        console.log('[Admin] Final images before DB update:', data.images);

        // Phase 2: Resolve product UUID for database update
        var prodUuid = null;
        if (id) {
          var cachedProduct = (self._productsCache || []).find(function (x) { return x.id === id; });
          prodUuid = (cachedProduct && cachedProduct.uuid) || self._productLegacyIdToUuid(id);
          console.log('[Admin] Product UUID for DB update:', prodUuid, '(legacy id:', id, ')');
        }

        // Phase 3: Save product to database
        var patch = self._denormProduct(data);
        console.log('[Admin] Product patch stock:', patch.stock, 'category:', patch.category_id);
        console.log('[Admin] Product patch images:', patch.images);
        var result;
        if (id) {
          result = await window.AdminDataLayer.products.update(prodUuid, patch);
        } else {
          result = await window.AdminDataLayer.products.create(patch);
        }
        if (result && result.ok) {
          var savedId = result.data && result.data.id;
          console.log('[Admin] Product saved to Supabase:', id ? 'updated' : 'created', savedId);
          // Verify the saved data has images
          if (result.data && result.data.images) {
            console.log('[Admin] Verified: DB has', result.data.images.length, 'image(s)');
          }

          // Phase 4: Delete removed images from Storage (only after successful save)
          var origImages = self._originalProductImages || [];
          for (var ri = 0; ri < origImages.length; ri++) {
            var origVal = origImages[ri];
            if (typeof origVal === 'string' && data.images.indexOf(origVal) === -1) {
              var delPath = (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.extractStoragePath === 'function')
                ? window.SupabaseStorage.extractStoragePath(origVal) : null;
              if (delPath) await window.SupabaseStorage.deleteFile(delPath);
            }
          }

          // Phase 5: Save variants (upsert — no delete-all-recreate)
          var variants = self.productVariants || [];
          if (savedId && variants.length > 0) {
            var canProceedWithVariants = true;
            var existingMap = {};
            var existingList = [];
            if (id) {
              var existing = await window.AdminDataLayer.productVariants.listByProduct(savedId);
              if (existing && existing.ok && Array.isArray(existing.data)) {
                existingList = existing.data;
                for (var ei = 0; ei < existingList.length; ei++) {
                  existingMap[existingList[ei].legacy_id] = existingList[ei];
                }
              } else {
                canProceedWithVariants = false;
                Utils.toast('تعذر جلب المتغيرات الحالية — تم حفظ المنتج بدون تحديث المتغيرات', 'error');
              }
            }
            if (canProceedWithVariants) {
              var keptLegacyIds = {};
              var variantOldUrls = {};
              for (var vi = 0; vi < variants.length; vi++) {
                var v = variants[vi];
                var variantImageUrl = '';
                if (v.image) {
                  if (typeof v.image === 'object' && v.image instanceof File && canUpload) {
                    var vProdId = savedId || 'tmp_' + Date.now();
                    var vUpRes = await window.SupabaseStorage.uploadProductImage(v.image, vProdId);
                    if (vUpRes.ok) {
                      variantImageUrl = vUpRes.url;
                    } else {
                      var existingV = existingMap[v.id || ('v_' + Date.now() + '_' + vi)];
                      variantImageUrl = (existingV && existingV.image_url) ? existingV.image_url : '';
                      if (!variantImageUrl) Utils.toast('فشل رفع صورة "' + (v.value || v.type) + '"', 'error');
                    }
                  } else if (typeof v.image === 'string') {
                    variantImageUrl = v.image;
                  }
                }
                var vLegacyId = v.uuid ? (v.id || '') : (v.id || 'v_' + Date.now() + '_' + vi);
                keptLegacyIds[vLegacyId] = true;
                var existingVariant = existingMap[vLegacyId];
                if (existingVariant) {
                  if (!variantImageUrl && existingVariant.image_url) variantImageUrl = existingVariant.image_url;
                  if (existingVariant.image_url && variantImageUrl && existingVariant.image_url !== variantImageUrl) {
                    variantOldUrls[existingVariant.image_url] = true;
                  }
                  await window.AdminDataLayer.productVariants.update(existingVariant.id, {
                    legacy_type: v.type || 'size',
                    legacy_value: v.value || '',
                    legacy_swatch: v.swatch || '',
                    price: Number(v.price) || 0,
                    stock: Number(v.stock) || 0,
                    image_url: variantImageUrl,
                    active: true,
                    display_order: vi
                  });
                } else {
                  var vCreateRes = await window.AdminDataLayer.productVariants.create({
                    product_id: savedId,
                    legacy_id: vLegacyId,
                    legacy_type: v.type || 'size',
                    legacy_value: v.value || '',
                    legacy_swatch: v.swatch || '',
                    price: Number(v.price) || 0,
                    stock: Number(v.stock) || 0,
                    image_url: variantImageUrl,
                    active: true,
                    display_order: vi
                  });
                  if (vCreateRes && !vCreateRes.ok) {
                    Utils.toast('فشل حفظ خيار "' + (v.value || v.type) + '": ' + (vCreateRes.error || 'خطأ غير معروف'), 'error');
                  }
                }
              }
              for (var di = 0; di < existingList.length; di++) {
                var oldV = existingList[di];
                if (!keptLegacyIds[oldV.legacy_id]) {
                  await window.AdminDataLayer.productVariants.delete(oldV.id);
                  if (oldV.image_url && typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.extractStoragePath === 'function') {
                    var oldPath = window.SupabaseStorage.extractStoragePath(oldV.image_url);
                    if (oldPath) await window.SupabaseStorage.deleteFile(oldPath);
                  }
                }
              }
              var oldUrls = Object.keys(variantOldUrls);
              for (var oui = 0; oui < oldUrls.length; oui++) {
                if (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.extractStoragePath === 'function') {
                  var oPath = window.SupabaseStorage.extractStoragePath(oldUrls[oui]);
                  if (oPath) await window.SupabaseStorage.deleteFile(oPath);
                }
              }
            }
          }

          // Phase 6: Refresh cache and render
          await self._loadProducts();
          self._originalProductImages = [];
          Utils.toast(id ? 'تم تحديث المنتج' : 'تم إضافة المنتج');
          self.closeModal();
          self.viewProducts();
          return;
        }
        // DB save failed: clean up any newly uploaded images
        console.error('[Admin] Product save failed:', result && result.error);
        for (var fi = 0; fi < uploadedProductUrls.length; fi++) {
          var failPath = (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.extractStoragePath === 'function')
            ? window.SupabaseStorage.extractStoragePath(uploadedProductUrls[fi]) : null;
          if (failPath) await window.SupabaseStorage.deleteFile(failPath);
        }
        self._showError(self._mapAuthError(result && result.error));
      } catch (e) {
        console.error('saveProduct error:', e);
        for (var ci = 0; ci < uploadedProductUrls.length; ci++) {
          try {
            var cPath = (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.extractStoragePath === 'function')
              ? window.SupabaseStorage.extractStoragePath(uploadedProductUrls[ci]) : null;
            if (cPath) await window.SupabaseStorage.deleteFile(cPath);
          } catch (ce) {}
        }
        self._showError('حدث خطأ غير متوقع أثناء حفظ المنتج.');
      }
    } else {
      // Fallback to Store
      this.editingProduct = { ...this.editingProduct, ...data, variants: this.productVariants || [] };
      if (id) { Store.updateProduct(id, this.editingProduct); Utils.toast('تم تحديث المنتج'); }
      else { Store.addProduct(this.editingProduct); Utils.toast('تم إضافة المنتج'); }
      this.closeModal();
      this.viewProducts();
    }
  },

  /* ===== CATEGORIES ===== */
  async viewCategories() {
    const cats = this._categoriesCache || await this._loadCategories();
    const products = this._productsCache || await this._loadProducts();
    const main = cats.filter(c => !c.parent);
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head">
        <div><h1>الفئات</h1><p>إدارة فئات وفئات فرعية للمتجر</p></div>
        <button class="btn btn-primary" onclick="Admin.categoryForm()">${Utils.icon('plus', 16)} إضافة فئة</button>
      </div>
      <div class="panel">
        <div class="panel-body">
          ${main.map(c => {
            const subs = cats.filter(sc => sc.parent === c.id);
            const productCount = products.filter(p => p.categoryId === c.id).length;
            return `<div style="background:var(--surface-2);border-radius:12px;padding:16px;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:50px;height:50px;background:#fff;border-radius:10px;display:grid;place-items:center;overflow:hidden">${c.image ? `<img src="${Utils.escapeUrl(c.image)}" style="width:100%;height:100%;object-fit:cover" loading="lazy">` : `<span style="font-size:28px">${c.icon || '📦'}</span>`}</div>
                <div style="flex:1"><strong>${Utils.escapeHtml(c.name)}</strong><br><span style="font-size:12px;color:var(--text-2)">${productCount} منتج • ${subs.length} فئة فرعية</span></div>
                <div class="actions">
                  <button class="icon-btn" onclick="Admin.categoryForm(null,'${c.id}')" title="إضافة فئة فرعية">${Utils.icon('plus', 16)}</button>
                  <button class="icon-btn" onclick="Admin.categoryForm('${c.id}')" title="تعديل">${Utils.icon('edit', 14)}</button>
                  <button class="icon-btn" onclick="Admin.deleteCategory('${c.id}')" title="حذف">${Utils.icon('trash', 14)}</button>
                </div>
              </div>
              ${subs.length ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">${subs.map(s => `<div style="background:#fff;padding:8px 12px;border-radius:8px;display:flex;align-items:center;gap:8px">${s.image ? `<img src="${Utils.escapeUrl(s.image)}" style="width:24px;height:24px;border-radius:6px;object-fit:cover" loading="lazy">` : `<span>${s.icon || '📦'}</span>`} ${Utils.escapeHtml(s.name)}<button onclick="Admin.deleteCategory('${s.id}')" style="color:var(--danger);margin-right:8px">×</button></div>`).join('')}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    `;
  },

  async categoryForm(id = null, parent = null) {
    const cats = this._categoriesCache || await this._loadCategories();
    const c = id ? cats.find(x => x.id === id) : { name: '', icon: '📦', image: '', parent: parent || null };
    if (id && !c) { Utils.toast('الفئة غير موجودة', 'error'); return; }
    const parentCats = cats.filter(x => !x.parent);
    this.openModal({
      title: id ? 'تعديل الفئة' : (parent ? 'إضافة فئة فرعية' : 'إضافة فئة جديدة'),
      body: `
        <div class="form-group"><label class="form-label">اسم الفئة <span class="req">*</span></label><input class="form-control" id="f-cat-name" value="${Utils.escapeHtml(c.name)}"></div>
        <div class="form-group">
          <label class="form-label">صورة الفئة (اختياري)</label>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <div id="cat-img-preview" style="width:64px;height:64px;border-radius:12px;overflow:hidden;background:var(--surface-2);display:grid;place-items:center;border:1.5px solid var(--border)">
              ${c.image ? `<img src="${Utils.escapeUrl(c.image)}" style="width:100%;height:100%;object-fit:cover">` : '<span style="color:var(--text-3);font-size:11px">لا توجد</span>'}
            </div>
            <input class="form-control" style="flex:1;min-width:200px" id="f-cat-image" value="${c.image || ''}" placeholder="https://..." oninput="Admin.previewCatImg()">
            <input type="file" id="f-cat-image-file" accept="image/*" style="display:none" onchange="Admin.uploadCatImg(this)">
            <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('f-cat-image-file').click()">${Utils.icon('plus', 12)} رفع</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('f-cat-image').value='';Admin.previewCatImg()">${Utils.icon('trash', 12)}</button>
          </div>
          <p class="form-help">إن تركتها فارغة سيتم استخدام الأيقونة (إيموجي) أدناه.</p>
        </div>
        <div class="form-group"><label class="form-label">الأيقونة (إيموجي) — تُستخدم إذا لم ترفع صورة</label><input class="form-control" id="f-cat-icon" value="${c.icon || '📦'}" maxlength="2"></div>
        ${!parent ? `<div class="form-group"><label class="form-label">الفئة الرئيسية (اتركها فارغة لفئة رئيسية)</label><select class="form-control" id="f-cat-parent"><option value="">بدون (فئة رئيسية)</option>${parentCats.map(x => `<option value="${x.id}" ${c.parent === x.id ? 'selected' : ''}>${Utils.escapeHtml(x.name)}</option>`).join('')}</select></div>` : `<input type="hidden" id="f-cat-parent" value="${parent}">`}
      `,
      foot: `<button class="btn btn-outline" onclick="Admin.closeModal()">إلغاء</button>
             <button class="btn btn-primary" onclick="Admin.saveCategory('${id || ''}')">حفظ</button>`
    });
  },

  previewCatImg() {
    const url = document.getElementById('f-cat-image').value.trim();
    const p = document.getElementById('cat-img-preview');
    if (url) p.innerHTML = `<img src="${Utils.escapeUrl(url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<span style=color:var(--danger)>!</span>'">`;
    else p.innerHTML = '<span style="color:var(--text-3);font-size:11px">لا توجد</span>';
  },

  async uploadCatImg(input) {
    const file = input.files[0];
    if (!file) return;
    const el = document.getElementById('f-cat-image');
    const oldVal = el.value;
    try {
      if (typeof window.SupabaseStorage === 'undefined' || !window.SupabaseStorage.uploadSettingsImage) {
        Utils.toast('نظام Storage غير جاهز', 'error'); return;
      }
      var r = await window.SupabaseStorage.uploadSettingsImage(file, 'settings/categories');
      if (r && r.ok && r.url) {
        if (oldVal && oldVal !== r.url && typeof window.SupabaseStorage.extractStoragePath === 'function') {
          var p = window.SupabaseStorage.extractStoragePath(oldVal);
          if (p) { if (!this._pendingImageCleanup) this._pendingImageCleanup = []; this._pendingImageCleanup.push(p); }
        }
        el.value = r.url;
        Admin.previewCatImg();
      } else {
        Utils.toast('فشل رفع صورة الفئة: ' + (r && r.error || 'خطأ غير معروف'), 'error');
      }
    } catch (e) {
      console.error('uploadCatImg error:', e);
      Utils.toast('حدث خطأ أثناء رفع صورة الفئة', 'error');
      el.value = oldVal;
    }
  },

  async saveCategory(id) {
    const data = {
      name: document.getElementById('f-cat-name').value.trim(),
      image: document.getElementById('f-cat-image').value.trim(),
      icon: document.getElementById('f-cat-icon').value.trim() || '📦',
      parent: document.getElementById('f-cat-parent').value || null
    };
    if (!data.name) return Utils.toast('اسم الفئة مطلوب', 'error');

    if (this._hasAdminDataLayer()) {
      try {
        var patch = this._denormCategory(data);
        var result;
        if (id) {
          var catUuid = this._legacyIdToUuid(id);
          result = await window.AdminDataLayer.categories.update(catUuid, patch);
        } else {
          result = await window.AdminDataLayer.categories.create(patch);
        }
        if (result && result.ok) {
          await this._loadCategories();
          if (this._pendingImageCleanup && this._pendingImageCleanup.length) {
            var urls = this._pendingImageCleanup.splice(0);
            for (var i = 0; i < urls.length; i++) { try { await window.SupabaseStorage.deleteFile(urls[i]); } catch (e) {} }
          }
          console.log('[Admin] Category saved to Supabase:', id ? 'updated' : 'created');
          Utils.toast(id ? 'تم تحديث الفئة' : 'تم إضافة الفئة');
          this.closeModal();
          this.viewCategories();
          return;
        }
        console.error('[Admin] Category save failed:', result && result.error);
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) {
        console.error('saveCategory error:', e);
        this._showError('حدث خطأ غير متوقع أثناء حفظ الفئة.');
      }
    } else {
      if (id) { Store.updateCategory(id, data); Utils.toast('تم تحديث الفئة'); }
      else { Store.addCategory(data); Utils.toast('تم إضافة الفئة'); }
      this.closeModal();
      this.viewCategories();
    }
  },

  async deleteCategory(id) {
    if (!confirm('هل أنت متأكد من حذف هذه الفئة نهائياً؟\nالمنتجات التابعة لهذه الفئة ستفقد فئتها (ستصبح بدون فئة).')) return;
    if (this._hasAdminDataLayer()) {
      try {
        var cat = (this._categoriesCache || []).find(x => x.id === id);
        var uuid = (cat && cat.uuid) || this._legacyIdToUuid(id);
        var catImageUrl = cat && cat.image;
        console.log('[Admin] Deleting category:', id, 'UUID:', uuid);
        // Actual DELETE from categories table
        var client = window.__supabase && window.__supabase.client;
        if (!client) { this._showError('Supabase client not available'); return; }
        var r = await client.from('categories').delete().eq('id', uuid);
        if (r && r.error) {
          console.error('[Admin] Category delete failed:', JSON.stringify(r.error));
          this._showError('فشل حذف الفئة: ' + (r.error.message || r.error.details || r.error.hint || 'خطأ غير معروف'));
          return;
        }
        if (catImageUrl && typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.extractStoragePath === 'function') {
          var imgPath = window.SupabaseStorage.extractStoragePath(catImageUrl);
          if (imgPath) { try { await window.SupabaseStorage.deleteFile(imgPath); } catch (e) {} }
        }
        console.log('[Admin] Category deleted from Supabase:', id);
        // Remove from local cache
        if (this._categoriesCache) {
          this._categoriesCache = this._categoriesCache.filter(function (x) { return x.id !== id; });
        }
        Utils.toast('تم حذف الفئة نهائياً');
        this.viewCategories();
        return;
      } catch (e) {
        console.error('[Admin] deleteCategory error:', e);
        this._showError('حدث خطأ غير متوقع أثناء حذف الفئة.');
      }
    } else {
      Store.deleteCategory(id);
      Utils.toast('تم حذف الفئة', 'warn');
      this.viewCategories();
    }
  },

  /* ===== ORDERS ===== */
  async viewOrders() {
    var orders = null;
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.orders.list();
        if (r && r.ok && Array.isArray(r.data)) {
          orders = this._normOrdersFromDB(r.data);
        } else {
          console.error('[Admin] viewOrders: Supabase failed:', r && r.error);
        }
      } catch (e) {
        console.error('[Admin] viewOrders: Supabase exception:', e);
      }
    }
    if (!orders) {
      orders = Store.getOrders();
      console.warn('[Admin] viewOrders: falling back to localStorage');
    }
    this._lastOrders = orders;
    this.refreshSidebarBadge({ totalOrders: orders.length });
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head">
        <div><h1>الطلبات</h1><p>إدارة طلبات العملاء (${orders.length} طلب)</p></div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(5,1fr)">
        <div class="stat-card"><div class="label">الكل</div><div class="value">${orders.length}</div></div>
        <div class="stat-card"><div class="label">جديد</div><div class="value" style="color:var(--info)">${orders.filter(o => o.status === 'ordered').length}</div></div>
        <div class="stat-card"><div class="label">قيد التحضير</div><div class="value" style="color:var(--warning)">${orders.filter(o => ['received', 'preparing'].includes(o.status)).length}</div></div>
        <div class="stat-card"><div class="label">بالطريق</div><div class="value" style="color:#8b5cf6">${orders.filter(o => o.status === 'out_for_delivery').length}</div></div>
        <div class="stat-card"><div class="label">مكتمل</div><div class="value" style="color:var(--success)">${orders.filter(o => o.status === 'delivered').length}</div></div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="filter-bar">
            <input type="text" id="ord-search" placeholder="بحث برقم الطلب، الاسم، الجوال..." oninput="Admin.filterOrders()">
            <select id="ord-status" onchange="Admin.filterOrders()">
              <option value="">جميع الحالات</option>
              <option value="ordered">جديد</option>
              <option value="preparing">قيد التحضير</option>
              <option value="out_for_delivery">بالطريق</option>
              <option value="delivered">تم التسليم</option>
              <option value="cancelled">ملغي</option>
            </select>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn btn-gold" onclick="Admin.migrateLocalOrdersToSupabase()" id="migrate-btn">${Utils.icon('refresh', 16)} نقل الطلبات القديمة إلى قاعدة البيانات</button>
          </div>
        </div>
        <div class="panel-body p0">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>رقم الطلب</th><th>التاريخ</th><th>العميل</th><th>المنتجات</th><th>الإجمالي</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
            <tbody id="orders-tbody">${orders.map(o => this.orderRow(o)).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  },

  orderRow(o) {
    var dbId = o.uuid || o.id;
    return `<tr>
      <td><strong>${o.id}</strong></td>
      <td>${Utils.formatDate(o.date)}</td>
      <td><strong>${Utils.escapeHtml(o.customer.name)}</strong><br><span style="font-size:11px;color:var(--text-3)">${Utils.escapeHtml(o.customer.phone)}</span></td>
      <td>${o.items.length} منتج</td>
      <td><strong>${Utils.formatPrice(o.total)}</strong></td>
      <td><span class="tag ${Utils.statusColor(o.status)}">${Utils.statusLabel(o.status)}</span></td>
      <td><div class="actions">
        <button onclick="Admin.viewOrder('${dbId}','${o.id}')" title="عرض">${Utils.icon('eye', 14)}</button>
        <button onclick="Admin.changeOrderStatus('${dbId}','${o.id}')" title="تغيير الحالة" class="success">${Utils.icon('edit', 14)}</button>
        <button onclick="window.open('index.html#order/${o.id}?admin=1','_blank')" title="فاتورة">${Utils.icon('invoice', 14)}</button>
        <button onclick="Admin.deleteOrder('${dbId}','${o.id}')" title="حذف" class="danger">${Utils.icon('trash', 14)}</button>
      </div></td>
    </tr>`;
  },

  filterOrders() {
    const q = document.getElementById('ord-search').value.toLowerCase();
    const st = document.getElementById('ord-status').value;
    let orders = this._lastOrders || Store.getOrders();
    if (q) orders = orders.filter(o => o.id.toLowerCase().includes(q) || o.customer.name.toLowerCase().includes(q) || o.customer.phone.includes(q));
    if (st) orders = orders.filter(o => o.status === st);
    document.getElementById('orders-tbody').innerHTML = orders.map(o => this.orderRow(o)).join('');
  },

  async viewOrder(dbId, displayId) {
    var id = dbId || displayId;
    var o = null;
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.orders.getById(id);
        if (r && r.ok && r.data && r.data.order) {
          o = this._normOrderFromDB(r.data.order, r.data.items);
        }
      } catch (e) { /* fall through */ }
    }
    if (!o) o = Store.getOrder(displayId || id);
    if (!o) return;
    this.openModal({
      title: 'تفاصيل الطلب ' + o.id,
      lg: true,
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
          <div><h4 style="font-size:13px;color:var(--text-2);margin-bottom:8px">معلومات العميل</h4>
            <p><strong>${Utils.escapeHtml(o.customer.name)}</strong></p>
            <p>${Utils.escapeHtml(o.customer.phone)}</p>
            <p>${Utils.escapeHtml(o.customer.city)} - ${Utils.escapeHtml(o.customer.address)}</p>
            ${o.notes ? `<p style="margin-top:6px;color:var(--warning)">📝 ${Utils.escapeHtml(o.notes)}</p>` : ''}
          </div>
          <div><h4 style="font-size:13px;color:var(--text-2);margin-bottom:8px">معلومات الطلب</h4>
            <p>التاريخ: ${Utils.formatDate(o.date)}</p>
            <p>الحالة: <span class="tag ${Utils.statusColor(o.status)}">${Utils.statusLabel(o.status)}</span></p>
            <p>الدفع: ${o.paymentMethod === 'cod' ? 'عند الاستلام' : o.paymentMethod}</p>
            ${o.coupon ? `<p>الكوبون: <span class="tag tag-gold">${Utils.escapeHtml(o.coupon)}</span></p>` : ''}
          </div>
        </div>
        <h4 style="font-size:13px;color:var(--text-2);margin-bottom:8px">المنتجات</h4>
        <table class="data" style="width:100%">
          <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
          <tbody>
            ${o.items.map(i => `<tr><td><div style="display:flex;gap:8px;align-items:center"><img src="${Utils.escapeUrl(i.image)}" class="thumb"><span>${Utils.escapeHtml(i.name)}${i.variant ? ` <small style="color:var(--text-3)">(${Utils.escapeHtml(i.variant)})</small>` : ''}</span></div></td><td>${i.qty}</td><td>${Utils.formatPrice(i.price)}</td><td><strong>${Utils.formatPrice(i.price * i.qty)}</strong></td></tr>`).join('')}
          </tbody>
        </table>
        <div style="margin-top:16px;background:var(--surface-2);padding:14px;border-radius:10px">
          <div class="flex-between mb-1"><span>المجموع</span><strong>${Utils.formatPrice(o.subtotal)}</strong></div>
          ${o.discount > 0 ? `<div class="flex-between mb-1" style="color:var(--success)"><span>الخصم</span><span>- ${Utils.formatPrice(o.discount)}</span></div>` : ''}
          <div class="flex-between mb-1"><span>رسوم التوصيل</span><span>${Utils.formatPrice(o.shipping)}</span></div>
          <div class="flex-between" style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px"><strong>الإجمالي</strong><strong style="color:var(--primary-dark);font-size:18px">${Utils.formatPrice(o.total)}</strong></div>
        </div>
      `,
      foot: `<button class="btn btn-outline" onclick="Admin.closeModal()">إغلاق</button>
             <button class="btn btn-primary" onclick="Admin.printInvoice('${o.id}')">${Utils.icon('invoice', 16)} طباعة الفاتورة</button>
             <button class="btn btn-gold" onclick="Admin.changeOrderStatus('${o.uuid}','${o.id}')">${Utils.icon('edit', 16)} تغيير الحالة</button>`
    });
  },

  printInvoice(id) {
    // Open the same printable invoice used by the storefront and auto-trigger the print dialog.
    const s = Store.getSettings();
    if (s.invoice?.thermal?.enabled) {
      this.printThermalInvoice([id]);
    } else {
      this.buildAndPrintInvoice([id], false);
    }
  },

  async buildAndPrintInvoice(orderIds, autoOpen) {
    const s = Store.getSettings();
    var orders = [];
    for (var i = 0; i < orderIds.length; i++) {
      var o = null;
      if (this._hasAdminReadLayer()) {
        try {
          var r = await window.AdminReadLayer.orders.getById(orderIds[i]);
          if (r && r.ok && r.data && r.data.order) {
            o = this._normOrderFromDB(r.data.order, r.data.items);
          }
        } catch (e) { /* fall through */ }
      }
      if (!o) o = Store.getOrder(orderIds[i]);
      if (o) orders.push(o);
    }
    if (!orders.length) { Utils.toast('لا توجد فواتير للطباعة', 'warn'); return; }
    const inv = s.invoice?.normal || {};
    const colors = inv.colors || {};
    const html = this.buildNormalInvoicesHTML(orders, s, inv, colors);
    const win = window.open('', '_blank');
    if (!win) { Utils.toast('يرجى السماح بالنوافذ المنبثقة', 'error'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 500);
  },

  async printInvoiceSingle() {
    const s = Store.getSettings();
    var orders = this._lastOrders || Store.getOrders();
    if (this._hasAdminReadLayer() && (!this._lastOrders || this._lastOrders.length === 0)) {
      try {
        var r = await window.AdminReadLayer.orders.list();
        if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
          orders = this._normOrdersFromDB(r.data);
        }
      } catch (e) { /* fall through to Store */ }
    }
    const recent = orders[0];
    if (!recent) { Utils.toast('لا توجد فواتير', 'warn'); return; }
    if (s.invoice?.thermal?.enabled) {
      this.printThermalInvoice([recent.id]);
    } else {
      this.buildAndPrintInvoice([recent.id], false);
    }
  },

  async printInvoicesToday() {
    const today = new Date().toISOString().slice(0, 10);
    var orders = this._lastOrders || Store.getOrders();
    if (this._hasAdminReadLayer() && (!this._lastOrders || this._lastOrders.length === 0)) {
      try {
        var r = await window.AdminReadLayer.orders.list();
        if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
          orders = this._normOrdersFromDB(r.data);
        }
      } catch (e) { /* fall through to Store */ }
    }
    const todayOrders = orders.filter(o => o.date === today);
    if (!todayOrders.length) { Utils.toast('لا توجد فواتير لليوم', 'warn'); return; }
    const s = Store.getSettings();
    if (s.invoice?.thermal?.enabled) {
      this.printThermalInvoice(todayOrders.map(o => o.id));
    } else {
      this.buildAndPrintInvoice(todayOrders.map(o => o.id), false);
    }
  },

  printInvoicesSelected() {
    const sels = Array.from(document.querySelectorAll('.inv-select:checked')).map(c => c.value);
    if (!sels.length) { Utils.toast('الرجاء تحديد فاتورة واحدة على الأقل من قائمة الطلبات', 'warn'); return; }
    const s = Store.getSettings();
    if (s.invoice?.thermal?.enabled) {
      this.printThermalInvoice(sels);
    } else {
      this.buildAndPrintInvoice(sels, false);
    }
  },

  async printThermalInvoice(orderIds) {
    const s = Store.getSettings();
    var orders = [];
    for (var i = 0; i < orderIds.length; i++) {
      var o = null;
      if (this._hasAdminReadLayer()) {
        try {
          var r = await window.AdminReadLayer.orders.getById(orderIds[i]);
          if (r && r.ok && r.data && r.data.order) {
            o = this._normOrderFromDB(r.data.order, r.data.items);
          }
        } catch (e) { /* fall through */ }
      }
      if (!o) o = Store.getOrder(orderIds[i]);
      if (o) orders.push(o);
    }
    if (!orders.length) return;
    const inv = s.invoice?.thermal || {};
    const paperSize = inv.paperSize || '80mm';
    const html = this.buildThermalInvoicesHTML(orders, s, inv, paperSize);
    const win = window.open('', '_blank');
    if (!win) { Utils.toast('يرجى السماح بالنوافذ المنبثقة', 'error'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 500);
  },

  buildNormalInvoicesHTML(orders, s, inv, colors) {
    const cText = colors.text || '#1a1a1a';
    const cHead = colors.heading || '#0d9488';
    const cBorder = colors.border || '#e8e3d8';
    const cTotal = colors.total || '#6b4423';
    const primary = s.primaryColor || '#14b8a6';
    const brown = '#6b4423';
    const logoHtml = s.logo ? `<img src="${Utils.escapeUrl(s.logo)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : this.esc((s.storeName || 'A').charAt(0));
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const invoicesHTML = orders.map((o, idx) => `
      <div class="invoice-page" style="${idx > 0 ? 'page-break-before:always;' : ''}">
        <div class="invoice">
          ${inv.headerText ? `<div class="inv-header-text">${esc(inv.headerText).replace(/\n/g, '<br>')}</div>` : ''}
          <div class="inv-head" style="border-bottom:3px solid ${cHead}">
            <div class="brand-box">
              <div class="brand-logo" style="background:linear-gradient(135deg, ${primary}, ${brown})">${logoHtml}</div>
              <div>
                <div class="brand-name" style="color:${cHead}">${esc(s.storeName)}</div>
                <div class="brand-tag">${esc(s.storeNameEn || '')} ${s.tagline ? ' • ' + esc(s.tagline) : ''}</div>
              </div>
            </div>
            <div class="inv-title">
              <h1 style="color:${cText}">فاتورة</h1>
              <p>رقم: <strong>${esc(o.id)}</strong></p>
              <p>التاريخ: ${esc(Utils.formatDate(o.date))}</p>
            </div>
          </div>
          <div class="inv-info" style="color:${cText}">
            <div class="inv-info-box" style="background:${cHead}11;border:1px solid ${cBorder}">
              <h4 style="color:${cHead}">بيانات المتجر</h4>
              <p><strong>${esc(s.storeName)}</strong></p>
              <p>${esc(s.address || '')}</p>
              <p>${esc(s.contactPhone || '')}</p>
              <p>${esc(s.contactEmail || '')}</p>
            </div>
            <div class="inv-info-box" style="background:${cHead}11;border:1px solid ${cBorder}">
              <h4 style="color:${cHead}">فاتورة إلى</h4>
              <p><strong>${esc(o.customer.name)}</strong></p>
              <p>${esc(o.customer.phone)}</p>
              <p>${esc(o.customer.city)}</p>
              <p>${esc(o.customer.address)}</p>
            </div>
          </div>
          <table style="color:${cText};border-color:${cBorder}">
            <thead><tr style="background:${cHead};color:#fff"><th>المنتج</th><th>الخيار</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th></tr></thead>
            <tbody>
              ${o.items.map(i => `<tr style="border-color:${cBorder}">
                <td><div class="img-cell"><img src="${Utils.escapeUrl(i.image)}"><div><div style="font-weight:600">${esc(i.name)}</div></div></div></td>
                <td>${esc((i.options && i.options.length ? i.options.map(op => `${op.type === 'color' ? 'اللون' : op.type === 'size' ? 'القياس' : op.type === 'dimension' ? 'الحجم' : op.type === 'weight' ? 'الوزن' : op.type}: ${op.value}`).join(' / ') : (i.variant || '—')))}</td>
                <td>${i.qty}</td>
                <td>${esc(Utils.formatPrice(i.price))}</td>
                <td><strong>${esc(Utils.formatPrice(i.price * i.qty))}</strong></td>
              </tr>`).join('')}
            </tbody>
          </table>
          <div class="totals" style="background:${cHead}11;border:1px solid ${cBorder};color:${cText}">
            <div><span>المجموع الفرعي</span><span>${esc(Utils.formatPrice(o.subtotal))}</span></div>
            ${o.discount > 0 ? `<div style="color:#16a34a"><span>الخصم${o.coupon ? ' (' + esc(o.coupon) + ')' : ''}</span><span>- ${esc(Utils.formatPrice(o.discount))}</span></div>` : ''}
            <div><span>رسوم التوصيل</span><span>${esc(Utils.formatPrice(o.shipping))}</span></div>
            <div class="total-final" style="background:${cTotal};color:#fff"><span>الإجمالي</span><span>${esc(Utils.formatPrice(o.total))}</span></div>
          </div>
          ${inv.extraText ? `<div class="inv-extra" style="margin-top:14px;color:${cText}">${esc(inv.extraText).replace(/\n/g, '<br>')}</div>` : ''}
          <div class="footer-inv" style="border-top:2px solid ${cBorder};color:${cText}">
            <p>${esc(inv.footerText || 'شكراً لتسوقكم من ' + (s.storeName || ''))}</p>
          </div>
        </div>
      </div>
    `).join('');
    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>طباعة فواتير</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Tajawal', 'Cairo', Arial, sans-serif; color: ${cText}; background: #fff; direction: rtl; }
.invoice { max-width: 800px; margin: 0 auto; padding: 24px; }
.inv-header-text { padding: 8px 0 16px; text-align: center; font-weight: 600; }
.inv-head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; margin-bottom: 16px; gap: 16px; }
.brand-box { display: flex; align-items: center; gap: 14px; }
.brand-logo { width: 64px; height: 64px; border-radius: 12px; color: #fff; display: grid; place-items: center; font-size: 26px; font-weight: 900; overflow: hidden; }
.brand-name { font-size: 20px; font-weight: 800; }
.brand-tag { font-size: 12px; color: #6b6b6b; }
.inv-title { text-align: left; }
.inv-title h1 { font-size: 26px; }
.inv-title p { font-size: 12px; color: #6b6b6b; margin-top: 2px; }
.inv-info { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
.inv-info-box { border-radius: 10px; padding: 14px; }
.inv-info-box h4 { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
.inv-info-box p { font-size: 13px; margin: 2px 0; }
table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
th { padding: 10px 8px; text-align: right; font-size: 12px; font-weight: 600; }
td { padding: 10px 8px; border-bottom: 1px solid ${cBorder}; font-size: 13px; }
tr:last-child td { border-bottom: 0; }
.img-cell { display: flex; gap: 8px; align-items: center; }
.img-cell img { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; }
.totals { width: 320px; margin-right: auto; border-radius: 10px; padding: 12px; }
.totals div { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.totals .total-final { padding: 12px; border-radius: 8px; font-size: 16px; font-weight: 800; margin-top: 6px; }
.footer-inv { margin-top: 24px; padding-top: 14px; text-align: center; font-size: 12px; }
@media print { .invoice-page { page-break-after: always; } .invoice-page:last-child { page-break-after: auto; } }
</style></head><body>${invoicesHTML}</body></html>`;
  },

  buildThermalInvoicesHTML(orders, s, inv, paperSize) {
    const colors = inv.colors || {};
    const cText = colors.text || '#000';
    const cHead = colors.heading || '#000';
    const cBorder = colors.border || '#000';
    const cTotal = colors.total || '#000';
    const widthPx = paperSize === '58mm' ? '220px' : '300px';
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let qrSvg = '';
    if (inv.qrUrl && inv.qrUrl.trim()) {
      try { qrSvg = QRCode_generateSVG(inv.qrUrl.trim(), { cellSize: 3, margin: 1 }); } catch (e) { qrSvg = ''; }
    }
    const thermalCSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Courier New', monospace; color: ${cText}; background: #fff; }
.receipt { width: ${widthPx}; max-width: 100%; margin: 0 auto; padding: 8px; font-size: 12px; line-height: 1.4; }
.r-store { text-align: center; font-weight: 700; font-size: 14px; margin-bottom: 2px; }
.r-phone { text-align: center; font-size: 11px; margin-bottom: 6px; }
.r-header { text-align: center; font-size: 11px; margin-bottom: 6px; }
.r-divider { border-top: 1px dashed ${cBorder}; margin: 6px 0; }
.r-row { display: flex; justify-content: space-between; }
.r-item { margin-bottom: 4px; }
.r-item-name { font-weight: 600; }
.r-item-opts { font-size: 10px; color: #555; }
.r-section { margin: 4px 0; }
.r-label { font-weight: 600; }
.r-total { font-weight: 700; font-size: 14px; color: ${cTotal}; }
.r-footer { text-align: center; font-size: 10px; margin-top: 6px; }
.r-extra { font-size: 10px; margin-top: 4px; }
.r-qr { text-align: center; margin: 8px 0; }
@media print {
  @page { size: ${paperSize} auto; margin: 0; }
  body { margin: 0; }
  .receipt { padding: 4px; }
  .receipt + .receipt { page-break-before: always; }
}
`;
    const itemsHTML = (o) => o.items.map(i => {
      const opts = (i.options && i.options.length) ? '<div class="r-item-opts">' + esc(i.options.map(op => `${op.type}: ${op.value}`).join(', ')) + '</div>' : '';
      return `<div class="r-item"><div class="r-item-name">${esc(i.name)}</div>${opts}<div class="r-row"><span>×${i.qty}</span><span>${esc(Utils.formatPrice(i.price * i.qty))}</span></div></div>`;
    }).join('');
    const receipts = orders.map(o => `
      <div class="receipt">
        ${inv.headerText ? `<div class="r-header">${esc(inv.headerText).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="r-store">${esc(s.storeName)}</div>
        ${s.contactPhone ? `<div class="r-phone">${esc(s.contactPhone)}</div>` : ''}
        <div class="r-divider"></div>
        <div class="r-row"><span>${esc(o.id)}</span><span>${esc(Utils.formatDate(o.date))}</span></div>
        <div class="r-divider"></div>
        <div class="r-section"><div class="r-label">العميل: ${esc(o.customer.name)}</div><div>${esc(o.customer.phone)}</div><div>${esc(o.customer.city)}${o.customer.address ? ' - ' + esc(o.customer.address) : ''}</div></div>
        <div class="r-divider"></div>
        <div class="r-label">المنتجات:</div>
        ${itemsHTML(o)}
        <div class="r-divider"></div>
        <div class="r-row"><span>المجموع الفرعي</span><span>${esc(Utils.formatPrice(o.subtotal))}</span></div>
        ${o.discount > 0 ? `<div class="r-row"><span>الخصم</span><span>-${esc(Utils.formatPrice(o.discount))}</span></div>` : ''}
        <div class="r-row"><span>رسوم التوصيل</span><span>${esc(Utils.formatPrice(o.shipping))}</span></div>
        <div class="r-row r-total"><span>الإجمالي</span><span>${esc(Utils.formatPrice(o.total))}</span></div>
        <div class="r-divider"></div>
        ${qrSvg ? `<div class="r-qr">${qrSvg}</div>` : ''}
        ${inv.extraText ? `<div class="r-extra">${esc(inv.extraText).replace(/\n/g, '<br>')}</div>` : ''}
        <div class="r-footer">${esc(inv.footerText || 'شكراً لزيارتكم')}</div>
      </div>
    `).join('');
    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة حرارية</title><style>${thermalCSS}</style></head><body>${receipts}</body></html>`;
  },

  async changeOrderStatus(dbId, displayId) {
    var inputId = dbId || displayId;
    var o = null;
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.orders.getById(inputId);
        if (r && r.ok && r.data && r.data.order) {
          o = this._normOrderFromDB(r.data.order, r.data.items);
        }
      } catch (e) { /* fall through */ }
    }
    if (!o) o = Store.getOrder(displayId);
    if (!o) return;

    var uuid = o.uuid || null;
    if (!uuid && this._hasAdminReadLayer()) {
      try {
        var lr = await window.AdminReadLayer.orders.getById(displayId || inputId);
        if (lr && lr.ok && lr.data && lr.data.order) uuid = lr.data.order.id;
      } catch (e) { /* fall through */ }
    }
    if (!uuid) {
      this._showError('لم يتم العثور على الطلب في قاعدة البيانات.');
      return;
    }

    const statuses = [
      { v: 'ordered', l: 'تم الطلب' },
      { v: 'preparing', l: 'قيد التجهيز' },
      { v: 'out_for_delivery', l: 'بالطريق للتوصيل' },
      { v: 'delivered', l: 'تم التسليم' },
      { v: 'cancelled', l: 'ملغي' }
    ];
    this.openModal({
      title: 'تغيير حالة الطلب ' + (displayId || inputId),
      body: `<div class="form-group"><label class="form-label">الحالة الجديدة</label><select class="form-control" id="new-status">${statuses.map(s => `<option value="${s.v}" ${o.status === s.v ? 'selected' : ''}>${s.l}</option>`).join('')}</select></div>`,
      foot: `<button class="btn btn-outline" onclick="Admin.closeModal()">إلغاء</button><button class="btn btn-primary" onclick="Admin.saveOrderStatus('${uuid}')">حفظ</button>`
    });
  },

  async saveOrderStatus(id) {
    const newStatus = document.getElementById('new-status').value;
    if (this._hasAdminDataLayer()) {
      try {
        var r = await window.AdminDataLayer.orders.updateStatus(id, newStatus);
        if (r && r.ok) {
          if (!r.data) {
            console.error('[Status] updateStatus ok=true but data=null. id:', id);
            this._showError('لم يتم العثور على الطلب أو لم يتم تغيير الحالة.');
            return;
          }
          var verifyClient = window.__supabase && window.__supabase.client;
          if (verifyClient) {
            var verify = await verifyClient.from('orders').select('id, order_number, status').eq('id', id).maybeSingle();
            if (verify && verify.data && verify.data.status === newStatus) {
              console.log('[Status] Verified: ' + verify.data.order_number + ' → ' + verify.data.status);
            } else {
              console.error('[Status] Verification FAILED. DB status:', verify && verify.data && verify.data.status, 'expected:', newStatus);
              this._showError('تم الحفظ لكن التحقق فشل. الحالة في قاعدة البيانات: ' + (verify && verify.data ? verify.data.status : 'unknown'));
              this.closeModal();
              this.viewOrders();
              return;
            }
          }
          if (newStatus === 'cancelled') await this._logInventoryOnCancel(id);
          Utils.toast('تم تحديث الحالة');
          this.closeModal();
          this.viewOrders();
          return;
        }
        console.error('[Status] Update FAILED:', JSON.stringify(r));
        this._showError(this._mapAuthError(r && r.error));
        return;
      } catch (e) { console.error('[Status] saveOrderStatus exception:', e); this._showError('حدث خطأ غير متوقع.'); return; }
    }
    if (newStatus === 'cancelled') await this._logInventoryOnCancel(id);
    Utils.toast('تم تحديث الحالة');
    this.closeModal();
    this.viewOrders();
  },

  async _logInventoryOnCancel(orderId) {
    if (!this._hasAdminDataLayer()) return;
    try {
      var r = await window.AdminReadLayer.orders.getById(orderId);
      if (!r || !r.ok || !r.data) return;
      var items = r.data.items || [];
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        await window.AdminDataLayer.inventory.create({
          product_id: it.product_id || null,
          variant_id: it.variant_id || null,
          delta: Number(it.qty) || 1,
          reason: 'restock',
          reference_id: orderId,
          note: 'إعادة مخزون بسبب إلغاء الطلب'
        });
      }
    } catch (e) { /* best effort */ }
  },

  async deleteOrder(dbId, displayId) {
    var id = dbId || displayId;
    if (confirm('حذف هذا الطلب نهائياً')) {
      if (this._hasAdminDataLayer()) {
        try {
          var r = await window.AdminDataLayer.orders.delete(id);
          if (r && r.ok) {
            console.log('[Admin] Order', id, 'deleted from Supabase');
            Store.deleteOrder(displayId || id);
            Utils.toast('تم حذف الطلب', 'warn');
            this.viewOrders();
            this.refreshNotificationBell();
            this.refreshSidebarBadge();
            return;
          }
          this._showError(this._mapAuthError(r && r.error));
          return;
        } catch (e) { this._showError('حدث خطأ غير متوقع.'); return; }
      }
      Store.deleteOrder(displayId || id);
      Utils.toast('تم حذف الطلب', 'warn');
      this.viewOrders();
      this.refreshNotificationBell();
      this.refreshSidebarBadge();
    }
  },

  /* ===== CUSTOMERS ===== */
  async viewCustomers() {
    var orders = Store.getOrders();
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.orders.list();
        if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
          orders = this._normOrdersFromDB(r.data);
        }
      } catch (e) { /* fall through to Store */ }
    }
    const customers = {};
    orders.forEach(o => {
      const k = o.customer.phone;
      if (!customers[k]) customers[k] = { ...o.customer, orders: [], totalSpent: 0 };
      customers[k].orders.push(o);
      customers[k].totalSpent += o.total;
    });
    const list = Object.values(customers).sort((a, b) => b.totalSpent - a.totalSpent);
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>العملاء</h1><p>قائمة جميع عملاء المتجر (${list.length} عميل)</p></div></div>
      <div class="panel">
        <div class="panel-body p0">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>العميل</th><th>الجوال</th><th>المدينة</th><th>الطلبات</th><th>إجمالي الإنفاق</th><th>آخر طلب</th></tr></thead>
            <tbody>
              ${list.map(c => `<tr>
                <td><div style="display:flex;gap:10px;align-items:center"><div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:#fff;display:grid;place-items:center;font-weight:700">${Utils.escapeHtml(c.name.charAt(0))}</div><strong>${Utils.escapeHtml(c.name)}</strong></div></td>
                <td>${Utils.escapeHtml(c.phone)}</td>
                <td>${Utils.escapeHtml(c.city)}</td>
                <td>${c.orders.length}</td>
                <td><strong>${Utils.formatPrice(c.totalSpent)}</strong></td>
                <td>${Utils.formatDate(c.orders[0].date)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        </div>
      </div>
    `;
  },

  /* ===== COUPONS ===== */
  async viewCoupons() {
    var coupons = Store.getCoupons();
    if (this._hasAdminReadLayer()) {
      try {
        var cr = await window.AdminReadLayer.coupons.list();
        if (cr && cr.ok && Array.isArray(cr.data) && cr.data.length > 0) {
          coupons = cr.data.map(this._normCouponFromDB);
        }
      } catch (e) { /* fall through to Store */ }
    }
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head">
        <div><h1>الكوبونات والخصومات</h1><p>إنشاء وإدارة أكواد الخصم</p></div>
        <button class="btn btn-primary" onclick="Admin.couponForm()">${Utils.icon('plus', 16)} إضافة كوبون</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${coupons.map(c => `
          <div class="panel" style="position:relative;overflow:hidden">
            <div style="position:absolute;top:0;right:0;width:100px;height:100px;background:${c.active ? 'var(--success)' : 'var(--text-3)'};opacity:.1;border-radius:50%;transform:translate(50%,-50%)"></div>
            <div class="panel-body">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div>
                  <div style="background:var(--accent);color:#fff;padding:8px 14px;border-radius:8px;font-weight:800;letter-spacing:.05em;display:inline-block;font-family:monospace">${Utils.escapeHtml(c.code)}</div>
                  <div style="font-size:24px;font-weight:800;margin-top:12px;color:var(--primary-dark)">${c.type === 'percent' ? c.value + '%' : Utils.formatPrice(c.value)} <span style="font-size:13px;font-weight:500;color:var(--text-2)">خصم</span></div>
                </div>
                <span class="tag ${c.active ? 'tag-green' : 'tag-gray'}">${c.active ? 'مفعل' : 'معطل'}</span>
              </div>
              <div style="margin-top:14px;display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--text-2)">
                <div>📅 ينتهي: ${Utils.formatDate(c.expiresAt)}</div>
                <div>🔢 استخدام: ${c.used} / ${c.maxUses}</div>
                <div>🛒 الحد الأدنى: ${Utils.formatPrice(c.minOrder)}</div>
              </div>
              <div class="flex gap-2 mt-2" style="margin-top:14px">
                <button class="btn btn-outline btn-sm" onclick="Admin.couponForm('${c.id}')">${Utils.icon('edit', 12)} تعديل</button>
                <button class="btn btn-outline btn-sm" onclick="Admin.toggleCoupon('${c.id}')">${c.active ? 'تعطيل' : 'تفعيل'}</button>
                <button class="btn btn-outline btn-sm" onclick="Admin.deleteCoupon('${c.id}')" style="color:var(--danger)">${Utils.icon('trash', 12)}</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  async couponForm(id = null) {
    var c = id ? null : { code: '', type: 'percent', value: 10, minOrder: 0, maxUses: 100, used: 0, expiresAt: '2026-12-31', active: true };
    if (id && this._hasAdminReadLayer()) {
      try {
        var cr2 = await window.AdminReadLayer.coupons.list();
        if (cr2 && cr2.ok && Array.isArray(cr2.data)) {
          var found = cr2.data.find(x => x.id === id);
          if (found) c = this._normCouponFromDB(found);
        }
      } catch (e) { /* fall through */ }
    }
    if (!c) c = id ? (Store.getCoupons().find(x => x.id === id) || { code: '', type: 'percent', value: 10, minOrder: 0, maxUses: 100, used: 0, expiresAt: '2026-12-31', active: true }) : c;
    this.openModal({
      title: id ? 'تعديل الكوبون' : 'إنشاء كوبون جديد',
      body: `
        <div class="form-row">
          <div class="form-group"><label class="form-label">كود الكوبون <span class="req">*</span></label><input class="form-control" id="c-code" value="${Utils.escapeHtml(c.code)}" style="text-transform:uppercase"></div>
          <div class="form-group"><label class="form-label">النوع</label><select class="form-control" id="c-type"><option value="percent" ${c.type === 'percent' ? 'selected' : ''}>نسبة مئوية %</option><option value="fixed" ${c.type === 'fixed' ? 'selected' : ''}>مبلغ ثابت</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">قيمة الخصم</label><input class="form-control" type="number" step="0.01" min="0" id="c-value" value="${c.value}"></div>
          <div class="form-group"><label class="form-label">الحد الأدنى للطلب</label><input class="form-control" type="number" id="c-min" value="${c.minOrder}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">الحد الأقصى للاستخدام</label><input class="form-control" type="number" id="c-max" value="${c.maxUses}"></div>
          <div class="form-group"><label class="form-label">تاريخ الانتهاء</label><input class="form-control" type="date" id="c-exp" value="${c.expiresAt}"></div>
        </div>
        <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="c-active" ${c.active ? 'checked' : ''}> <span>مفعل</span></label></div>
      `,
      foot: `<button class="btn btn-outline" onclick="Admin.closeModal()">إلغاء</button><button class="btn btn-primary" onclick="Admin.saveCoupon('${id || ''}')">حفظ</button>`
    });
  },

  async saveCoupon(id) {
    const data = {
      code: document.getElementById('c-code').value.trim().toUpperCase(),
      type: document.getElementById('c-type').value,
      value: +document.getElementById('c-value').value,
      minOrder: +document.getElementById('c-min').value || 0,
      maxUses: +document.getElementById('c-max').value || 100,
      expiresAt: document.getElementById('c-exp').value,
      active: document.getElementById('c-active').checked
    };
    if (!data.code) return Utils.toast('كود الكوبون مطلوب', 'error');
    if (this._hasAdminDataLayer()) {
      try {
        var dbData = this._denormCoupon(data);
        if (id) {
          var r = await window.AdminDataLayer.coupons.update(id, dbData);
          if (r && r.ok) { console.log('[Admin] Coupon updated in Supabase:', id); Utils.toast('تم تحديث الكوبون'); this.closeModal(); this.viewCoupons(); return; }
          console.error('[Admin] Coupon update failed:', r && r.error);
          this._showError(this._mapAuthError(r && r.error));
          return;
        } else {
          delete dbData.used;
          var r2 = await window.AdminDataLayer.coupons.create(dbData);
          if (r2 && r2.ok) { console.log('[Admin] Coupon created in Supabase:', dbData.code); Utils.toast('تم إنشاء الكوبون'); this.closeModal(); this.viewCoupons(); return; }
          console.error('[Admin] Coupon create failed:', r2 && r2.error);
          this._showError(this._mapAuthError(r2 && r2.error));
          return;
        }
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); return; }
    }
    if (id) { Store.updateCoupon(id, data); Utils.toast('تم تحديث الكوبون'); }
    else { Store.addCoupon(data); Utils.toast('تم إنشاء الكوبون'); }
    this.closeModal();
    this.viewCoupons();
  },

  async toggleCoupon(id) {
    var c = null;
    if (this._hasAdminReadLayer()) {
      try {
        var rList = await window.AdminReadLayer.coupons.list();
        if (rList && rList.ok && Array.isArray(rList.data)) {
          c = rList.data.find(x => x.id === id);
        }
      } catch (e) {}
    }
    if (!c) {
      try { c = Store.getCoupons().find(x => x.id === id); } catch (e) {}
    }
    if (this._hasAdminDataLayer()) {
      try {
        var newActive = !(c && c.active !== false);
        var r = await window.AdminDataLayer.coupons.update(id, { active: newActive });
        if (r && r.ok) { console.log('[Admin] Coupon', id, 'toggled to', newActive ? 'active' : 'inactive'); this.viewCoupons(); return; }
        console.error('[Admin] Coupon toggle failed:', r && r.error);
        this._showError(this._mapAuthError(r && r.error));
        return;
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); return; }
    }
    if (c) { Store.updateCoupon(id, { active: !c.active }); this.viewCoupons(); }
  },
  async deleteCoupon(id) {
    if (!confirm('حذف هذا الكوبون؟')) return;
    if (this._hasAdminDataLayer()) {
      try {
        var r = await window.AdminDataLayer.coupons.delete(id);
        if (r && r.ok) { console.log('[Admin] Coupon', id, 'deleted from Supabase'); Utils.toast('تم الحذف', 'warn'); this.viewCoupons(); return; }
        console.error('[Admin] Coupon delete failed:', r && r.error);
        this._showError(this._mapAuthError(r && r.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    }
    Store.deleteCoupon(id);
    Utils.toast('تم الحذف', 'warn');
    this.viewCoupons();
  },

  /* ===== OFFERS & DISCOUNTS ===== */

  async migrateLegacyOffersToSupabase() {
    var client = null;
    try { var sv = window.__supabase; if (sv && sv.client) client = sv.client; } catch (e) {}
    if (!client) return { migrated: 0, skipped: 0, errors: [] };
    var oldOffers = Store.getOffers();
    if (!oldOffers.length) return { migrated: 0, skipped: 0, errors: [] };
    var alreadyMigrated = [];
    try { alreadyMigrated = JSON.parse(localStorage.getItem('_migratedOfferIds') || '[]'); } catch (e) {}
    var doneSet = {};
    alreadyMigrated.forEach(function (id) { doneSet[id] = true; });
    var r = await client.from('offers').select('id, legacy_id');
    if (r.error || !Array.isArray(r.data)) {
      console.error('[Migration] Failed to read Supabase offers:', r.error);
      return { migrated: 0, skipped: 0, errors: [r.error] };
    }
    var existingLegacyIds = {};
    var existingSupabaseIds = {};
    r.data.forEach(function (o) { if (o.legacy_id) existingLegacyIds[o.legacy_id] = true; if (o.id) existingSupabaseIds[o.id] = true; });
    var merged = {};
    r.data.forEach(function (o) { if (o.legacy_id) merged[o.legacy_id] = true; });
    alreadyMigrated.forEach(function (id) { merged[id] = true; });
    try { localStorage.setItem('_migratedOfferIds', JSON.stringify(Object.keys(merged))); } catch (e) {}
    var toMigrate = oldOffers.filter(function (o) { return o.id && !existingLegacyIds[o.id] && !doneSet[o.id] && !existingSupabaseIds[o.id]; });
    if (!toMigrate.length) return { migrated: 0, skipped: 0, errors: [] };
    var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var migrated = 0, skipped = 0, errors = [];
    for (var i = 0; i < toMigrate.length; i++) {
      var o = toMigrate[i];
      var targetId = o.targetId;
      if (!targetId || !uuidRe.test(targetId)) {
        try {
          var prodR = await client.from('products').select('id').eq('legacy_id', targetId).limit(1);
          if (prodR && prodR.data && prodR.data.length > 0) {
            targetId = prodR.data[0].id;
          } else {
            skipped++;
            console.warn('[Migration] Offer', o.id, 'skipped: target_id', o.targetId, 'not found in products');
            continue;
          }
        } catch (e) {
          skipped++;
          console.warn('[Migration] Offer', o.id, 'skipped: product lookup failed', e);
          continue;
        }
      }
      var payload = {
        legacy_id: o.id,
        target_type: o.targetType || 'product',
        target_id: targetId,
        discount_type: o.discountType || 'percent',
        discount_value: Number(o.discountValue) || 0,
        starts_at: o.startAt || null,
        ends_at: o.endAt || null,
        active: o.active !== false
      };
      try {
        var insR = await client.from('offers').upsert(payload, { onConflict: 'legacy_id' }).select();
        if (insR && insR.error) {
          errors.push({ offer: o.id, error: insR.error });
          console.error('[Migration] Failed to migrate offer', o.id, ':', insR.error.message || insR.error);
          continue;
        }
        if (!insR || !insR.data || !insR.data.length) {
          errors.push({ offer: o.id, error: 'No row returned' });
          console.error('[Migration] No row returned after upsert:', payload);
          continue;
        }
        migrated++;
        alreadyMigrated.push(o.id);
        try { localStorage.setItem('_migratedOfferIds', JSON.stringify(alreadyMigrated)); } catch (e) {}
        console.log('[Migration] Confirmed:', payload.legacy_id, '→', insR.data[0].id);
      } catch (e) {
        errors.push({ offer: o.id, error: e });
        console.error('[Migration] Exception migrating offer', o.id, ':', e);
      }
    }
    console.log('[Migration] Offers: migrated=' + migrated + ' skipped=' + skipped + ' errors=' + errors.length);
    return { migrated: migrated, skipped: skipped, errors: errors };
  },

  async viewOffers() {
    var offers = [];
    var supabaseOk = false;
    if (this._hasAdminReadLayer()) {
      try {
        await this.migrateLegacyOffersToSupabase();
        var r = await window.AdminReadLayer.offers.list();
        if (r && r.ok && Array.isArray(r.data)) {
          offers = r.data.map(this._normOfferFromDB);
          supabaseOk = true;
        }
      } catch (e) { console.error('[Admin] viewOffers error:', e); }
    }
    if (!offers.length && !supabaseOk) {
      offers = Store.getOffers();
    }
    const cats = this._categoriesCache || await this._loadCategories();
    const products = this._productsCache || await this._loadProducts();
    const now = Date.now();
    const groups = { active: [], scheduled: [], expired: [], disabled: [] };
    offers.forEach(o => { groups[Store._offerStateAt(o, now)] = groups[Store._offerStateAt(o, now)] || []; groups[Store._offerStateAt(o, now)].push(o); });
    const renderCard = (o) => {
      const target = o.targetType === 'product' ? (products.find(p => p.id === o.targetId) || {}).name : (cats.find(c => c.id === o.targetId) || {}).name || '—';
      const disc = o.discountType === 'percent' ? (o.discountValue + '٪') : (Utils.formatPrice(o.discountValue));
      return `<div class="panel" style="margin-bottom:12px">
        <div class="panel-body">
          <div class="flex-between" style="flex-wrap:wrap;gap:10px">
            <div>
              <div style="font-weight:700">خصم ${disc}</div>
              <div style="font-size:12px;color:var(--text-2);margin-top:4px">الهدف: ${o.targetType === 'product' ? 'منتج' : 'فئة'} — ${Utils.escapeHtml(target)}</div>
              <div style="font-size:12px;color:var(--text-2);margin-top:2px">من: ${Utils.formatDate(o.startAt)} ${(o.startTime || '')} — إلى: ${Utils.formatDate(o.endAt)} ${(o.endTime || '')}</div>
            </div>
            <div class="actions">
              <button class="btn btn-outline btn-sm" onclick="Admin.offerForm('${o.id}')">${Utils.icon('edit', 12)} تعديل</button>
              <button class="btn btn-outline btn-sm" onclick="Admin.toggleOffer('${o.id}')">${o.active === false ? 'تفعيل' : 'تعطيل'}</button>
              <button class="btn btn-outline btn-sm" onclick="Admin.deleteOffer('${o.id}')" style="color:var(--danger)">${Utils.icon('trash', 12)}</button>
            </div>
          </div>
        </div>
      </div>`;
    };
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>العروض والخصومات</h1><p>إنشاء وإدارة العروض الترويجية (خصم بالنسبة المئوية أو سعر ثابت جديد) على منتج محدد أو فئة كاملة. يتم احتساب العرض تلقائياً على موقع العميل خلال فترة العرض فقط.</p></div></div>
      <div class="flex-between mb-2" style="margin-bottom:12px">
        <button class="btn btn-primary" onclick="Admin.offerForm()">${Utils.icon('plus', 16)} عرض جديد</button>
        <div class="muted" style="font-size:13px">${offers.length} عرض مسجل</div>
      </div>
      <div class="tabs" style="margin-bottom:14px">
        <div class="tab active" data-tab="active" onclick="Admin.switchOfferTab(this)">العروض الفعالة (${groups.active.length})</div>
        <div class="tab" data-tab="scheduled" onclick="Admin.switchOfferTab(this)">المجدولة (${groups.scheduled.length})</div>
        <div class="tab" data-tab="expired" onclick="Admin.switchOfferTab(this)">المنتهية (${groups.expired.length})</div>
        <div class="tab" data-tab="disabled" onclick="Admin.switchOfferTab(this)">المعطلة (${groups.disabled.length})</div>
      </div>
      <div class="offer-tab-pane" data-pane="active">${groups.active.length ? groups.active.map(renderCard).join('') : '<div class="empty-state"><div style="font-size:50px">🏷️</div><h3>لا توجد عروض فعالة</h3></div>'}</div>
      <div class="offer-tab-pane" data-pane="scheduled" style="display:none">${groups.scheduled.length ? groups.scheduled.map(renderCard).join('') : '<div class="empty-state"><div style="font-size:50px">⏰</div><h3>لا توجد عروض مجدولة</h3></div>'}</div>
      <div class="offer-tab-pane" data-pane="expired" style="display:none">${groups.expired.length ? groups.expired.map(renderCard).join('') : '<div class="empty-state"><div style="font-size:50px">⏳</div><h3>لا توجد عروض منتهية</h3></div>'}</div>
      <div class="offer-tab-pane" data-pane="disabled" style="display:none">${groups.disabled.length ? groups.disabled.map(renderCard).join('') : '<div class="empty-state"><div style="font-size:50px">🚫</div><h3>لا توجد عروض معطلة</h3></div>'}</div>
    `;
  },

  switchOfferTab(el) {
    el.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    const key = el.dataset.tab;
    document.querySelectorAll('.offer-tab-pane').forEach(p => { p.style.display = p.dataset.pane === key ? '' : 'none'; });
  },

  async offerForm(id = null) {
    var o = id ? Store.getOffer(id) : null;
    if (id && this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.offers.list();
        if (r && r.ok && Array.isArray(r.data)) {
          var found = r.data.find(x => x.id === id);
          if (found) o = this._normOfferFromDB(found);
        }
      } catch (e) { /* fall through */ }
    }
    const cats = this._categoriesCache || await this._loadCategories();
    const products = this._productsCache || await this._loadProducts();
    const today = new Date();
    const fmt = (d) => d.toISOString().slice(0, 10);
    const defaultStart = o ? o.startAt : fmt(today);
    const defaultEnd = o ? o.endAt : fmt(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000));
    this.openModal({
      title: id ? 'تعديل العرض' : 'عرض جديد',
      lg: true,
      body: `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">نوع الهدف</label>
            <select class="form-control" id="of-target-type" onchange="Admin.offerTargetChange()">
              <option value="product" ${(o && o.targetType === 'product') || !o ? 'selected' : ''}>منتج محدد</option>
              <option value="category" ${o && o.targetType === 'category' ? 'selected' : ''}>فئة كاملة</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">الهدف</label>
            <select class="form-control" id="of-target-id">
              <option value="">اختر</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">نوع الخصم</label>
            <select class="form-control" id="of-disc-type" onchange="Admin.offerDiscountTypeChange()">
              <option value="percent" ${!o || o.discountType === 'percent' ? 'selected' : ''}>خصم بالنسبة المئوية (٪)</option>
              <option value="fixed" ${o && o.discountType === 'fixed' ? 'selected' : ''}>سعر ثابت جديد</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" id="of-disc-label">قيمة الخصم (٪)</label>
            <input class="form-control" type="number" min="0" step="0.01" id="of-disc-value" value="${o ? (o.discountValue || '') : ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">تاريخ البداية</label>
            <input class="form-control" type="date" id="of-start-date" value="${defaultStart}">
          </div>
          <div class="form-group">
            <label class="form-label">وقت البداية</label>
            <input class="form-control" type="time" id="of-start-time" value="${o ? (o.startTime || '00:00') : '00:00'}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">تاريخ النهاية</label>
            <input class="form-control" type="date" id="of-end-date" value="${defaultEnd}">
          </div>
          <div class="form-group">
            <label class="form-label">وقت النهاية</label>
            <input class="form-control" type="time" id="of-end-time" value="${o ? (o.endTime || '23:59') : '23:59'}">
          </div>
        </div>
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="of-active" ${(!o || o.active !== false) ? 'checked' : ''}> <span>العرض مفعّل</span></label>
        </div>
      `,
      foot: `<button class="btn btn-outline" onclick="Admin.closeModal()">إلغاء</button>
             <button class="btn btn-primary" onclick="Admin.saveOffer('${id || ''}')">${Utils.icon('check', 16)} حفظ</button>`
    });
    this._offerFormCtx = { o, cats, products };
    setTimeout(() => { this.offerTargetChange(); if (o) { document.getElementById('of-target-type').value = o.targetType; this.offerTargetChange(); document.getElementById('of-target-id').value = o.targetId || ''; } this.offerDiscountTypeChange(); }, 30);
  },

  offerTargetChange() {
    const type = document.getElementById('of-target-type').value;
    const sel = document.getElementById('of-target-id');
    const ctx = this._offerFormCtx || {};
    if (type === 'product') {
      sel.innerHTML = '<option value="">اختر المنتج</option>' + ctx.products.map(p => `<option value="${p.uuid || p.id}">${Utils.escapeHtml(p.name)}</option>`).join('');
    } else {
      sel.innerHTML = '<option value="">اختر الفئة</option>' + ctx.cats.map(c => `<option value="${c.uuid || c.id}">${Utils.escapeHtml(c.name)}</option>`).join('');
    }
  },

  offerDiscountTypeChange() {
    const t = document.getElementById('of-disc-type').value;
    document.getElementById('of-disc-label').textContent = t === 'percent' ? 'قيمة الخصم (٪)' : 'السعر الثابت الجديد';
    document.getElementById('of-disc-value').placeholder = t === 'percent' ? 'مثال: 20' : 'مثال: 50';
  },

  async saveOffer(id) {
    const targetType = document.getElementById('of-target-type').value;
    const targetId = document.getElementById('of-target-id').value;
    const discountType = document.getElementById('of-disc-type').value;
    const discountValue = parseFloat(document.getElementById('of-disc-value').value);
    const startDate = document.getElementById('of-start-date').value;
    const startTime = document.getElementById('of-start-time').value || '00:00';
    const endDate = document.getElementById('of-end-date').value;
    const endTime = document.getElementById('of-end-time').value || '23:59';
    const active = document.getElementById('of-active').checked;
    if (!targetId) return Utils.toast('الرجاء اختيار الهدف', 'error');
    if (!Number.isFinite(discountValue) || discountValue < 0) return Utils.toast('قيمة الخصم غير صحيحة', 'error');
    if (!startDate || !endDate) return Utils.toast('الرجاء تحديد تاريخ البداية والنهاية', 'error');
    const startAt = startDate + 'T' + startTime + ':00';
    const endAt = endDate + 'T' + endTime + ':59';
    if (new Date(endAt) <= new Date(startAt)) return Utils.toast('تاريخ النهاية يجب أن يكون بعد تاريخ البداية', 'error');
    const data = { targetType, targetId, discountType, discountValue, startAt, endAt, startTime, endTime, active };
    if (this._hasAdminDataLayer()) {
      try {
        var dbData = this._denormOffer(data);
        if (id) {
          var r = await window.AdminDataLayer.offers.update(id, dbData);
          if (r && r.ok) { console.log('[Admin] Offer updated in Supabase:', id); Utils.toast('تم تحديث العرض'); this.closeModal(); this.viewOffers(); return; }
        } else {
          var r2 = await window.AdminDataLayer.offers.create(dbData);
          if (r2 && r2.ok) { console.log('[Admin] Offer created in Supabase'); Utils.toast('تم إنشاء العرض'); this.closeModal(); this.viewOffers(); return; }
        }
        var errR = r || r2;
        console.error('[Admin] Offer save failed:', JSON.stringify(errR, null, 2));
        var errMsg = (errR && errR.details) || (errR && errR.message) || 'خطأ غير معروف';
        this._showError('فشل حفظ العرض: ' + errMsg);
        return;
      } catch (e) { console.error('[Admin] saveOffer exception:', e); this._showError('حدث خطأ غير متوقع: ' + (e.message || e)); return; }
    }
    if (id) { Store.updateOffer(id, data); Utils.toast('تم تحديث العرض'); }
    else { Store.addOffer(data); Utils.toast('تم إنشاء العرض'); }
    this.closeModal();
    this.viewOffers();
  },

  async toggleOffer(id) {
    var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRe.test(id)) { Utils.toast('معرف العرض غير صحيح', 'error'); return; }
    var o = null;
    if (this._hasAdminReadLayer()) {
      try {
        var rList = await window.AdminReadLayer.offers.list();
        if (rList && rList.ok && Array.isArray(rList.data)) {
          var found = rList.data.find(function (x) { return x.id === id; });
          if (found) o = found;
        }
      } catch (e) { /* fall through */ }
    }
    if (!o) o = Store.getOffer(id);
    if (this._hasAdminDataLayer()) {
      try {
        var r = await window.AdminDataLayer.offers.update(id, { active: !(o && o.active !== false) });
        if (r && r.ok) { console.log('[Admin] Offer', id, 'toggled'); Utils.toast('تم التغيير'); this.viewOffers(); return; }
        this._showError('فشل التغيير: ' + ((r && r.details) || (r && r.message) || 'خطأ غير معروف'));
        return;
      } catch (e) { console.error('[Admin] toggleOffer exception:', e); this._showError('حدث خطأ غير متوقع: ' + (e.message || e)); return; }
    }
    if (!o) return;
    Store.updateOffer(id, { active: !(o.active !== false) });
    Utils.toast((o.active === false ? 'تم التفعيل' : 'تم التعطيل'));
    this.viewOffers();
  },

  async deleteOffer(id) {
    var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!id || !uuidRe.test(id)) { Utils.toast('معرف العرض غير صحيح', 'error'); return; }
    if (!confirm('حذف هذا العرض؟')) return;
    if (this._hasAdminDataLayer()) {
      try {
        var r = await window.AdminDataLayer.offers.delete(id);
        if (r && r.ok) {
          console.log('[Admin] Offer', id, 'confirmed deleted from Supabase');
          Utils.toast('تم الحذف', 'warn');
          this.viewOffers();
          return;
        }
        var errMsg = (r && r.details) || (r && r.message) || 'خطأ غير معروف';
        console.error('[Admin] deleteOffer FAILED:', errMsg);
        this._showError('فشل الحذف: ' + errMsg);
        return;
      } catch (e) { console.error('[Admin] deleteOffer exception:', e); this._showError('حدث خطأ غير متوقع: ' + (e.message || e)); return; }
    }
    Store.deleteOffer(id);
    Utils.toast('تم الحذف', 'warn');
    this.viewOffers();
  },

  /* ===== HERO SLIDES ===== */
  async viewHero() {
    const s = this._settingsCache || await this._loadSettings() || Store.getSettings();
    const slides = (s.heroSlides || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>البانر الرئيسي (Hero Slider)</h1><p>إدارة شرائح البانر الرئيسي في الصفحة الرئيسية</p></div>
        <button class="btn btn-primary" onclick="Admin.addHeroSlide()">${Utils.icon('plus', 16)} إضافة شريحة</button></div>
      <div id="hero-slides-list">${slides.map((slide) => `
        <div class="panel" style="margin-bottom:14px" data-id="${slide.id}">
          <div class="panel-body">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:8px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:10px">
                <span class="tag ${slide.active !== false ? 'tag-green' : 'tag-gray'}">${slide.active !== false ? 'مفعل' : 'معطل'}</span>
                <strong>${Utils.escapeHtml(slide.title || 'شريحة')}</strong>
              </div>
              <div class="actions" style="display:flex;gap:6px">
                <button class="icon-btn" onclick="Admin.moveHeroSlide('${slide.id}', -1)" title="للأعلى">↑</button>
                <button class="icon-btn" onclick="Admin.moveHeroSlide('${slide.id}', 1)" title="للأسفل">↓</button>
                <button class="icon-btn" onclick="Admin.toggleHeroSlide('${slide.id}')" title="تفعيل/تعطيل">${slide.active !== false ? '⏸' : '▶'}</button>
                <button class="icon-btn" onclick="Admin.removeHeroSlide('${slide.id}')" title="حذف" style="color:var(--danger)">${Utils.icon('trash', 14)}</button>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">العنوان</label><input class="form-control" data-field="title" data-id="${slide.id}" value="${Utils.escapeHtml(slide.title || '')}"></div>
              <div class="form-group"><label class="form-label">نص الزر</label><input class="form-control" data-field="cta" data-id="${slide.id}" value="${Utils.escapeHtml(slide.cta || '')}"></div>
            </div>
            <div class="form-group"><label class="form-label">الوصف</label><textarea class="form-control" data-field="subtitle" data-id="${slide.id}" rows="2">${Utils.escapeHtml(slide.subtitle || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">رابط الزر</label><input class="form-control" data-field="link" data-id="${slide.id}" value="${Utils.escapeHtml(slide.link || '#shop')}" placeholder="#shop"></div>
              <div class="form-group"><label class="form-label">صورة الخلفية (URL)</label><input class="form-control" data-field="image" data-id="${slide.id}" value="${Utils.escapeHtml(slide.image || '')}" placeholder="https://..."></div>
            </div>
            <div class="form-group">
              <label class="form-label">وجهة الزر (اختياري)</label>
              <select class="form-control" data-field="linkType" data-id="${slide.id}" onchange="Admin.onHeroLinkTypeChange('${slide.id}')">
                <option value="">— افتراضي (يستخدم الرابط أعلاه) —</option>
                <option value="product" ${slide.linkType === 'product' ? 'selected' : ''}>منتج محدد</option>
                <option value="category" ${slide.linkType === 'category' ? 'selected' : ''}>فئة محددة</option>
                <option value="shop" ${slide.linkType === 'shop' ? 'selected' : ''}>جميع المنتجات</option>
                <option value="custom" ${slide.linkType === 'custom' ? 'selected' : ''}>رابط مخصص</option>
              </select>
            </div>
            <div class="form-row" id="hero-link-product-${slide.id}" style="display:${slide.linkType === 'product' ? '' : 'none'}">
              <div class="form-group"><label class="form-label">اختر المنتج</label><select class="form-control" data-field="linkProductId" data-id="${slide.id}"><option value="">— اختر —</option>${(this._productsCache || []).map(p => `<option value="${p.id}" ${slide.linkProductId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('')}</select></div>
              <div class="form-group"></div>
            </div>
            <div class="form-row" id="hero-link-category-${slide.id}" style="display:${slide.linkType === 'category' ? '' : 'none'}">
              <div class="form-group"><label class="form-label">اختر الفئة</label><select class="form-control" data-field="linkCategoryId" data-id="${slide.id}"><option value="">— اختر —</option>${(this._categoriesCache || []).map(c => `<option value="${c.id}" ${slide.linkCategoryId === c.id ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`).join('')}</select></div>
              <div class="form-group"></div>
            </div>
            <div class="form-row" id="hero-link-custom-${slide.id}" style="display:${slide.linkType === 'custom' ? '' : 'none'}">
              <div class="form-group"><label class="form-label">الرابط المخصص (URL)</label><input class="form-control" data-field="linkCustomUrl" data-id="${slide.id}" value="${Utils.escapeHtml(slide.linkCustomUrl || '')}" placeholder="https://..." dir="ltr"></div>
              <div class="form-group"></div>
            </div>
            <div style="margin-top:8px;display:flex;gap:6px;align-items:center">
              <input type="file" id="h-file-${slide.id}" accept="image/*" style="display:none" onchange="Admin.uploadHeroImage('${slide.id}', this)">
              <button class="btn btn-outline btn-sm" onclick="document.getElementById('h-file-${slide.id}').click()">${Utils.icon('plus', 12)} رفع صورة</button>
              ${slide.image ? `<img src="${Utils.escapeUrl(slide.image)}" style="width:60px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border)" loading="lazy">` : ''}
              <button class="btn btn-primary btn-sm" style="margin-right:auto" onclick="Admin.saveHeroField('${slide.id}')">${Utils.icon('check', 12)} حفظ الشريحة</button>
            </div>
          </div>
        </div>
      `).join('')}</div>
      ${!slides.length ? '<div class="empty-state"><h3>لا توجد شرائح</h3><p>أضف شريحتك الأولى</p></div>' : ''}
    `;
  },

  async addHeroSlide() {
    if (this._hasAdminDataLayer()) {
      try {
        var s = this._settingsCache || {};
        var slides = (s.heroSlides || []).slice();
        var newId = 's_' + Date.now();
        slides.push({ id: newId, title: 'شريحة جديدة', subtitle: 'وصف الشريحة', cta: 'اكتشف', link: '#shop', image: '', active: true, order: slides.length + 1 });
        var result = await window.AdminDataLayer.settings.update({ hero_slides: slides });
        if (result && result.ok) { await this._loadSettings(); Utils.toast('تمت إضافة الشريحة'); this.viewHero(); return; }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.addHeroSlide({ title: 'شريحة جديدة', subtitle: 'وصف الشريحة', cta: 'اكتشف', link: '#shop', image: '' });
      Utils.toast('تمت إضافة الشريحة');
      this.viewHero();
    }
  },

  async removeHeroSlide(id) {
    if (!confirm('حذف هذه الشريحة؟')) return;
    if (this._hasAdminDataLayer()) {
      try {
        var s = this._settingsCache || {};
        var slideToRemove = (s.heroSlides || []).find(sl => sl.id === id);
        var slides = (s.heroSlides || []).filter(sl => sl.id !== id);
        var result = await window.AdminDataLayer.settings.update({ hero_slides: slides });
        if (result && result.ok) {
          if (slideToRemove && slideToRemove.image && typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.extractStoragePath === 'function') {
            var imgPath = window.SupabaseStorage.extractStoragePath(slideToRemove.image);
            if (imgPath) { try { await window.SupabaseStorage.deleteFile(imgPath); } catch (e) {} }
          }
          await this._loadSettings(); Utils.toast('تم الحذف', 'warn'); this.viewHero(); return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.deleteHeroSlide(id);
      Utils.toast('تم الحذف', 'warn');
      this.viewHero();
    }
  },

  async toggleHeroSlide(id) {
    const s = this._settingsCache || Store.getSettings();
    const slide = (s.heroSlides || []).find(sl => sl.id === id);
    if (!slide) return;
    if (this._hasAdminDataLayer()) {
      try {
        var slides = (s.heroSlides || []).map(sl => sl.id === id ? Object.assign({}, sl, { active: sl.active === false }) : sl);
        var result = await window.AdminDataLayer.settings.update({ hero_slides: slides });
        if (result && result.ok) { await this._loadSettings(); this.viewHero(); return; }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.updateHeroSlide(id, { active: slide.active === false });
      this.viewHero();
    }
  },

  async moveHeroSlide(id, dir) {
    const s = this._settingsCache || await this._loadSettings() || Store.getSettings();
    const slides = (s.heroSlides || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = slides.findIndex(sl => sl.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= slides.length) return;
    [slides[i], slides[j]] = [slides[j], slides[i]];
    const reordered = slides.map((sl, idx) => Object.assign({}, sl, { order: idx + 1 }));

    if (this._hasAdminDataLayer()) {
      try {
        var result = await window.AdminDataLayer.settings.update({ hero_slides: reordered });
        if (result && result.ok) { await this._loadSettings(); this.viewHero(); return; }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.reorderHeroSlides(slides.map(sl => sl.id));
      this.viewHero();
    }
  },

  async uploadHeroImage(id, input) {
    const file = input.files[0];
    if (!file) return;
    try {
      if (typeof window.SupabaseStorage === 'undefined' || !window.SupabaseStorage.uploadSettingsImage) {
        Utils.toast('نظام Storage غير جاهز', 'error'); return;
      }
      var r = await window.SupabaseStorage.uploadSettingsImage(file, 'settings/hero');
      if (r && r.ok && r.url) {
        if (this._hasAdminDataLayer()) {
          try {
            var s = this._settingsCache || {};
            var slides = (s.heroSlides || []).map(sl => {
              if (sl.id === id && sl.image && sl.image !== r.url && typeof window.SupabaseStorage.extractStoragePath === 'function') {
                var p = window.SupabaseStorage.extractStoragePath(sl.image);
                if (p) { if (!this._pendingImageCleanup) this._pendingImageCleanup = []; this._pendingImageCleanup.push(p); }
              }
              return sl.id === id ? Object.assign({}, sl, { image: r.url }) : sl;
            });
            var result = await window.AdminDataLayer.settings.update({ hero_slides: slides });
            if (result && result.ok) { await this._loadSettings(); this.viewHero(); return; }
            this._showError(this._mapAuthError(result && result.error));
          } catch (err) { this._showError('حدث خطأ غير متوقع.'); }
        } else {
          Store.updateHeroSlide(id, { image: r.url });
          this.viewHero();
        }
      } else {
        Utils.toast('فشل رفع صورة البانر: ' + (r && r.error || 'خطأ غير معروف'), 'error');
      }
    } catch (e) {
      console.error('uploadHeroImage error:', e);
      Utils.toast('حدث خطأ أثناء رفع صورة البانر', 'error');
    }
  },

  async saveHeroField(id) {
    const patch = {};
    ['title', 'subtitle', 'cta', 'link', 'image', 'linkType'].forEach(f => {
      const el = document.querySelector(`[data-id="${id}"][data-field="${f}"]`);
      if (el) patch[f] = el.value;
    });
    var linkRowMap = { linkProductId: 'product', linkCategoryId: 'category', linkCustomUrl: 'custom' };
    Object.keys(linkRowMap).forEach(f => {
      var row = document.getElementById('hero-link-' + linkRowMap[f] + '-' + id);
      if (row && row.style.display !== 'none') {
        const el = document.querySelector(`[data-id="${id}"][data-field="${f}"]`);
        if (el) patch[f] = el.value;
      }
    });

    if (this._hasAdminDataLayer()) {
      try {
        var s = this._settingsCache || {};
        var slides = (s.heroSlides || []).map(sl => sl.id === id ? Object.assign({}, sl, patch) : sl);
        var result = await window.AdminDataLayer.settings.update({ hero_slides: slides });
        if (result && result.ok) { await this._loadSettings(); Utils.toast('تم حفظ الشريحة'); return; }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.updateHeroSlide(id, patch);
      Utils.toast('تم حفظ الشريحة');
    }
  },

  onHeroLinkTypeChange(id) {
    const sel = document.querySelector(`[data-id="${id}"][data-field="linkType"]`);
    const t = sel ? sel.value : '';
    const groups = ['product', 'category', 'custom'];
    groups.forEach(g => {
      const row = document.getElementById('hero-link-' + g + '-' + id);
      if (row) row.style.display = (t === g) ? '' : 'none';
    });
  },
  /* ===== SETTINGS ===== */
  async viewSettings() {
    const s = this._settingsCache || await this._loadSettings() || Store.getSettings();
    const f = s.footer || {};
    const fw = s.floatingWhatsapp || { enabled: true, message: '' };
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>إعدادات المتجر</h1><p>تخصيص بيانات المتجر، التواصل، والشبكات الاجتماعية</p></div></div>

      <div class="panel">
        <div class="panel-head"><h3>البيانات الأساسية والشعار</h3></div>
        <div class="panel-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">اسم المتجر (عربي)</label><input class="form-control" id="s-name" value="${Utils.escapeHtml(s.storeName)}"></div>
            <div class="form-group"><label class="form-label">اسم المتجر (إنجليزي)</label><input class="form-control" id="s-name-en" value="${Utils.escapeHtml(s.storeNameEn || '')}"></div>
          </div>
          <div class="form-group"><label class="form-label">العنوان الفرعي / الشعار النصي</label><input class="form-control" id="s-tagline" value="${Utils.escapeHtml(s.tagline || '')}"></div>
          <div class="form-group">
            <label class="form-label">شعار المتجر (صورة)</label>
            <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
              <div id="s-logo-preview" style="width:80px;height:80px;border-radius:14px;overflow:hidden;background:var(--surface-2);display:grid;place-items:center;border:1.5px solid var(--border)">
                ${s.logo ? `<img src="${Utils.escapeUrl(s.logo)}" style="width:100%;height:100%;object-fit:cover">` : `<span style="font-size:32px;font-weight:800;color:var(--brown)">${Utils.escapeHtml((s.storeName || 'A').charAt(0))}</span>`}
              </div>
              <div style="flex:1">
                <input class="form-control" id="s-logo" value="${Utils.escapeHtml(s.logo || '')}" placeholder="https://..." oninput="Admin.previewLogo()">
                <div style="display:flex;gap:6px;margin-top:6px">
                  <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('s-logo-file').click()">${Utils.icon('plus', 12)} رفع صورة</button>
                  <button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById('s-logo').value='';Admin.previewLogo()">${Utils.icon('trash', 12)} إزالة</button>
                </div>
                <input type="file" id="s-logo-file" accept="image/*" style="display:none" onchange="Admin.uploadLogoFile(this)">
              </div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">العملة</label><input class="form-control" id="s-currency" value="${Utils.escapeHtml(s.currency || '')}"></div>
            <div class="form-group"><label class="form-label">رمز العملة (ISO)</label><input class="form-control" id="s-currency-code" value="${Utils.escapeHtml(s.currencyCode || 'JOD')}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">اللون الرئيسي (تركوازي)</label><div class="color-input"><input type="color" id="s-color-pick" value="${Utils.escapeHtml(s.primaryColor)}"><input type="text" id="s-color" value="${Utils.escapeHtml(s.primaryColor)}"></div></div>
            <div class="form-group"><label class="form-label">لون التمييز</label><div class="color-input"><input type="color" id="s-accent-pick" value="${Utils.escapeHtml(s.accentColor)}"><input type="text" id="s-accent" value="${Utils.escapeHtml(s.accentColor)}"></div></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>ألوان الموقع والمظهر</h3></div>
        <div class="panel-body">
          <p class="muted mb-2" style="font-size:13px">تحكم كامل بألوان عناصر الموقع. تعمل هذه الألوان مع الوضع الفاتح والداكن. اترك الحقل فارغاً لاستخدام اللون الافتراضي.</p>
          <div class="form-row">
            <div class="form-group"><label class="form-label">خلفية الموقع الرئيسية</label><div class="color-input"><input type="color" id="c-pageBg" value="${(s.colors && s.colors.pageBg) || '#fafaf7'}"><input type="text" id="c-pageBg-t" value="${Utils.escapeHtml((s.colors && s.colors.pageBg) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">خلفية شريط الهيدر</label><div class="color-input"><input type="color" id="c-headerBg" value="${(s.colors && s.colors.headerBg) || '#ffffff'}"><input type="text" id="c-headerBg-t" value="${Utils.escapeHtml((s.colors && s.colors.headerBg) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">خلفية القائمة الرئيسية</label><div class="color-input"><input type="color" id="c-navBg" value="${(s.colors && s.colors.navBg) || '#ffffff'}"><input type="text" id="c-navBg-t" value="${Utils.escapeHtml((s.colors && s.colors.navBg) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون نص القائمة الرئيسية</label><div class="color-input"><input type="color" id="c-navText" value="${(s.colors && s.colors.navText) || '#1a1a1a'}"><input type="text" id="c-navText-t" value="${Utils.escapeHtml((s.colors && s.colors.navText) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">خلفية الفئات</label><div class="color-input"><input type="color" id="c-categoryBg" value="${(s.colors && s.colors.categoryBg) || '#ffffff'}"><input type="text" id="c-categoryBg-t" value="${Utils.escapeHtml((s.colors && s.colors.categoryBg) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">خلفية عنصر الفئة</label><div class="color-input"><input type="color" id="c-categoryItemBg" value="${(s.colors && s.colors.categoryItemBg) || '#ffffff'}"><input type="text" id="c-categoryItemBg-t" value="${Utils.escapeHtml((s.colors && s.colors.categoryItemBg) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون نص عنصر الفئة</label><div class="color-input"><input type="color" id="c-categoryItemText" value="${(s.colors && s.colors.categoryItemText) || '#1a1a1a'}"><input type="text" id="c-categoryItemText-t" value="${Utils.escapeHtml((s.colors && s.colors.categoryItemText) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">خلفية البانر</label><div class="color-input"><input type="color" id="c-bannerBg" value="${(s.colors && s.colors.bannerBg) || '#1a1a1a'}"><input type="text" id="c-bannerBg-t" value="${Utils.escapeHtml((s.colors && s.colors.bannerBg) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون نص البانر</label><div class="color-input"><input type="color" id="c-bannerText" value="${(s.colors && s.colors.bannerText) || '#ffffff'}"><input type="text" id="c-bannerText-t" value="${Utils.escapeHtml((s.colors && s.colors.bannerText) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون الأزرار العامة</label><div class="color-input"><input type="color" id="c-buttonBg" value="${(s.colors && s.colors.buttonBg) || '#14b8a6'}"><input type="text" id="c-buttonBg-t" value="${Utils.escapeHtml((s.colors && s.colors.buttonBg) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون نص الأزرار</label><div class="color-input"><input type="color" id="c-buttonText" value="${(s.colors && s.colors.buttonText) || '#ffffff'}"><input type="text" id="c-buttonText-t" value="${Utils.escapeHtml((s.colors && s.colors.buttonText) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون زر "أضف للسلة"</label><div class="color-input"><input type="color" id="c-addToCartBg" value="${(s.colors && s.colors.addToCartBg) || '#6b4423'}"><input type="text" id="c-addToCartBg-t" value="${Utils.escapeHtml((s.colors && s.colors.addToCartBg) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون نص زر "أضف للسلة"</label><div class="color-input"><input type="color" id="c-addToCartText" value="${(s.colors && s.colors.addToCartText) || '#ffffff'}"><input type="text" id="c-addToCartText-t" value="${Utils.escapeHtml((s.colors && s.colors.addToCartText) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون السعر العادي</label><div class="color-input"><input type="color" id="c-price" value="${(s.colors && s.colors.price) || '#0d9488'}"><input type="text" id="c-price-t" value="${Utils.escapeHtml((s.colors && s.colors.price) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون السعر القديم (المشطوب)</label><div class="color-input"><input type="color" id="c-priceOld" value="${(s.colors && s.colors.priceOld) || '#9a9a9a'}"><input type="text" id="c-priceOld-t" value="${Utils.escapeHtml((s.colors && s.colors.priceOld) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون السعر الجديد/المخفض</label><div class="color-input"><input type="color" id="c-priceNew" value="${(s.colors && s.colors.priceNew) || '#dc2626'}"><input type="text" id="c-priceNew-t" value="${Utils.escapeHtml((s.colors && s.colors.priceNew) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون خلفية شارة العرض</label><div class="color-input"><input type="color" id="c-offerBg" value="${(s.colors && s.colors.offerBg) || '#dc2626'}"><input type="text" id="c-offerBg-t" value="${Utils.escapeHtml((s.colors && s.colors.offerBg) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون نص شارة العرض</label><div class="color-input"><input type="color" id="c-offerText" value="${(s.colors && s.colors.offerText) || '#ffffff'}"><input type="text" id="c-offerText-t" value="${Utils.escapeHtml((s.colors && s.colors.offerText) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون القلب عند التفعيل (المفضلة)</label><div class="color-input"><input type="color" id="c-wishlistActive" value="${(s.colors && s.colors.wishlistActive) || '#dc2626'}"><input type="text" id="c-wishlistActive-t" value="${Utils.escapeHtml((s.colors && s.colors.wishlistActive) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون شارة السلة</label><div class="color-input"><input type="color" id="c-cartBadge" value="${(s.colors && s.colors.cartBadge) || '#dc2626'}"><input type="text" id="c-cartBadge-t" value="${Utils.escapeHtml((s.colors && s.colors.cartBadge) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون العناوين الرئيسية</label><div class="color-input"><input type="color" id="c-heading" value="${(s.colors && s.colors.heading) || '#1a1a1a'}"><input type="text" id="c-heading-t" value="${Utils.escapeHtml((s.colors && s.colors.heading) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون الروابط</label><div class="color-input"><input type="color" id="c-link" value="${(s.colors && s.colors.link) || '#0d9488'}"><input type="text" id="c-link-t" value="${Utils.escapeHtml((s.colors && s.colors.link) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون خلفية الحقول</label><div class="color-input"><input type="color" id="c-inputBg" value="${(s.colors && s.colors.inputBg) || '#ffffff'}"><input type="text" id="c-inputBg-t" value="${Utils.escapeHtml((s.colors && s.colors.inputBg) || '')}" placeholder="افتراضي"></div></div>
            <div class="form-group"><label class="form-label">لون حدود الحقول</label><div class="color-input"><input type="color" id="c-inputBorder" value="${(s.colors && s.colors.inputBorder) || '#e8e3d8'}"><input type="text" id="c-inputBorder-t" value="${Utils.escapeHtml((s.colors && s.colors.inputBorder) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">لون خلفية البطاقات</label><div class="color-input"><input type="color" id="c-cardBg" value="${(s.colors && s.colors.cardBg) || '#ffffff'}"><input type="text" id="c-cardBg-t" value="${Utils.escapeHtml((s.colors && s.colors.cardBg) || '')}" placeholder="افتراضي"></div></div>
          </div>
          <div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="Admin.saveColors()">${Utils.icon('check', 16)} حفظ الألوان</button>
            <button class="btn btn-outline" onclick="Admin.resetColors()">${Utils.icon('refresh', 14)} استعادة الافتراضي</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>معلومات التواصل والواتساب</h3></div>
        <div class="panel-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">رقم الجوال</label><input class="form-control" id="s-phone" value="${Utils.escapeHtml(s.contactPhone)}"></div>
            <div class="form-group"><label class="form-label">البريد الإلكتروني</label><input class="form-control" id="s-email" value="${Utils.escapeHtml(s.contactEmail)}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">رقم الواتساب (مع كود الدولة بدون +)</label><input class="form-control" id="s-whatsapp" value="${Utils.escapeHtml(s.whatsapp)}" placeholder="962790000000"></div>
            <div class="form-group"><label class="form-label">العنوان</label><input class="form-control" id="s-address" value="${Utils.escapeHtml(s.address)}"></div>
          </div>
          <div class="form-group">
            <label class="form-label">موقع المتجر على الخرائط</label>
            <input class="form-control" id="s-maps-url" value="${Utils.escapeHtml(s.mapsUrl || '')}" placeholder="https://maps.google.com/..." dir="ltr">
            <p class="form-help">الصق رابط مشاركة الموقع من Google Maps. سيظهر في الفوتر كزر "موقعنا".</p>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>زر الواتساب العائم</h3></div>
        <div class="panel-body">
          <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-fw-enabled" ${fw.enabled ? 'checked' : ''}> <span>إظهار زر الواتساب العائم</span></label></div>
          <div class="form-group"><label class="form-label">الرسالة الافتراضية</label><textarea class="form-control" id="s-fw-msg" rows="2">${Utils.escapeHtml(fw.message || '')}</textarea></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>الخلفية الزخرفية</h3></div>
        <div class="panel-body">
          <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-deco-bg" ${s.decorativeBackground?.enabled !== false ? 'checked' : ''} onchange="Admin.toggleDecorativeBackground()"> <span>شيل وحط (إظهار عناصر زخرفية صغيرة على الخلفية)</span></label></div>
          <p class="muted" style="font-size:13px">عند التفعيل، تظهر عناصر صغيرة متفرقة (خرز، خيوط، إكسسوارات) على الخلفية البيضاء بتأثير خفيف. عند الإلغاء، تعود الخلفية إلى الأبيض النظيف.</p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>الشبكات الاجتماعية</h3></div>
        <div class="panel-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">${Utils.icon('facebook', 14)} فيسبوك</label><input class="form-control" id="s-fb" value="${Utils.escapeHtml(s.facebook || '')}" dir="ltr"></div>
            <div class="form-group"><label class="form-label">${Utils.icon('instagram', 14)} انستغرام</label><input class="form-control" id="s-ig" value="${Utils.escapeHtml(s.instagram || '')}" dir="ltr"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">${Utils.icon('twitter', 14)} X / تويتر</label><input class="form-control" id="s-tw" value="${Utils.escapeHtml(s.twitter || '')}" dir="ltr"></div>
            <div class="form-group"><label class="form-label">${Utils.icon('tiktok', 14)} تيك توك</label><input class="form-control" id="s-tt" value="${Utils.escapeHtml(s.tiktok || '')}" dir="ltr"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">${Utils.icon('snapchat', 14)} سناب شات</label><input class="form-control" id="s-sc" value="${Utils.escapeHtml(s.snapchat || '')}" dir="ltr"></div>
            <div class="form-group"><label class="form-label">${Utils.icon('youtube', 14)} يوتيوب</label><input class="form-control" id="s-yt" value="${Utils.escapeHtml(s.youtube || '')}" dir="ltr"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>الشحن</h3></div>
        <div class="panel-body">
          <div class="form-row">
            <div class="form-group"><label class="form-label">حد الشحن المجاني (دينار)</label><input class="form-control" type="number" step="0.01" min="0" id="s-free" value="${s.freeShippingThreshold}"></div>
            <div class="form-group"><label class="form-label">تكلفة الشحن الافتراضية (دينار)</label><input class="form-control" type="number" step="0.01" min="0" id="s-shipping" value="${(s.defaultShippingCost ?? s.shippingCost ?? 0)}"></div>
          </div>
          <p class="form-help">لإدارة أسعار الشحن لكل محافظة، استخدم صفحة <a href="#delivery" class="text-gold">مناطق التوصيل</a></p>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>الفوتر (تذييل الموقع)</h3></div>
        <div class="panel-body">
          <div class="form-group"><label class="form-label">وصف المتجر في الفوتر</label><textarea class="form-control" id="s-f-about" rows="3">${Utils.escapeHtml(f.aboutText || '')}</textarea></div>
          <div class="form-group"><label class="form-label">نص حقوق النشر (اختياري)</label><input class="form-control" id="s-f-copyright" value="${Utils.escapeHtml(f.copyright || '')}" placeholder="اتركه فارغاً لاستخدام النص الافتراضي"></div>
          <div class="form-row">
            <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-f-name" ${f.showName !== false ? 'checked' : ''}> <span>إظهار اسم المتجر</span></label></div>
            <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-f-desc" ${f.showDescription !== false ? 'checked' : ''}> <span>إظهار وصف المتجر</span></label></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-f-social" ${f.showSocial !== false ? 'checked' : ''}> <span>إظهار الشبكات الاجتماعية</span></label></div>
            <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-f-phone" ${f.showPhone !== false ? 'checked' : ''}> <span>إظهار رقم الجوال</span></label></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-f-wa" ${f.showWhatsapp !== false ? 'checked' : ''}> <span>إظهار الواتساب</span></label></div>
            <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-f-addr" ${f.showAddress !== false ? 'checked' : ''}> <span>إظهار العنوان</span></label></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="s-f-location" ${f.showLocation !== false ? 'checked' : ''}> <span>إظهار الموقع (موقعنا)</span></label></div>
            <div class="form-group"></div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>النسخ الاحتياطي</h3></div>
        <div class="panel-body">
          <p class="muted mb-2">يمكنك تصدير جميع بيانات المتجر أو استعادتها لاحقاً</p>
          <div class="flex gap-2">
            <button class="btn btn-outline" onclick="Admin.exportData()">${Utils.icon('download', 14)} تصدير البيانات</button>
            <button class="btn btn-outline" onclick="Admin.importData()">${Utils.icon('plus', 14)} استيراد البيانات</button>
            <button class="btn btn-outline" onclick="Admin.resetData()" style="color:var(--danger)">${Utils.icon('trash', 14)} إعادة تعيين</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>بيانات دخول الإدارة</h3></div>
        <div class="panel-body">
          <p class="muted mb-2" style="font-size:13px">تغيير اسم المستخدم وكلمة المرور. يجب إدخال اسم المستخدم الحالي وكلمة المرور الحالية معاً للتحقق قبل المتابعة. لن تظهر كلمة المرور بشكل واضح في أي مكان.</p>
          <div class="form-row">
            <div class="form-group"><label class="form-label">اسم المستخدم الحالي <span class="req">*</span></label><input class="form-control" id="cred-current-user" autocomplete="username"></div>
            <div class="form-group"><label class="form-label">كلمة المرور الحالية <span class="req">*</span></label><input class="form-control" type="password" id="cred-current" autocomplete="current-password"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">اسم المستخدم الجديد</label><input class="form-control" id="cred-new-user" autocomplete="username"></div>
            <div class="form-group"><label class="form-label">كلمة المرور الجديدة</label><input class="form-control" type="password" id="cred-new-pass" autocomplete="new-password"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">تأكيد كلمة المرور الجديدة</label><input class="form-control" type="password" id="cred-new-pass2" autocomplete="new-password"></div>
          </div>
          <button class="btn btn-primary" onclick="Admin.changeAdminCredentials()">${Utils.icon('check', 16)} تحديث بيانات الدخول</button>
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn btn-primary btn-lg" onclick="Admin.saveSettings()">${Utils.icon('check', 16)} حفظ كل الإعدادات</button>
      </div>
    `;
    ['s-color-pick', 's-accent-pick'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', e => {
        document.getElementById(id.replace('-pick', '')).value = e.target.value;
      });
    });
    const colorKeys = ['pageBg','headerBg','navBg','navText','categoryBg','categoryItemBg','categoryItemText','bannerBg','bannerText','buttonBg','buttonText','addToCartBg','addToCartText','price','priceOld','priceNew','offerBg','offerText','wishlistActive','cartBadge','heading','link','inputBg','inputBorder','cardBg'];
    colorKeys.forEach(k => {
      const pick = document.getElementById('c-' + k);
      const text = document.getElementById('c-' + k + '-t');
      if (pick && text) {
        pick.addEventListener('input', e => { if (!text.value || /^#([0-9a-f]{3}){1,2}$/i.test(text.value.trim())) text.value = e.target.value; });
        text.addEventListener('input', e => { if (/^#([0-9a-f]{3}){1,2}$/i.test(e.target.value.trim())) pick.value = e.target.value.trim(); });
      }
    });
  },

  previewLogo() {
    const url = document.getElementById('s-logo').value.trim();
    const preview = document.getElementById('s-logo-preview');
    if (url) preview.innerHTML = `<img src="${Utils.escapeUrl(url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<span style=color:var(--danger)>!</span>'">`;
    else { const s = Store.getSettings(); preview.innerHTML = `<span style="font-size:32px;font-weight:800;color:var(--brown)">${(s.storeName || 'A').charAt(0)}</span>`; }
  },

  async uploadLogoFile(input) {
    const file = input.files[0];
    if (!file) return;
    const el = document.getElementById('s-logo');
    const oldVal = el.value;
    try {
      if (typeof window.SupabaseStorage === 'undefined' || !window.SupabaseStorage.uploadSettingsImage) {
        Utils.toast('نظام Storage غير جاهز', 'error'); return;
      }
      var r = await window.SupabaseStorage.uploadSettingsImage(file, 'settings/logo');
      if (r && r.ok && r.url) {
        el.value = r.url;
        if (oldVal && oldVal !== r.url && typeof window.SupabaseStorage.extractStoragePath === 'function') {
          var p = window.SupabaseStorage.extractStoragePath(oldVal);
          if (p) { if (!this._pendingImageCleanup) this._pendingImageCleanup = []; this._pendingImageCleanup.push(p); }
        }
        Admin.previewLogo();
      } else {
        Utils.toast('فشل رفع الشعار: ' + (r && r.error || 'خطأ غير معروف'), 'error');
      }
    } catch (e) {
      console.error('uploadLogoFile error:', e);
      Utils.toast('حدث خطأ أثناء رفع الشعار', 'error');
      el.value = oldVal;
    }
  },

  async saveSettings() {
    const data = {
      storeName: document.getElementById('s-name').value,
      storeNameEn: document.getElementById('s-name-en').value,
      tagline: document.getElementById('s-tagline').value,
      currency: document.getElementById('s-currency').value,
      currencyCode: document.getElementById('s-currency-code').value,
      primaryColor: document.getElementById('s-color').value,
      accentColor: document.getElementById('s-accent').value,
      logo: document.getElementById('s-logo').value,
      contactPhone: document.getElementById('s-phone').value,
      contactEmail: document.getElementById('s-email').value,
      whatsapp: document.getElementById('s-whatsapp').value,
      address: document.getElementById('s-address').value,
      mapsUrl: document.getElementById('s-maps-url').value,
      facebook: document.getElementById('s-fb').value,
      instagram: document.getElementById('s-ig').value,
      twitter: document.getElementById('s-tw').value,
      tiktok: document.getElementById('s-tt').value,
      snapchat: document.getElementById('s-sc').value,
      youtube: document.getElementById('s-yt').value,
      freeShippingThreshold: +document.getElementById('s-free').value,
      defaultShippingCost: +document.getElementById('s-shipping').value,
      floatingWhatsapp: {
        enabled: document.getElementById('s-fw-enabled').checked,
        message: document.getElementById('s-fw-msg').value
      },
      footer: {
        aboutText: document.getElementById('s-f-about').value,
        copyright: document.getElementById('s-f-copyright').value,
        showName: document.getElementById('s-f-name').checked,
        showDescription: document.getElementById('s-f-desc').checked,
        showSocial: document.getElementById('s-f-social').checked,
        showPhone: document.getElementById('s-f-phone').checked,
        showWhatsapp: document.getElementById('s-f-wa').checked,
        showAddress: document.getElementById('s-f-addr').checked,
        showLocation: document.getElementById('s-f-location').checked
      }
    };

    if (this._hasAdminDataLayer()) {
      try {
        var patch = this._denormSettings(data);
        var result = await window.AdminDataLayer.settings.update(patch);
        if (result && result.ok) {
          await this._loadSettings();
          if (this._pendingImageCleanup && this._pendingImageCleanup.length) {
            var urls = this._pendingImageCleanup.splice(0);
            for (var i = 0; i < urls.length; i++) { try { await window.SupabaseStorage.deleteFile(urls[i]); } catch (e) {} }
          }
          console.log('[Admin] Settings saved to Supabase');
          Utils.toast('تم حفظ الإعدادات بنجاح');
          return;
        }
        this._pendingImageCleanup = [];
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) {
        console.error('saveSettings error:', e);
        this._showError('حدث خطأ غير متوقع أثناء حفظ الإعدادات.');
      }
    } else {
      Store.updateSettings(data);
      Utils.toast('تم حفظ الإعدادات بنجاح');
    }
  },

  esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  numInput(v) { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; },
  onBasePriceChange() {
    const baseEl = document.getElementById('f-price');
    if (!baseEl) return;
    const newBase = this.numInput(baseEl.value);
    (this.productVariants || []).forEach((v, i) => {
      if (v && v._isCustomPrice) return; // customized variants are not affected
      v.price = newBase;
      const input = document.querySelector(`.variant-row input[onchange*="setVariantPrice(${i},"]`);
      if (input) input.value = String(newBase);
    });
  },
  setVariantPrice(i, value) {
    if (!this.productVariants || !this.productVariants[i]) return;
    this.productVariants[i].price = this.numInput(value);
    this.productVariants[i]._isCustomPrice = true;
  },

  async saveInvoiceSettings() {
    // Thermal-only save (normal invoice settings are removed by design)
    const get = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const getCheck = id => { const el = document.getElementById(id); return el ? el.checked : false; };
    const data = {
      invoice: {
        thermal: {
          enabled: getCheck('inv-t-enabled'),
          paperSize: get('inv-t-paper') || '80mm',
          qrUrl: get('inv-t-qr').trim()
        }
      }
    };
    const current = this._settingsCache || Store.getSettings();
    const existingThermal = (current.invoice && current.invoice.thermal) || {};
    data.invoice.thermal = Object.assign({}, existingThermal, data.invoice.thermal);

    if (this._hasAdminDataLayer()) {
      try {
        var result = await window.AdminDataLayer.settings.update({ invoice: data.invoice });
        if (result && result.ok) {
          await this._loadSettings();
          Utils.toast('تم حفظ إعدادات الفاتورة الحرارية');
          this.refreshInvoiceQrPreview();
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) {
        this._showError('حدث خطأ غير متوقع.');
      }
    } else {
      Store.updateSettings({ invoice: data.invoice });
      Utils.toast('تم حفظ إعدادات الفاتورة الحرارية');
      this.refreshInvoiceQrPreview();
    }
  },

  refreshInvoiceQrPreview() {
    const el = document.getElementById('inv-t-qr-preview');
    if (!el) return;
    const url = (document.getElementById('inv-t-qr') || {}).value || '';
    el.innerHTML = '';
    if (!url.trim()) { el.textContent = 'أدخل رابط QR لعرض المعاينة'; return; }
    try {
      const svg = QRCode_generateSVG(url, { cellSize: 4, margin: 2 });
      el.innerHTML = '<div style="background:#fff;padding:6px;border:1px solid var(--border);border-radius:8px;display:inline-block">' + svg + '</div><span style="font-size:12px;color:var(--text-2)">معاينة — امسح للتحقق</span>';
    } catch (e) {
      el.textContent = 'تعذر إنشاء المعاينة (الرابط طويل جداً)';
    }
  },

  toggleAllInvoiceSelection(checked) {
    document.querySelectorAll('.inv-select').forEach(c => { c.checked = checked; });
  },

  changeAdminCredentials() {
    const currentUserEl = document.getElementById('cred-current-user');
    const currentPassEl = document.getElementById('cred-current');
    const newUserEl = document.getElementById('cred-new-user');
    const newPassEl = document.getElementById('cred-new-pass');
    const newPass2El = document.getElementById('cred-new-pass2');
    const currentUser = currentUserEl ? currentUserEl.value : '';
    const current = currentPassEl ? currentPassEl.value : '';
    const newUser = newUserEl ? newUserEl.value.trim() : '';
    const newPass = newPassEl ? newPassEl.value : '';
    const newPass2 = newPass2El ? newPass2El.value : '';
    if (!currentUser) return Utils.toast('الرجاء إدخال اسم المستخدم الحالي', 'error');
    if (!current) return Utils.toast('الرجاء إدخال كلمة المرور الحالية', 'error');
    if (!Store.verifyAdminCredentials(currentUser, current)) {
      return Utils.toast('اسم المستخدم أو كلمة المرور الحالية غير صحيحة', 'error');
    }
    if (!newUser && !newPass && !newPass2) return Utils.toast('الرجاء إدخال اسم مستخدم أو كلمة مرور جديدة', 'error');
    if (newPass || newPass2) {
      if (newPass !== newPass2) return Utils.toast('كلمتا المرور الجديدتان غير متطابقتين', 'error');
      if (newPass.length < 4) return Utils.toast('يجب أن تكون كلمة المرور 4 أحرف على الأقل', 'error');
    }
    const finalUser = newUser || currentUser;
    const finalPass = newPass || current;
    Store.setAdminCredentials(finalUser, finalPass);
    Utils.toast('تم تحديث بيانات الدخول. سيتم تسجيل الخروج الآن.');
    if (currentUserEl) currentUserEl.value = '';
    if (currentPassEl) currentPassEl.value = '';
    if (newUserEl) newUserEl.value = '';
    if (newPassEl) newPassEl.value = '';
    if (newPass2El) newPass2El.value = '';
    setTimeout(() => { sessionStorage.removeItem('anwar_admin'); this.loggedIn = false; location.reload(); }, 800);
  },

  async saveColors() {
    const keys = ['pageBg','headerBg','navBg','navText','categoryBg','categoryItemBg','categoryItemText','bannerBg','bannerText','buttonBg','buttonText','addToCartBg','addToCartText','price','priceOld','priceNew','offerBg','offerText','wishlistActive','cartBadge','heading','link','inputBg','inputBorder','cardBg'];
    const colors = {};
    keys.forEach(k => {
      const text = document.getElementById('c-' + k + '-t');
      const pick = document.getElementById('c-' + k);
      if (text && text.value && text.value.trim()) colors[k] = text.value.trim();
      else if (pick && pick.value) colors[k] = pick.value;
    });

    if (this._hasAdminDataLayer()) {
      try {
        var current = this._settingsCache || {};
        var extra = current.extra || {};
        extra.colors = colors;
        var result = await window.AdminDataLayer.settings.update({ extra: extra });
        if (result && result.ok) {
          await this._loadSettings();
          Utils.toast('تم حفظ الألوان وتطبيقها على الموقع');
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) {
        this._showError('حدث خطأ غير متوقع.');
      }
    } else {
      Store.updateSettings({ colors });
      Utils.toast('تم حفظ الألوان وتطبيقها على الموقع');
    }
  },

  async resetColors() {
    if (!confirm('استعادة الألوان الافتراضية؟')) return;

    if (this._hasAdminDataLayer()) {
      try {
        var current = this._settingsCache || {};
        var extra = current.extra || {};
        extra.colors = {};
        var result = await window.AdminDataLayer.settings.update({ extra: extra });
        if (result && result.ok) {
          await this._loadSettings();
          Utils.toast('تمت استعادة الألوان الافتراضية');
          this.viewSettings();
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) {
        this._showError('حدث خطأ غير متوقع.');
      }
    } else {
      Store.updateSettings({ colors: {} });
      Utils.toast('تمت استعادة الألوان الافتراضية');
      this.viewSettings();
    }
  },

  async toggleDecorativeBackground() {
    const el = document.getElementById('s-deco-bg');
    if (!el) return;
    const enabled = el.checked;

    if (this._hasAdminDataLayer()) {
      try {
        var current = this._settingsCache || {};
        var extra = current.extra || {};
        extra.decorativeBackground = { enabled: enabled };
        var result = await window.AdminDataLayer.settings.update({ extra: extra });
        if (result && result.ok) {
          await this._loadSettings();
          try { document.body.setAttribute('data-deco-bg', enabled ? 'on' : 'off'); } catch (e) {}
          Utils.toast(enabled ? 'تم تفعيل الخلفية الزخرفية' : 'تم إخفاء الخلفية الزخرفية');
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) {
        this._showError('حدث خطأ غير متوقع.');
      }
    } else {
      Store.updateSettings({ decorativeBackground: { enabled } });
      try { document.body.setAttribute('data-deco-bg', enabled ? 'on' : 'off'); } catch (e) {}
      Utils.toast(enabled ? 'تم تفعيل الخلفية الزخرفية' : 'تم إخفاء الخلفية الزخرفية');
    }
  },

  async exportData() {
    var orders = Store.getOrders();
    var settings = Store.getSettings();
    var categories = Store.getCategories();
    var products = Store.getProducts();
    var coupons = Store.getCoupons();
    var deliveryAreas = Store.getDeliveryAreas();
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.orders.list();
        if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
          orders = this._normOrdersFromDB(r.data);
        }
      } catch (e) { /* fall through */ }
      try {
        var r2 = await window.AdminReadLayer.products.list();
        if (r2 && r2.ok && Array.isArray(r2.data)) {
          products = r2.data.map(this._normProduct);
        }
      } catch (e) { /* fall through */ }
      try {
        var r3 = await window.AdminReadLayer.categories.list();
        if (r3 && r3.ok && Array.isArray(r3.data)) {
          categories = r3.data.map(this._normCategory);
        }
      } catch (e) { /* fall through */ }
      try {
        var r4 = await window.AdminReadLayer.coupons.list();
        if (r4 && r4.ok && Array.isArray(r4.data)) {
          coupons = r4.data.map(this._normCouponFromDB);
        }
      } catch (e) { /* fall through */ }
      try {
        var r5 = await window.AdminReadLayer.deliveryAreas.list();
        if (r5 && r5.ok && Array.isArray(r5.data)) {
          deliveryAreas = r5.data.map(function (a) {
            return { id: a.id, name: a.name || '', shippingCost: Number(a.shipping_cost) || 0, active: a.active !== false, order: a.display_order || 0 };
          });
        }
      } catch (e) { /* fall through */ }
    }
    const data = JSON.stringify({ settings: settings, categories: categories, products: products, coupons: coupons, orders: orders, deliveryAreas: deliveryAreas }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ahmad-kamal-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    Utils.toast('تم تصدير البيانات');
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = e => {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          Store._saveDB(data);
          Utils.toast('تم استيراد البيانات بنجاح');
          this.route();
        } catch (err) { Utils.toast('ملف غير صالح', 'error'); }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  resetData() {
    if (confirm('سيتم حذف جميع البيانات واستعادة البيانات الافتراضية. هل أنت متأكد؟')) {
      Store.resetData();
      Utils.toast('تم إعادة التعيين', 'warn');
      this.route();
    }
  },

  /* ===== Modal ===== */
  openModal({ title, body, foot, lg = false }) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-foot').innerHTML = foot;
    document.getElementById('modal').classList.toggle('modal-lg', lg);
    document.getElementById('modal-backdrop').classList.add('active');
  },
  closeModal() { document.getElementById('modal-backdrop').classList.remove('active'); },

  openVariantLightbox(src) {
    this.openModal({
      title: 'معاينة الصورة',
      body: `<div style="text-align:center"><img src="${Utils.escapeUrl(src)}" style="max-width:100%;max-height:70vh;border-radius:8px;display:inline-block"></div>`,
      foot: '<button class="btn btn-primary" onclick="Admin.closeModal()">إغلاق</button>'
    });
  },

  /* ===== ANNOUNCEMENT BANNER ===== */
  async viewAnnouncement() {
    const s = this._settingsCache || await this._loadSettings() || Store.getSettings();
    const ann = s.announcement || {};
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>بانر الإعلان</h1><p>إدارة بانر الإعلان/الترويجي الذي يظهر أعلى المتجر</p></div></div>

      <div class="panel">
        <div class="panel-body">
          <div class="form-group">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="ann-enabled" ${ann.enabled ? 'checked' : ''}>
              <span style="font-weight:700">إظهار بانر الإعلان</span>
            </label>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">العنوان</label><input class="form-control" id="ann-title" value="${Utils.escapeHtml(ann.title || '')}"></div>
            <div class="form-group"><label class="form-label">لون الخلفية</label><div class="color-input"><input type="color" id="ann-color-pick" value="${Utils.escapeHtml(ann.bgColor || '#14b8a6')}"><input type="text" id="ann-color" value="${Utils.escapeHtml(ann.bgColor || '#14b8a6')}"></div></div>
          </div>
          <div class="form-group"><label class="form-label">النص / المحتوى</label><textarea class="form-control" id="ann-text" rows="2">${Utils.escapeHtml(ann.text || '')}</textarea></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">نص الزر</label><input class="form-control" id="ann-cta" value="${Utils.escapeHtml(ann.cta || '')}"></div>
            <div class="form-group"><label class="form-label">رابط الزر</label><input class="form-control" id="ann-link" value="${Utils.escapeHtml(ann.link || '#shop')}" placeholder="#shop"></div>
          </div>
          <div class="form-group">
            <label class="form-label">وجهة الزر (اختياري)</label>
            <select class="form-control" id="ann-linkType" onchange="Admin.onAnnLinkTypeChange()">
              <option value="">— افتراضي (يستخدم الرابط أعلاه) —</option>
              <option value="product" ${ann.linkType === 'product' ? 'selected' : ''}>منتج محدد</option>
              <option value="category" ${ann.linkType === 'category' ? 'selected' : ''}>فئة محددة</option>
              <option value="shop" ${ann.linkType === 'shop' ? 'selected' : ''}>جميع المنتجات</option>
              <option value="custom" ${ann.linkType === 'custom' ? 'selected' : ''}>رابط مخصص</option>
            </select>
          </div>
          <div class="form-row" id="ann-link-product" style="display:${ann.linkType === 'product' ? '' : 'none'}">
            <div class="form-group"><label class="form-label">اختر المنتج</label><select class="form-control" id="ann-linkProductId"><option value="">— اختر —</option>${(this._productsCache || []).map(p => `<option value="${p.id}" ${ann.linkProductId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('')}</select></div>
            <div class="form-group"></div>
          </div>
          <div class="form-row" id="ann-link-category" style="display:${ann.linkType === 'category' ? '' : 'none'}">
            <div class="form-group"><label class="form-label">اختر الفئة</label><select class="form-control" id="ann-linkCategoryId"><option value="">— اختر —</option>${(this._categoriesCache || []).map(c => `<option value="${c.id}" ${ann.linkCategoryId === c.id ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`).join('')}</select></div>
            <div class="form-group"></div>
          </div>
          <div class="form-row" id="ann-link-custom" style="display:${ann.linkType === 'custom' ? '' : 'none'}">
            <div class="form-group"><label class="form-label">الرابط المخصص (URL)</label><input class="form-control" id="ann-linkCustomUrl" value="${Utils.escapeHtml(ann.linkCustomUrl || '')}" placeholder="https://..." dir="ltr"></div>
            <div class="form-group"></div>
          </div>
          <div class="form-group">
            <label class="form-label">صورة (اختياري - لاستبدال الن بصورة كاملة)</label>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              <div id="ann-img-preview" style="width:120px;height:60px;border-radius:8px;overflow:hidden;background:var(--surface-2);border:1px solid var(--border)">
                ${ann.image ? `<img src="${Utils.escapeUrl(ann.image)}" style="width:100%;height:100%;object-fit:cover">` : '<div style="display:grid;place-items:center;height:100%;color:var(--text-3);font-size:12px">لا توجد صورة</div>'}
              </div>
              <input class="form-control" style="flex:1" id="ann-image" value="${Utils.escapeHtml(ann.image || '')}" placeholder="https://..." oninput="Admin.previewAnnImg()">
              <input type="file" id="ann-file" accept="image/*" style="display:none" onchange="Admin.uploadAnnImg(this)">
              <button class="btn btn-outline btn-sm" onclick="document.getElementById('ann-file').click()">${Utils.icon('plus', 12)} رفع</button>
              <button class="btn btn-outline btn-sm" onclick="document.getElementById('ann-image').value='';Admin.previewAnnImg()">${Utils.icon('trash', 12)}</button>
            </div>
          </div>
          <div style="margin-top:18px"><button class="btn btn-primary btn-lg" onclick="Admin.saveAnnouncement()">${Utils.icon('check', 16)} حفظ بانر الإعلان</button></div>
        </div>
      </div>
    `;
    document.getElementById('ann-color-pick')?.addEventListener('input', e => { document.getElementById('ann-color').value = e.target.value; });
  },

  previewAnnImg() {
    const url = document.getElementById('ann-image').value.trim();
    const p = document.getElementById('ann-img-preview');
    if (url) p.innerHTML = `<img src="${Utils.escapeUrl(url)}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<div style=color:var(--danger)>!</div>'">`;
    else p.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:var(--text-3);font-size:12px">لا توجد صورة</div>';
  },

  async uploadAnnImg(input) {
    const file = input.files[0];
    if (!file) return;
    const el = document.getElementById('ann-image');
    const oldVal = el.value;
    try {
      if (typeof window.SupabaseStorage === 'undefined' || !window.SupabaseStorage.uploadSettingsImage) {
        Utils.toast('نظام Storage غير جاهز', 'error'); return;
      }
      var r = await window.SupabaseStorage.uploadSettingsImage(file, 'settings/announcement');
      if (r && r.ok && r.url) {
        if (oldVal && oldVal !== r.url && typeof window.SupabaseStorage.extractStoragePath === 'function') {
          var p = window.SupabaseStorage.extractStoragePath(oldVal);
          if (p) { if (!this._pendingImageCleanup) this._pendingImageCleanup = []; this._pendingImageCleanup.push(p); }
        }
        el.value = r.url;
        Admin.previewAnnImg();
      } else {
        Utils.toast('فشل رفع صورة الإعلان: ' + (r && r.error || 'خطأ غير معروف'), 'error');
      }
    } catch (e) {
      console.error('uploadAnnImg error:', e);
      Utils.toast('حدث خطأ أثناء رفع صورة الإعلان', 'error');
      el.value = oldVal;
    }
  },

  async saveAnnouncement() {
    const data = {
      enabled: document.getElementById('ann-enabled').checked,
      title: document.getElementById('ann-title').value,
      text: document.getElementById('ann-text').value,
      cta: document.getElementById('ann-cta').value,
      link: document.getElementById('ann-link').value,
      linkType: document.getElementById('ann-linkType').value,
      linkProductId: document.getElementById('ann-linkProductId').value,
      linkCategoryId: document.getElementById('ann-linkCategoryId').value,
      linkCustomUrl: document.getElementById('ann-linkCustomUrl').value,
      image: document.getElementById('ann-image').value,
      bgColor: document.getElementById('ann-color').value
    };

    if (this._hasAdminDataLayer()) {
      try {
        var result = await window.AdminDataLayer.settings.update({ announcement: data });
        if (result && result.ok) {
          await this._loadSettings();
          if (this._pendingImageCleanup && this._pendingImageCleanup.length) {
            var urls = this._pendingImageCleanup.splice(0);
            for (var i = 0; i < urls.length; i++) { try { await window.SupabaseStorage.deleteFile(urls[i]); } catch (e) {} }
          }
          Utils.toast('تم حفظ بانر الإعلان');
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) {
        this._showError('حدث خطأ غير متوقع.');
      }
    } else {
      Store.updateSettings({ announcement: data });
      Utils.toast('تم حفظ بانر الإعلان');
    }
  },

  onAnnLinkTypeChange() {
    const sel = document.getElementById('ann-linkType');
    const t = sel ? sel.value : '';
    const groups = ['product', 'category', 'custom'];
    groups.forEach(g => {
      const row = document.getElementById('ann-link-' + g);
      if (row) row.style.display = (t === g) ? '' : 'none';
    });
  },

  /* ===== HOMEPAGE SECTIONS ===== */
  async viewSections() {
    const s = this._settingsCache || await this._loadSettings() || Store.getSettings();
    const sec = s.homepageSections || {};
    const sections = [
      { key: 'newArrivals', label: 'وصل حديثًا', desc: 'منتجات تم تحديدها كمنتجات جديدة' },
      { key: 'onSale', label: 'العروض والتخفيضات', desc: 'منتجات عليها تخفيض' },
      { key: 'featured', label: 'المنتجات المميزة', desc: 'منتجات تم تحديدها كمميزة' },
      { key: 'bestSellers', label: 'الأكثر مبيعًا', desc: 'يتم تحديدها تلقائياً حسب حجم المبيعات' }
    ];
    const products = this._productsCache || await this._loadProducts();
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>أقسام الصفحة الرئيسية</h1><p>تحكم بأقسام المنتجات المعروضة في الصفحة الرئيسية (إخفاء/إظهار، اختيار المنتجات، أو تركها فارغة للعرض التلقائي). لن يتم عرض القسم إذا كان فارغاً أو معطلاً.</p></div></div>
      ${sections.map(sd => {
        const data = sec[sd.key] || { enabled: true, title: '', subtitle: '', productIds: [] };
        const selectedIds = data.productIds || [];
        const helpText = sd.key === 'bestSellers'
          ? 'اتركها فارغة لعرض المنتجات الأكثر مبيعاً تلقائياً من الطلبات.'
          : 'اتركها فارغة لعرض تلقائي حسب النوع (جديد / تخفيض / مميز).';
        return `<div class="panel">
          <div class="panel-head">
            <h3>${sd.label}</h3>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="sec-${sd.key}-enabled" ${data.enabled !== false ? 'checked' : ''} onchange="Admin.saveSection('${sd.key}')">
              <span>مفعل</span>
            </label>
          </div>
          <div class="panel-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">عنوان القسم</label><input class="form-control" id="sec-${sd.key}-title" value="${Utils.escapeHtml(data.title || '')}" onblur="Admin.saveSection('${sd.key}')"></div>
              <div class="form-group"><label class="form-label">العنوان الفرعي</label><input class="form-control" id="sec-${sd.key}-sub" value="${Utils.escapeHtml(data.subtitle || '')}" onblur="Admin.saveSection('${sd.key}')"></div>
            </div>
            <div class="form-group">
              <label class="form-label">المنتجات المعروضة</label>
              <div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--surface-2)">
                ${products.map(p => `
                  <label style="display:flex;align-items:center;gap:10px;padding:6px 8px;cursor:pointer;border-radius:6px;${selectedIds.includes(p.id) ? 'background:var(--primary-soft)' : ''}">
                    <input type="checkbox" data-section="${sd.key}" data-pid="${p.id}" ${selectedIds.includes(p.id) ? 'checked' : ''} onchange="Admin.toggleSectionProduct('${sd.key}', '${p.id}', this.checked)">
                    <img src="${Utils.escapeUrl(this._resolveImg(p.images[0])) || ''}" style="width:36px;height:36px;border-radius:6px;object-fit:cover" loading="lazy">
                    <span style="flex:1;font-size:13px">${Utils.escapeHtml(p.name)}</span>
                    <span style="font-size:12px;color:var(--text-2)">${Utils.formatPrice(p.price)}</span>
                  </label>
                `).join('')}
              </div>
              <p class="form-help" style="margin-top:6px">${helpText} المحدد: <strong id="sec-${sd.key}-count">${selectedIds.length}</strong> منتج.</p>
            </div>
          </div>
        </div>`;
      }).join('')}
    `;
  },

  async toggleSectionProduct(key, pid, checked) {
    const sec = Store.getHomepageSection(key) || { productIds: [] };
    const ids = sec.productIds || [];
    const i = ids.indexOf(pid);
    if (checked && i < 0) ids.push(pid);
    if (!checked && i >= 0) ids.splice(i, 1);
    Store.updateHomepageSection(key, { productIds: ids });
    const el = document.getElementById(`sec-${key}-count`);
    if (el) el.textContent = ids.length;
    if (this._hasAdminDataLayer()) {
      try {
        var current = this._settingsCache || {};
        var homepageSections = current.homepageSections || {};
        homepageSections[key] = Object.assign({}, homepageSections[key] || {}, { productIds: ids });
        var result = await window.AdminDataLayer.settings.update({ homepage_sections: homepageSections });
        if (result && result.ok) { await this._loadSettings(); return; }
        console.error('[Admin] Section product toggle failed:', result && result.error);
      } catch (e) { console.error('[Admin] Section product toggle error:', e); }
    }
  },

  async saveSection(key) {
    const enabledEl = document.getElementById(`sec-${key}-enabled`);
    const secStore = Store.getHomepageSection(key) || {};
    const data = {
      enabled: enabledEl ? enabledEl.checked : true,
      title: document.getElementById(`sec-${key}-title`)?.value || '',
      subtitle: document.getElementById(`sec-${key}-sub`)?.value || '',
      productIds: secStore.productIds || []
    };
    if (this._hasAdminDataLayer()) {
      try {
        var current = this._settingsCache || {};
        var homepageSections = current.homepageSections || {};
        homepageSections[key] = data;
        var result = await window.AdminDataLayer.settings.update({ homepage_sections: homepageSections });
        if (result && result.ok) { await this._loadSettings(); return; }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.updateHomepageSection(key, data);
    }
  },

  /* ===== NAVIGATION ===== */
async viewNavigation() {
    const s = this._settingsCache || await this._loadSettings() || Store.getSettings();
    const items = (s.navigation || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>القائمة الرئيسية</h1><p>إدارة عناصر القائمة الرئيسية في المتجر. الحفظ تلقائي عند تعديل أي حقل. يوصى بالالتزام بالعناصر الافتراضية.</p></div></div>
      <button class="btn btn-primary" onclick="Admin.addNavItem()">${Utils.icon('plus', 16)} إضافة عنصر</button>
      <div class="panel">
        <div class="panel-body p0">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>الترتيب</th><th>التسمية</th><th>النوع</th><th>القيمة / الرابط</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
            <tbody>${items.map((n, i) => `<tr data-id="${n.id}">
              <td>${i + 1}</td>
              <td><input class="form-control" style="height:34px" value="${Utils.escapeHtml(n.label)}" data-field="label" data-id="${n.id}" onchange="Admin.saveNavItem('${n.id}')"></td>
              <td><select class="form-control" style="height:34px" data-field="type" data-id="${n.id}" onchange="Admin.saveNavItem('${n.id}')"><option value="route" ${n.type === 'route' ? 'selected' : ''}>صفحة داخلية</option><option value="url" ${n.type === 'url' ? 'selected' : ''}>رابط خارجي</option></select></td>
              <td><input class="form-control" style="height:34px" value="${Utils.escapeHtml(n.value)}" data-field="value" data-id="${n.id}" dir="ltr" onchange="Admin.saveNavItem('${n.id}')"></td>
              <td><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-field="active" data-id="${n.id}" ${n.active !== false ? 'checked' : ''} onchange="Admin.saveNavItem('${n.id}')"> <span style="font-size:12px">مفعل</span></label></td>
              <td><div class="actions">
                <button onclick="Admin.moveNav('${n.id}', -1)" title="رفع">↑</button>
                <button onclick="Admin.moveNav('${n.id}', 1)" title="إنزال">↓</button>
                <button onclick="Admin.saveNavItem('${n.id}')" class="success" title="حفظ">${Utils.icon('check', 14)}</button>
                <button onclick="Admin.deleteNavItem('${n.id}')" class="danger" title="حذف">${Utils.icon('trash', 14)}</button>
              </div></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  },

  async addNavItem() {
    if (this._hasAdminDataLayer()) {
      try {
        var s = this._settingsCache || {};
        var nav = (s.navigation || []).slice();
        var newId = 'n_' + Date.now();
        nav.push({ id: newId, label: 'عنصر جديد', type: 'route', value: 'home', order: nav.length + 1, active: true });
        var result = await window.AdminDataLayer.settings.update({ navigation: nav });
        if (result && result.ok) {
          await this._loadSettings();
          Utils.toast('تمت الإضافة');
          this.viewNavigation();
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.addNavItem({ label: 'عنصر جديد', type: 'route', value: 'home' });
      Utils.toast('تمت الإضافة');
      this.viewNavigation();
    }
  },

  async saveNavItem(id) {
    const patch = {};
    ['label', 'type', 'value', 'active'].forEach(f => {
      const el = document.querySelector(`[data-id="${id}"][data-field="${f}"]`);
      if (!el) return;
      if (f === 'active') patch[f] = el.checked;
      else patch[f] = el.value;
    });

    if (this._hasAdminDataLayer()) {
      try {
        var s = this._settingsCache || {};
        var nav = (s.navigation || []).map(n => n.id === id ? Object.assign({}, n, patch) : n);
        var result = await window.AdminDataLayer.settings.update({ navigation: nav });
        if (result && result.ok) {
          await this._loadSettings();
          Utils.toast('تم الحفظ');
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.updateNavItem(id, patch);
      Utils.toast('تم الحفظ');
    }
  },

  async deleteNavItem(id) {
    if (!confirm('حذف هذا العنصر؟')) return;
    if (this._hasAdminDataLayer()) {
      try {
        var s = this._settingsCache || {};
        var nav = (s.navigation || []).filter(n => n.id !== id);
        var result = await window.AdminDataLayer.settings.update({ navigation: nav });
        if (result && result.ok) {
          await this._loadSettings();
          Utils.toast('تم الحذف', 'warn');
          this.viewNavigation();
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.deleteNavItem(id);
      Utils.toast('تم الحذف', 'warn');
      this.viewNavigation();
    }
  },

  async moveNav(id, dir) {
    const s = this._settingsCache || await this._loadSettings() || Store.getSettings();
    const items = (s.navigation || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const i = items.findIndex(n => n.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    const reordered = items.map((n, idx) => Object.assign({}, n, { order: idx + 1 }));

    if (this._hasAdminDataLayer()) {
      try {
        var result = await window.AdminDataLayer.settings.update({ navigation: reordered });
        if (result && result.ok) {
          await this._loadSettings();
          this.viewNavigation();
          return;
        }
        this._showError(this._mapAuthError(result && result.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    } else {
      Store.reorderNav(items.map(n => n.id));
      this.viewNavigation();
    }
  },

  /* ===== DELIVERY AREAS ===== */
  async viewDelivery() {
    var areas = Store.getDeliveryAreas();
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.deliveryAreas.list();
        if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
          areas = r.data.map(function (a) {
            return { id: a.id, name: a.name || '', shippingCost: Number(a.shipping_cost) || 0, active: a.active !== false, order: a.display_order || 0 };
          });
        }
      } catch (e) { /* fall through to Store */ }
    }
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>مناطق التوصيل</h1><p>إدارة محافظات/مناطق التوصيل وأسعار الشحن لكل منطقة</p></div>
      <button class="btn btn-primary" onclick="Admin.addDeliveryArea()">${Utils.icon('plus', 16)} إضافة منطقة</button></div>
      <div class="panel">
        <div class="panel-body p0">
          <div class="table-wrap"><table class="data">
            <thead><tr><th>#</th><th>اسم المنطقة / المحافظة</th><th>سعر الشحن (دينار)</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
            <tbody>${areas.map((a, i) => `<tr data-id="${a.id}">
              <td>${i + 1}</td>
              <td><input class="form-control" style="height:36px" value="${Utils.escapeHtml(a.name)}" data-field="name" data-id="${a.id}"></td>
              <td><input class="form-control" type="number" min="0" step="0.5" style="height:36px;width:120px" value="${a.shippingCost}" data-field="shippingCost" data-id="${a.id}"></td>
              <td><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-field="active" data-id="${a.id}" ${a.active !== false ? 'checked' : ''}> <span style="font-size:12px">${a.active !== false ? 'مفعل' : 'معطل'}</span></label></td>
              <td><div class="actions">
                <button onclick="Admin.moveDelivery('${a.id}', -1)">↑</button>
                <button onclick="Admin.moveDelivery('${a.id}', 1)">↓</button>
                <button onclick="Admin.saveDelivery('${a.id}')" class="success">${Utils.icon('check', 14)} حفظ</button>
                <button onclick="Admin.deleteDelivery('${a.id}')" class="danger">${Utils.icon('trash', 14)}</button>
              </div></td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  },

  async addDeliveryArea() {
    if (this._hasAdminDataLayer()) {
      try {
        var r = await window.AdminDataLayer.deliveryAreas.create({ name: 'منطقة جديدة', shipping_cost: 3, active: true });
        if (r && r.ok) {
          Utils.toast('تمت الإضافة');
          this.viewDelivery();
          return;
        }
        this._showError(this._mapAuthError(r && r.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    }
    Store.addDeliveryArea({ name: 'منطقة جديدة', shippingCost: 3, active: true });
    Utils.toast('تمت الإضافة');
    this.viewDelivery();
  },

  async saveDelivery(id) {
    const patch = {};
    ['name', 'shippingCost', 'active'].forEach(f => {
      const el = document.querySelector(`[data-id="${id}"][data-field="${f}"]`);
      if (!el) return;
      if (f === 'active') patch[f] = el.checked;
      else if (f === 'shippingCost') patch[f] = +el.value || 0;
      else patch[f] = el.value;
    });
    console.log('[Admin] saveDelivery id:', id, 'patch:', patch);
    if (this._hasAdminDataLayer()) {
      try {
        var dbPatch = { name: patch.name, shipping_cost: patch.shippingCost, active: patch.active };
        console.log('[Admin] saveDelivery dbPatch:', dbPatch);
        var r = await window.AdminDataLayer.deliveryAreas.update(id, dbPatch);
        console.log('[Admin] saveDelivery result:', r);
        if (r && r.ok) {
          Utils.toast('تم الحفظ');
          this.viewDelivery();
          return;
        }
        this._showError(this._mapAuthError(r && r.error));
      } catch (e) { console.error('[Admin] saveDelivery error:', e); this._showError('حدث خطأ غير متوقع.'); }
    }
    Store.updateDeliveryArea(id, patch);
    Utils.toast('تم الحفظ');
  },

  async deleteDelivery(id) {
    if (!confirm('حذف هذه المنطقة؟')) return;
    if (this._hasAdminDataLayer()) {
      try {
        var r = await window.AdminDataLayer.deliveryAreas.delete(id);
        if (r && r.ok) {
          Utils.toast('تم الحذف', 'warn');
          this.viewDelivery();
          return;
        }
        this._showError(this._mapAuthError(r && r.error));
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    }
    Store.deleteDeliveryArea(id);
    Utils.toast('تم الحذف', 'warn');
    this.viewDelivery();
  },

  async moveDelivery(id, dir) {
    var areas = Store.getDeliveryAreas();
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.deliveryAreas.list();
        if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
          areas = r.data.map(function (a) {
            return { id: a.id, name: a.name || '', shippingCost: Number(a.shipping_cost) || 0, active: a.active !== false, order: a.display_order || 0 };
          });
        }
      } catch (e) { /* fall through to Store */ }
    }
    const i = areas.findIndex(a => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= areas.length) return;
    [areas[i], areas[j]] = [areas[j], areas[i]];
    if (this._hasAdminDataLayer()) {
      try {
        for (var k = 0; k < areas.length; k++) {
          await window.AdminDataLayer.deliveryAreas.update(areas[k].id, { display_order: k });
        }
        Utils.toast('تم الترتيب');
        this.viewDelivery();
        return;
      } catch (e) { this._showError('حدث خطأ غير متوقع.'); }
    }
    Store.reorderDeliveryAreas(areas.map(a => a.id));
    this.viewDelivery();
  },

  /* ===== INVOICE (standalone) ===== */
  async viewInvoice() {
    const s = this._settingsCache || await this._loadSettings() || Store.getSettings();
    const t = (s.invoice && s.invoice.thermal) || {};
    var orders = Store.getOrders();
    if (this._hasAdminReadLayer()) {
      try {
        var r = await window.AdminReadLayer.orders.list();
        if (r && r.ok && Array.isArray(r.data) && r.data.length > 0) {
          orders = this._normOrdersFromDB(r.data);
        }
      } catch (e) { /* fall through to Store */ }
    }
    document.getElementById('admin-content').innerHTML = `
      <div class="page-head"><div><h1>الفاتورة</h1><p>إعدادات الفاتورة الحرارية وطباعة الفواتير</p></div></div>

      <div class="panel">
        <div class="panel-head"><h3>إعدادات الفاتورة الحرارية</h3></div>
        <div class="panel-body">
          <div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="inv-t-enabled" ${t.enabled ? 'checked' : ''} onchange="Admin.toggleThermalEnabled()"> <span>تفعيل الطباعة الحرارية</span></label></div>
          <p class="muted" style="font-size:13px">عند التفعيل، تستخدم الطباعة تنسيق الفاتورة الحرارية المخصص للطابعة الحرارية. عند الإيقاف، تبقى الفاتورة العادية الحالية كما هي.</p>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">مقاس الورق الحراري</label>
              <select class="form-control" id="inv-t-paper" onchange="Admin.saveInvoiceSettings()">
                <option value="58mm" ${t.paperSize === '58mm' ? 'selected' : ''}>58mm</option>
                <option value="80mm" ${(t.paperSize || '80mm') === '80mm' ? 'selected' : ''}>80mm</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">رابط QR</label>
              <input class="form-control" id="inv-t-qr" value="${this.esc(t.qrUrl || '')}" placeholder="https://wa.me/..." dir="ltr" oninput="Admin.onInvoiceQrInput()">
              <p class="form-help">سيتم ترميز هذا الرابط في رمز QR أسفل الفاتورة الحرارية. اتركه فارغاً لإخفاء الرمز.</p>
            </div>
          </div>
          <div id="inv-t-qr-preview" style="margin-top:10px;display:flex;align-items:center;gap:10px"></div>
          <div style="margin-top:14px"><button class="btn btn-primary" onclick="Admin.saveInvoiceSettings()">${Utils.icon('check', 16)} حفظ الإعدادات</button></div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>طباعة فواتير اليوم</h3></div>
        <div class="panel-body">
          <p class="muted" style="font-size:13px">يطبع جميع طلبات اليوم في مستند واحد. يستخدم تنسيق الفاتورة الحرارية إذا كان مفعّلاً، وإلا الفاتورة العادية.</p>
          <button class="btn btn-primary" onclick="Admin.printInvoicesToday()">${Utils.icon('invoice', 16)} طباعة فواتير اليوم (${orders.filter(o => o.date === new Date().toISOString().slice(0, 10)).length})</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h3>اختيار الفواتير</h3></div>
        <div class="panel-body">
          <p class="muted" style="font-size:13px">حدد الفواتير التي تريد طباعتها ثم اضغط طباعة. لن يتم تضمين أي فاتورة غير محددة.</p>
          <div class="table-wrap" style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:10px">
            <table class="data">
              <thead><tr><th style="width:40px"><input type="checkbox" id="inv-select-all" onchange="Admin.toggleAllInvoiceSelection(this.checked)"></th><th>رقم الطلب</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th></tr></thead>
              <tbody>${orders.map(o => `<tr><td><input type="checkbox" class="inv-select" value="${o.id}"></td><td><strong>${o.id}</strong></td><td>${Utils.formatDate(o.date)}</td><td>${Utils.escapeHtml(o.customer.name)}</td><td>${Utils.formatPrice(o.total)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
          <div style="margin-top:12px"><button class="btn btn-primary" onclick="Admin.printInvoicesSelected()">${Utils.icon('invoice', 16)} طباعة الفواتير المحددة</button></div>
        </div>
      </div>
    `;
    setTimeout(() => this.refreshInvoiceQrPreview(), 50);
  },

  toggleThermalEnabled() { this.saveInvoiceSettings(); },
  onInvoiceQrInput() { this.refreshInvoiceQrPreview(); },

  /* ====== MIGRATE LOCAL ORDERS TO SUPABASE ====== */
  async migrateLocalOrdersToSupabase() {
    if (!this._hasAdminDataLayer()) {
      this._showError('Supabase data layer not available.');
      return;
    }
    var client = window.__supabase && window.__supabase.client;
    if (!client) {
      this._showError('Supabase client not available.');
      return;
    }
    var localOrders = Store.getOrders();
    if (!localOrders || localOrders.length === 0) {
      Utils.toast('لا توجد طلبات محلية للنقل');
      return;
    }

    var existingR = await client.from('orders').select('order_number');
    var existingNumbers = [];
    if (existingR && existingR.data) {
      existingNumbers = existingR.data.map(function(r) { return r.order_number; });
    }

    var toMigrate = localOrders.filter(function(o) {
      return existingNumbers.indexOf(o.id) === -1;
    });

    if (toMigrate.length === 0) {
      Utils.toast('جميع الطلبات موجودة مسبقًا في Supabase');
      return;
    }

    var summary = 'سيتم نقل ' + toMigrate.length + ' طلب:\n\n';
    toMigrate.forEach(function(o) {
      summary += o.id + ' — ' + (o.items ? o.items.length : 0) + ' منتج\n';
    });
    summary += '\nهل تريد المتابعة؟';

    if (!confirm(summary)) return;

    var migrated = 0;
    var failed = 0;
    var errors = [];

    for (var i = 0; i < toMigrate.length; i++) {
      var o = toMigrate[i];
      try {
        var orderUuid = crypto.randomUUID ? crypto.randomUUID() : ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));

        var validStatuses = ['ordered', 'preparing', 'out_for_delivery', 'delivered', 'cancelled'];
        var orderStatus = validStatuses.indexOf(o.status) >= 0 ? o.status : 'ordered';

        var orderRow = {
          id: orderUuid,
          order_number: o.id,
          customer_name: o.customer ? o.customer.name : '',
          customer_phone: o.customer ? o.customer.phone : '',
          customer_address: o.customer ? o.customer.address : '',
          customer_city: o.customer ? o.customer.city : '',
          customer_extra: {},
          subtotal: Number(o.subtotal) || 0,
          discount: Number(o.discount) || 0,
          shipping_cost: Number(o.shipping) || 0,
          total: Number(o.total) || 0,
          coupon_code: o.coupon || null,
          notes: o.notes || '',
          payment_method: o.paymentMethod || 'cod',
          status: orderStatus,
          created_at: o.date ? o.date + 'T12:00:00Z' : new Date().toISOString(),
          updated_at: o.date ? o.date + 'T12:00:00Z' : new Date().toISOString()
        };

        var insertR = await client.from('orders').insert(orderRow).select();
        if (insertR && insertR.error) {
          failed++;
          errors.push(o.id + ': ' + (insertR.error.message || 'insert failed'));
          continue;
        }

        if (!insertR || !insertR.data || !insertR.data.length) {
          failed++;
          errors.push(o.id + ': insert returned no data');
          continue;
        }

        var itemsOk = 0;
        var itemsFail = 0;
        if (o.items && o.items.length) {
          for (var j = 0; j < o.items.length; j++) {
            var it = o.items[j];
            var itemRow = {
              order_id: orderUuid,
              product_id: it.productId || null,
              variant_id: it.variantId || null,
              product_name_snapshot: it.name || '',
              variant_label_snapshot: it.variant || '',
              image_snapshot: it.image || '',
              unit_price: Number(it.price) || 0,
              qty: Number(it.qty) || 1,
              line_total: (Number(it.price) || 0) * (Number(it.qty) || 1),
              options_snapshot: it.options ? it.options.map(function(opt) { return { type: opt.type || opt.name || '', value: opt.value || '' }; }) : [],
              display_order: j
            };
            var itemInsertR = await client.from('order_items').insert(itemRow);
            if (itemInsertR && itemInsertR.error) {
              itemsFail++;
            } else {
              itemsOk++;
            }
          }
        }

        var verifyR = await client.from('order_items').select('id').eq('order_id', orderUuid);
        var verifyCount = (verifyR && verifyR.data) ? verifyR.data.length : 0;
        var expectedCount = o.items ? o.items.length : 0;

        if (verifyCount === expectedCount) {
          migrated++;
        } else {
          failed++;
          errors.push(o.id + ': verification failed (expected ' + expectedCount + ' items, got ' + verifyCount + ')');
        }
      } catch (e) {
        failed++;
        errors.push(o.id + ': ' + (e.message || 'exception'));
      }
    }

    var msg = 'النتيجة: ' + migrated + ' نُقل بنجاح، ' + failed + ' فشل';
    if (errors.length > 0) {
      msg += '\n\nالأخطاء:\n' + errors.join('\n');
    }
    console.log('[Migration] Result:', msg);
    alert(msg);

    if (migrated > 0) {
      this.viewOrders();
    }
  }
};

if (typeof window !== 'undefined') window.Admin = Admin;
document.addEventListener('DOMContentLoaded', () => Admin.init());
