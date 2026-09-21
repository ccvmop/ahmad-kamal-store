# Migration Plan (Phase 2 and beyond)

This document describes how the existing localStorage data will eventually be
imported into the Supabase database. **It does not run any migration in this
phase.** The browser's `localStorage` is the single source of truth until the
cutover phase is approved and executed manually.

## Goals

- Preserve the exact contents of every `localStorage` and `sessionStorage`
  key listed in the Phase 0 audit.
- Preserve exact monetary values (0.60, 1.50, 3.00, 4.50, …) without
  rounding or float conversion.
- Preserve Base64 / Data-URL images byte-for-byte. They are uploaded to
  Supabase Storage (bucket `media`) and the resulting URL replaces the
  Base64 value in the database row.
- Preserve every existing product, category, variant, order, coupon,
  delivery area, hero slide, navigation item, footer setting, invoice
  setting, offer, homepage section, admin credential hash, and
  customer phone.
- Do NOT change the live `localStorage` during the import.

## Inputs (already captured in Phase 1)

- `anwar_store_v2` — main DB (settings, categories, products, variants,
  coupons, deliveryAreas, offers, orders).
- `anwar_cart_v1` — cart.
- `anwar_wishlist_v1` — wishlist.
- `anwar_admin_creds` — admin credential hash (preserved as-is for now;
  will be replaced by Supabase Auth in the auth-migration phase).
- `anwar_admin_creds_migrated_v1` — flag (preserved as-is).
- `anwar_orders_seen_at` — admin notification timestamp.
- `anwar_customer_phone` — last customer phone.
- `anwar_theme` — light/dark preference.
- `anwar_store_v1` — legacy import target (if present).
- `anwar_session_v1` — legacy session key.
- `sessionStorage.anwar_admin` — admin login flag (will move to Supabase
  Auth in a later phase).
- `sessionStorage.anwar_admin_notif_<orderId>` — one-shot WhatsApp
  notification dedup flags.

## Proposed data mapping

| localStorage field        | Supabase table.column                | Notes |
| ------------------------- | -------------------------------------- | ----- |
| settings.storeName       | settings.store_name                   | |
| settings.storeNameEn      | settings.store_name_en                | |
| settings.tagline          | settings.tagline                       | |
| settings.logo             | settings.logo_url (future)             | current value is empty; will be a Supabase Storage URL after image migration |
| settings.primaryColor     | settings.primary_color                 | |
| settings.accentColor      | settings.accent_color                  | |
| settings.contactEmail     | settings.contact_email                 | |
| settings.contactPhone     | settings.contact_phone                 | |
| settings.whatsapp         | settings.whatsapp                      | |
| settings.address          | settings.address                       | |
| settings.currency         | settings.currency                      | |
| settings.currencyCode     | settings.currency_code                 | |
| settings.facebook … youtube | settings.facebook … youtube        | |
| settings.heroSlides       | settings.hero_slides (jsonb)           | |
| settings.announcement    | settings.announcement (jsonb)          | |
| settings.homepageSections | settings.homepage_sections (jsonb)     | |
| settings.navigation       | settings.navigation (jsonb)            | |
| settings.floatingWhatsapp | settings.floating_whatsapp (jsonb)    | |
| settings.freeShippingThreshold | settings.free_shipping_threshold | |
| settings.defaultShippingCost | settings.default_shipping_cost    | |
| settings.footer           | settings.footer (jsonb)                | |
| settings.invoice          | settings.invoice (jsonb)               | |
| categories[].id           | categories.legacy_id                   | uuid is the PK |
| categories[].name         | categories.name                        | |
| categories[].icon         | categories.icon                        | optional; NOT required |
| categories[].parent       | categories.parent_id (FK to categories) | |
| categories[].order        | categories.display_order                | |
| products[].id             | products.legacy_id                      | uuid is the PK |
| products[].name, .sku, .shortDescription, .description | products.* | |
| products[].categoryId     | products.category_id (FK)               | |
| products[].price, .oldPrice | products.price, products.old_price (numeric(12,2)) | exact decimal preserved |
| products[].stock          | products.stock (int)                    | |
| products[].images[]       | products.images (text[])               | currently Base64 or HTTPS; after image migration these become Supabase Storage URLs |
| products[].featured, .isNew, .onSale, .active, .rating, .reviews | products.featured, is_new, on_sale, active, rating, reviews | |
| products[].variants[].id  | product_variants.legacy_id              | |
| products[].variants[].type, .value, .swatch, .price, .stock | product_variants.legacy_type/value/swatch + price/stock | for richer multi-option support, the new design also supports product_option_types + product_variant_options |
| coupons[].id, .code, .type, .value, .minOrder, .maxUses, .used, .expiresAt, .active | coupons.* | numeric(12,2) for value & min_order; dates for starts_at/expires_at |
| deliveryAreas[].id, .name, .shippingCost, .active, .order | delivery_areas.* | numeric(12,2) for shipping_cost |
| offers[]                  | offers.* (with target_type='product' or 'category') | date-windowed discount |
| orders[].id               | orders.legacy_id or orders.order_number | order_number is the human-readable id; id is the uuid |
| orders[].customer, .items, .subtotal, .discount, .shipping, .total, .status, .paymentMethod, .notes, .coupon | orders + order_items | numeric(12,2) for all money; status constrained to the approved set |
| cart                      | (not migrated) — cart is session-scoped UX state; it stays client-side | |
| wishlist                  | (not migrated in Phase 2 — will be moved to `public.wishlists` keyed by user in the customer-auth phase) | |
| sessionStorage.anwar_admin | (not migrated in Phase 2 — replaced by Supabase Auth in the auth-migration phase) | |
| sessionStorage.anwar_admin_notif_<id> | (ephemeral, not migrated) | |

## Image migration plan (later phase)

1. Read `anwar_store_v2` from `localStorage`.
2. For every product/variant/category/hero/announcement/logo URL that starts
   with `data:`:
   - Decode the Base64 payload.
   - Upload to Supabase Storage bucket `media` under a stable path
     (e.g. `products/<legacy_product_id>/image-0.png`).
   - Replace the `data:` URL in the database row with the public Storage URL.
3. For URLs that are already `https://...` (e.g. Unsplash), copy them
   as-is into the database row. No download/re-upload.
4. Image upload limits enforced by the bucket:
   `media` bucket has `file_size_limit = 10 MB`,
   `allowed_mime_types = ['image/png','image/jpeg','image/webp','image/gif','image/svg+xml']`.

## Rollback plan (if migration fails)

- Keep the `backup.html` browser tool forever. The Phase 1 backup JSON
  is the rollback source.
- To restore: open `backup.html` in the browser, copy each
  `data.localStorage` value into DevTools → Application → Local Storage
  in the same browser, then reload `index.html`. The application is
  designed to boot from `localStorage` (see `Store.loadDB` in
  `assets/js/store-data.js`).

## Phase 2 scope (this phase)

- Database schema created.
- RLS policies created.
- Storage buckets created.
- Seed script ready.
- Documentation written.

**Not in Phase 2 scope** (will be a separate, later phase):
- Connecting the live storefront to Supabase.
- Importing real customer data from `localStorage`.
- Replacing the client-side admin credential with Supabase Auth.
- Image uploads to Supabase Storage.
- Removing or renaming any `anwar_*` `localStorage` key.
