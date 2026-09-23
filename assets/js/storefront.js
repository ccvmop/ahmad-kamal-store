/* =========================================================
   Storefront App
   ========================================================= */

const App = {
  page: 'home',
  searchQuery: '',
  filters: { category: null, minPrice: 0, maxPrice: 5000, sort: 'newest' },
  currentProduct: null,
  selectedVariants: {},
  _ppp: 24,
  _shopPage: 1,
  _shopTotal: 0,
  _filterPage: 1,
  _filterTotal: 0,
  _wishPage: 1,
  _wishTotal: 0,
  qty: 1,
  activeSlide: 0,
  slideInterval: null,
  customerPhone: localStorage.getItem('anwar_customer_phone') || '',
  theme: localStorage.getItem('anwar_theme') === 'dark' ? 'dark' : 'light',

  getBestOffer(product) {
    if (!product) return null;
    try { return Store.getBestOfferForProduct(product) || null; } catch (e) { return null; }
  },
  getEffectivePrice(product) {
    const offer = this.getBestOffer(product);
    if (offer && offer.final < (Number(product.price) || 0)) return offer.final;
    return Number(product.price) || 0;
  },
  // Read the real saved price field from a product or variant object.
  // Centralized so the cart, checkout, and invoice all read the same source of truth.
  // Returns a finite number; does not substitute any hardcoded fallback amount.
  readPrice(item) {
    if (item == null) return 0;
    const n = Number(item.price);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  },
  getOriginalPrice(product) { return Number(product && product.price) || 0; },

  resolveHeroHref(slide) {
    if (!slide) return '#shop';
    if (slide.linkType === 'product' && slide.linkProductId) return '#product-' + slide.linkProductId;
    if (slide.linkType === 'category' && slide.linkCategoryId) return '#category-' + slide.linkCategoryId;
    if (slide.linkType === 'shop') return '#shop';
    if (slide.linkType === 'custom' && slide.linkCustomUrl) return slide.linkCustomUrl;
    if (slide.link && slide.link !== '#shop') return slide.link;
    return '#shop';
  },

  resolveAnnHref(ann) {
    if (!ann) return '#shop';
    if (ann.linkType === 'product' && ann.linkProductId) return '#product-' + ann.linkProductId;
    if (ann.linkType === 'category' && ann.linkCategoryId) return '#category-' + ann.linkCategoryId;
    if (ann.linkType === 'shop') return '#shop';
    if (ann.linkType === 'custom' && ann.linkCustomUrl) return ann.linkCustomUrl;
    return ann.link || '#shop';
  },
  formatOfferEnd(offer) {
    if (!offer || !offer.offer) return '';
    const d = new Date(offer.offer.endAt);
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  },

  _resolveImg(val) {
    if (!val) return '';
    if (typeof window.SupabaseStorage === 'object' && typeof window.SupabaseStorage.resolveImageUrl === 'function') {
      return window.SupabaseStorage.resolveImageUrl(val);
    }
    return val;
  },

  async init() {
    // Load Supabase data in the correct order:
    // 1. Settings + Categories + Delivery Areas in parallel (independent)
    // 2. Products after categories (needs category UUID→legacy map)
    // 3. Then render
    try {
      await Promise.all([
        this._loadSettingsFromSupabase(),
        this._loadCategoriesFromSupabase(),
        this._loadDeliveryAreasFromSupabase(),
        this._loadOffersFromSupabase(),
        this._loadCouponsFromSupabase()
      ]);
      await this._loadProductsFromSupabase();
    } catch (e) {
      console.error('[Storefront] Init error:', e);
    }
    this.applySettings();
    this.renderLayout();
    this.bindGlobal();
    this.route();
    window.addEventListener('hashchange', () => this.route());
  },

  _loadSettingsFromSupabase: async function () {
    try {
      if (typeof window === 'undefined') return;
      var dl = window.StoreDataLayer && window.StoreDataLayer.settings;
      if (!dl || typeof dl.getStoreSettingsCached !== 'function') {
        console.log('[Storefront] Settings: StoreDataLayer not available, using localStorage');
        return;
      }
      var res = await Promise.race([
        dl.getStoreSettingsCached(),
        new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, data: null, error: 'timeout' }); }, 3000); })
      ]);
      if (res && res.ok && res.data) {
        var merged;
        try { merged = Store.getSettings() || {}; } catch (e) { merged = {}; }
        var d = res.data;
        if (d.storeName != null)         merged.storeName = d.storeName;
        if (d.storeNameEn != null)      merged.storeNameEn = d.storeNameEn;
        if (d.tagline != null)           merged.tagline = d.tagline;
        if (d.logo != null)              merged.logo = d.logo;
        if (d.currency != null)           merged.currency = d.currency;
        if (d.currencyCode != null)       merged.currencyCode = d.currencyCode;
        if (d.primaryColor != null)       merged.primaryColor = d.primaryColor;
        if (d.accentColor != null)        merged.accentColor = d.accentColor;
        if (d.contactEmail != null)       merged.contactEmail = d.contactEmail;
        if (d.contactPhone != null)       merged.contactPhone = d.contactPhone;
        if (d.whatsapp != null)           merged.whatsapp = d.whatsapp;
        if (d.address != null)            merged.address = d.address;
        if (d.social) {
          if (d.social.facebook)  merged.facebook  = d.social.facebook;
          if (d.social.instagram) merged.instagram = d.social.instagram;
          if (d.social.twitter)   merged.twitter   = d.social.twitter;
          if (d.social.tiktok)    merged.tiktok    = d.social.tiktok;
          if (d.social.snapchat)  merged.snapchat  = d.social.snapchat;
          if (d.social.youtube)   merged.youtube   = d.social.youtube;
        }
        if (d.freeShippingThreshold != null) merged.freeShippingThreshold = d.freeShippingThreshold;
        if (d.defaultShippingCost != null)    merged.defaultShippingCost    = d.defaultShippingCost;
        if (d.mapsUrl != null)        merged.mapsUrl = d.mapsUrl;
        if (d.footer)                 merged.footer  = d.footer;
        if (d.heroSlides != null)        merged.heroSlides = d.heroSlides;
        if (d.announcement != null)      merged.announcement = d.announcement;
        if (d.homepageSections != null)  merged.homepageSections = d.homepageSections;
        if (d.navigation != null)        merged.navigation = d.navigation;
        if (d.floatingWhatsapp != null)  merged.floatingWhatsapp = d.floatingWhatsapp;
        if (d.extra != null)             merged.extra = d.extra;
        try { Store.updateSettings(merged); } catch (e) {}
        this._remoteMergedSettings = merged;
        console.log('[Storefront] Settings loaded from Supabase');
      } else {
        console.log('[Storefront] Settings: Supabase unavailable, using localStorage. Reason:', res && res.error);
      }
    } catch (e) {
      console.error('[Storefront] Settings load error:', e);
    }
  },

  _loadOffersFromSupabase: async function () {
    try {
      if (typeof window === 'undefined') return;
      var dl = window.StoreDataLayer && window.StoreDataLayer.offers;
      if (!dl || typeof dl.getActiveOffers !== 'function') return;
      var res = await Promise.race([
        dl.getActiveOffers(),
        new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, data: null, error: 'timeout' }); }, 3000); })
      ]);
      if (!(res && res.ok && Array.isArray(res.data))) {
        console.log('[Storefront] Offers: first attempt failed, retrying in 2s. Reason:', res && res.error);
        await new Promise(function (r) { setTimeout(r, 2000); });
        dl = window.StoreDataLayer && window.StoreDataLayer.offers;
        if (dl && typeof dl.getActiveOffers === 'function') {
          res = await Promise.race([
            dl.getActiveOffers(),
            new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, data: null, error: 'timeout' }); }, 8000); })
          ]);
        }
      }
      try { console.log('[DEBUG-OFFER] final result: ok=', res && res.ok, 'data=', res && res.data && res.data.length); } catch(e) {}
      if (res && res.ok && Array.isArray(res.data)) {
        var db = Store._loadDB();
        db.offers = res.data;
        Store._saveDB(db);
        console.log('[Storefront] Offers loaded from Supabase:', res.data.length);
      }
    } catch (e) {
      console.error('[Storefront] Offers load error:', e);
    }
  },

  _loadCouponsFromSupabase: async function () {
    try {
      if (typeof window === 'undefined') return;
      var localCoupons = [];
      try { var db = Store._loadDB(); localCoupons = db.coupons || []; } catch (e) {}
      var localCodes = {};
      localCoupons.forEach(function (c) { localCodes[(c.code || '').toLowerCase()] = true; });
      var client = null;
      try { var s = window.__supabase; if (s && s.client) client = s.client; } catch (e) {}
      if (!client) return;
      var res = await client.from('coupons')
        .select('id, code, discount_type, value, min_order, max_uses, used, expires_at, active')
        .eq('active', true);
      if ((res.error || !Array.isArray(res.data)) && window.__supabase && typeof window.__supabase.reconnect === 'function') {
        console.log('[Storefront] Coupons: first attempt failed, retrying. Reason:', res && res.error);
        window.__supabase.reconnect();
        await new Promise(function (r) { setTimeout(r, 2000); });
        try { client = window.__supabase && window.__supabase.client; } catch (e) {}
        if (client && client.from) {
          res = await client.from('coupons')
            .select('id, code, discount_type, value, min_order, max_uses, used, expires_at, active')
            .eq('active', true);
        }
      }
      if (res.error || !Array.isArray(res.data)) {
        console.log('[Storefront] Coupons: Supabase unavailable, using localStorage. Reason:', res && res.error);
        return;
      }
      try { console.log('[DEBUG-COUPON] result: ok=', res && !res.error, 'data_count=', res && res.data && res.data.length, 'error=', res && res.error); } catch(e) {}
      var db2 = Store._loadDB();
      if (!db2.coupons) db2.coupons = [];
      res.data.forEach(function (c) {
        var key = (c.code || '').toLowerCase();
        var mapped = {
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
        if (localCodes[key]) {
          var idx = db2.coupons.findIndex(function (x) { return (x.code || '').toLowerCase() === key; });
          if (idx >= 0) db2.coupons[idx] = mapped;
        } else {
          db2.coupons.push(mapped);
        }
      });
      Store._saveDB(db2);
      console.log('[Storefront] Coupons loaded from Supabase:', res.data.length);
    } catch (e) {
      console.error('[Storefront] Coupons load error:', e);
    }
  },

  _loadProductsFromSupabase: async function () {
    try {
      if (typeof window === 'undefined') return;
      var dl = window.StoreDataLayer && window.StoreDataLayer.products;
      if (!dl || typeof dl.getProducts !== 'function') {
        console.log('[Storefront] Products: StoreDataLayer not available, using localStorage');
        return;
      }
      var res = await Promise.race([
        dl.getProducts(),
        new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, data: null, error: 'timeout' }); }, 3000); })
      ]);
      if (res && res.ok && Array.isArray(res.data) && res.data.length > 0) {
        var catLegacyMap = {};
        try {
          var supaMap = window.StoreDataLayer && window.StoreDataLayer._categoryMap;
          if (supaMap) {
            Object.keys(supaMap).forEach(function (k) { catLegacyMap[k] = supaMap[k]; });
          }
        } catch (e) {}
        if (Object.keys(catLegacyMap).length === 0) {
          try {
            var localCats = Store.getCategories() || [];
            localCats.forEach(function (c) { if (c.id) catLegacyMap[c.id] = c.id; });
          } catch (e) {}
        }
        var mapped = res.data.map(function (p) {
          var imgs = Array.isArray(p.images) ? p.images : (p.images ? [p.images] : []);
          return {
            id: p.legacy_id || p.id,
            uuid: p.id,
            sku: p.sku || '',
            name: p.name || '',
            shortDescription: p.short_description || '',
            description: p.description || '',
            categoryId: (function () {
              if (catLegacyMap[p.category_id]) return catLegacyMap[p.category_id];
              return p.category_id || '';
            })(),
            categoryUuid: p.category_id || '',
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
            createdAt: p.created_at || '',
            updatedAt: p.updated_at || '',
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
        });
        try { Store.updateProducts(mapped); } catch (e) {}
        console.log('[Storefront] Products loaded from Supabase:', mapped.length);
      } else {
        console.log('[Storefront] Products: Supabase unavailable or empty, using localStorage. Reason:', res && res.error);
      }
    } catch (e) {
      console.error('[Storefront] Products load error:', e);
    }
  },

  _loadCategoriesFromSupabase: async function () {
    try {
      if (typeof window === 'undefined') return;
      var dl = window.StoreDataLayer && window.StoreDataLayer.categories;
      if (!dl || typeof dl.getCategories !== 'function') {
        console.log('[Storefront] Categories: StoreDataLayer not available, using localStorage');
        return;
      }
      var res = await Promise.race([
        dl.getCategories(),
        new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, data: null, error: 'timeout' }); }, 3000); })
      ]);
      if (!(res && res.ok && Array.isArray(res.data) && res.data.length > 0)) {
        console.log('[Storefront] Categories: first attempt failed, retrying in 2s. Reason:', res && res.error);
        await new Promise(function (r) { setTimeout(r, 2000); });
        dl = window.StoreDataLayer && window.StoreDataLayer.categories;
        if (dl && typeof dl.getCategories === 'function') {
          res = await Promise.race([
            dl.getCategories(),
            new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, data: null, error: 'timeout' }); }, 8000); })
          ]);
        }
      }
      try { console.log('[DEBUG-CAT] final result: ok=', res && res.ok, 'data=', res && res.data && res.data.length, 'localStorage_cats=', Store.getCategories() && Store.getCategories().length); } catch(e) {}
      if (res && res.ok && Array.isArray(res.data) && res.data.length > 0) {
        var catMap = {};
        var uuidToLegacy = {};
        var mapped = res.data.map(function (c) {
          var lid = c.legacy_id || c.id;
          catMap[c.id] = lid;
          uuidToLegacy[c.id] = lid;
          return {
            id: lid,
            name: c.name || '',
            description: c.description || '',
            image: c.image_url || '',
            icon: c.icon || '📦',
            parent: null,
            _parentUuid: c.parent_id || null,
            order: Number(c.display_order) || 0,
            active: c.active !== false
          };
        });
        mapped.forEach(function (c) {
          if (c._parentUuid && uuidToLegacy[c._parentUuid]) c.parent = uuidToLegacy[c._parentUuid];
        });
        try {
          if (!window.StoreDataLayer) window.StoreDataLayer = {};
          window.StoreDataLayer._categoryMap = catMap;
        } catch (e) {}
        try { Store.updateCategories(mapped); } catch (e) {}
        console.log('[Storefront] Categories loaded from Supabase:', mapped.length);
      } else {
        console.log('[Storefront] Categories: Supabase unavailable, using localStorage. Reason:', res && res.error);
      }
    } catch (e) {
      console.error('[Storefront] Categories load error:', e);
    }
  },

  _loadDeliveryAreasFromSupabase: async function () {
    try {
      if (typeof window === 'undefined') return;
      var dl = window.StoreDataLayer && window.StoreDataLayer.deliveryAreas;
      if (!dl || typeof dl.getDeliveryAreas !== 'function') {
        console.log('[Storefront] DeliveryAreas: StoreDataLayer not available, using localStorage');
        return;
      }
      var res = await Promise.race([
        dl.getDeliveryAreas(),
        new Promise(function (resolve) { setTimeout(function () { resolve({ ok: false, data: null, error: 'timeout' }); }, 3000); })
      ]);
      if (res && res.ok && Array.isArray(res.data) && res.data.length > 0) {
        var mapped = res.data.map(function (a) {
          return {
            id: a.legacy_id || a.id,
            name: a.name || '',
            shippingCost: Number(a.shipping_cost) || 0,
            active: a.active !== false,
            order: Number(a.display_order) || 0
          };
        });
        try {
          var db = Store._loadDB();
          if (!db.settings) db.settings = {};
          db.deliveryAreas = mapped;
          Store._saveDB(db);
        } catch (e) {}
        console.log('[Storefront] DeliveryAreas loaded from Supabase:', mapped.length);
      } else {
        console.log('[Storefront] DeliveryAreas: Supabase unavailable or empty, using localStorage. Reason:', res && res.error);
      }
    } catch (e) {
      console.error('[Storefront] DeliveryAreas load error:', e);
    }
  },

  applySettings() {
    // Apply CSS properties from the merged settings (Supabase overlay).
    // All other call sites read from Store.getSettings() which now includes
    // the Supabase values written back to localStorage above.
    var remote = (this && this._remoteMergedSettings) ? this._remoteMergedSettings : null;
    var s = remote || Store.getSettings();
    document.documentElement.style.setProperty('--primary', s.primaryColor || '#c9a86a');
    document.documentElement.style.setProperty('--accent', s.accentColor || '#1a1a1a');
    this.applyColors(s);
    this.applyTheme();
    this.applyDecorativeBackground(s);
  },

  applyDecorativeBackground(s) {
    if (!s) s = Store.getSettings();
    const enabled = s.decorativeBackground?.enabled !== false;
    document.body.setAttribute('data-deco-bg', enabled ? 'on' : 'off');
  },

  applyColors(s) {
    if (!s) s = Store.getSettings();
    const c = s.colors || {};
    const root = document.documentElement.style;
    const set = (k, v) => { if (v) root.setProperty(k, v); };
    set('--c-page-bg', c.pageBg);
    set('--c-header-bg', c.headerBg);
    set('--c-nav-bg', c.navBg);
    set('--c-nav-text', c.navText);
    set('--c-category-bg', c.categoryBg);
    set('--c-category-item-bg', c.categoryItemBg);
    set('--c-category-item-text', c.categoryItemText);
    set('--c-banner-bg', c.bannerBg);
    set('--c-banner-text', c.bannerText);
    set('--c-button-bg', c.buttonBg);
    set('--c-button-text', c.buttonText);
    set('--c-add-to-cart-bg', c.addToCartBg);
    set('--c-add-to-cart-text', c.addToCartText);
    set('--c-price', c.price);
    set('--c-price-old', c.priceOld);
    set('--c-price-new', c.priceNew);
    set('--c-offer-bg', c.offerBg);
    set('--c-offer-text', c.offerText);
    set('--c-wishlist-active', c.wishlistActive);
    set('--c-cart-badge', c.cartBadge);
    set('--c-heading', c.heading);
    set('--c-link', c.link);
    set('--c-input-bg', c.inputBg);
    set('--c-input-border', c.inputBorder);
    set('--c-card-bg', c.cardBg);
  },

  applyTheme() {
    const t = this.theme || 'light';
    document.documentElement.setAttribute('data-theme', t);
  },

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('anwar_theme', this.theme); } catch (e) {}
    this.applyTheme();
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.innerHTML = this.theme === 'dark' ? Utils.icon('sun', 20) : Utils.icon('moon', 20);
  },

  renderLayout() {
    const s = Store.getSettings();
    const cart = Store.getCart();
    const cartCount = cart.reduce((s, i) => s + i.qty, 0);
    const f = s.footer || {};
    const logoHtml = s.logo ? `<img src="${Utils.escapeUrl(s.logo)}" alt="${Utils.escapeHtml(s.storeName)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : (s.storeName || 'A').charAt(0);

    document.body.innerHTML = `
      <header class="header">
        <div class="container header-inner">
          <a href="#home" class="brand">
            <div class="brand-logo">${logoHtml}</div>
            <div>
              ${Utils.escapeHtml(s.storeName)}
              <small>${Utils.escapeHtml(s.storeNameEn || '')}</small>
            </div>
          </a>
          <div class="search-wrap">
            <input type="text" id="search-input" placeholder="ابحث عن منتج، فئة، علامة تجارية..." autocomplete="off">
            <button class="search-btn">${Utils.icon('search', 16)}</button>
            <div class="search-results" id="search-results"></div>
          </div>
          <div class="header-actions">
            <a href="#myorders" class="icon-btn hide-mob" title="طلباتي">${Utils.icon('package', 20)}</a>
            <a href="#wishlist" class="icon-btn" title="المفضلة">${Utils.icon('heart', 20)}<span class="badge" id="wishlist-count" style="display:${Store.getWishlist().length ? 'grid' : 'none'}">${Store.getWishlist().length}</span></a>
            <button class="icon-btn" id="theme-toggle" title="تبديل الوضع" onclick="App.toggleTheme()">${this.theme === 'dark' ? Utils.icon('sun', 20) : Utils.icon('moon', 20)}</button>
            <button class="icon-btn" id="cart-btn" title="السلة">${Utils.icon('cart', 20)}<span class="badge" id="cart-count" style="display:${cartCount ? 'grid' : 'none'}">${cartCount}</span></button>
          </div>
        </div>
      </header>

      <nav class="nav">
        <div class="container">
          <div class="nav-inner" id="main-nav"></div>
        </div>
      </nav>

      <div id="announcement-container"></div>

      <main id="main-content"></main>

      <footer class="footer">
        <div class="container">
          <div class="footer-grid" style="grid-template-columns:1.4fr 1fr 1.2fr">
            <div>
              ${(f.showName !== false) ? `<div class="brand" style="color:#fff;margin-bottom:16px">
                <div class="brand-logo">${logoHtml}</div>
                <div>${Utils.escapeHtml(s.storeName)}<small style="color:rgba(255,255,255,.5)">${Utils.escapeHtml(s.storeNameEn || '')}</small></div>
              </div>` : ''}
              ${(f.showDescription !== false) ? `<p class="footer-about">${Utils.escapeHtml(f.aboutText || s.tagline || '')}</p>` : ''}
              ${(f.showSocial !== false) ? `<div class="social-row">
                ${s.facebook ? `<a href="${Utils.escapeUrl(s.facebook)}" target="_blank" title="فيسبوك">${Utils.icon('facebook', 16)}</a>` : ''}
                ${s.instagram ? `<a href="${Utils.escapeUrl(s.instagram)}" target="_blank" title="انستغرام">${Utils.icon('instagram', 16)}</a>` : ''}
                ${s.twitter ? `<a href="${Utils.escapeUrl(s.twitter)}" target="_blank" title="X">${Utils.icon('twitter', 16)}</a>` : ''}
                ${s.tiktok ? `<a href="${Utils.escapeUrl(s.tiktok)}" target="_blank" title="تيك توك">${Utils.icon('tiktok', 16)}</a>` : ''}
                ${s.snapchat ? `<a href="${Utils.escapeUrl(s.snapchat)}" target="_blank" title="سناب شات">${Utils.icon('snapchat', 16)}</a>` : ''}
                ${s.youtube ? `<a href="${Utils.escapeUrl(s.youtube)}" target="_blank" title="يوتيوب">${Utils.icon('youtube', 16)}</a>` : ''}
              </div>` : ''}
            </div>
            <div>
              <h4>روابط سريعة</h4>
              <div class="footer-list">
                <a href="#home">الرئيسية</a>
                <a href="#offers">العروض</a>
                <a href="#new">وصل حديثًا</a>
                <a href="#shop">جميع المنتجات</a>
                <a href="#myorders">طلباتي</a>
                <a href="#wishlist">المفضلة</a>
              </div>
            </div>
            <div>
              <h4>تواصل معنا</h4>
              <div class="footer-list">
                ${(f.showPhone !== false && s.contactPhone) ? `<a href="tel:${encodeURIComponent(s.contactPhone)}">${Utils.icon('phone', 14)} <span style="margin-right:6px">${Utils.escapeHtml(s.contactPhone)}</span></a>` : ''}
                ${(f.showWhatsapp !== false && s.whatsapp) ? `<a href="https://wa.me/${encodeURIComponent(s.whatsapp)}" target="_blank">${Utils.icon('whatsapp', 14)} <span style="margin-right:6px">واتساب</span></a>` : ''}
                ${(f.showAddress !== false && s.address) ? `<a>${Utils.icon('location', 14)} <span style="margin-right:6px">${Utils.escapeHtml(s.address)}</span></a>` : ''}
                ${(f.showLocation !== false && s.mapsUrl) ? `<a href="${Utils.escapeUrl(s.mapsUrl)}" target="_blank" rel="noopener">${Utils.icon('location', 14)} <span style="margin-right:6px">موقعنا</span></a>` : ''}
                ${s.contactEmail ? `<a href="mailto:${encodeURIComponent(s.contactEmail)}">${Utils.icon('mail', 14)} <span style="margin-right:6px">${Utils.escapeHtml(s.contactEmail)}</span></a>` : ''}
              </div>
            </div>
          </div>
          <div class="copyright">${f.copyright || ('© ' + new Date().getFullYear() + ' ' + Utils.escapeHtml(s.storeName) + '. جميع الحقوق محفوظة.')}</div>
        </div>
      </footer>

      <div class="drawer-backdrop" id="drawer-backdrop"></div>
      <div class="drawer" id="cart-drawer">
        <div class="drawer-head">
          <h3>سلة المشتريات</h3>
          <button class="icon-btn" id="cart-close">${Utils.icon('close', 18)}</button>
        </div>
        <div class="drawer-body" id="cart-body"></div>
        <div class="drawer-foot" id="cart-foot"></div>
      </div>

      ${s.floatingWhatsapp?.enabled ? `
      <a href="https://wa.me/${encodeURIComponent(s.whatsapp || '')}?text=${encodeURIComponent(s.floatingWhatsapp.message || '')}" target="_blank" class="floating-whatsapp" title="تواصل معنا عبر واتساب">
        <span class="pulse"></span>
        ${Utils.icon('whatsapp', 28)}
        <span class="tooltip-fw">تواصل معنا عبر واتساب</span>
      </a>` : ''}

      <div class="toast-wrap"></div>
    `;

    // Render navigation from settings (5 fixed items)
    const navItems = Store.getNavigation();
    document.getElementById('main-nav').innerHTML = navItems.map(n => {
      const href = n.type === 'route' ? '#' + n.value : (n.value || '#');
      return `<a href="${href}" data-nav="${n.value}">${Utils.escapeHtml(n.label)}</a>`;
    }).join('');

    // Render announcement banner
    this.renderAnnouncement();

    document.getElementById('cart-btn').addEventListener('click', () => this.openCart());
    document.getElementById('cart-close').addEventListener('click', () => this.closeCart());
    document.getElementById('drawer-backdrop').addEventListener('click', () => this.closeCart());

    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', Utils.debounce((e) => this.handleSearch(e.target.value), 250));
    searchInput.addEventListener('focus', () => { if (searchInput.value) this.handleSearch(searchInput.value); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) document.getElementById('search-results').classList.remove('active'); });
  },

  bindGlobal() {},

  route() {
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    const hash = location.hash.slice(1) || 'home';
    const qIdx = hash.indexOf('?');
    const hashPath = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
    const hashQuery = qIdx >= 0 ? hash.slice(qIdx + 1) : '';
    const params = new URLSearchParams(hashQuery);
    const isAdmin = params.get('admin') === '1';
    const parts = hashPath.split('/');
    const first = parts[0];
    const dashIdx = first.indexOf('-');
    const page = dashIdx > 0 ? first.slice(0, dashIdx) : first;
    const id = dashIdx > 0 ? first.slice(dashIdx + 1) : (parts[1] || null);
    document.querySelectorAll('[data-nav]').forEach(a => a.classList.remove('active'));
    const navEl = document.querySelector(`[data-nav="${page}"]`);
    if (navEl) navEl.classList.add('active');

    if (page === 'home') { this._shopPage = 1; this._filterPage = 1; this._wishPage = 1; this.renderHome(); }
    else if (page === 'shop') {
      var sq = params.get('q') || '';
      this.filters.search = sq;
      this._shopPage = 1;
      this.renderShop();
    }
    else if (page === 'offers') { this._filterPage = 1; this.renderOffers(); }
    else if (page === 'new') { this._filterPage = 1; this.renderNew(); }
    else if (page === 'category' && id) { this._shopPage = 1; this.renderCategory(id); }
    else if (page === 'product' && id) this.renderProduct(id);
    else if (page === 'cart') this.openCart();
    else if (page === 'checkout') this.renderCheckout();
    else if (page === 'track') this.renderTrack();
    else if (page === 'myorders') this.renderMyOrders();
    else if (page === 'wishlist') { this._wishPage = 1; this.renderWishlist(); }
    else if (page === 'order' && id) this.renderOrderDetail(id, isAdmin);
    else if (page === 'about') this.renderAbout();
    else if (page === 'contact') this.renderContact();
    else this.renderHome();
  },

  /* ====== HOME ====== */
  renderHome() {
    const s = Store.getSettings();
    const cats = Store.getCategories().filter(c => !c.parent && c.active !== false);
    const slides = Store.getHeroSlides();

    const sec = s.homepageSections || {};
    const stats = Store.getStats();
    const bestSellers = (stats.topProducts || []).map(t => t.product).filter(Boolean);
    const sectionData = [
      { key: 'featured', filter: { featured: true, active: true }, enabled: sec.featured?.enabled !== false, title: sec.featured?.title || 'منتجات مميزة', subtitle: sec.featured?.subtitle || 'مختارة خصيصاً لك', productIds: sec.featured?.productIds || [] },
      { key: 'newArrivals', filter: { isNew: true, active: true }, enabled: sec.newArrivals?.enabled !== false, title: sec.newArrivals?.title || 'وصل حديثًا', subtitle: sec.newArrivals?.subtitle || 'أحدث المنتجات في متجرنا', productIds: sec.newArrivals?.productIds || [] },
      { key: 'onSale', filter: { onSale: true, active: true }, enabled: sec.onSale?.enabled !== false, title: sec.onSale?.title || 'عروض وتخفيضات', subtitle: sec.onSale?.subtitle || 'وفر أكثر مع تخفيضاتنا الحصرية', productIds: sec.onSale?.productIds || [] },
      { key: 'bestSellers', enabled: sec.bestSellers?.enabled !== false, title: sec.bestSellers?.title || 'الأكثر مبيعًا', subtitle: sec.bestSellers?.subtitle || 'المنتجات الأكثر طلباً من عملائنا', productIds: sec.bestSellers?.productIds || [], fixedProducts: bestSellers }
    ];

    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="container">
        ${slides.length ? `
        <div class="hero">
          <div class="hero-slides" id="hero-slides">
            ${slides.map((slide, i) => `
              <div class="hero-slide ${i === 0 ? 'active' : ''}" data-slide="${i}" style="${slide.image ? `background-image:url('${Utils.escapeUrl(slide.image)}')` : ''}">
                <div>
                  <h1>${Utils.escapeHtml(slide.title)}</h1>
                  <p>${Utils.escapeHtml(slide.subtitle)}</p>
                  <a href="${Utils.escapeUrl(this.resolveHeroHref(slide))}" class="hero-cta">${Utils.escapeHtml(slide.cta || 'تسوق')} ${Utils.icon('arrow_right', 16)}</a>
                </div>
              </div>
            `).join('')}
          </div>
          ${slides.length > 1 ? `<div class="hero-dots" id="hero-dots">
            ${slides.map((_, i) => `<button data-dot="${i}" class="${i === 0 ? 'active' : ''}"></button>`).join('')}
          </div>` : ''}
        </div>` : ''}

        <section class="section">
          <div class="section-head">
            <div>
              <div class="section-title"><small>تسوق حسب الفئة</small>الفئات الرئيسية</div>
            </div>
            <a href="#shop" class="section-link">عرض الكل ${Utils.icon('arrow_right', 14)}</a>
          </div>
          <div class="cats-grid">
            ${cats.map(c => `
              <a href="#category-${c.id}" class="cat-card">
                <div class="cat-icon">${c.image ? `<img src="${Utils.escapeUrl(c.image)}" alt="${Utils.escapeHtml(c.name)}" loading="lazy" width="60" height="60">` : (c.icon || '📦')}</div>
                <div class="cat-text">
                  <div class="cat-name">${Utils.escapeHtml(c.name)}</div>
                  <div class="cat-count">${Store.getProducts({ categoryId: c.id, active: true }).length} منتج</div>
                </div>
              </a>
            `).join('')}
          </div>
        </section>

        ${sectionData.map(sd => {
          if (!sd.enabled) return '';
          let products;
          if (sd.productIds.length) {
            products = sd.productIds.map(id => Store.getProduct(id)).filter(Boolean);
          } else if (sd.fixedProducts) {
            products = sd.fixedProducts;
          } else {
            products = Store.getProducts(sd.filter).slice(0, 8);
          }
          if (!products.length) return '';
          return this.renderProductSection(sd.title, sd.subtitle, products, '#' + (sd.key === 'featured' ? 'shop' : sd.key === 'newArrivals' ? 'new' : sd.key === 'bestSellers' ? 'shop' : 'offers'));
        }).join('')}
      </div>
    `;
    if (slides.length > 1) this.startSlider();
  },

  renderAnnouncement() {
    const s = Store.getSettings();
    const ann = s.announcement;
    const container = document.getElementById('announcement-container');
    if (!container) return;
    if (!ann || !ann.enabled) { container.innerHTML = ''; return; }
    const hasImage = ann.image && ann.image.trim();
    container.innerHTML = `
      <div class="announcement-bar ${hasImage ? 'ann-image-mode' : ''}" style="${!hasImage && ann.bgColor ? `background:${ann.bgColor}` : ''}">
        ${hasImage ? `
          <div class="ann-inner">
            <img src="${Utils.escapeUrl(ann.image)}" alt="${Utils.escapeHtml(ann.title || '')}">
            <div class="ann-overlay">
              <div>
                ${ann.title ? `<h3>${Utils.escapeHtml(ann.title)}</h3>` : ''}
                ${ann.text ? `<p>${Utils.escapeHtml(ann.text)}</p>` : ''}
              </div>
              ${ann.cta ? `<a href="${Utils.escapeUrl(this.resolveAnnHref(ann))}">${Utils.escapeHtml(ann.cta)}</a>` : ''}
            </div>
          </div>
        ` : `
          <div class="container">
            ${ann.image ? `<img src="${Utils.escapeUrl(ann.image)}" class="ann-image" alt="">` : ''}
            <div class="ann-text">${ann.title ? `<strong>${Utils.escapeHtml(ann.title)}</strong> — ` : ''}${Utils.escapeHtml(ann.text || '')}</div>
            ${ann.cta ? `<a href="${Utils.escapeUrl(this.resolveAnnHref(ann))}" class="ann-cta">${Utils.escapeHtml(ann.cta)}</a>` : ''}
          </div>
        `}
      </div>
    `;
  },

  renderOffers() {
    var allProducts = Store.getProducts({ active: true });
    var products = allProducts.filter(function(p) {
      return Store.getActiveOffersForProduct(p).length > 0;
    });
    this._filterTotal = products.length;
    if (!this._filterPage || this._filterPage < 1) this._filterPage = 1;
    var pageProducts = products.slice(0, this._filterPage * this._ppp);
    var hasMore = pageProducts.length < products.length;
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2);margin-bottom:16px">
          <a href="#home" style="color:var(--text-2)">الرئيسية</a>
          <span>/</span>
          <span style="color:var(--text)">العروض والتخفيضات</span>
        </div>
        <h1 style="font-size:30px;font-weight:800;margin-bottom:8px">العروض والتخفيضات</h1>
        <p class="muted" style="margin-bottom:24px">وفر أكثر مع تخفيضاتنا الحصرية • ${products.length} منتج</p>
        ${pageProducts.length ? `<div class="products-grid">${pageProducts.map(p => this.productCard(p)).join('')}</div>` : '<div class="empty-state"><div style="font-size:60px">📭</div><h3>لا توجد منتجات في هذا القسم</h3></div>'}
        ${hasMore ? `<div style="text-align:center;margin-top:24px"><button class="btn btn-outline" onclick="App.loadMoreFilter()">تحميل المزيد (${products.length - pageProducts.length} متبقي)</button></div>` : ''}
      </div>
    `;
  },

  renderNew() {
    this.renderProductListByFilter('new', 'وصل حديثًا', 'أحدث المنتجات في متجرنا', { isNew: true, active: true });
  },

  renderProductListByFilter(key, title, subtitle, filter) {
    const allProducts = Store.getProducts(filter);
    this._filterTotal = allProducts.length;
    if (!this._filterPage || this._filterPage < 1) this._filterPage = 1;
    const products = allProducts.slice(0, this._filterPage * this._ppp);
    const hasMore = products.length < allProducts.length;
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2);margin-bottom:16px">
          <a href="#home" style="color:var(--text-2)">الرئيسية</a>
          <span>/</span>
          <span style="color:var(--text)">${title}</span>
        </div>
        <h1 style="font-size:30px;font-weight:800;margin-bottom:8px">${title}</h1>
        <p class="muted" style="margin-bottom:24px">${subtitle} • ${allProducts.length} منتج</p>
        ${products.length ? `<div class="products-grid">${products.map(p => this.productCard(p)).join('')}</div>` : '<div class="empty-state"><div style="font-size:60px">📭</div><h3>لا توجد منتجات في هذا القسم</h3></div>'}
        ${hasMore ? `<div style="text-align:center;margin-top:24px"><button class="btn btn-outline" onclick="App.loadMoreFilter()">تحميل المزيد (${allProducts.length - products.length} متبقي)</button></div>` : ''}
      </div>
    `;
  },

  loadMoreFilter() { this._filterPage++; this.route(); },

  renderProductSection(title, subtitle, products, link) {
    if (!products.length) return '';
    return `
      <section class="section">
        <div class="section-head">
          <div class="section-title"><small>${subtitle}</small>${title}</div>
          <a href="${link}" class="section-link">عرض الكل ${Utils.icon('arrow_right', 14)}</a>
        </div>
        <div class="products-grid">${products.map(p => this.productCard(p)).join('')}</div>
      </section>
    `;
  },

  productCard(p) {
    const cat = Store.getCategory(p.categoryId);
    const offer = this.getBestOffer(p);
    const finalPrice = offer ? offer.final : (Number(p.price) || 0);
    const originalPrice = Number(p.price) || 0;
    const oldStrike = (p.oldPrice && p.oldPrice > originalPrice) ? p.oldPrice : null;
    const showOld = offer ? (offer.original > finalPrice) : (oldStrike && oldStrike > finalPrice);
    const offerBadge = offer ? `<span class="badge-pill badge-sale">-${Math.round((1 - finalPrice / offer.original) * 100)}%</span>` : '';
    const inWishlist = Store.getWishlist().includes(p.id);
    return `
      <div class="product-card">
        <div class="product-media">
          <a href="#product-${p.id}" onclick="event.preventDefault();location.hash='product-${p.id}'"><img src="${Utils.escapeUrl(this._resolveImg(p.images[0])) || 'https://via.placeholder.com/400x400?text=No+Image'}" alt="${Utils.escapeHtml(p.name)}" loading="lazy" width="400" height="400"></a>
          <div class="product-badges">
            ${p.isNew ? '<span class="badge-pill badge-new">جديد</span>' : ''}
            ${offerBadge}
            ${p.featured ? '<span class="badge-pill badge-hot">مميز</span>' : ''}
            ${offer ? '<span class="badge-pill badge-hot" style="background:var(--danger)">عرض</span>' : ''}
          </div>
          <div class="product-quick">
            <button class="quick-btn wishlist ${inWishlist ? 'active' : ''}" onclick="App.toggleWishlist('${p.id}')" title="إضافة للمفضلة">${inWishlist ? Utils.icon('heart_filled', 14) : Utils.icon('heart', 14)}</button>
          </div>
        </div>
        <a href="#product-${p.id}" class="product-body" onclick="event.preventDefault();location.hash='product-${p.id}'">
          <span class="product-cat">${cat ? Utils.escapeHtml(cat.name) : 'منتجات'}</span>
          <h3 class="product-title">${Utils.escapeHtml(p.name)}</h3>
          <div class="product-rating">
            <span class="stars">${Utils.stars(p.rating)}</span>
            <span>(${p.reviews || 0})</span>
          </div>
          <div class="product-foot">
            <div class="product-price">
              <span class="price-now" style="${showOld ? 'color:var(--danger)' : ''}">${Utils.formatPrice(finalPrice)}</span>
              ${showOld ? `<span class="price-old">${Utils.formatPrice(offer ? offer.original : oldStrike)}</span>` : ''}
            </div>
          </div>
        </a>
      </div>
    `;
  },

  startSlider() {
    clearInterval(this.slideInterval);
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.hero-dots button');
    if (!slides.length) return;
    dots.forEach((d, i) => d.addEventListener('click', () => this.goToSlide(i)));
    this.slideInterval = setInterval(() => {
      this.activeSlide = (this.activeSlide + 1) % slides.length;
      this.goToSlide(this.activeSlide);
    }, 5000);
  },
  goToSlide(i) {
    this.activeSlide = i;
    document.querySelectorAll('.hero-slide').forEach((s, idx) => s.classList.toggle('active', idx === i));
    document.querySelectorAll('.hero-dots button').forEach((d, idx) => d.classList.toggle('active', idx === i));
  },

  /* ====== SEARCH ====== */
  handleSearch(q) {
    const box = document.getElementById('search-results');
    if (!q || q.length < 2) { box.classList.remove('active'); return; }
    const allResults = Store.getProducts({ search: q, active: true });
    const results = allResults.slice(0, 6);
    if (!results.length) {
      box.innerHTML = '<div style="padding:20px;text-align:center;color:#9a9a9a">لا توجد نتائج</div>';
    } else {
      box.innerHTML = results.map(p => {
        const eff = this.getEffectivePrice(p);
        const onOffer = eff < p.price;
        return `
        <a href="#product-${p.id}" class="search-result-item" onclick="document.getElementById('search-results').classList.remove('active')">
          <img src="${Utils.escapeUrl(this._resolveImg(p.images[0])) || ''}" loading="lazy" width="44" height="44">
          <div style="flex:1">
            <div style="font-weight:600;font-size:14px">${Utils.escapeHtml(p.name)}</div>
            <div style="font-size:13px;font-weight:700;color:${onOffer ? 'var(--danger)' : 'var(--primary-dark)'}">${Utils.formatPrice(eff)}${onOffer ? ` <span style="color:var(--text-3);text-decoration:line-through;font-weight:500">${Utils.formatPrice(p.price)}</span>` : ''}</div>
          </div>
        </a>
      `;}).join('') + `<a href="#shop?q=${encodeURIComponent(q)}" class="search-result-item" style="justify-content:center;color:var(--primary);font-weight:600;font-size:13px" onclick="document.getElementById('search-results').classList.remove('active')">عرض جميع النتائج (${allResults.length})</a>`;
    }
    box.classList.add('active');
  },

  /* ====== SHOP / CATEGORY ====== */
  renderShop() { this.renderProductList(null); },
  renderCategory(catId) {
    this.renderProductList(catId);
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    document.documentElement.style.scrollBehavior = '';
  },

  renderProductList(catId) {
    const cat = catId ? Store.getCategory(catId) : null;
    const subCats = catId ? Store.getCategories().filter(c => c.parent === catId && c.active !== false) : [];
    const allProducts = Store.getProducts({
      categoryId: catId,
      search: this.filters.search,
      minPrice: this.filters.minPrice,
      maxPrice: this.filters.maxPrice,
      sort: this.filters.sort,
      active: true
    });
    this._shopTotal = allProducts.length;
    if (!this._shopPage || this._shopPage < 1) this._shopPage = 1;
    const products = allProducts.slice(0, this._shopPage * this._ppp);
    const hasMore = products.length < allProducts.length;

    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2);margin-bottom:16px">
          <a href="#home" style="color:var(--text-2)">الرئيسية</a>
          <span>/</span>
          <span style="color:var(--text)">${cat ? Utils.escapeHtml(cat.name) : 'المتجر'}</span>
        </div>
        <h1 style="font-size:30px;font-weight:800;margin-bottom:8px">${cat ? Utils.escapeHtml(cat.name) : 'جميع المنتجات'}</h1>
        <p class="muted" style="margin-bottom:24px">${allProducts.length} منتج متاح</p>

        <div class="shop-wrap no-sidebar">
          <div>
            <div class="shop-toolbar">
              <span class="result-count">عرض ${products.length} من ${allProducts.length} منتج</span>
              <select id="sort-select" onchange="App.changeSort(this.value)">
                <option value="newest" ${this.filters.sort === 'newest' ? 'selected' : ''}>الأحدث</option>
                <option value="popular" ${this.filters.sort === 'popular' ? 'selected' : ''}>الأكثر مبيعاً</option>
                <option value="rating" ${this.filters.sort === 'rating' ? 'selected' : ''}>الأعلى تقييماً</option>
                <option value="price-asc" ${this.filters.sort === 'price-asc' ? 'selected' : ''}>السعر: الأقل أولاً</option>
                <option value="price-desc" ${this.filters.sort === 'price-desc' ? 'selected' : ''}>السعر: الأعلى أولاً</option>
              </select>
            </div>
            ${products.length ? `<div class="products-grid">${products.map(p => this.productCard(p)).join('')}</div>` : '<div class="empty-state"><div style="font-size:60px">📭</div><h3>لا توجد منتجات</h3><p>جرب تعديل معايير البحث</p></div>'}
            ${hasMore ? `<div style="text-align:center;margin-top:24px"><button class="btn btn-outline" onclick="App.loadMoreShop()">تحميل المزيد (${allProducts.length - products.length} متبقي)</button></div>` : ''}
          </div>
        </div>
      </div>
    `;
  },

  loadMoreShop() { this._shopPage++; this.route(); },

  applyPriceFilter() {
    this.filters.minPrice = +document.getElementById('min-price').value || 0;
    this.filters.maxPrice = +document.getElementById('max-price').value || 99999;
    this._shopPage = 1;
    this.route();
  },
  changeSort(v) { this.filters.sort = v; this._shopPage = 1; this.route(); },

  /* ====== PRODUCT DETAIL ====== */
  renderProduct(id) {
    const p = Store.getProduct(id);
    if (!p) { document.getElementById('main-content').innerHTML = '<div class="container empty-state"><h3>المنتج غير موجود</h3></div>'; return; }
    const cat = Store.getCategory(p.categoryId);
    const related = Store.getProducts({ categoryId: p.categoryId, active: true }).filter(x => x.id !== p.id).slice(0, 4);
    this.currentProduct = p;
    this.selectedVariants = {};
    this.qty = 1;
    const optionTypes = [
      { key: 'color', label: 'اللون' },
      { key: 'size', label: 'القياس' },
      { key: 'dimension', label: 'الحجم' },
      { key: 'weight', label: 'الوزن' }
    ];
    const groupedOptions = optionTypes
      .map(t => ({ ...t, values: p.variants.filter(v => v.type === t.key) }))
      .filter(g => g.values.length > 0);
    const inWishlist = Store.getWishlist().includes(p.id);

    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px">
        <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2);margin-bottom:16px">
          <a href="#home" style="color:var(--text-2)">الرئيسية</a>
          <span>/</span>
          ${cat ? `<a href="#category-${cat.id}" style="color:var(--text-2)">${Utils.escapeHtml(cat.name)}</a><span>/</span>` : ''}
          <span style="color:var(--text)">${Utils.escapeHtml(p.name)}</span>
        </div>

        <div class="pd-wrap">
          <div class="pd-gallery">
            <div class="pd-main"><img id="pd-main-img" src="${Utils.escapeUrl(this._resolveImg(p.images[0])) || 'https://via.placeholder.com/600x600?text=No+Image'}"></div>
            ${p.images.length > 1 ? `<div class="pd-thumbs">${p.images.map((img, i) => `<div class="pd-thumb ${i === 0 ? 'active' : ''}" onclick="App.changeImg('${Utils.escapeUrl(this._resolveImg(img))}', this)"><img src="${Utils.escapeUrl(this._resolveImg(img))}" loading="lazy" width="60" height="60"></div>`).join('')}</div>` : ''}
          </div>
          <div class="pd-info">
            <span class="product-cat">${cat ? Utils.escapeHtml(cat.name) : 'منتجات'} | SKU: ${p.sku || '—'}</span>
            <h1>${Utils.escapeHtml(p.name)}</h1>
            <div class="pd-meta">
              <div class="pd-rating">${Utils.stars(p.rating)} <span>${p.rating || 0} (${p.reviews || 0} تقييم)</span></div>
              <span class="tag tag-green">${p.stock > 0 ? 'متوفر' : 'غير متوفر'}</span>
            </div>
            <div class="pd-price-box" id="pd-price-box">
              ${(() => {
                const offer = App.getBestOffer(p);
                if (offer) {
                  const pct = Math.round((1 - offer.final / offer.original) * 100);
                  return `<span class="pd-price" style="color:var(--danger)">${Utils.formatPrice(offer.final)}</span>
                          <span class="pd-price-old">${Utils.formatPrice(offer.original)}</span>
                          <span class="pd-discount">خصم ${pct}٪</span>
                          <div class="muted" style="font-size:12px;margin-top:6px">⏰ ينتهي العرض في ${App.formatOfferEnd(offer)}</div>`;
                }
                return `<span class="pd-price">${Utils.formatPrice(p.price)}</span>
                        ${p.oldPrice > p.price ? `<span class="pd-price-old">${Utils.formatPrice(p.oldPrice)}</span><span class="pd-discount">خصم ${Math.round((1 - p.price / p.oldPrice) * 100)}%</span>` : ''}`;
              })()}
            </div>
            <p class="pd-desc">${Utils.escapeHtml(p.description)}</p>

            ${groupedOptions.map(g => g.values.some(v => v.image) ? `
            <div class="pd-section">
              <div class="pd-section-title">${g.label}: <span id="opt-name-${g.key}">اختر ${g.label}</span></div>
              <div class="variant-image-list">
                ${g.values.map(v => {
                  var vImg = Utils.escapeUrl(this._resolveImg(v.image));
                  var escImg = vImg ? vImg.replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';
                  var escVal = Utils.escapeHtml(v.value || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                  return `
                  <button class="variant-img-btn ${v.stock <= 0 ? 'disabled' : ''}" data-variant="${v.id}" data-type="${g.key}" onclick="App.selectOption('${v.id}', '${g.key}', '${escVal}', '${escImg}')" ${v.stock <= 0 ? 'disabled' : ''} title="${Utils.escapeHtml(v.value)}">
                    ${vImg ? `<img src="${vImg}" alt="${Utils.escapeHtml(v.value)}" loading="lazy" width="56" height="56">` : (v.swatch ? `<span class="swatch" style="background:${v.swatch}"></span>` : '')}
                    <span class="variant-img-label">${Utils.escapeHtml(v.value)}</span>
                  </button>`;
                }).join('')}
              </div>
            </div>
            ` : `
            <div class="pd-section">
              <div class="pd-section-title">${g.label}: <span id="opt-name-${g.key}">اختر ${g.label}</span></div>
              <div class="variant-list">
                ${g.values.map(v => {
                  var escImg2 = v.image ? (typeof this._resolveImg === 'function' ? this._resolveImg(v.image) : v.image).replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';
                  var escVal2 = Utils.escapeHtml(v.value || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
                  return `
                  <button class="variant-btn" data-variant="${v.id}" data-type="${g.key}" onclick="App.selectOption('${v.id}', '${g.key}', '${escVal2}', '${escImg2}')" ${v.stock <= 0 ? 'disabled' : ''}>
                    ${v.swatch ? `<span class="swatch" style="background:${v.swatch}"></span>` : ''}
                    ${Utils.escapeHtml(v.value)}
                  </button>`;
                }).join('')}
              </div>
            </div>
            `).join('')}

            <div class="pd-section">
              <div class="pd-section-title">الكمية</div>
              <div class="qty-control">
                <button onclick="App.changeQty(-1)">−</button>
                <input type="text" id="qty-input" value="1" readonly>
                <button onclick="App.changeQty(1)">+</button>
              </div>
            </div>

            <div class="pd-actions">
              <button class="btn btn-primary btn-lg" onclick="App.addToCartDetail()" style="flex:1">${Utils.icon('cart', 18)} أضف للسلة</button>
              <button id="pd-wishlist-btn" class="btn btn-outline btn-lg icon-btn pd-wishlist ${inWishlist ? 'active' : ''}" onclick="App.toggleWishlist('${p.id}')" title="${inWishlist ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}"><svg width="20" height="20" viewBox="0 0 24 24" fill="${inWishlist ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"></path></svg></button>
            </div>

            <div class="pd-features">
              <div class="pd-feature">${Utils.icon('check', 16)} توصيل سريع خلال 24 ساعة</div>
              <div class="pd-feature">${Utils.icon('check', 16)} الدفع عند الاستلام</div>
            </div>
          </div>
        </div>

        ${related.length ? `
        <section class="section">
          <div class="section-head">
            <div class="section-title"><small>منتجات ذات صلة</small>قد يعجبك أيضاً</div>
          </div>
          <div class="products-grid">${related.map(rp => this.productCard(rp)).join('')}</div>
        </section>
        ` : ''}
      </div>
    `;
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
      document.documentElement.style.scrollBehavior = '';
    });
  },

  changeImg(src, el) {
    document.getElementById('pd-main-img').src = src;
    document.querySelectorAll('.pd-thumb').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
  },

  selectOption(id, type, value, image) {
    const v = this.currentProduct.variants.find(x => x.id === id);
    if (!v || v.stock <= 0) return;
    var resolvedImage = this._resolveImg(v.image || '');
    this.selectedVariants[type] = { id, type, value, price: v.price, stock: v.stock, image: resolvedImage };
    const btn = document.querySelector(`[data-variant="${id}"]`);
    if (btn) {
      btn.parentElement.querySelectorAll('.variant-btn, .variant-img-btn').forEach(b => {
        const bType = b.dataset.type;
        if (bType && bType === type) b.classList.remove('active');
      });
      btn.classList.add('active');
    }
    const nameEl = document.getElementById('opt-name-' + type);
    if (nameEl) nameEl.textContent = value;
    if (resolvedImage) {
      const main = document.getElementById('pd-main-img');
      if (main) main.src = resolvedImage;
      document.querySelectorAll('.pd-thumb').forEach(t => t.classList.remove('active'));
    }
    this._updatePriceDisplay();
  },

  _updatePriceDisplay() {
    const p = this.currentProduct;
    if (!p) return;
    const box = document.getElementById('pd-price-box');
    if (!box) return;
    const offer = this.getBestOffer(p);
    const selected = Object.values(this.selectedVariants);
    const variantPrice = selected.length ? selected[0].price : 0;
    if (offer) {
      const pct = Math.round((1 - offer.final / offer.original) * 100);
      box.innerHTML = `<span class="pd-price" style="color:var(--danger)">${Utils.formatPrice(offer.final)}</span>
        <span class="pd-price-old">${Utils.formatPrice(offer.original)}</span>
        <span class="pd-discount">خصم ${pct}٪</span>
        <div class="muted" style="font-size:12px;margin-top:6px">⏰ ينتهي العرض في ${this.formatOfferEnd(offer)}</div>`;
    } else if (variantPrice > 0) {
      box.innerHTML = `<span class="pd-price">${Utils.formatPrice(variantPrice)}</span>`;
    } else {
      box.innerHTML = `<span class="pd-price">${Utils.formatPrice(p.price)}</span>
        ${p.oldPrice > p.price ? `<span class="pd-price-old">${Utils.formatPrice(p.oldPrice)}</span><span class="pd-discount">خصم ${Math.round((1 - p.price / p.oldPrice) * 100)}%</span>` : ''}`;
    }
  },

  changeQty(d) {
    const p = this.currentProduct;
    const selected = Object.values(this.selectedVariants);
    const maxStock = selected.length ? selected[0].stock : (p ? p.stock : 999);
    const max = maxStock > 0 ? maxStock : 999;
    this.qty = Math.max(1, Math.min(max, this.qty + d));
    document.getElementById('qty-input').value = this.qty;
  },

  getOptionTypeLabels() {
    return { color: 'اللون', size: 'القياس', dimension: 'الحجم', weight: 'الوزن' };
  },

  getRequiredOptionTypes(product) {
    return Array.from(new Set((product?.variants || []).map(v => v.type).filter(Boolean)));
  },

  validateRequiredOptions(product) {
    const required = this.getRequiredOptionTypes(product);
    const missing = required.filter(t => !this.selectedVariants[t]);
    return { required, missing, ok: missing.length === 0 };
  },

  showMissingOptionsToast(missing) {
    const labels = this.getOptionTypeLabels();
    const names = missing.map(t => labels[t] || t).join(' ، ');
    const verb = missing.length === 1 ? 'الرجاء اختيار' : 'الرجاء اختيار جميع الخيارات:';
    Utils.toast(missing.length === 1 ? `${verb} ${names}` : `${verb} ${names}`, 'warn');
  },

  addToCartDetail() {
    const p = this.currentProduct;
    if (!p) return;
    const v = this.validateRequiredOptions(p);
    if (!v.ok) { this.showMissingOptionsToast(v.missing); return; }
    const firstVariant = Object.values(this.selectedVariants)[0];
    const colorSel = this.selectedVariants.color;
    this.addToCart(p.id, firstVariant?.id || null, colorSel?.id || null, this.qty);
    this.resetProductSelections();
  },

  resetProductSelections() {
    this.selectedVariants = {};
    this.qty = 1;
    const qtyInput = document.getElementById('qty-input');
    if (qtyInput) qtyInput.value = '1';
    document.querySelectorAll('.variant-btn.active, .variant-img-btn.active').forEach(b => b.classList.remove('active'));
    const optKeys = ['color', 'size', 'dimension', 'weight'];
    optKeys.forEach(k => {
      const labels = { color: 'اللون', size: 'القياس', dimension: 'الحجم', weight: 'الوزن' };
      const el = document.getElementById('opt-name-' + k);
      if (el) el.textContent = 'اختر ' + labels[k];
    });
  },

  buyNow() {
    const p = this.currentProduct;
    if (!p) return;
    const v = this.validateRequiredOptions(p);
    if (!v.ok) { this.showMissingOptionsToast(v.missing); return; }
    this.addToCartDetail();
    setTimeout(() => location.hash = 'checkout', 300);
  },

  orderViaWhatsApp() {
    const p = this.currentProduct;
    if (!p) return;
    const v = this.validateRequiredOptions(p);
    if (!v.ok) { this.showMissingOptionsToast(v.missing); return; }
    const s = Store.getSettings();
    const labels = this.getOptionTypeLabels();
    const selectedList = Object.values(this.selectedVariants);
    const optionLines = selectedList.map(v => `${labels[v.type] || v.type}: ${v.value}`).join(' | ');
    const firstV = selectedList[0];
    const offer = this.getBestOffer(p);
    const unitPrice = firstV?.price || (offer ? offer.final : p.price);
    let msg = `🛍️ *طلب من ${s.storeName}*\n\n`;
    msg += `📦 *المنتج:* ${p.name}\n`;
    if (optionLines) msg += `🎨 *الخيارات:* ${optionLines}\n`;
    msg += `💰 *السعر:* ${Utils.formatPrice(unitPrice)}\n`;
    msg += `🔢 *الكمية:* ${this.qty}\n`;
    msg += `💵 *الإجمالي:* ${Utils.formatPrice(unitPrice * this.qty)}\n`;
    if (p.oldPrice > p.price) msg += `🏷️ *وفرت:* ${Math.round((1 - p.price / p.oldPrice) * 100)}%\n`;
    if (this.customerPhone) msg += `📞 *جوال التواصل:* ${this.customerPhone}\n`;
    msg += `\nأرجو تأكيد توفر المنتج وتفاصيل التوصيل. شكراً!`;
    const url = `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  },

  addToCart(productId, variantId = null, colorId = null, qty = 1) {
    const p = Store.getProduct(productId);
    if (!p) return;
    const onDetail = this.currentProduct && this.currentProduct.id === productId;
    if (onDetail) {
      const v = this.validateRequiredOptions(p);
      if (!v.ok) { this.showMissingOptionsToast(v.missing); return; }
    }
    if (!variantId && !colorId && (!p.variants || !p.variants.length) && p.stock <= 0) {
      Utils.toast('هذا المنتج غير متوفر حالياً');
      return;
    }
    const selectedFromDetail = onDetail ? this.selectedVariants : null;
    const selected = selectedFromDetail && Object.keys(selectedFromDetail).length
      ? Object.values(selectedFromDetail)
      : null;
    const variant = variantId ? p.variants.find(v => v.id === variantId) : null;
    const color = colorId ? p.variants.find(v => v.id === colorId) : null;
    const optionsArr = selected
      ? selected.map(v => ({ type: v.type, value: v.value, variantId: v.id, price: this.readPrice(v) }))
      : (variant || color ? [{ type: variant?.type || color?.type, value: variant?.value || color?.value, variantId: variant?.id || color?.id, price: this.readPrice(variant) || this.readPrice(color) }].filter(o => o.type) : []);
    const optionKey = optionsArr.map(o => `${o.type}:${o.variantId}`).sort().join('|') || 'none';
    const cart = Store.getCart();
    const existing = cart.find(i => i.productId === productId && (i.optionKey || ((i.variantId || '') + '|' + (i.colorId || ''))) === optionKey);
    const offer = this.getBestOffer(p);
    // Price resolution: use the actual saved variant/color price if a variant/color is selected;
    // otherwise use the product's real saved price. Do not substitute any hardcoded amount.
    const variantPrice = this.readPrice(variant);
    const colorPrice = this.readPrice(color);
    const productPrice = this.readPrice(p);
    const basePrice = variantPrice > 0 ? variantPrice : (colorPrice > 0 ? colorPrice : (offer ? offer.final : productPrice));
    const price = optionsArr.length ? this.readPrice(optionsArr[0]) : basePrice;
    const originalPrice = variantPrice > 0 ? variantPrice : (colorPrice > 0 ? colorPrice : productPrice);
    const itemImage = optionsArr.find(o => {
      const v = p.variants.find(vv => vv.id === o.variantId);
      return v && v.image;
    });
    const cartImage = itemImage ? this._resolveImg(p.variants.find(vv => vv.id === itemImage.variantId).image) : (this._resolveImg(p.images[0]) || '');
    if (existing) existing.qty += qty;
    else cart.push({
      productId,
      variantId: optionsArr.find(o => o.type === 'size')?.variantId || variant?.id || null,
      variantUuid: (function () {
        var sizeOpt = optionsArr.find(function (o) { return o.type === 'size'; });
        if (sizeOpt && sizeOpt.variantId) { var sv = p.variants.find(function (vv) { return vv.id === sizeOpt.variantId; }); return sv ? sv.uuid : null; }
        if (variant && variant.uuid) return variant.uuid;
        if (variant && variant.id) { var dv = p.variants.find(function (vv) { return vv.id === variant.id; }); return dv ? dv.uuid : null; }
        return null;
      })(),
      colorId: optionsArr.find(o => o.type === 'color')?.variantId || color?.id || null,
      colorUuid: (function () {
        var colorOpt = optionsArr.find(function (o) { return o.type === 'color'; });
        if (colorOpt && colorOpt.variantId) { var cv = p.variants.find(function (vv) { return vv.id === colorOpt.variantId; }); return cv ? cv.uuid : null; }
        if (color && color.uuid) return color.uuid;
        if (color && color.id) { var dv2 = p.variants.find(function (vv) { return vv.id === color.id; }); return dv2 ? dv2.uuid : null; }
        return null;
      })(),
      optionKey,
      options: optionsArr,
      name: p.name,
      variant: optionsArr.find(o => o.type === 'size')?.value || optionsArr.find(o => o.type !== 'color')?.value || '',
      color: optionsArr.find(o => o.type === 'color')?.value || '',
      price,
      originalPrice,
      offerId: offer ? offer.offer.id : null,
      qty,
      image: cartImage
    });
    Store.setCart(cart);
    Utils.toast('تمت الإضافة إلى السلة');
    this.updateCartBadge();
  },

  updateCartBadge() {
    const c = Store.getCart().reduce((s, i) => s + i.qty, 0);
    const el = document.getElementById('cart-count');
    if (el) { el.textContent = c; el.style.display = c ? 'grid' : 'none'; }
  },

  toggleWishlist(pid) {
    const w = Store.getWishlist();
    const i = w.indexOf(pid);
    const willBeIn = i < 0;
    if (i >= 0) { w.splice(i, 1); Utils.toast('تمت الإزالة من المفضلة', 'warn'); }
    else { w.push(pid); Utils.toast('تمت الإضافة إلى المفضلة'); }
    Store.setWishlist(w);
    const el = document.getElementById('wishlist-count');
    if (el) { el.textContent = w.length; el.style.display = w.length ? 'grid' : 'none'; }
    if (location.hash === '#wishlist') this.renderWishlist();
    if (this.currentProduct && this.currentProduct.id === pid) {
      const btn = document.getElementById('pd-wishlist-btn');
      if (btn) {
        btn.classList.toggle('active', willBeIn);
        const svg = btn.querySelector('svg');
        if (svg) svg.setAttribute('fill', willBeIn ? 'currentColor' : 'none');
      }
    }
    document.querySelectorAll('.quick-btn.wishlist[onclick*="' + pid + '"]').forEach(function (btn) {
      btn.classList.toggle('active', willBeIn);
      btn.innerHTML = willBeIn ? Utils.icon('heart_filled', 14) : Utils.icon('heart', 14);
    });
  },

  /* ====== CART ====== */
  openCart() {
    this.renderCart();
    document.getElementById('cart-drawer').classList.add('active');
    document.getElementById('drawer-backdrop').classList.add('active');
  },
  closeCart() {
    document.getElementById('cart-drawer').classList.remove('active');
    document.getElementById('drawer-backdrop').classList.remove('active');
  },
  renderCart() {
    const cart = Store.getCart();
    const body = document.getElementById('cart-body');
    const foot = document.getElementById('cart-foot');
    if (!cart.length) {
      body.innerHTML = `<div class="cart-empty"><div style="font-size:60px;margin-bottom:12px">🛒</div><h3 style="font-size:18px;margin-bottom:8px">السلة فارغة</h3><p>أضف بعض المنتجات الرائعة</p><a href="#shop" class="btn btn-primary mt-2" onclick="setTimeout(()=>App.closeCart(),50)">تسوق الآن</a></div>`;
      foot.innerHTML = '';
      return;
    }
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    body.innerHTML = cart.map((item, idx) => `
      <div class="cart-item">
        <img src="${Utils.escapeUrl(item.image)}" loading="lazy" width="70" height="70">
        <div>
          <h4>${Utils.escapeHtml(item.name)}</h4>
          <div class="variant">${(item.options && item.options.length ? item.options.map(o => Utils.escapeHtml(o.value)).join(' / ') : [item.variant, item.color].filter(Boolean).map(v => Utils.escapeHtml(v)).join(' / '))}</div>
          <div class="flex gap-2" style="margin-top:6px">
            <button class="icon-btn" style="width:28px;height:28px" onclick="App.cartQty(${idx},-1)">−</button>
            <span style="min-width:24px;text-align:center;font-weight:700">${item.qty}</span>
            <button class="icon-btn" style="width:28px;height:28px" onclick="App.cartQty(${idx},1)">+</button>
          </div>
        </div>
        <div style="text-align:left">
          <div class="price" style="font-weight:700">${Utils.formatPrice(item.price * item.qty)}</div>
          <div class="remove" style="margin-top:8px;cursor:pointer" onclick="App.removeCartItem(${idx})">${Utils.icon('trash', 14)}</div>
        </div>
      </div>
    `).join('');
    foot.innerHTML = `
      <div class="flex-between mb-2" style="margin-bottom:12px">
        <span>المجموع الفرعي</span>
        <strong style="font-size:18px">${Utils.formatPrice(subtotal)}</strong>
      </div>
      <a href="#checkout" class="btn btn-primary btn-block btn-lg" onclick="setTimeout(()=>App.closeCart(),50)">إتمام الشراء ${Utils.icon('arrow_right', 16)}</a>
      <a href="#shop" class="btn btn-outline btn-block mt-1" onclick="setTimeout(()=>App.closeCart(),50)">متابعة التسوق</a>
    `;
  },
  cartQty(idx, d) {
    const cart = Store.getCart();
    const item = cart[idx];
    if (!item) return;
    const p = Store.getProduct(item.productId);
    let maxStock = 999;
    if (p) {
      const v = item.variantId ? p.variants.find(vv => vv.id === item.variantId) : null;
      maxStock = v ? v.stock : p.stock;
    }
    const max = maxStock > 0 ? maxStock : 999;
    item.qty = Math.max(1, Math.min(max, item.qty + d));
    Store.setCart(cart);
    this.renderCart();
    this.updateCartBadge();
  },
  removeCartItem(idx) {
    const cart = Store.getCart();
    cart.splice(idx, 1);
    Store.setCart(cart);
    this.renderCart();
    this.updateCartBadge();
    Utils.toast('تم حذف المنتج', 'warn');
  },

  /* ====== CHECKOUT ====== */
  renderCheckout() {
    const cart = Store.getCart();
    if (!cart.length) {
      document.getElementById('main-content').innerHTML = `<div class="container empty-state"><div style="font-size:60px">🛒</div><h3>السلة فارغة</h3><a href="#shop" class="btn btn-primary mt-2">تسوق الآن</a></div>`;
      return;
    }
    const s = Store.getSettings();
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const areas = Store.getDeliveryAreas().filter(a => a.active !== false);
    const defaultShipping = subtotal >= s.freeShippingThreshold ? 0 : ((s.defaultShippingCost ?? s.shippingCost) ?? 0);
    const defaultArea = areas[0];
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px">
        <h1 style="font-size:28px;font-weight:800;margin-bottom:8px">إتمام الشراء</h1>
        <p class="muted mb-3">راجع طلبك وأكمل بيانات الشحن</p>

        <div class="checkout-grid" style="display:grid;grid-template-columns:1.4fr 1fr;gap:24px">
          <div>
            <div class="panel">
              <div class="panel-head"><h3>معلومات الاتصال</h3></div>
              <div class="panel-body">
                <div class="form-row">
                  <div class="form-group"><label class="form-label">الاسم الكامل <span class="req">*</span></label><input class="form-control" id="c-name" required oninput="this.style.borderColor='';this.classList.remove('field-error')"></div>
                  <div class="form-group"><label class="form-label">رقم الجوال الأردني <span class="req">*</span></label><input class="form-control" id="c-phone" type="tel" placeholder="07XXXXXXXX" required oninput="this.style.borderColor='';this.classList.remove('field-error')"></div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label">المحافظة <span class="req">*</span></label>
                    <select class="form-control" id="c-city" required onchange="App.onAreaChange();this.style.borderColor='';this.classList.remove('field-error')">
                      <option value="">اختر المحافظة</option>
                      ${areas.map(a => `<option value="${a.name}" data-shipping="${a.shippingCost}">${a.name}</option>`).join('')}
                    </select>
                  </div>
                  <div class="form-group"><label class="form-label">المنطقة / الحي <span class="req">*</span></label><input class="form-control" id="c-district" placeholder="مثال: عبدون، الصويفية" required oninput="this.style.borderColor='';this.classList.remove('field-error')"></div>
                </div>
                <div class="form-group"><label class="form-label">العنوان التفصيلي <span class="req">*</span></label><input class="form-control" id="c-address" placeholder="الشارع، رقم البناء، علامة مميزة" required oninput="this.style.borderColor='';this.classList.remove('field-error')"></div>
                <div class="form-group"><label class="form-label">ملاحظات (اختياري)</label><textarea class="form-control" id="c-notes" placeholder="مثال: اتصل قبل الوصول"></textarea></div>
              </div>
            </div>

            <div class="panel">
              <div class="panel-head"><h3>طريقة الدفع</h3></div>
              <div class="panel-body">
                <label style="display:flex;align-items:center;gap:12px;padding:14px;border:1.5px solid var(--primary);border-radius:10px;background:var(--primary-soft)">
                  <input type="radio" name="pay" checked>
                  <div>
                    <div style="font-weight:700;color:var(--primary-dark)">الدفع عند الاستلام (كاش)</div>
                    <div style="font-size:12px;color:var(--text-2)">ادفع نقداً للمندوب عند استلام الطلب</div>
                  </div>
                </label>
              </div>
            </div>

            <div class="panel">
              <div class="panel-head"><h3>كود الخصم</h3></div>
              <div class="panel-body">
                <div style="display:flex;gap:8px">
                  <input class="form-control" id="coupon-code" placeholder="مثال: WELCOME10" style="text-transform:uppercase">
                  <button class="btn btn-primary" onclick="App.applyCoupon()">تطبيق</button>
                </div>
                <div id="coupon-message" style="margin-top:8px"></div>
              </div>
            </div>
          </div>

          <div>
            <div class="panel" style="position:sticky;top:calc(var(--header-h) + 16px)">
              <div class="panel-head"><h3>ملخص الطلب</h3></div>
              <div class="panel-body">
                <div id="checkout-items">
                  ${cart.map(i => `
                    <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
                      <img src="${Utils.escapeUrl(i.image)}" style="width:50px;height:50px;object-fit:cover;border-radius:8px" loading="lazy">
                      <div style="flex:1">
                        <div style="font-weight:600;font-size:13px">${Utils.escapeHtml(i.name)}</div>
                        <div style="font-size:12px;color:var(--text-2)">${(i.options && i.options.length ? i.options.map(o => Utils.escapeHtml(o.value)).join(' / ') : [i.variant, i.color].filter(Boolean).map(v => Utils.escapeHtml(v)).join(' / '))} × ${i.qty}</div>
                      </div>
                      <div style="font-weight:700">${Utils.formatPrice(i.price * i.qty)}</div>
                    </div>
                  `).join('')}
                </div>
                <div style="margin-top:14px" id="checkout-summary"></div>
                <a href="#cart" class="btn btn-block btn-lg mt-2" style="background:#6b4423;color:#fff;text-decoration:none">العودة إلى سلة المشتريات</a>
                <button class="btn btn-primary btn-block btn-lg mt-2" onclick="App.placeOrder()">${Utils.icon('check', 18)} تأكيد الطلب</button>
                <button class="btn btn-success btn-block mt-1" onclick="App.placeWhatsAppOrder()">${Utils.icon('whatsapp', 18)} الطلب عبر واتساب</button>
                <p style="text-align:center;margin-top:10px;font-size:12px;color:var(--text-2)">بإتمامك الطلب فأنت توافق على شروط الاستخدام</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    this.checkoutData = { subtotal, shipping: defaultShipping, discount: 0, coupon: null, area: defaultArea?.name || null, areaSelected: false };
    this.updateCheckoutSummary();
    if (this.customerPhone) document.getElementById('c-phone').value = this.customerPhone;
  },

  onAreaChange() {
    const sel = document.getElementById('c-city');
    const opt = sel.options[sel.selectedIndex];
    const shippingCost = opt && opt.dataset.shipping ? +opt.dataset.shipping : 0;
    const s = Store.getSettings();
    const subtotal = this.checkoutData.subtotal;
    this.checkoutData.shipping = subtotal >= s.freeShippingThreshold ? 0 : shippingCost;
    this.checkoutData.area = sel.value;
    this.checkoutData.areaSelected = !!sel.value;
    this.updateCheckoutSummary();
  },

  async applyCoupon() {
    const code = document.getElementById('coupon-code').value.trim();
    const msg = document.getElementById('coupon-message');
    if (!code) return;
    var res = Store.applyCoupon(code, this.checkoutData.subtotal);
    if (!res.ok && window.StoreDataLayer && window.StoreDataLayer.coupons && typeof window.StoreDataLayer.coupons.getByCode === 'function') {
      try {
        var remote = await window.StoreDataLayer.coupons.getByCode(code);
        if (remote && remote.ok && remote.data) {
          var c = remote.data;
          if (!c.active) { res = { ok: false, error: 'كود الخصم غير مفعّل' }; }
          else if (c.expiresAt && new Date(c.expiresAt) < new Date()) { res = { ok: false, error: 'انتهت صلاحية الكود' }; }
          else if (c.maxUses > 0 && c.used >= c.maxUses) { res = { ok: false, error: 'تم استخدام الكود الحد الأقصى' }; }
          else if (this.checkoutData.subtotal < c.minOrder) { res = { ok: false, error: 'الحد الأدنى للطلب ' + c.minOrder }; }
          else {
            var discount = c.type === 'percent' ? this.checkoutData.subtotal * c.value / 100 : c.value;
            res = { ok: true, coupon: c, discount: discount };
          }
        }
      } catch (e) { console.error('[Storefront] Coupon remote fallback error:', e); }
    }
    if (res.ok) {
      this.checkoutData.discount = res.discount;
      this.checkoutData.coupon = res.coupon.code;
      msg.innerHTML = `<div class="tag tag-green">تم تطبيق الكود: ${Utils.escapeHtml(res.coupon.code)} (وفّرت ${Utils.formatPrice(res.discount)})</div>`;
      Utils.toast('تم تطبيق الكود بنجاح');
    } else {
      msg.innerHTML = `<div class="tag tag-red">${Utils.escapeHtml(res.error)}</div>`;
    }
    this.updateCheckoutSummary();
  },

  updateCheckoutSummary() {
    const d = this.checkoutData;
    const total = d.subtotal - d.discount + d.shipping;
    document.getElementById('checkout-summary').innerHTML = `
      <div class="flex-between" style="margin-bottom:8px"><span class="muted">المجموع الفرعي</span><span>${Utils.formatPrice(d.subtotal)}</span></div>
      ${d.discount > 0 ? `<div class="flex-between" style="margin-bottom:8px;color:var(--success)"><span>الخصم</span><span>- ${Utils.formatPrice(d.discount)}</span></div>` : ''}
      <div class="flex-between" style="margin-bottom:8px"><span class="muted">رسوم التوصيل</span><span>${!d.areaSelected ? 'يتم تحديد سعر التوصيل بعد اختيار المحافظة' : d.shipping > 0 ? Utils.formatPrice(d.shipping) : 'توصيل مجاني'}</span></div>
      <div class="flex-between" style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px"><strong style="font-size:18px">الإجمالي</strong><strong style="font-size:20px;color:var(--primary-dark)">${Utils.formatPrice(total)}</strong></div>
    `;
  },

  async placeOrder() {
    const cart = Store.getCart();
    if (!cart.length) return;
    const name = document.getElementById('c-name').value.trim();
    const phone = document.getElementById('c-phone').value.trim();
    const city = document.getElementById('c-city').value;
    const district = document.getElementById('c-district').value.trim();
    const address = document.getElementById('c-address').value.trim() + (district ? ' - ' + district : '');
    var requiredFields = [
      { el: document.getElementById('c-name'), ok: !!name },
      { el: document.getElementById('c-phone'), ok: !!phone },
      { el: document.getElementById('c-city'), ok: !!city },
      { el: document.getElementById('c-district'), ok: !!district },
      { el: document.getElementById('c-address'), ok: !!document.getElementById('c-address').value.trim() }
    ];
    var allValid = true;
    requiredFields.forEach(function(f) {
      if (f.el) {
        if (f.ok) { f.el.style.borderColor = ''; f.el.classList.remove('field-error'); }
        else { f.el.style.borderColor = 'var(--danger)'; f.el.classList.add('field-error'); allValid = false; }
      }
    });
    if (!allValid) {
      var first = requiredFields.find(function(f) { return !f.ok; });
      if (first && first.el) first.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      Utils.toast('الرجاء إكمال جميع الحقول المطلوبة', 'error'); return;
    }
    const notes = document.getElementById('c-notes').value.trim();
    const cleanPhone = phone.replace(/[\s\-+]/g, '');
    if (!/^(07\d{8}|9627\d{8})$/.test(cleanPhone)) {
      Utils.toast('الرجاء إدخال رقم جوال أردني صحيح (07XXXXXXXX)', 'error');
      return;
    }
    const d = this.checkoutData;
    const area = Store.getDeliveryAreaByName(city);
    const s = Store.getSettings();
    const shipping = (d.subtotal >= s.freeShippingThreshold) ? 0 : (area ? area.shippingCost : ((s.defaultShippingCost ?? s.shippingCost) ?? 0));

    var client = null;
    try { var sv = window.__supabase; if (sv && sv.client) client = sv.client; } catch (e) {}

    if (client) {
      try {
        var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        var rpcItems = [];
        var cartChanged = false;
        for (var ci = 0; ci < cart.length; ci++) {
          var ciItem = cart[ci];
          var ciProd = Store.getProduct(ciItem.productId);
          var ciUuid = ciProd && ciProd.uuid;
          if (!ciUuid || !uuidRe.test(ciUuid)) {
            Utils.toast('المنتج "' + ciItem.name + '" غير موجود في قاعدة البيانات', 'error');
            return;
          }
          if (ciItem.variantUuid && ciProd && ciProd.variants) {
            var vMatch = ciProd.variants.find(function (vv) { return vv.uuid === ciItem.variantUuid; });
            if (!vMatch && ciItem.variantId) {
              vMatch = ciProd.variants.find(function (vv) { return vv.id === ciItem.variantId; });
              if (vMatch && vMatch.uuid) { ciItem.variantUuid = vMatch.uuid; cartChanged = true; }
            }
            if (!vMatch) {
              Utils.toast('خيار "' + (ciItem.name || '') + '" — ' + (ciItem.variant || '') + ' لم يعد متاحاً. الرجاء إعادة اختياره من صفحة المنتج.', 'error');
              return;
            }
          }
          if (ciItem.colorUuid && ciProd && ciProd.variants) {
            var cMatch = ciProd.variants.find(function (vv) { return vv.uuid === ciItem.colorUuid; });
            if (!cMatch && ciItem.colorId) {
              cMatch = ciProd.variants.find(function (vv) { return vv.id === ciItem.colorId; });
              if (cMatch && cMatch.uuid) { ciItem.colorUuid = cMatch.uuid; cartChanged = true; }
            }
            if (!cMatch) {
              Utils.toast('لون "' + (ciItem.name || '') + '" — ' + (ciItem.color || '') + ' لم يعد متاحاً. الرجاء إعادة اختياره من صفحة المنتج.', 'error');
              return;
            }
          }
          rpcItems.push({
            product_id: ciUuid,
            variant_id: ciItem.variantUuid || ciItem.variantId || null,
            product_name: ciItem.name || '',
            variant: (ciItem.options && ciItem.options.length ? ciItem.options.map(function (o) { return o.value; }).join('/') : [ciItem.variant, ciItem.color].filter(Boolean).join('/')),
            qty: ciItem.qty,
            price: ciItem.price,
            image: ciItem.image || null,
            options: ciItem.options || [],
            display_order: ci
          });
        }
        if (cartChanged) Store.setCart(cart);
        var rpcResult = await client.rpc('place_order', {
          p_customer_name: name,
          p_customer_phone: cleanPhone,
          p_customer_city: city,
          p_customer_address: address,
          p_items: rpcItems,
          p_subtotal: d.subtotal,
          p_discount: d.discount,
          p_shipping_cost: shipping,
          p_total: d.subtotal - d.discount + shipping,
          p_notes: notes || null,
          p_payment_method: 'cod',
          p_coupon_code: d.coupon || null
        });
        if (rpcResult && rpcResult.error) {
          console.error('[placeOrder] RPC error:', rpcResult.error);
          Utils.toast('حدث خطأ أثناء إنشاء الطلب: ' + (rpcResult.error.message || 'خطأ غير معروف'), 'error');
          return;
        }
        var orderData = rpcResult && rpcResult.data;
        var orderNumber = orderData && orderData.order_number;
        var accessToken = orderData && orderData.access_token;
        console.log('[placeOrder] Order created:', orderNumber, orderData);
        this.customerPhone = cleanPhone;
        localStorage.setItem('anwar_customer_phone', cleanPhone);
        if (accessToken) {
          var tokens = {};
          try { tokens = JSON.parse(localStorage.getItem('anwar_order_tokens') || '{}'); } catch (e) {}
          tokens[cleanPhone] = accessToken;
          localStorage.setItem('anwar_order_tokens', JSON.stringify(tokens));
        }
        Store.setCart([]);
        this.updateCartBadge();
        Utils.toast('تم استلام طلبك بنجاح!');
        location.hash = 'order/' + orderNumber;
        return;
      } catch (e) {
        console.error('[placeOrder] RPC exception:', e);
        Utils.toast('حدث خطأ أثناء إنشاء الطلب: ' + (e.message || 'خطأ غير معروف'), 'error');
        return;
      }
    }

    var order = Store.addOrder({
      customer: { name, phone, city, address },
      items: cart.map(function (i) {
        return {
          productId: i.productId, variantId: i.variantId,
          colorId: i.colorId, optionKey: i.optionKey,
          options: i.options || [], name: i.name,
          variant: (i.options && i.options.length ? i.options.map(function (o) { return o.value; }).join('/') : [i.variant, i.color].filter(Boolean).join('/')),
          qty: i.qty, price: i.price, image: i.image
        };
      }),
      subtotal: d.subtotal, discount: d.discount, shipping: shipping,
      total: d.subtotal - d.discount + shipping,
      status: 'ordered', paymentMethod: 'cod', notes, coupon: d.coupon
    });
    this.customerPhone = phone;
    localStorage.setItem('anwar_customer_phone', phone);
    Store.setCart([]);
    this.updateCartBadge();
    Utils.toast('تم استلام طلبك بنجاح!');
    location.hash = 'order/' + order.id;
  },

  placeWhatsAppOrder() {
    const cart = Store.getCart();
    if (!cart.length) return;
    const name = document.getElementById('c-name').value.trim();
    const phone = document.getElementById('c-phone').value.trim();
    const city = document.getElementById('c-city').value;
    const district = document.getElementById('c-district').value.trim();
    const address = document.getElementById('c-address').value.trim() + (district ? ' - ' + district : '');
    var requiredFields = [
      { el: document.getElementById('c-name'), ok: !!name },
      { el: document.getElementById('c-phone'), ok: !!phone },
      { el: document.getElementById('c-city'), ok: !!city },
      { el: document.getElementById('c-district'), ok: !!district },
      { el: document.getElementById('c-address'), ok: !!document.getElementById('c-address').value.trim() }
    ];
    var allValid = true;
    requiredFields.forEach(function(f) {
      if (f.el) {
        if (f.ok) { f.el.style.borderColor = ''; f.el.classList.remove('field-error'); }
        else { f.el.style.borderColor = 'var(--danger)'; f.el.classList.add('field-error'); allValid = false; }
      }
    });
    if (!allValid) {
      var first = requiredFields.find(function(f) { return !f.ok; });
      if (first && first.el) first.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      Utils.toast('الرجاء إكمال بياناتك أولاً', 'error'); return;
    }
    const s = Store.getSettings();
    const d = this.checkoutData;
    const total = d.subtotal - d.discount + d.shipping;
    let msg = `🛍️ *طلب جديد من ${s.storeName}*\n\n`;
    msg += `👤 *العميل:* ${name}\n`;
    msg += `📞 ${phone}\n`;
    msg += `📍 ${city}${district ? ' - ' + district : ''} - ${address}\n`;
    if (document.getElementById('c-notes').value) msg += `📝 ${document.getElementById('c-notes').value}\n`;
    msg += `\n*المنتجات:*\n`;
    cart.forEach((i, idx) => {
      msg += `${idx + 1}. ${i.name}`;
      const optLabel = (i.options && i.options.length) ? i.options.map(o => o.value).join('/') : [i.variant, i.color].filter(Boolean).join('/');
      if (optLabel) msg += ` (${optLabel})`;
      msg += ` × ${i.qty} = ${Utils.formatPrice(i.price * i.qty)}\n`;
    });
    msg += `\n💰 *المجموع:* ${Utils.formatPrice(d.subtotal)}`;
    if (d.discount) msg += `\n🏷️ الخصم: -${Utils.formatPrice(d.discount)}`;
    msg += `\n🚚 رسوم التوصيل: ${Utils.formatPrice(d.shipping)}`;
    msg += `\n*💵 الإجمالي: ${Utils.formatPrice(total)}*`;
    const url = `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
    Store.setCart([]);
    this.updateCartBadge();
  },

  /* ====== MY ORDERS (customer) ====== */
  async renderMyOrders() {
    const phone = localStorage.getItem('anwar_customer_phone') || '';
    var accessToken = null;
    if (phone) {
      try { var tokens = JSON.parse(localStorage.getItem('anwar_order_tokens') || '{}'); accessToken = tokens[phone] || null; } catch (e) {}
    }
    var orders = null;
    if (phone && window.StoreDataLayer && window.StoreDataLayer.orders) {
      try {
        var r = await window.StoreDataLayer.orders.getByPhone(phone, accessToken);
        if (r && r.ok && Array.isArray(r.data)) {
          orders = r.data;
          if (orders.length > 0 && orders[0].customer && orders[0].customer.phone) {
            var supabasePhone = orders[0].customer.phone;
            if (supabasePhone && supabasePhone !== phone) {
              localStorage.setItem('anwar_customer_phone', supabasePhone);
            }
          }
        }
      } catch (e) { /* fall through */ }
    }
    if (!orders) orders = phone
      ? Store.getOrders().filter(o => (o.customer && o.customer.phone || '').replace(/\D/g, '') === phone.replace(/\D/g, ''))
      : [];
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px;max-width:780px">
        <h1 style="font-size:28px;font-weight:800;margin-bottom:8px">طلباتي</h1>
        <p class="muted mb-3">${phone ? ('رقم الجوال المسجل: <strong dir="ltr">' + phone + '</strong>') : 'لم يتم تسجيل أي رقم جوال بعد — أكمل طلباً ليتم حفظ طلباتك تلقائياً.'}</p>
        ${!phone ? '' : (!orders.length ? `
          <div class="empty-state"><div style="font-size:60px">📦</div><h3>لا توجد طلبات حتى الآن</h3><p>ابدأ بالتسوق من المتجر وستظهر طلباتك هنا تلقائياً.</p><a href="#shop" class="btn btn-primary mt-2">تسوق الآن</a></div>
        ` : orders.map(o => `
          <div class="panel" style="margin-bottom:14px">
            <div class="panel-body">
              <div class="flex-between" style="flex-wrap:wrap;gap:10px">
                <div>
                  <div class="muted" style="font-size:12px">رقم الطلب</div>
                  <div style="font-weight:800;font-size:16px">${o.id}</div>
                </div>
                <div>
                  <div class="muted" style="font-size:12px">التاريخ</div>
                  <div>${Utils.formatDate(o.date)}</div>
                </div>
                <div>
                  <div class="muted" style="font-size:12px">الحالة</div>
                  <div><span class="tag ${Utils.statusColor(o.status)}">${Utils.statusLabel(o.status)}</span></div>
                </div>
                <div>
                  <div class="muted" style="font-size:12px">الإجمالي</div>
                  <div style="font-weight:700">${Utils.formatPrice(o.total)}</div>
                </div>
              </div>
              <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
                <div class="muted" style="font-size:12px;margin-bottom:6px">تفاصيل/منتجات الطلب</div>
                <div style="display:flex;gap:10px;flex-wrap:wrap">
                  ${(o.items || []).map(i => `<div style="display:flex;align-items:center;gap:8px;background:var(--surface-2);padding:6px 10px;border-radius:10px">
                    <img src="${Utils.escapeUrl(i.image || '')}" style="width:36px;height:36px;object-fit:cover;border-radius:8px" loading="lazy">
                    <div style="font-size:13px"><strong>${Utils.escapeHtml(i.name)}</strong>${i.variant ? ' <span style="color:var(--text-2)">(' + Utils.escapeHtml(i.variant) + ')</span>' : ''} × ${i.qty}</div>
                  </div>`).join('')}
                </div>
              </div>
              <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                <a href="#order/${o.id}" class="btn btn-outline btn-sm">عرض التفاصيل</a>
              </div>
            </div>
          </div>
        `).join(''))}
      </div>
    `;
  },

  /* ====== ORDER TRACKING ====== */
  renderTrack() {
    var savedPhone = localStorage.getItem('anwar_customer_phone') || '';
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px;max-width:680px">
        <h1 style="font-size:28px;font-weight:800;margin-bottom:8px">تتبع طلبك</h1>
        <p class="muted mb-3">أدخل رقم الطلب ورقم الجوال لعرض تفاصيل طلبك</p>
        <div class="panel">
          <div class="panel-body">
            <div class="form-group">
              <label class="form-label">رقم الطلب</label>
              <input class="form-control" id="track-order" placeholder="مثال: AK_2026_3">
            </div>
            <div class="form-group">
              <label class="form-label">رقم الجوال</label>
              <input class="form-control" id="track-phone" placeholder="مثال: 0501234567" value="${savedPhone}">
            </div>
            <button class="btn btn-primary" onclick="App.searchOrder()">بحث</button>
          </div>
        </div>
        <div id="track-results" class="mt-3"></div>
      </div>
    `;
  },

  async searchOrder() {
    var orderNum = (document.getElementById('track-order') || {}).value || '';
    var phone = (document.getElementById('track-phone') || {}).value || '';
    orderNum = orderNum.trim();
    phone = phone.trim();
    if (!orderNum || !phone) { Utils.toast('أدخل رقم الطلب ورقم الجوال', 'error'); return; }
    var el = document.getElementById('track-results');
    console.log('[Track] searchOrder. orderNum:', orderNum, 'phone:', phone);
    var supabaseResult = null;
    try {
      var client = window.__supabase && window.__supabase.client;
      if (client && client.rpc) {
        console.log('[Track] Calling RPC: track_order({p_order_number:', orderNum, ', p_customer_phone:', phone, '})');
        var r = await client.rpc('track_order', { p_order_number: orderNum, p_customer_phone: phone });
        if (r && !r.error && r.data) {
          console.log('[Track] RPC data.found:', r.data.found, 'status:', r.data.order && r.data.order.status);
        }
        if (r && !r.error && r.data) supabaseResult = r.data;
      }
    } catch (e) {
      console.error('[Track] searchOrder RPC exception:', e);
    }
    if (supabaseResult && supabaseResult.found === false) {
      el.innerHTML = '<div class="empty-state"><div style="font-size:50px">🔍</div><h3>لا توجد طلبات</h3><p>تأكد من رقم الطلب ورقم الجوال وحاول مرة أخرى</p></div>';
      return;
    }
    if (supabaseResult && supabaseResult.found === true && supabaseResult.order) {
      var o = supabaseResult.order;
      var items = supabaseResult.items || [];
      el.innerHTML = `
        <div class="panel mb-2" style="margin-bottom:12px">
          <div class="panel-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <div>
              <div style="font-weight:700;font-size:16px">${o.order_number}</div>
              <div style="font-size:13px;color:var(--text-2);margin-top:4px">${Utils.formatDate(o.created_at ? o.created_at.slice(0, 10) : '')} • ${items.length} منتج</div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <span class="tag ${Utils.statusColor(o.status)}">${Utils.statusLabel(o.status)}</span>
              <strong style="color:var(--primary-dark)">${Utils.formatPrice(o.total)}</strong>
              <a href="#order/${o.order_number}" class="btn btn-outline btn-sm">التفاصيل</a>
            </div>
          </div>
        </div>`;
      return;
    }
    var orders = Store.getOrders().filter(o => o.customer.phone === phone || o.id.toLowerCase().includes(orderNum.toLowerCase()));
    if (!orders.length) { el.innerHTML = '<div class="empty-state"><div style="font-size:50px">🔍</div><h3>لا توجد طلبات</h3><p>تأكد من الرقم وحاول مرة أخرى</p></div>'; return; }
    el.innerHTML = orders.map(o => `
      <div class="panel mb-2" style="margin-bottom:12px">
        <div class="panel-body" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-weight:700;font-size:16px">${o.id}</div>
            <div style="font-size:13px;color:var(--text-2);margin-top:4px">${Utils.formatDate(o.date)} • ${o.items.length} منتج</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="tag ${Utils.statusColor(o.status)}">${Utils.statusLabel(o.status)}</span>
            <strong style="color:var(--primary-dark)">${Utils.formatPrice(o.total)}</strong>
            <a href="#order/${o.id}" class="btn btn-outline btn-sm">التفاصيل</a>
          </div>
        </div>
      </div>
    `).join('');
  },

  async renderOrderDetail(id, isAdmin) {
    var o = null;
    var phone = localStorage.getItem('anwar_customer_phone') || '';
    var accessToken = null;
    if (phone) {
      try { var tokens = JSON.parse(localStorage.getItem('anwar_order_tokens') || '{}'); accessToken = tokens[phone] || null; } catch (e) {}
    }
    if (phone && window.StoreDataLayer && window.StoreDataLayer.orders) {
      try {
        var r = await window.StoreDataLayer.orders.getByPhone(phone, accessToken);
        if (r && r.ok && Array.isArray(r.data)) {
          var found = r.data.find(function (x) { return x.id === id; });
          if (found) o = found;
        }
      } catch (e) { /* fall through */ }
    }
    if (!o) o = Store.getOrder(id);
    if (!o) { document.getElementById('main-content').innerHTML = '<div class="container empty-state"><h3>الطلب غير موجود</h3></div>'; return; }
    const steps = Utils.statusSteps();
    const currentIdx = o.status === 'cancelled' ? -1 : steps.findIndex(s => s.key === o.status);
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px">
        <div style="margin-bottom:24px">
          <h1 style="font-size:26px;font-weight:800">تفاصيل الطلب ${Utils.escapeHtml(o.id)}</h1>
          <p class="muted" style="margin-top:4px">${Utils.formatDate(o.date)}</p>
        </div>

        <div class="order-detail-grid" style="display:grid;gap:20px;grid-template-columns:1.4fr 1fr;grid-template-areas:'status status' 'customer products' 'summary summary'">
            <div class="panel" style="grid-area:status">
              <div class="panel-head"><h3>حالة الطلب</h3><span class="tag ${Utils.statusColor(o.status)}">${Utils.statusLabel(o.status)}</span></div>
              <div class="panel-body">
                ${o.status === 'cancelled' ? '<div class="tag tag-red" style="padding:12px 16px;font-size:14px">هذا الطلب ملغي</div>' : `
                <div class="status-progress">
                  ${steps.map((s, i) => {
                    const cls = i < currentIdx ? 'done' : (i === currentIdx ? (currentIdx === steps.length - 1 ? 'done' : 'current') : '');
                    return `<div class="status-step ${cls}">
                      <div class="step-circle">${i <= currentIdx ? Utils.icon('check', 18) : (i + 1)}</div>
                      <div class="step-label">${s.label}</div>
                    </div>`;
                  }).join('')}
                </div>
                <p style="margin-top:16px;padding:14px;background:var(--primary-soft);border-radius:10px;color:var(--primary-dark);font-size:14px">
                  ${currentIdx === 0 ? '⏳ تم استلام طلبك وهو بانتظار التأكيد' :
                    currentIdx === 1 ? '✅ تم تأكيد طلبك وجاري التحضير' :
                    currentIdx === 2 ? '📦 طلبك في الطريق إليك' :
                    currentIdx === 3 ? '🎉 تم استلام الطلب' :
                    ''}
                </p>
                `}
              </div>
            </div>

            <div class="panel" style="grid-area:customer">
              <div class="panel-head"><h3>معلومات العميل</h3></div>
              <div class="panel-body">
                <div style="display:flex;flex-direction:column;gap:10px;font-size:14px">
                  <div><span class="muted">الاسم:</span> <strong>${Utils.escapeHtml(o.customer.name)}</strong></div>
                  <div><span class="muted">الجوال:</span> <strong style="direction:ltr;display:inline-block">${Utils.escapeHtml(o.customer.phone)}</strong></div>
                  <div><span class="muted">المدينة:</span> <strong>${Utils.escapeHtml(o.customer.city)}</strong></div>
                  <div><span class="muted">العنوان:</span> <strong>${Utils.escapeHtml(o.customer.address)}</strong></div>
                  ${o.notes ? `<div><span class="muted">ملاحظات:</span> ${Utils.escapeHtml(o.notes)}</div>` : ''}
                </div>
              </div>
            </div>

            <div class="panel" style="grid-area:products">
              <div class="panel-head"><h3>المنتجات</h3></div>
              <div class="panel-body p0">
                <div class="table-wrap">
                  <table class="data">
                    <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
                    <tbody>
                      ${o.items.map(i => `
                        <tr>
                          <td>
                            <div style="display:flex;gap:10px;align-items:center">
                              <img src="${Utils.escapeUrl(i.image)}" class="thumb" style="width:40px;height:40px;object-fit:cover;border-radius:8px" loading="lazy">
                              <div>
                                <div style="font-weight:600;font-size:14px">${Utils.escapeHtml(i.name)}</div>
                                ${i.variant ? `<div style="font-size:12px;color:var(--text-3)">${Utils.escapeHtml(i.variant)}</div>` : ''}
                              </div>
                            </div>
                          </td>
                          <td>${i.qty}</td>
                          <td>${Utils.formatPrice(i.price)}</td>
                          <td><strong>${Utils.formatPrice(i.price * i.qty)}</strong></td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div class="panel" style="grid-area:summary">
              <div class="panel-head"><h3>ملخص الطلب</h3></div>
              <div class="panel-body">
                <div class="flex-between mb-1"><span class="muted">المجموع الفرعي</span><span>${Utils.formatPrice(o.subtotal)}</span></div>
                ${o.discount > 0 ? `<div class="flex-between mb-1" style="color:var(--success)"><span>الخصم${o.coupon ? ' (' + Utils.escapeHtml(o.coupon) + ')' : ''}</span><span>- ${Utils.formatPrice(o.discount)}</span></div>` : ''}
                <div class="flex-between mb-1"><span class="muted">رسوم التوصيل</span><span>${o.shipping > 0 ? Utils.formatPrice(o.shipping) : 'توصيل مجاني'}</span></div>
                <div class="flex-between" style="border-top:1px solid var(--border);padding-top:10px;margin-top:10px"><strong>الإجمالي</strong><strong style="color:var(--primary-dark);font-size:18px">${Utils.formatPrice(o.total)}</strong></div>
              </div>
            </div>
        </div>

        <div class="panel" style="margin-top:20px">
          <div class="panel-head"><h3>الفاتورة</h3></div>
          <div class="panel-body" style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
            <button class="btn btn-outline" onclick="App.downloadInvoice('${Utils.escapeHtml(o.id)}')">${Utils.icon('eye', 16)} عرض الفاتورة</button>
            <button class="btn btn-primary" onclick="App.tryDownloadInvoice('${Utils.escapeHtml(o.id)}', '${Utils.escapeHtml(o.status)}', ${isAdmin ? 'true' : 'false'})">${Utils.icon('download', 16)} تحميل الفاتورة PDF</button>
            <div id="invoice-msg-${Utils.escapeHtml(o.id)}" style="display:none;font-size:13px;color:var(--warning);margin-left:8px">يمكنك تحميل هذه الفاتورة عند إتمام الطلب واستلامه.</div>
          </div>
        </div>
      </div>
    `;
  },

  /* ====== INVOICE PDF ====== */
  tryDownloadInvoice(orderId, status, isAdmin) {
    if (!isAdmin && status !== 'delivered') {
      var msg = document.getElementById('invoice-msg-' + orderId);
      if (msg) msg.style.display = 'block';
      return;
    }
    this.downloadInvoice(orderId);
  },

  async downloadInvoice(orderId) {
    var o = null;
    var phone = localStorage.getItem('anwar_customer_phone') || '';
    var accessToken = null;
    if (phone) {
      try { var tokens = JSON.parse(localStorage.getItem('anwar_order_tokens') || '{}'); accessToken = tokens[phone] || null; } catch (e) {}
    }
    if (phone && window.StoreDataLayer && window.StoreDataLayer.orders) {
      try {
        var r = await window.StoreDataLayer.orders.getByPhone(phone, accessToken);
        if (r && r.ok && Array.isArray(r.data)) {
          var found = r.data.find(function (x) { return x.id === orderId; });
          if (found) o = found;
        }
      } catch (e) { /* fall through */ }
    }
    if (!o) o = Store.getOrder(orderId);
    if (!o) return;
    const s = Store.getSettings();
    const win = window.open('', '_blank');
    const logoHtml = s.logo ? `<img src="${Utils.escapeUrl(s.logo)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : (s.storeName || 'A').charAt(0);
    const primary = s.primaryColor || '#14b8a6';
    const brown = '#6b4423';
    win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة ${Utils.escapeHtml(o.id)}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Tajawal', 'Cairo', Arial, sans-serif; padding: 40px; color: #1a1a1a; background: #fff; direction: rtl; }
.invoice { max-width: 800px; margin: 0 auto; }
.inv-head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 24px; border-bottom: 3px solid ${primary}; margin-bottom: 24px; gap: 16px; }
.brand-box { display: flex; align-items: center; gap: 14px; }
.brand-logo { width: 70px; height: 70px; border-radius: 14px; background: linear-gradient(135deg, ${primary}, ${brown}); color: #fff; display: grid; place-items: center; font-size: 28px; font-weight: 900; overflow: hidden; }
.brand-name { font-size: 22px; font-weight: 800; color: ${primary}; }
.brand-tag { font-size: 13px; color: #6b6b6b; }
.inv-title { text-align: left; }
.inv-title h1 { font-size: 32px; color: #1a1a1a; letter-spacing: -.02em; }
.inv-title p { font-size: 13px; color: #6b6b6b; margin-top: 4px; }
.inv-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
.inv-info-box { background: #fafaf7; border-radius: 10px; padding: 16px; }
.inv-info-box h4 { font-size: 12px; color: ${primary}; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 8px; }
.inv-info-box p { font-size: 14px; margin: 3px 0; }
.inv-meta { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 24px; }
.inv-meta div { background: ${primary}15; border: 1px solid ${primary}40; border-radius: 8px; padding: 8px 14px; font-size: 13px; }
.inv-meta strong { color: ${primary}; }
table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
th { background: #1a1a1a; color: #fff; padding: 12px 10px; text-align: right; font-size: 13px; font-weight: 600; }
td { padding: 12px 10px; border-bottom: 1px solid #e8e3d8; font-size: 14px; }
tr:last-child td { border-bottom: 0; }
.img-cell { display: flex; gap: 10px; align-items: center; }
.img-cell img { width: 44px; height: 44px; object-fit: cover; border-radius: 6px; }
.totals { width: 340px; margin-right: auto; background: #fafaf7; border-radius: 10px; padding: 14px; }
.totals div { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
.totals .total-final { background: ${brown}; color: #fff; padding: 14px; border-radius: 10px; font-size: 18px; font-weight: 800; margin-top: 8px; }
.footer-inv { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e8e3d8; text-align: center; font-size: 12px; color: #6b6b6b; }
.print-btn { display: block; margin: 30px auto 0; padding: 14px 32px; background: ${brown}; color: #fff; border: 0; border-radius: 10px; font-size: 15px; font-weight: 700; cursor: pointer; }
@media print { body { padding: 0; } .print-btn { display: none; } }
</style></head><body>
<div class="invoice">
  <div class="inv-head">
    <div class="brand-box">
      <div class="brand-logo">${logoHtml}</div>
      <div>
        <div class="brand-name">${Utils.escapeHtml(s.storeName)}</div>
        <div class="brand-tag">${Utils.escapeHtml(s.storeNameEn || '')} • ${Utils.escapeHtml(s.tagline || '')}</div>
      </div>
    </div>
    <div class="inv-title">
      <h1>فاتورة</h1>
      <p>رقم: <strong>${Utils.escapeHtml(o.id)}</strong></p>
      <p>التاريخ: ${Utils.formatDate(o.date)}</p>
    </div>
  </div>

  <div class="inv-meta">
    ${o.coupon ? `<div>كود الخصم: <strong>${Utils.escapeHtml(o.coupon)}</strong></div>` : ''}
  </div>

  <div class="inv-info">
    <div class="inv-info-box">
      <h4>بيانات المتجر</h4>
      <p><strong>${Utils.escapeHtml(s.storeName)}</strong></p>
      <p>${Utils.escapeHtml(s.address || '')}</p>
      <p>${Utils.escapeHtml(s.contactPhone || '')}</p>
      <p>${Utils.escapeHtml(s.contactEmail || '')}</p>
      ${s.whatsapp ? `<p>واتساب: ${Utils.escapeHtml(s.whatsapp)}</p>` : ''}
    </div>
    <div class="inv-info-box">
      <h4>فاتورة إلى</h4>
      <p><strong>${Utils.escapeHtml(o.customer.name)}</strong></p>
      <p>${Utils.escapeHtml(o.customer.phone)}</p>
      <p>${Utils.escapeHtml(o.customer.city)}</p>
      <p>${Utils.escapeHtml(o.customer.address)}</p>
      ${o.notes ? `<p style="margin-top:6px;color:#92400e">ملاحظات: ${Utils.escapeHtml(o.notes)}</p>` : ''}
    </div>
  </div>

  <table>
    <thead><tr><th>المنتج</th><th>الخيار</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th></tr></thead>
    <tbody>
      ${o.items.map(i => `<tr>
        <td><div class="img-cell"><img src="${Utils.escapeUrl(i.image)}"><div><div style="font-weight:600">${Utils.escapeHtml(i.name)}</div></div></div></td>
        <td>${(i.options && i.options.length ? i.options.map(o => `${o.type === 'color' ? 'اللون' : o.type === 'size' ? 'القياس' : o.type === 'dimension' ? 'الحجم' : o.type === 'weight' ? 'الوزن' : o.type}: ${Utils.escapeHtml(o.value)}`).join(' / ') : (i.variant ? Utils.escapeHtml(i.variant) : '—'))}</td>
        <td>${i.qty}</td>
        <td>${Utils.formatPrice(i.price)}</td>
        <td><strong>${Utils.formatPrice(i.price * i.qty)}</strong></td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div><span>المجموع الفرعي</span><span>${Utils.formatPrice(o.subtotal)}</span></div>
    ${o.discount > 0 ? `<div style="color:#16a34a"><span>الخصم${o.coupon ? ' (' + Utils.escapeHtml(o.coupon) + ')' : ''}</span><span>- ${Utils.formatPrice(o.discount)}</span></div>` : ''}
    <div><span>رسوم التوصيل</span><span>${o.shipping > 0 ? Utils.formatPrice(o.shipping) : 'توصيل مجاني'}</span></div>
    <div class="total-final"><span>الإجمالي</span><span>${Utils.formatPrice(o.total)}</span></div>
  </div>

  <div class="footer-inv">
    <p>شكراً لتسوقكم من <strong>${Utils.escapeHtml(s.storeName)}</strong></p>
    <p>للاستفسارات: ${Utils.escapeHtml(s.contactPhone || '')}${s.whatsapp ? ' • واتساب: ' + Utils.escapeHtml(s.whatsapp) : ''}</p>
  </div>
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e8e3d8;text-align:center;font-size:10px;color:#999;line-height:1.6">
    هذه الفاتورة صادرة إلكترونياً من خلال موقع معرض أحمد كمال، وقد تم تحميلها من الموقع لأغراض توثيق تفاصيل الطلب. لا تعتبر هذه النسخة فاتورة مختومة أو معتمدة من المحل ما لم تكن مختومة وموقعة من معرض أحمد كمال.
  </div>
</div>
<button class="print-btn" onclick="window.print()">🖨️ طباعة / حفظ كـ PDF</button>
</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 500);
  },

  /* ====== WISHLIST ====== */
  renderWishlist() {
    const w = Store.getWishlist();
    const allProducts = w.map(id => Store.getProduct(id)).filter(Boolean);
    this._wishTotal = allProducts.length;
    if (!this._wishPage || this._wishPage < 1) this._wishPage = 1;
    const products = allProducts.slice(0, this._wishPage * this._ppp);
    const hasMore = products.length < allProducts.length;
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px">
        <h1 style="font-size:28px;font-weight:800;margin-bottom:24px">المفضلة (${w.length})</h1>
        ${products.length ? `<div class="products-grid">${products.map(p => this.productCard(p)).join('')}</div>` : '<div class="empty-state"><div style="font-size:60px">💝</div><h3>قائمة المفضلة فارغة</h3><p>أضف منتجاتك المفضلة لتجدها بسهولة لاحقاً</p><a href="#shop" class="btn btn-primary mt-2">تسوق الآن</a></div>'}
        ${hasMore ? `<div style="text-align:center;margin-top:24px"><button class="btn btn-outline" onclick="App.loadMoreWish()">تحميل المزيد (${allProducts.length - products.length} متبقي)</button></div>` : ''}
      </div>
    `;
  },

  loadMoreWish() { this._wishPage++; this.route(); },

  /* ====== STATIC PAGES ====== */
  renderAbout() {
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px;max-width:800px">
        <h1 style="font-size:32px;font-weight:800;margin-bottom:16px">من نحن</h1>
        <p class="muted" style="font-size:16px;line-height:1.9;margin-bottom:16px">${Utils.escapeHtml(Store.getSettings().storeName)} وجهتك المثالية للأزياء العصرية والأنيقة. نقدم لك تشكيلة واسعة من الملابس والإكسسوارات بأعلى جودة وأفضل الأسعار.</p>
        <p class="muted" style="font-size:16px;line-height:1.9">نؤمن بأن الموضة ليست مجرد ملابس، بل هي تعبير عن الشخصية والثقة. لذلك نختار لك بعناية أحدث الصيحات من أبرز العلامات التجارية العالمية.</p>
      </div>
    `;
  },
  renderContact() {
    const s = Store.getSettings();
    document.getElementById('main-content').innerHTML = `
      <div class="container" style="margin-top:24px">
        <h1 style="font-size:32px;font-weight:800;margin-bottom:24px">اتصل بنا</h1>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:20px">
          <div class="panel"><div class="panel-body" style="text-align:center"><div style="font-size:32px;color:var(--primary-dark)">${Utils.icon('phone', 32)}</div><h3 style="margin:12px 0">الهاتف</h3><p>${Utils.escapeHtml(s.contactPhone)}</p></div></div>
          <div class="panel"><div class="panel-body" style="text-align:center"><div style="font-size:32px;color:var(--primary-dark)">${Utils.icon('mail', 32)}</div><h3 style="margin:12px 0">البريد</h3><p>${Utils.escapeHtml(s.contactEmail)}</p></div></div>
          <div class="panel"><div class="panel-body" style="text-align:center"><div style="font-size:32px;color:var(--primary-dark)">${Utils.icon('location', 32)}</div><h3 style="margin:12px 0">العنوان</h3><p>${Utils.escapeHtml(s.address)}</p></div></div>
        </div>
      </div>
    `;
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

window.addEventListener('storage', e => {
  if (e.key === 'anwar_store_v2') {
    try {
      Store._saveDB(JSON.parse(e.newValue || '{}'));
      App.applyDecorativeBackground();
    } catch (err) {}
  }
});
