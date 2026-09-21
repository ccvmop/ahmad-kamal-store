-- Migration 011: Diagnostic — check current DELETE grants on products/categories.
--
-- Run this FIRST in Supabase SQL Editor to see the current state.
-- Then run 010 to apply the fix.

-- 1. Show current table-level privileges for products
SELECT
  grantee,
  privilege_type,
  table_name
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('products', 'categories')
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

-- 2. Show RLS status
SELECT
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('products', 'categories');

-- 3. Show RLS policies for DELETE
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('products', 'categories')
  AND cmd IN ('ALL', 'DELETE');
