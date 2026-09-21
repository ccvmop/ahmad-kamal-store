-- Migration 011: Add missing INSERT/UPDATE grants for orders and order_items.
--
-- Problem: Migration 007 granted SELECT, UPDATE, DELETE on orders
-- and SELECT only on order_items. The migration tool that copies
-- localStorage orders into Supabase needs INSERT on both tables
-- and UPDATE on order_items.
--
-- These grants do NOT weaken security because:
--   - RLS policies (003) still gate all access via is_admin()
--   - The anon role receives no new privileges

-- orders: add INSERT (missing from 007)
GRANT INSERT ON public.orders TO authenticated;

-- order_items: add INSERT and UPDATE (only SELECT was granted in 007)
GRANT INSERT, UPDATE ON public.order_items TO authenticated;
