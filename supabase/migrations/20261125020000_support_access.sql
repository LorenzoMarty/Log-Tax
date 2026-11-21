-- Support access and suspension (#201). A platform admin reads a person's workspace metadata only while that person
-- has an active grant (time-boxed, revocable by them alone), and every read is an audit row the person can see.

-- Audit rows may now be about another account: the target reads them too.
alter table public.audit_log add column target_user_id uuid;
create index on public.audit_log (target_user_id, created_at desc) where target_user_id is not null;
drop policy audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (
    public.is_owner(workspace_id)
    or (workspace_id is null and actor_id = (select auth.uid()))
    or target_user_id = (select auth.uid())
  );

-- Consent. Only the person writes it, only these columns, and never for more than 7 days.
create table public.support_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint support_grants_max_7_days check (expires_at > granted_at and expires_at <= granted_at + interval '7 days')
);
create index on public.support_grants (user_id, expires_at desc);
revoke all on public.support_grants from anon, authenticated;
grant select on public.support_grants to authenticated;
grant insert (expires_at) on public.support_grants to authenticated;
grant update (revoked_at) on public.support_grants to authenticated;
alter table public.support_grants enable row level security;
create policy support_grants_select on public.support_grants for select to authenticated using (user_id = (select auth.uid()));
create policy support_grants_insert on public.support_grants for insert to authenticated with check (user_id = (select auth.uid()));
create policy support_grants_update on public.support_grants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Suspension. A person can see their own status; only admin_set_suspended writes it.
create table public.user_status (
  user_id uuid primary key references auth.users (id) on delete cascade,
  suspended boolean not null default false,
  updated_at timestamptz not null default now()
);
revoke all on public.user_status from anon, authenticated;
grant select on public.user_status to authenticated;
alter table public.user_status enable row level security;
create policy user_status_own on public.user_status for select to authenticated using (user_id = (select auth.uid()));

-- Workspace metadata of one person: names, kinds, plan and counters. No documents, messages or profile content.
create function public.admin_support_view(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.support_grants
    where user_id = p_user and revoked_at is null and expires_at > now()
  ) then
    raise exception 'no_grant' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, actor_email, workspace_id, action, target, target_user_id)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), null, 'support_access', 'workspaces', p_user);
  select jsonb_build_object(
    'user_id', p_user,
    'plan', coalesce((select plan from public.user_plans where user_id = p_user), 'free'),
    'suspended', coalesce((select suspended from public.user_status where user_id = p_user), false),
    'workspaces', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.name, 'kind', w.kind, 'created_at', w.created_at,
        'documents', (select count(*) from public.documents d where d.workspace_id = w.id),
        'dashboards', (select count(*) from public.dashboards d where d.workspace_id = w.id),
        'agents', (select count(*) from public.agents a where a.workspace_id = w.id),
        'members', (select count(*) from public.workspace_members m where m.workspace_id = w.id)
      ) order by w.created_at) from public.workspaces w where w.owner_id = p_user), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_support_view(uuid) from public, anon;
grant execute on function public.admin_support_view(uuid) to authenticated;

create function public.admin_set_suspended(p_user uuid, p_suspended boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user = auth.uid() or exists (select 1 from public.platform_admins where user_id = p_user) then
    raise exception 'cannot suspend an admin' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  insert into public.user_status (user_id, suspended) values (p_user, p_suspended)
  on conflict (user_id) do update set suspended = excluded.suspended, updated_at = now();
  insert into public.audit_log (actor_id, actor_email, workspace_id, action, target, target_user_id)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), null,
          case when p_suspended then 'account_suspended' else 'account_reactivated' end, null, p_user);
end;
$$;
revoke all on function public.admin_set_suspended(uuid, boolean) from public, anon;
grant execute on function public.admin_set_suspended(uuid, boolean) to authenticated;
