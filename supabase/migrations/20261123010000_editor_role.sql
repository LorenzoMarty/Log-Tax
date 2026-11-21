-- Editor role (#151): may change dashboards, documents, alerts and assets; may comment.
-- Never: delete the workspace, manage members/invites, agents, integrations, billing, consents, AI conversation.
-- Everything not listed below keeps using is_owner() and so stays owner-only.

alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'editor', 'commenter', 'reader'));
alter table public.workspace_invites drop constraint workspace_invites_role_check;
alter table public.workspace_invites add constraint workspace_invites_role_check
  check (role in ('editor', 'commenter', 'reader'));

create function public.can_edit(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role in ('owner', 'editor')
  );
$$;
revoke execute on function public.can_edit(uuid) from public, anon;
grant execute on function public.can_edit(uuid) to authenticated;

-- An editor comments like a commenter.
create or replace function public.can_comment(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role in ('owner', 'editor', 'commenter')
  );
$$;

-- dashboards, alerts, assets: write = can_edit
drop policy dashboards_write on public.dashboards;
create policy dashboards_write on public.dashboards for all to authenticated
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
drop policy alerts_write on public.alerts;
create policy alerts_write on public.alerts for all to authenticated
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));
drop policy assets_write on public.assets;
create policy assets_write on public.assets for all to authenticated
  using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));

-- documents (table + private bucket)
drop policy documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    public.can_edit(workspace_id)
    and consented_at is not null
    and storage_path is not null
    and public.object_workspace(storage_path) = workspace_id
  );
drop policy documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (public.can_edit(workspace_id))
  with check (public.can_edit(workspace_id) and public.object_workspace(storage_path) = workspace_id);
drop policy documents_delete on public.documents;
create policy documents_delete on public.documents for delete to authenticated
  using (public.can_edit(workspace_id));
drop policy documents_objects_insert on storage.objects;
create policy documents_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_edit(public.object_workspace(name)));
drop policy documents_objects_delete on storage.objects;
create policy documents_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and public.can_edit(public.object_workspace(name)));

-- Every write by an editor lands in the audit trail (the owner reads it).
create function public.audit_editor_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  ws uuid := (r ->> 'workspace_id')::uuid;
begin
  if (select role from public.workspace_members where workspace_id = ws and user_id = (select auth.uid())) = 'editor' then
    insert into public.audit_log (actor_id, actor_email, workspace_id, action, target)
    values ((select auth.uid()), (select email from auth.users where id = (select auth.uid())), ws,
      'editor_' || lower(tg_op), left(tg_table_name || ':' || coalesce(r ->> 'id', ''), 300));
  end if;
  return null;
end;
$$;
revoke execute on function public.audit_editor_write() from public, anon, authenticated;
create trigger dashboards_audit_editor after insert or update or delete on public.dashboards
  for each row execute function public.audit_editor_write();
create trigger alerts_audit_editor after insert or update or delete on public.alerts
  for each row execute function public.audit_editor_write();
create trigger assets_audit_editor after insert or update or delete on public.assets
  for each row execute function public.audit_editor_write();
create trigger documents_audit_editor after insert or update or delete on public.documents
  for each row execute function public.audit_editor_write();
