-- NF-e imported in batch (#163): one row per invoice already counted into the company's monthly series, so importing the same
-- file (or the same invoice in another file) again adds nothing. Only the owner imports, so only the owner reads and writes.
create table public.nfe_imports (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  nfe_key text not null check (nfe_key ~ '^[0-9]{44}$'),
  -- sale = the company issued it (revenue); purchase = the company received it.
  kind text not null check (kind in ('sale', 'purchase')),
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount numeric(16, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (workspace_id, nfe_key)
);

revoke all on public.nfe_imports from anon;
alter table public.nfe_imports enable row level security;
create policy nfe_imports_owner on public.nfe_imports for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
