-- Phase 2 — Migration 004: Supabase Storage buckets
-- Run with: psql -f supabase/migrations/004_storage_buckets.sql
-- Creates three buckets:
--   media  (public)  — product, variant, category, hero, logo, favicon, announcement images
--   private (private) — admin-only files
--   invoices (private) — generated invoice PDFs (future)
-- A bucket is "public" if anyone with the URL can read; "private" means only
-- authorised users (with RLS policies) can read.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private', 'private', false, 26214400, null)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- =========================================================
-- Storage object RLS policies
-- =========================================================
-- The "media" bucket is public-readable so storefront images can be served
-- directly. Writes are admin-only.
drop policy if exists "media read public" on storage.objects;
create policy "media read public" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'media');

drop policy if exists "media write admin" on storage.objects;
create policy "media write admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "media update admin" on storage.objects;
create policy "media update admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'media' and public.is_admin())
  with check (bucket_id = 'media' and public.is_admin());

drop policy if exists "media delete admin" on storage.objects;
create policy "media delete admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());

-- "private" bucket: admin only for all operations.
drop policy if exists "private read admin" on storage.objects;
create policy "private read admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'private' and public.is_admin());

drop policy if exists "private write admin" on storage.objects;
create policy "private write admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'private' and public.is_admin());

drop policy if exists "private update admin" on storage.objects;
create policy "private update admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'private' and public.is_admin())
  with check (bucket_id = 'private' and public.is_admin());

drop policy if exists "private delete admin" on storage.objects;
create policy "private delete admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'private' and public.is_admin());

-- "invoices" bucket: admin only (signed URLs are issued server-side for
-- legitimate customer downloads in a later phase).
drop policy if exists "invoices read admin" on storage.objects;
create policy "invoices read admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'invoices' and public.is_admin());

drop policy if exists "invoices write admin" on storage.objects;
create policy "invoices write admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'invoices' and public.is_admin());
