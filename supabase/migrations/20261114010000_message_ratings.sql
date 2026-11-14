-- User feedback on the AI's answers (#121). A rating points at the message by its position in the workspace's
-- conversation; deleting the conversation deletes its ratings. Only the owner chats, so only the owner rates.
create table public.message_ratings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  message_index integer not null check (message_index >= 0),
  rating smallint not null check (rating in (-1, 1)),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id, message_index)
);

revoke all on public.message_ratings from anon;
alter table public.message_ratings enable row level security;
create policy message_ratings_own on public.message_ratings for all to authenticated
  using (public.is_owner(workspace_id) and user_id = (select auth.uid()))
  with check (public.is_owner(workspace_id) and user_id = (select auth.uid()));
