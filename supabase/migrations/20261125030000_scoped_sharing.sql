-- Scoped sharing (#152): the owner shares only SELECTED parts of the workspace (dashboard, documents, report).
-- A member with a row in member_scopes can read only what it allows; a member without one (every existing member,
-- the owner) is unchanged. Implemented as RESTRICTIVE select policies: they are ANDed with the existing permissive
-- ones, so no existing policy is touched or weakened.

create table public.member_scopes (
  workspace_id uuid not null,
  user_id uuid not null,
  kinds text[] not null check (kinds <> '{}' and kinds <@ array['dashboard', 'documents', 'report']),
  -- null = every document (when 'documents' is allowed); otherwise only these.
  document_ids uuid[],
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id) references public.workspace_members (workspace_id, user_id) on delete cascade
);
revoke all on public.member_scopes from anon, authenticated;
grant select on public.member_scopes to authenticated;
alter table public.member_scopes enable row level security;
-- Owner sees who is restricted; the member sees their own restriction. Nobody writes directly: only accept_invite.
create policy member_scopes_select on public.member_scopes for select to authenticated
  using (public.is_owner(workspace_id) or user_id = (select auth.uid()));

-- Scope carried by the invite: {"kinds": [...], "documentIds": [...]}; null = whole workspace (today's behaviour).
alter table public.workspace_invites add column scope jsonb;
alter table public.workspace_invites add constraint workspace_invites_scope_no_editor
  check (scope is null or role <> 'editor');

-- true when the caller has no scope (full access) or the scope allows `kind` ('full' is never allowed by a scope).
create function public.can_view(ws uuid, kind text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.member_scopes where workspace_id = ws and user_id = (select auth.uid())
  ) or exists (
    select 1 from public.member_scopes
    where workspace_id = ws and user_id = (select auth.uid()) and kind = any (kinds)
  );
$$;

-- Documents: kind 'documents' allowed and, when the scope lists ids, only those.
create function public.can_view_document(ws uuid, doc uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.member_scopes where workspace_id = ws and user_id = (select auth.uid())
  ) or exists (
    select 1 from public.member_scopes
    where workspace_id = ws and user_id = (select auth.uid()) and 'documents' = any (kinds)
      and (document_ids is null or doc = any (document_ids))
  );
$$;

create function public.can_view_document_object(path text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.can_view(public.object_workspace(path), 'documents')
    and (
      not exists (
        select 1 from public.member_scopes
        where workspace_id = public.object_workspace(path) and user_id = (select auth.uid()) and document_ids is not null
      )
      or exists (
        select 1 from public.documents d
        where d.workspace_id = public.object_workspace(path) and d.storage_path = path
          and public.can_view_document(d.workspace_id, d.id)
      )
    );
$$;

revoke execute on function public.can_view(uuid, text), public.can_view_document(uuid, uuid),
  public.can_view_document_object(text) from public, anon;
grant execute on function public.can_view(uuid, text), public.can_view_document(uuid, uuid),
  public.can_view_document_object(text) to authenticated;

-- accept_invite: also stores the scope (a re-invite without scope clears it).
create or replace function public.accept_invite(invite_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  inv public.workspace_invites;
begin
  select * into inv from public.workspace_invites
  where id = invite_id and email = lower(auth.jwt() ->> 'email');
  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  insert into public.workspace_members (workspace_id, user_id, role, email)
  values (inv.workspace_id, (select auth.uid()), inv.role, inv.email)
  on conflict (workspace_id, user_id) do update set role = excluded.role
    where public.workspace_members.role <> 'owner';
  if (select role from public.workspace_members where workspace_id = inv.workspace_id and user_id = (select auth.uid())) <> 'owner' then
    delete from public.member_scopes where workspace_id = inv.workspace_id and user_id = (select auth.uid());
    if inv.scope is not null then
      insert into public.member_scopes (workspace_id, user_id, kinds, document_ids)
      values (
        inv.workspace_id, (select auth.uid()),
        array(select jsonb_array_elements_text(inv.scope -> 'kinds')),
        case when jsonb_typeof(inv.scope -> 'documentIds') = 'array'
          then array(select jsonb_array_elements_text(inv.scope -> 'documentIds'))::uuid[] end
      );
    end if;
  end if;
  delete from public.workspace_invites where id = inv.id;
  return inv.workspace_id;
end;
$$;

-- Dashboard part: dashboards, their versions and comments.
create policy dashboards_scope on public.dashboards as restrictive for select to authenticated
  using (public.can_view(workspace_id, 'dashboard'));
create policy dashboard_versions_scope on public.dashboard_versions as restrictive for select to authenticated
  using (public.can_view(workspace_id, 'dashboard'));
create policy comments_scope on public.comments as restrictive for select to authenticated
  using (public.can_view(workspace_id, 'dashboard'));

-- Documents part (table + private bucket).
create policy documents_scope on public.documents as restrictive for select to authenticated
  using (public.can_view_document(workspace_id, id));
create policy documents_objects_scope on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'documents' or public.can_view_document_object(name));

-- Report part (history + private bucket).
create policy report_history_scope on public.report_history as restrictive for select to authenticated
  using (public.can_view(workspace_id, 'report'));
create policy reports_objects_scope on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'reports' or public.can_view(public.object_workspace(name), 'report'));

-- Everything else a member can read today stays hidden from a scoped member.
do $$
declare t text;
begin
  foreach t in array array['agents', 'alerts', 'alert_events', 'assets', 'estates', 'heirs', 'ir_imports', 'validations', 'ir_bens_direitos'] loop
    execute format(
      'create policy %I on public.%I as restrictive for select to authenticated using (public.can_view(workspace_id, ''full''))',
      t || '_scope', t);
  end loop;
end $$;
