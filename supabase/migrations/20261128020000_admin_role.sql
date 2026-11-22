-- Administrator role and ownership transfer (#156).
-- An admin has the owner's powers over the workspace's data and people (invite, remove, share, agents, integrations,
-- reports...) but never: deletes/renames the workspace, transfers it, removes or demotes the owner, makes other admins,
-- or reads/writes the owner's private AI conversation.
-- How: is_owner() (used by every owner-only policy) now also accepts 'admin'; the few things that must stay with the
-- real owner move to is_workspace_owner(). No existing policy loses a restriction: only a role nobody has yet gains access.

alter table public.workspace_members drop constraint workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('owner', 'admin', 'editor', 'commenter', 'reader'));
alter table public.workspace_invites drop constraint workspace_invites_role_check;
alter table public.workspace_invites add constraint workspace_invites_role_check
  check (role in ('admin', 'editor', 'commenter', 'reader'));
-- An admin has full access: never a scoped (restricted) member.
alter table public.workspace_invites drop constraint workspace_invites_scope_no_editor;
alter table public.workspace_invites add constraint workspace_invites_scope_no_editor
  check (scope is null or role not in ('editor', 'admin'));

-- The real owner only.
create function public.is_workspace_owner(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role = 'owner'
  );
$$;
revoke execute on function public.is_workspace_owner(uuid) from public, anon;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

-- Owner or admin.
create or replace function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role in ('owner', 'admin')
  );
$$;

create or replace function public.can_edit(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role in ('owner', 'admin', 'editor')
  );
$$;

create or replace function public.can_comment(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role in ('owner', 'admin', 'editor', 'commenter')
  );
$$;

-- Rename/delete the workspace: the real owner only (owner_id is also what an update could otherwise hijack).
drop policy workspaces_update on public.workspaces;
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.is_workspace_owner(id)) with check (public.is_workspace_owner(id) and owner_id = (select auth.uid()));
drop policy workspaces_delete on public.workspaces;
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.is_workspace_owner(id));

-- The AI conversation stays private to the real owner.
drop policy conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (public.is_workspace_owner(workspace_id));
drop policy conversations_write on public.conversations;
create policy conversations_write on public.conversations for all to authenticated
  using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));
drop policy agent_conversations_select on public.agent_conversations;
create policy agent_conversations_select on public.agent_conversations for select to authenticated
  using (public.is_workspace_owner(workspace_id));
drop policy agent_conversations_write on public.agent_conversations;
create policy agent_conversations_write on public.agent_conversations for all to authenticated
  using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

-- Members: the owner removes anyone but the owner; an admin removes only non-admins; anyone may leave (not the owner).
drop policy members_delete on public.workspace_members;
create policy members_delete on public.workspace_members for delete to authenticated
  using (
    role <> 'owner'
    and (
      public.is_workspace_owner(workspace_id)
      or (public.is_owner(workspace_id) and role <> 'admin')
      or user_id = (select auth.uid())
    )
  );

-- Invites: only the real owner makes an admin.
drop policy invites_insert on public.workspace_invites;
create policy invites_insert on public.workspace_invites for insert to authenticated
  with check (
    public.is_owner(workspace_id) and invited_by = (select auth.uid())
    and (role <> 'admin' or public.is_workspace_owner(workspace_id))
  );

-- An invite never changes the role of an owner or an admin (use set_member_role for that).
-- Keeps the page cut of 20261128010000_scoped_dashboard_pages.sql (dashboard_ids): this definition replaces that one, so
-- dropping the column here would silently widen a page-scoped invite to every page.
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
    where public.workspace_members.role not in ('owner', 'admin');
  if (select role from public.workspace_members where workspace_id = inv.workspace_id and user_id = (select auth.uid())) not in ('owner', 'admin') then
    delete from public.member_scopes where workspace_id = inv.workspace_id and user_id = (select auth.uid());
    if inv.scope is not null then
      insert into public.member_scopes (workspace_id, user_id, kinds, document_ids, dashboard_ids)
      values (
        inv.workspace_id, (select auth.uid()),
        array(select jsonb_array_elements_text(inv.scope -> 'kinds')),
        case when jsonb_typeof(inv.scope -> 'documentIds') = 'array'
          then array(select jsonb_array_elements_text(inv.scope -> 'documentIds'))::uuid[] end,
        case when jsonb_typeof(inv.scope -> 'dashboardIds') = 'array'
          then array(select jsonb_array_elements_text(inv.scope -> 'dashboardIds'))::uuid[] end
      );
    end if;
  end if;
  delete from public.workspace_invites where id = inv.id;
  return inv.workspace_id;
end;
$$;

-- Change a member's role (the only way to promote to or demote from admin): the real owner only, never the owner row.
create function public.set_member_role(ws uuid, member uuid, new_role text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_workspace_owner(ws) then
    raise exception 'only the owner changes roles' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'editor', 'commenter', 'reader') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  update public.workspace_members set role = new_role
  where workspace_id = ws and user_id = member and role <> 'owner';
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  -- Full access is never scoped.
  if new_role in ('admin', 'editor') then
    delete from public.member_scopes where workspace_id = ws and user_id = member;
  end if;
end;
$$;

-- Hand the workspace to another member: they become owner, the previous owner stays as admin.
create function public.transfer_ownership(ws uuid, new_owner uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if not public.is_workspace_owner(ws) then
    raise exception 'only the owner transfers ownership' using errcode = '42501';
  end if;
  if new_owner = me then
    raise exception 'already the owner' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = ws and user_id = new_owner) then
    raise exception 'new owner must be a member' using errcode = 'P0002';
  end if;
  update public.workspaces set owner_id = new_owner where id = ws;
  update public.workspace_members set role = 'owner' where workspace_id = ws and user_id = new_owner;
  update public.workspace_members set role = 'admin' where workspace_id = ws and user_id = me;
  delete from public.member_scopes where workspace_id = ws and user_id = new_owner;
  insert into public.audit_log (actor_id, actor_email, workspace_id, action, target)
  values (me, (select email from auth.users where id = me), ws, 'ownership_transferred', new_owner::text);
end;
$$;
revoke execute on function public.set_member_role(uuid, uuid, text), public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text), public.transfer_ownership(uuid, uuid) to authenticated;

-- The owner is told of other people's comments (an admin's comment counts as someone else's).
create or replace function public.notify_owner_of_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_workspace_owner(new.workspace_id) then
    insert into public.alert_events (workspace_id, comment_id, text, current_text)
    values (new.workspace_id, new.id,
      case when new.parent_id is null then 'Novo comentário' else 'Nova resposta' end || ' de ' || new.author_email,
      left(new.body, 140));
  end if;
  return new;
end;
$$;

-- An admin's writes land in the audit trail like an editor's.
create or replace function public.audit_editor_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  ws uuid := (r ->> 'workspace_id')::uuid;
  who text := (select role from public.workspace_members where workspace_id = ws and user_id = (select auth.uid()));
begin
  if who in ('editor', 'admin') then
    insert into public.audit_log (actor_id, actor_email, workspace_id, action, target)
    values ((select auth.uid()), (select email from auth.users where id = (select auth.uid())), ws,
      who || '_' || lower(tg_op), left(tg_table_name || ':' || coalesce(r ->> 'id', ''), 300));
  end if;
  return null;
end;
$$;
