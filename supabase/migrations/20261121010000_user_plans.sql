-- The plan each person is on (#197). No row means "free". Only the billing back end (service role, #196) writes it;
-- a person can read their own plan but never upgrade themselves.
create table public.user_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  updated_at timestamptz not null default now()
);

revoke all on public.user_plans from anon;
revoke insert, update, delete on public.user_plans from authenticated;
alter table public.user_plans enable row level security;
create policy user_plans_own on public.user_plans for select to authenticated
  using (user_id = auth.uid());
