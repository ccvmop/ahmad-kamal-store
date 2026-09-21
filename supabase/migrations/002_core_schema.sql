-- Phase 2 — Migration 002: Core schema (users, settings, navigation, hero, announcement, offers, coupons, delivery, categories, products, variants, orders, order_items, inventory, audit)
-- Run with: psql -f supabase/migrations/002_core_schema.sql
-- All tables use UUID primary keys and created_at/updated_at timestamps.
-- All monetary values use NUMERIC(12,2) to preserve values like 0.60, 1.50 exactly.
-- RLS is enabled on every table. Policies are defined in 003_rls_policies.sql.

-- =========================================================
-- 0. Helper: updated_at trigger
-- =========================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =========================================================
-- 1. Profiles (linked to Supabase Auth users)
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =========================================================
-- 2. Settings (singleton)
-- =========================================================
-- One-row table that holds the flexible store configuration. Uses JSONB for
-- genuinely flexible fields (hero slides, navigation, announcement, footer,
-- invoice settings, homepage sections, custom keys) so the schema does not
-- break when new optional settings are added in the future. All data round-trips
-- through JSONB without altering numeric precision.
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  -- Core store identity (kept as first-class columns for cheap reads and
  -- strong validation of the most-queried values).
  store_name text,
  store_name_en text,
  tagline text,
  primary_color text,
  accent_color text,
  logo_url text,
  favicon_url text,
  contact_email text,
  contact_phone text,
  whatsapp text,
  address text,
  currency text default 'د.أ',
  currency_code text default 'JOD',
  facebook text,
  instagram text,
  twitter text,
  tiktok text,
  snapchat text,
  youtube text,
  maps_url text,
  free_shipping_threshold numeric(12,2) not null default 0,
  default_shipping_cost numeric(12,2) not null default 0,
  -- Flexible configuration
  hero_slides jsonb not null default '[]'::jsonb,
  announcement jsonb not null default '{}'::jsonb,
  homepage_sections jsonb not null default '{}'::jsonb,
  navigation jsonb not null default '[]'::jsonb,
  footer jsonb not null default '{}'::jsonb,
  invoice jsonb not null default '{}'::jsonb,
  floating_whatsapp jsonb not null default '{}'::jsonb,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_settings_updated_at on public.settings;
create trigger trg_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- =========================================================
-- 3. Categories (self-referencing for subcategories)
-- =========================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique, -- preserves the existing localStorage id (c1, c2-1, ...)
  name text not null,
  description text,
  image_url text,
  icon text,                 -- optional emoji fallback; not required
  parent_id uuid references public.categories(id) on delete set null,
  display_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_categories_parent on public.categories(parent_id);
create index if not exists idx_categories_order on public.categories(display_order);
drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- =========================================================
-- 4. Products
-- =========================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique, -- preserves the existing localStorage id (p1..p12, ...)
  sku text,
  name text not null,
  short_description text,
  description text,
  category_id uuid references public.categories(id) on delete set null,
  price numeric(12,2) not null default 0,
  old_price numeric(12,2) not null default 0,
  stock int not null default 0,
  images text[] not null default '{}'::text[],  -- ordered array of URLs
  featured boolean not null default false,
  is_new boolean not null default false,
  on_sale boolean not null default false,
  most_sold boolean not null default false,
  active boolean not null default true,
  rating numeric(3,2) not null default 0,
  reviews int not null default 0,
  display_order int not null default 0,
  extra jsonb not null default '{}'::jsonb,  -- preserves any future custom fields
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_category on public.products(category_id);
create index if not exists idx_products_active on public.products(active);
create index if not exists idx_products_featured on public.products(featured);
create index if not exists idx_products_isnew on public.products(is_new);
create index if not exists idx_products_onsale on public.products(on_sale);
create index if not exists idx_products_mostsold on public.products(most_sold);
create index if not exists idx_products_createdat on public.products(created_at desc);
create index if not exists idx_products_legacy on public.products(legacy_id);
drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- =========================================================
-- 5. Product option types
-- =========================================================
-- A product can have multiple option dimensions (e.g. color, size, material).
-- The "type" label is free-form; common values today: 'color', 'size',
-- 'dimension', 'weight'. New values can be added without schema change.
create table if not exists public.product_option_types (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  type_key text not null,        -- machine key, e.g. 'color', 'size'
  display_name text not null,     -- human label, e.g. 'اللون', 'القياس'
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (product_id, type_key)
);
create index if not exists idx_opt_types_product on public.product_option_types(product_id);

-- =========================================================
-- 6. Product variants (option combinations + per-variant price/stock/image)
-- =========================================================
-- A variant is a specific combination of option values for a product
-- (e.g. color='black' AND size='large'). It carries its own price, stock, and
-- image, and its own active flag. The legacy 'type'/'value' fields are kept
-- for forward-compat with older code that referenced a single option, but new
-- combinations should use product_variant_options.
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  product_id uuid not null references public.products(id) on delete cascade,
  -- Legacy single-option fields (kept for backward compatibility).
  legacy_type text,
  legacy_value text,
  legacy_swatch text,
  -- Per-variant data
  price numeric(12,2) not null default 0,
  stock int not null default 0,
  image_url text,
  active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_variants_product on public.product_variants(product_id);
