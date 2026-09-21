-- Migration 015: Grant SELECT to anon on public-facing tables.
--
-- Root cause: The storefront runs as the anon role. PostgreSQL checks
-- table-level privileges BEFORE evaluating RLS policies. Without a
-- SELECT grant, anon receives 42501 "permission denied" even though
-- RLS policies (categories_select_public, products_select_public,
-- offers_select_public, coupons_select_public,
-- delivery_areas_select_public) correctly allow reading active rows.
--
-- Security:
--   - anon: SELECT only. INSERT/UPDATE/DELETE remain denied.
--   - RLS policies still filter rows (active = true, date window, etc.)
--   - orders/order_items: NO grants to anon (intentional).

GRANT SELECT ON TABLE
  public.categories,
  public.products,
  public.offers,
  public.coupons,
  public.delivery_areas
TO anon;
