-- Append-only audit trail. Rows are written only through audit_record() (security definer); no role has an
-- insert/update/delete policy, so nobody can edit or erase history. No foreign keys on purpose: the record must
-- outlive the workspace or the account it talks about.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  actor_email text,
  workspace_id uuid,
  action text not null,
  target text,
  created_at timestamptz not null default now()
);
create index on public.audit_log (workspace_id, created_at desc);
create index on public.audit_log (actor_id, created_at desc);
alter table public.audit_log enable row level security;

-- The owner reads the activity of the workspace; anyone reads their own account events (login, export, deletion).
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_owner(workspace_id) or (workspace_id is null and actor_id = (select auth.uid())));

-- Records one event for the caller. A workspace event is accepted only from a member of that workspace
-- (or, for the removal of a member, from its owner, who is a member too).
create function public.audit_record(p_workspace uuid, p_action text, p_target text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_workspace is not null and not public.is_member(p_workspace) then
    raise exception 'not a member of this workspace';
  end if;
  insert into public.audit_log (actor_id, actor_email, workspace_id, action, target)
  values (v_uid, (select email from auth.users where id = v_uid), p_workspace, left(p_action, 60), left(p_target, 300));
end;
$$;

revoke all on function public.audit_record(uuid, text, text) from public, anon;
grant execute on function public.audit_record(uuid, text, text) to authenticated;
