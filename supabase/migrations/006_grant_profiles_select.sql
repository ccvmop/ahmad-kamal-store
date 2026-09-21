-- Migration 006: Grant SELECT on profiles to authenticated role.
--
-- Root cause: PostgreSQL checks table-level privileges BEFORE RLS.
-- The RLS policy profiles_select_self allows authenticated users to read
-- their own row (id = auth.uid()), but the authenticated role had no
-- base SELECT privilege on public.profiles, so the query was denied
-- with 42501 before RLS was ever evaluated.
--
-- This GRANT gives the authenticated role the minimum privilege needed
-- to query profiles. RLS still controls WHICH rows are visible.
-- The anon role is NOT granted any access to profiles.

GRANT SELECT ON public.profiles TO authenticated;
