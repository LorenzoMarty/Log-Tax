-- Origin of person-profile values imported from an IRPF declaration or an income statement (#174).
-- Members read, only the owner writes. Gone with the workspace. `fields` = what was applied (field -> normalised value).
create table public.ir_imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  origin text not null check (origin in ('declaracao', 'informe_rendimentos')),
  file_sha256 text not null check (char_length(file_sha256) = 64),
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  created_at timestamptz not null default now()
);
create index on public.ir_imports (workspace_id, created_at);

revoke all on public.ir_imports from anon;
alter table public.ir_imports enable row level security;
create policy ir_imports_select on public.ir_imports for select to authenticated using (public.is_member(workspace_id));
create policy ir_imports_write on public.ir_imports for all to authenticated
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
