-- Scoped sharing by dashboard page (#152): a scope with kind 'dashboard' may list dashboardIds so the member reads
-- only those pages (null = every page, as before). Still RESTRICTIVE select policies: nothing existing is weakened.

alter table public.member_scopes add column dashboard_ids uuid[];

create function public.can_view_dashboard(ws uuid, page uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.member_scopes where workspace_id = ws and user_id = (select auth.uid())
  ) or exists (
    select 1 from public.member_scopes
    where workspace_id = ws and user_id = (select auth.uid()) and 'dashboard' = any (kinds)
      and (dashboard_ids is null or page = any (dashboard_ids))
  );
$$;

-- Workspace-wide dashboard data (versions, comments): only when the scope is not narrowed to some pages.
create function public.can_view_all_dashboards(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.member_scopes where workspace_id = ws and user_id = (select auth.uid())
  ) or exists (
    select 1 from public.member_scopes
    where workspace_id = ws and user_id = (select auth.uid()) and 'dashboard' = any (kinds) and dashboard_ids is null
  );
$$;

revoke execute on function public.can_view_dashboard(uuid, uuid), public.can_view_all_dashboards(uuid) from public, anon;
grant execute on function public.can_view_dashboard(uuid, uuid), public.can_view_all_dashboards(uuid) to authenticated;

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

drop policy dashboards_scope on public.dashboards;
create policy dashboards_scope on public.dashboards as restrictive for select to authenticated
  using (public.can_view_dashboard(workspace_id, id));
drop policy dashboard_versions_scope on public.dashboard_versions;
create policy dashboard_versions_scope on public.dashboard_versions as restrictive for select to authenticated
  using (public.can_view_all_dashboards(workspace_id));
drop policy comments_scope on public.comments;
create policy comments_scope on public.comments as restrictive for select to authenticated
  using (public.can_view_all_dashboards(workspace_id));
