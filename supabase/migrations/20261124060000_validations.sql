-- Professional review of an estimate (#154): an accountant marks a diagnosis or the opportunities as validated or contested.
-- A row is a fixed record of one review of one exact calculation (inputs_hash + rules_version, both set by the API);
-- whether it still holds is decided on read by comparing them with the current ones. Rows are never edited.
create table public.validations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subject text not null check (subject in ('diagnosis', 'opportunities')),
  status text not null check (status in ('validated', 'contested')),
  note text not null default '' check (char_length(note) <= 1000),
  inputs_hash text not null check (char_length(inputs_hash) between 1 and 128),
  rules_version text not null check (char_length(rules_version) between 1 and 60),
  validator_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  validator_email text,
  created_at timestamptz not null default now()
);
create index on public.validations (workspace_id, subject, created_at desc);

revoke all on public.validations from anon;
alter table public.validations enable row level security;
create policy validations_select on public.validations for select to authenticated using (public.is_member(workspace_id));
-- Commenter or above, and only as themselves.
create policy validations_insert on public.validations for insert to authenticated
  with check (validator_id = (select auth.uid()) and public.can_comment(workspace_id));
create policy validations_delete on public.validations for delete to authenticated
  using (validator_id = (select auth.uid()) and public.can_comment(workspace_id));
