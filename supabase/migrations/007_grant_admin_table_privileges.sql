-- Migration 007: Grant all required table privileges to the authenticated role.
--
-- Root cause: Tables were created via SQL migration (002) without GRANT
-- statements. PostgreSQL checks table-level privileges BEFORE evaluating
-- RLS policies. Without a GRANT, the authenticated role receives 42501
-- "permission denied" before RLS can filter rows.
--
-- This migration grants the minimum required privileges on every table
-- the admin panel reads or writes. RLS policies (003) still control
-- WHICH rows are visible/editable. The anon role receives no additional
-- access beyond what already exists.
--
-- Security model:
--   - anon:  read-only on public-facing tables (settings, categories,
--           products, product_variants, product_option_types,
--           product_variant_options, coupons, delivery_areas, offers)
--   - authenticated (admin):  full CRUD on all tables, gated by RLS
--                             policies that check is_admin()
--   - service_role:  bypasses RLS entirely (dashboard only)

-- 1. settings (singleton, id=1)
GRANT SELECT ON public.settings TO authenticated;
GRANT UPDATE ON public.settings TO authenticated;

-- 2. products
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;

-- 3. categories
GRANT SELECT, INSERT, UPDATE ON public.categories TO authenticated;

-- 4. product_variants (includes DELETE for variant removal)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;

-- 5. product_option_types (read-only for admin via joined queries)
GRANT SELECT ON public.product_option_types TO authenticated;

-- 6. product_variant_options (read-only for admin via joined queries)
GRANT SELECT ON public.product_variant_options TO authenticated;

-- 7. orders (UPDATE status + DELETE)
GRANT SELECT, UPDATE, DELETE ON public.orders TO authenticated;

-- 8. order_items (read-only for admin order detail view)
GRANT SELECT ON public.order_items TO authenticated;

-- 9. delivery_areas (full CRUD)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_areas TO authenticated;

-- 10. coupons (full CRUD)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupons TO authenticated;

-- 11. offers (full CRUD)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.offers TO authenticated;

-- 12. inventory_movements (read + insert only)
GRANT SELECT, INSERT ON public.inventory_movements TO authenticated;
