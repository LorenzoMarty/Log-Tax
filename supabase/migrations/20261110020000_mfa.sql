-- Optional two-factor (TOTP). Once a person has a verified factor, a session that has not passed the second
-- step (aal1) reads and writes nothing: RESTRICTIVE policies are ANDed with every existing policy.

-- True when the session is aal2, or when the person has no verified factor (MFA is optional).
create function public.aal_ok() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors where user_id = (select auth.uid()) and status = 'verified'
    );
$$;
revoke all on function public.aal_ok() from public, anon;
grant execute on function public.aal_ok() to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'workspaces', 'workspace_members', 'dashboards', 'agents', 'alerts', 'documents',
    'conversations', 'agent_conversations', 'workspace_invites', 'comments', 'audit_log'
  ] loop
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (public.aal_ok()) with check (public.aal_ok())', t || '_aal2', t);
  end loop;
end $$;

-- Same rule for stored documents.
create policy documents_objects_aal2 on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'documents' or public.aal_ok())
  with check (bucket_id <> 'documents' or public.aal_ok());

-- One-time recovery codes. Only hashes are stored, and only the server (service role) touches the table.
create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);
alter table public.mfa_recovery_codes enable row level security;
-- no policies: invisible to users; the service role bypasses RLS
