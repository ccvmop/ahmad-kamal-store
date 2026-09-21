-- Migration 010: Grant DELETE on products and categories to authenticated role.
--
-- Root cause: Migration 007 granted SELECT, INSERT, UPDATE but NOT DELETE
-- on products and categories. PostgreSQL checks table-level privileges
-- BEFORE evaluating RLS. Without DELETE grant, the authenticated role
-- receives 42501 "permission denied" even though RLS policies allow it.
--
-- The existing RLS policies (products_admin_all, categories_admin_all) use
-- "for all to authenticated" with is_admin() check, so they already cover
-- DELETE operations. Only the GRANT was missing.
--
-- Security:
--   - anon: NO DELETE on any table
--   - authenticated (admin): DELETE gated by is_admin() RLS policy
--   - service_role: bypasses RLS (dashboard only)

-- 1. products — add DELETE for admin product removal
GRANT DELETE ON public.products TO authenticated;

-- 2. categories — add DELETE for admin category removal
--    Note: products.category_id has ON DELETE SET NULL, so deleting a
--    category sets products.category_id to NULL (products are NOT deleted).
--    categories.parent_id has ON DELETE SET NULL, so child categories
--    become top-level categories.
GRANT DELETE ON public.categories TO authenticated;
