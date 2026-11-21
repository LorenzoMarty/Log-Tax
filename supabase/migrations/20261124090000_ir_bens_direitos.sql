-- Confirmed "Bens e Direitos" lines of the IRPF, taken from the patrimony assets (#182). One snapshot per workspace, year and asset;
-- the user confirms before a line lands here. Members read, only the owner writes. Gone with the workspace.
-- `codigo` (Receita group/item) stays null until the user confirms it: it is not guessed.
create table public.ir_bens_direitos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  asset_id uuid not null,
  description text not null check (char_length(description) between 1 and 200),
  value numeric(16, 2) not null check (value >= 0),
  acquired_at date,
  codigo text check (codigo is null or char_length(codigo) <= 10),
  created_at timestamptz not null default now(),
  unique (workspace_id, year, asset_id)
);

revoke all on public.ir_bens_direitos from anon;
alter table public.ir_bens_direitos enable row level security;
create policy ir_bens_select on public.ir_bens_direitos for select to authenticated using (public.is_member(workspace_id));
create policy ir_bens_write on public.ir_bens_direitos for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
