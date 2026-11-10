-- Consent log: append-only, one row per acceptance or revocation, per purpose and policy version.
-- The current state of a purpose is its latest row. Written only through record_consent().
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  purpose text not null check (purpose in ('documents')),
  version text not null,
  action text not null check (action in ('granted', 'revoked')),
  created_at timestamptz not null default now()
);
create index on public.consents (user_id, purpose, created_at desc);
alter table public.consents enable row level security;
create policy consents_select on public.consents for select to authenticated using (user_id = (select auth.uid()));
create policy consents_aal2 on public.consents as restrictive for all to authenticated using (public.aal_ok()) with check (public.aal_ok());

create function public.record_consent(p_purpose text, p_version text, p_action text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.consents (user_id, purpose, version, action) values (auth.uid(), p_purpose, p_version, p_action);
end;
$$;

-- True when the person's latest decision for the purpose is a grant.
create function public.has_consent(p_purpose text) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select action = 'granted' from public.consents where user_id = auth.uid() and purpose = p_purpose order by created_at desc, id desc limit 1), false);
$$;

revoke all on function public.record_consent(text, text, text), public.has_consent(text) from public, anon;
grant execute on function public.record_consent(text, text, text), public.has_consent(text) to authenticated;

-- People who already uploaded documents consented at upload time (documents.consented_at): carry that over.
insert into public.consents (user_id, purpose, version, action, created_at)
select w.owner_id, 'documents', '2026-11', 'granted', min(d.consented_at)
from public.documents d join public.workspaces w on w.id = d.workspace_id
where d.consented_at is not null
group by w.owner_id;
