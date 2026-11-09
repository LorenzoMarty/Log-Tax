-- Sharing a workspace with other people (e.g. the accountant): invites, roles, comments.
-- Roles: owner (everything), commenter (read + comment), reader (read only).

-- ---- members: show who they are, restrict who sees whom, allow leaving/removal ----
alter table public.workspace_members add column email text;
update public.workspace_members m set email = u.email from auth.users u where u.id = m.user_id;

create or replace function public.add_owner_member() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role, email)
  values (new.id, new.owner_id, 'owner', (select email from auth.users where id = new.owner_id));
  return new;
end;
$$;

-- The owner sees every member; everyone else sees only their own row.
drop policy members_select on public.workspace_members;
create policy members_select on public.workspace_members for select to authenticated
  using (public.is_owner(workspace_id) or user_id = (select auth.uid()));

-- The owner can remove members, a member can leave; the owner row can never be removed.
create policy members_delete on public.workspace_members for delete to authenticated
  using (role <> 'owner' and (public.is_owner(workspace_id) or user_id = (select auth.uid())));

-- Role of the current user in a workspace (null if not a member).
create function public.my_role(ws uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select role from public.workspace_members where workspace_id = ws and user_id = (select auth.uid());
$$;

create function public.can_comment(ws uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = (select auth.uid()) and role in ('owner', 'commenter')
  );
$$;

-- The AI conversation is private to the owner (a shared workspace shows dashboards, alerts and agents).
drop policy conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (public.is_owner(workspace_id));
drop policy agent_conversations_select on public.agent_conversations;
create policy agent_conversations_select on public.agent_conversations for select to authenticated
  using (public.is_owner(workspace_id));

-- ---- invites ----
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Denormalised so the invitee can see what they were invited to before being a member.
  workspace_name text not null,
  email text not null check (email = lower(email) and email like '%_@_%'),
  role text not null check (role in ('commenter', 'reader')),
  invited_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  invited_by_email text not null default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create index on public.workspace_invites (email);

revoke all on public.workspace_invites from anon;
alter table public.workspace_invites enable row level security;

-- The owner sees the workspace's invites; an invitee sees only their own.
create policy invites_select on public.workspace_invites for select to authenticated
  using (public.is_owner(workspace_id) or email = lower(auth.jwt() ->> 'email'));
create policy invites_insert on public.workspace_invites for insert to authenticated
  with check (public.is_owner(workspace_id) and invited_by = (select auth.uid()));
create policy invites_delete on public.workspace_invites for delete to authenticated
  using (public.is_owner(workspace_id) or email = lower(auth.jwt() ->> 'email'));

-- Accepting is the only way to become a member: checks the invite is for the caller's email.
create function public.accept_invite(invite_id uuid) returns uuid
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
  delete from public.workspace_invites where id = inv.id;
  return inv.workspace_id;
end;
$$;

revoke execute on function public.accept_invite(uuid), public.my_role(uuid), public.can_comment(uuid) from public, anon;
grant execute on function public.accept_invite(uuid), public.my_role(uuid), public.can_comment(uuid) to authenticated;

-- ---- comments on the dashboard ----
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- Optional: which dashboard block the comment is about.
  widget_id text,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_email text not null default (auth.jwt() ->> 'email'),
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index on public.comments (workspace_id, created_at);

revoke all on public.comments from anon;
alter table public.comments enable row level security;

create policy comments_select on public.comments for select to authenticated
  using (public.is_member(workspace_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_comment(workspace_id));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_owner(workspace_id));
