# Phase 2 — Supabase Database Foundation

This directory contains the SQL migrations for the Supabase database that will
eventually replace the current `localStorage` data layer.

## Layout

```
supabase/
├── README.md
├── MIGRATION_PLAN.md
├── migrations/
│   ├── 001_extensions.sql
│   ├── 002_core_schema.sql
│   ├── 003_rls_policies.sql
│   ├── 004_storage_buckets.sql
│   └── 005_seed.sql
```

## How to apply (later, by a Supabase admin, NOT in this phase)

1. Create a Supabase project.
2. Copy `.env.example` (at the project root) to a secure `.env` on the server
   and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (server-only).
3. Run the migrations in order, in a single transaction or one at a time:

   ```
   psql "$SUPABASE_DB_URL" -f supabase/migrations/001_extensions.sql
   psql "$SUPABASE_DB_URL" -f supabase/migrations/002_core_schema.sql
   psql "$SUPABASE_DB_URL" -f supabase/migrations/003_rls_policies.sql
   psql "$SUPABASE_DB_URL" -f supabase/migrations/004_storage_buckets.sql
   psql "$SUPABASE_DB_URL" -f supabase/migrations/005_seed.sql
   ```

4. Enable Supabase Auth (email + password). Manually insert the first admin
   user into `auth.users` (via the Supabase dashboard) and then set
   `public.profiles.is_admin = true` for that user.

## Critical design decisions

- **All monetary fields use `numeric(12,2)`.** This is the canonical
  decimal type in Postgres. Values such as `0.60`, `1.50`, `3.00`,
  `4.50`, `49.99` are stored exactly. There is no `float` / `double precision`
  anywhere. The seed file writes the values as quoted decimal strings
  (`'180.00'`, `'0.60'`, `'2.00'`) so they bypass any client-side float
  conversion.

- **All tables use UUID primary keys** with a `legacy_id text` companion
  column. This preserves the existing localStorage id values (`p1`, `c2-1`,
  `co1`, `d9`, `v14`, `s2`, `n3`, `ORD-2026-1001` etc.) so the eventual
  data import and the legacy Store API can still match by id.

- **Order numbers are server-generated.** The trigger function
  `public.next_order_number()` produces `AK_<year>_<n>` (e.g. `AK_2026_1`).
  The client never invents order numbers; the create-order RPC call gets
  the canonical id from the database.

- **RLS is enabled on every user/business table.** No policy uses
  `USING (true)` / `WITH CHECK (true)` to grant public write access.
  Public read is restricted to data that is intentionally public (active
  products, active categories, active delivery areas, the singleton
  settings row). Write access is admin-only via `public.is_admin()`,
  which reads the caller's `profiles.is_admin`.

- **Storage buckets**: `media` (public-read, admin-write) for storefront
  images; `private` (admin-only) for internal files; `invoices` (admin
  only) for future generated PDFs.

- **No live data is imported in this phase.** The seed file (`005_seed.sql`)
  contains the same default data already present in
  `assets/js/store-data.js`. Existing localStorage data is NOT modified.

- **No frontend file is changed in this phase.** The current storefront and
  admin panel continue to use `localStorage` via the existing `Store.*`
  API. Connecting the frontend to Supabase happens in a later phase.

## Money preservation (0.60, 1.50, 3.00, ...)

- The schema uses `numeric(12,2)` everywhere money appears
  (product.price, product.old_price, variant.price, order_items.unit_price,
  order_items.line_total, orders.subtotal, orders.discount,
  orders.shipping_cost, orders.total, delivery_areas.shipping_cost,
  coupons.value, coupons.min_order, offers.discount_value,
  settings.free_shipping_threshold, settings.default_shipping_cost).
- `numeric(12,2)` stores up to 12 digits with 2 decimal places
  (max 9,999,999,999.99). All current prices and totals fit comfortably.
- No `real` / `double precision` / `float` types are used for money.
- JS code in a later phase must send values as **strings** when calling
  Supabase RPC functions (e.g. `"0.60"`, not `0.6`) so that the database
  driver does not coerce to a JS number, and must read values back as
  strings too. The existing `formatPrice` helper already uses
  `toLocaleString` with `minimumFractionDigits: 2` for display.

## Security summary

- An anonymous user can: read active products, active categories,
  active delivery areas, the public settings row, active in-window
  offers, the active coupons (just the codes).
- An anonymous user **cannot**: read/write orders, read other customers'
  orders by phone, modify products/prices/stock/settings, write any data,
  upload to storage, create admin users, change order totals.
- A signed-in non-admin user will (in the customer-auth phase) be able to
  read **only their own** orders via a future `customer_select_own` RLS
  policy on `orders` / `order_items` keyed on `auth.uid()`.
- Only admins (profiles.is_admin = true) can write to any business table
  or to storage.
