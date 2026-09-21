-- Phase 2 — Migration 003: Row Level Security policies
-- Run with: psql -f supabase/migrations/003_rls_policies.sql
-- All policies follow the principle of least privilege:
--   * Public/anonymous can only read data that is intentionally public.
--   * Write operations are restricted to admins (profiles.is_admin = true).
--   * No "USING (true) / WITH CHECK (true)" for unrestricted public writes.
--   * Customers cannot read, modify, or delete other customers' orders.

-- Helper: is_admin() — readable only from RLS policies.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

-- =========================================================
-- 1. profiles
-- =========================================================
-- A user can read their own profile; admins can read all.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- A user can update their own profile (but NOT the is_admin flag).
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid()));

-- Admins can manage all profiles.
drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 2. settings (singleton, public read)
-- =========================================================
-- Anyone (including anonymous) can read public store settings.
drop policy if exists settings_select_public on public.settings;
create policy settings_select_public on public.settings
  for select to anon, authenticated
  using (true);

-- Only admins can write.
drop policy if exists settings_admin_write on public.settings;
create policy settings_admin_write on public.settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 3. categories
-- =========================================================
-- Public read of active categories.
drop policy if exists categories_select_public on public.categories;
create policy categories_select_public on public.categories
  for select to anon, authenticated
  using (active = true or public.is_admin());

-- Admin write.
drop policy if exists categories_admin_all on public.categories;
create policy categories_admin_all on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 4. products
-- =========================================================
-- Public read of active products; admin sees all.
drop policy if exists products_select_public on public.products;
create policy products_select_public on public.products
  for select to anon, authenticated
  using (active = true or public.is_admin());

-- Admin write.
drop policy if exists products_admin_all on public.products;
create policy products_admin_all on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 5. product_option_types
-- =========================================================
-- Public read (mirrors product visibility).
drop policy if exists product_option_types_select_public on public.product_option_types;
create policy product_option_types_select_public on public.product_option_types
  for select to anon, authenticated
  using (public.is_admin()
         or exists (select 1 from public.products p
                    where p.id = product_option_types.product_id and p.active = true));

drop policy if exists product_option_types_admin_all on public.product_option_types;
create policy product_option_types_admin_all on public.product_option_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 6. product_variants + product_variant_options
-- =========================================================
drop policy if exists variants_select_public on public.product_variants;
create policy variants_select_public on public.product_variants
  for select to anon, authenticated
  using (public.is_admin()
         or (active = true and exists (select 1 from public.products p
                                       where p.id = product_variants.product_id and p.active = true)));

drop policy if exists variants_admin_all on public.product_variants;
create policy variants_admin_all on public.product_variants
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists pvo_select_public on public.product_variant_options;
create policy pvo_select_public on public.product_variant_options
  for select to anon, authenticated
  using (public.is_admin()
         or exists (select 1 from public.product_variants v
                    join public.products p on p.id = v.product_id
                    where v.id = product_variant_options.variant_id
                      and v.active = true and p.active = true));

drop policy if exists pvo_admin_all on public.product_variant_options;
create policy pvo_admin_all on public.product_variant_options
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 7. inventory_movements
-- =========================================================
-- Only admins may read or write the inventory ledger.
drop policy if exists inventory_movements_admin_all on public.inventory_movements;
create policy inventory_movements_admin_all on public.inventory_movements
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 8. coupons
-- =========================================================
-- Public can read only active coupons (needed to display the code in checkout
-- and validate at apply time). Other fields are not sensitive.
drop policy if exists coupons_select_public on public.coupons;
create policy coupons_select_public on public.coupons
  for select to anon, authenticated
  using (active = true or public.is_admin());

drop policy if exists coupons_admin_all on public.coupons;
create policy coupons_admin_all on public.coupons
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 9. delivery_areas
-- =========================================================
-- Public read of active delivery areas (checkout needs them).
drop policy if exists delivery_areas_select_public on public.delivery_areas;
create policy delivery_areas_select_public on public.delivery_areas
  for select to anon, authenticated
  using (active = true or public.is_admin());

drop policy if exists delivery_areas_admin_all on public.delivery_areas;
create policy delivery_areas_admin_all on public.delivery_areas
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 10. offers
-- =========================================================
-- Public read of active, in-window offers; admin sees all.
drop policy if exists offers_select_public on public.offers;
create policy offers_select_public on public.offers
  for select to anon, authenticated
  using ((active = true
          and now() between coalesce(starts_at, '-infinity'::timestamptz)
                     and coalesce(ends_at,   'infinity'::timestamptz))
         or public.is_admin());

drop policy if exists offers_admin_all on public.offers;
create policy offers_admin_all on public.offers
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 11. orders
-- =========================================================
-- SECURITY: We do NOT expose orders to anonymous users by phone. The current
-- "My Orders by phone" model is insecure and will be replaced by signed-in
-- customer access in a later phase. For now, orders are admin-only.
-- A signed-in customer will be able to read their own orders in the
-- customer-auth phase. Until then, admin is the only consumer.
drop policy if exists orders_admin_all on public.orders;
create policy orders_admin_all on public.orders
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 12. order_items
-- =========================================================
drop policy if exists order_items_admin_all on public.order_items;
create policy order_items_admin_all on public.order_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 13. audit_log
-- =========================================================
-- Only admins may read or write the audit log.
drop policy if exists audit_log_admin_all on public.audit_log;
create policy audit_log_admin_all on public.audit_log
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
