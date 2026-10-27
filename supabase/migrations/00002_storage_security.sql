-- ===========================================================================
-- DocuFlow AI — private storage bucket and owner-scoped policies
-- ===========================================================================

-- Create a private bucket for invoices. `file_size_limit` enforces a 5 MB
-- cap server-side, and `allowed_mime_types` restricts acceptable content.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices',
  'invoices',
  false,
  5242880,  -- 5 MB
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage objects live under "<user_id>/<filename>". These policies scope every
-- object to the authenticated owner's own folder, so a user can never read or
-- write another user's files. Uploads happen directly from the browser using
-- the authenticated (anon) key, which is why INSERT is granted here.
create policy invoices_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy invoices_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy invoices_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy invoices_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'invoices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