create index if not exists idx_variants_active on public.product_variants(active);
drop trigger if exists trg_variants_updated_at on public.product_variants;
create trigger trg_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

-- Many-to-many: which option values belong to a variant
-- (e.g. variant 42 has color='black' AND size='large')
create table if not exists public.product_variant_options (
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  option_type_id uuid not null references public.product_option_types(id) on delete cascade,
  value text not null,
  primary key (variant_id, option_type_id)
);
create index if not exists idx_pvo_option_type on public.product_variant_options(option_type_id);

-- =========================================================
-- 7. Inventory movements (append-only ledger)
-- =========================================================
-- Eventually server-authoritative inventory will be enforced via atomic
-- updates in product_variants.stock / products.stock. This ledger preserves
-- a complete history of every change for audit and reconciliation.
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  delta int not null,                  -- positive = inbound, negative = outbound
  reason text not null,                -- e.g. 'sale', 'restock', 'manual_adjustment'
  reference_id text,                   -- e.g. order id
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_inv_mov_product on public.inventory_movements(product_id, created_at desc);
create index if not exists idx_inv_mov_variant on public.inventory_movements(variant_id, created_at desc);

-- =========================================================
-- 8. Coupons
-- =========================================================
create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  code text not null unique,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  value numeric(12,2) not null check (value >= 0),
  min_order numeric(12,2) not null default 0,
  max_uses int not null default 0,           -- 0 = unlimited
  used int not null default 0,
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_coupons_active on public.coupons(active);
create index if not exists idx_coupons_expires on public.coupons(expires_at);
drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

-- =========================================================
-- 9. Delivery areas (Jordanian governorates)
-- =========================================================
create table if not exists public.delivery_areas (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null unique,
  shipping_cost numeric(12,2) not null default 0,
  active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_delivery_order on public.delivery_areas(display_order);
create index if not exists idx_delivery_active on public.delivery_areas(active);
drop trigger if exists trg_delivery_updated_at on public.delivery_areas;
create trigger trg_delivery_updated_at
  before update on public.delivery_areas
  for each row execute function public.set_updated_at();

-- =========================================================
-- 10. Offers & discounts (date-windowed product/category discounts)
-- =========================================================
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  target_type text not null check (target_type in ('product', 'category')),
  target_id uuid not null,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12,2) not null check (discount_value >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists idx_offers_target on public.offers(target_type, target_id);
create index if not exists idx_offers_active on public.offers(active, starts_at, ends_at);

-- =========================================================
-- 11. Orders
-- =========================================================
-- order_number is the server-generated human-readable id (e.g. AK_2026_1).
-- It is set by the create_order Edge Function / trigger to guarantee
-- monotonic, year-scoped numbering. status is constrained to the
-- approved set; "تم الاستلام" is intentionally NOT allowed.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,         -- e.g. 'AK_2026_1'
  customer_name text not null,
  customer_phone text not null,
  customer_address text not null,
  customer_city text,                        -- governorate name (free text for now)
  customer_extra jsonb not null default '{}'::jsonb,
  -- Monetary breakdown. NUMERIC(12,2) preserves 0.60, 1.50 etc. exactly.
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  shipping_cost numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  coupon_id uuid references public.coupons(id) on delete set null,
  coupon_code text,                          -- preserved snapshot even if coupon deleted
  delivery_area_id uuid references public.delivery_areas(id) on delete set null,
  delivery_area_name text,                  -- snapshot
  notes text,
  payment_method text not null default 'cod',
  status text not null default 'ordered'
    check (status in ('ordered', 'preparing', 'out_for_delivery', 'delivered', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_orders_phone on public.orders(customer_phone);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_orders_createdat on public.orders(created_at desc);
create index if not exists idx_orders_order_number on public.orders(order_number);
drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Order number generator: AK_<year>_<n>
create or replace function public.next_order_number()
returns text as $$
declare
  yr int := extract(year from now())::int;
  n int;
begin
  select count(*) + 1 into n
  from public.orders
  where order_number like 'AK_' || yr || '_%';
  return 'AK_' || yr || '_' || n;
end;
$$ language plpgsql stable;

-- =========================================================
-- 12. Order items
-- =========================================================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  product_name_snapshot text not null,   -- preserved even if product deleted
  variant_label_snapshot text,           -- e.g. 'color: black / size: large'
  image_snapshot text,
  unit_price numeric(12,2) not null,
  qty int not null check (qty > 0),
  line_total numeric(12,2) not null,
  options_snapshot jsonb not null default '[]'::jsonb,  -- [{type,value}]
  display_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_items_order on public.order_items(order_id, display_order);

-- =========================================================
-- 13. Audit log
-- =========================================================
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_entity on public.audit_log(entity_type, entity_id, created_at desc);
create index if not exists idx_audit_actor on public.audit_log(actor_id, created_at desc);

-- =========================================================
-- 14. RLS enable on every table
-- =========================================================
alter table public.profiles               enable row level security;
alter table public.settings               enable row level security;
alter table public.categories             enable row level security;
alter table public.products               enable row level security;
alter table public.product_option_types   enable row level security;
alter table public.product_variants       enable row level security;
alter table public.product_variant_options enable row level security;
alter table public.inventory_movements    enable row level security;
alter table public.coupons                enable row level security;
alter table public.delivery_areas         enable row level security;
alter table public.offers                 enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.audit_log              enable row level security;
