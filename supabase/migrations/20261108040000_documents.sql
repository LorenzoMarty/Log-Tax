-- Document uploads: a private bucket whose first path segment is the workspace id,
-- plus LGPD consent evidence on every record.

alter table public.documents
  add column mime_type text,
  add column size_bytes bigint,
  add column consented_at timestamptz;

-- Safe uuid parse of the first path segment (null when it is not a uuid).
create function public.object_workspace(path text) returns uuid
language plpgsql immutable
as $$
begin
  return split_part(path, '/', 1)::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function public.object_workspace(text) to authenticated;

-- Writes: only the owner, only with consent, and the file must live inside the same workspace.
drop policy documents_write on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    public.is_owner(workspace_id)
    and consented_at is not null
    and storage_path is not null
    and public.object_workspace(storage_path) = workspace_id
  );
create policy documents_update on public.documents for update to authenticated
  using (public.is_owner(workspace_id))
  with check (public.is_owner(workspace_id) and public.object_workspace(storage_path) = workspace_id);
create policy documents_delete on public.documents for delete to authenticated
  using (public.is_owner(workspace_id));

-- Private bucket, 10 MB, a short list of document types.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 10485760,
  array['application/pdf', 'application/xml', 'text/xml', 'text/plain', 'image/png', 'image/jpeg']
)
on conflict (id) do nothing;

-- Same rule as the table: members read, only the owner writes, always inside their workspace's folder.
create policy documents_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_member(public.object_workspace(name)));
create policy documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_owner(public.object_workspace(name)));
create policy documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.is_owner(public.object_workspace(name)));
