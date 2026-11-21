-- Tax rules administration (#202): rule versions published at runtime, with a two-person review and a reference-case gate.
-- The tables are closed to every client role: rows change only through the security-definer functions below, which
-- require a platform admin (#201), append an audit row, and enforce the four-eyes rule in SQL.
-- audit_log.action has no CHECK constraint (free text, left(…, 60)), so the new action names need no migration there.

create table public.rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_id text not null check (rule_id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  version integer not null check (version >= 1),
  name text not null,
  jurisdiction text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_url text not null check (source_url ~ '^https?://'),
  valid_from text not null check (valid_from ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  valid_until text check (valid_until ~ '^\d{4}-(0[1-9]|1[0-2])$' and valid_until >= valid_from),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  requires_validation boolean not null default true,
  notes text,
  status text not null default 'proposed' check (status in ('draft', 'proposed', 'approved', 'rejected')),
  created_by uuid not null references auth.users (id),
  approved_by uuid references auth.users (id),
  approved_hash text, -- content hash at the moment of approval
  reject_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (rule_id, version),
  -- four eyes, also as a table constraint: nobody approves their own proposal, whatever path writes the row
  constraint rule_versions_two_people check (approved_by is null or approved_by <> created_by),
  constraint rule_versions_approved_has_approver check (status <> 'approved' or (approved_by is not null and approved_hash is not null))
);
create index on public.rule_versions (rule_id, valid_from);
alter table public.rule_versions enable row level security;
revoke all on public.rule_versions from anon, authenticated;
-- The engine may read what is approved (public tax law); everything else is for admins, through the functions below.
grant select on public.rule_versions to authenticated;
create policy rule_versions_read_approved on public.rule_versions for select to authenticated using (status = 'approved');

create table public.rule_reference_cases (
  id uuid primary key default gen_random_uuid(),
  rule_id text not null check (rule_id ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  name text not null check (length(name) between 1 and 200),
  competence text not null check (competence ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  inputs jsonb not null,
  expected jsonb not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index on public.rule_reference_cases (rule_id);
alter table public.rule_reference_cases enable row level security; -- no policy: closed to every client role
revoke all on public.rule_reference_cases from anon, authenticated;

create table public.rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.rule_versions (id) on delete cascade,
  payload_hash text not null,
  cases_hash text not null,
  passed boolean not null,
  results jsonb not null default '[]',
  evaluated_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index on public.rule_evaluations (version_id, created_at desc);
alter table public.rule_evaluations enable row level security; -- no policy: closed to every client role
revoke all on public.rule_evaluations from anon, authenticated;

-- An approved version is frozen: its content cannot change, only be read.
create function public.rule_versions_freeze() returns trigger
language plpgsql as $$
begin
  if old.status = 'approved' and (
       new.payload is distinct from old.payload or new.rule_id <> old.rule_id or new.valid_from <> old.valid_from
       or new.valid_until is distinct from old.valid_until or new.source_url <> old.source_url
       or new.confidence <> old.confidence or new.status <> old.status or new.approved_by is distinct from old.approved_by) then
    raise exception 'approved_is_frozen' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger rule_versions_freeze before update on public.rule_versions
  for each row execute function public.rule_versions_freeze();

-- Content hash of one version: every field that changes what the engine would compute. jsonb::text is canonical.
create function public.rule_content_hash(p_version uuid) returns text
language sql stable security definer set search_path = public
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'rule_id', rule_id, 'name', name, 'jurisdiction', jurisdiction, 'payload', payload, 'source_url', source_url,
    'valid_from', valid_from, 'valid_until', valid_until, 'confidence', confidence,
    'requires_validation', requires_validation)::text, 'utf8')), 'hex')
  from public.rule_versions where id = p_version
$$;
revoke all on function public.rule_content_hash(uuid) from public, anon, authenticated;

-- Hash of the reference cases attached to a rule: removing or editing a failing case after evaluation voids the evaluation.
create function public.rule_cases_hash(p_rule text) returns text
language sql stable security definer set search_path = public
as $$
  select encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'competence', competence, 'inputs', inputs, 'expected', expected) order by id), '[]'::jsonb)::text,
    'utf8')), 'hex')
  from public.rule_reference_cases where rule_id = p_rule
$$;
revoke all on function public.rule_cases_hash(text) from public, anon, authenticated;

create function public.rules_admin_guard(p_action text, p_target text) returns uuid
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.audit_log (actor_id, actor_email, workspace_id, action, target)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), null, p_action, left(p_target, 300));
  return auth.uid();
end;
$$;
revoke all on function public.rules_admin_guard(text, text) from public, anon, authenticated;

create function public.admin_rules_list() returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform public.rules_admin_guard('admin_rules_list', null);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', v.id, 'rule_id', v.rule_id, 'version', v.version, 'name', v.name, 'jurisdiction', v.jurisdiction,
    'source_url', v.source_url, 'valid_from', v.valid_from, 'valid_until', v.valid_until, 'confidence', v.confidence,
    'requires_validation', v.requires_validation, 'status', v.status, 'created_by', v.created_by,
    'approved_by', v.approved_by, 'created_at', v.created_at, 'decided_at', v.decided_at)
    order by v.rule_id, v.version) from public.rule_versions v), '[]'::jsonb);
end;
$$;

create function public.admin_rule_get(p_version uuid) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.rule_versions;
begin
  perform public.rules_admin_guard('admin_rule_get', p_version::text);
  select * into v from public.rule_versions where id = p_version;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', v.id, 'rule_id', v.rule_id, 'version', v.version, 'name', v.name, 'jurisdiction', v.jurisdiction,
    'payload', v.payload, 'source_url', v.source_url, 'valid_from', v.valid_from, 'valid_until', v.valid_until,
    'confidence', v.confidence, 'requires_validation', v.requires_validation, 'notes', v.notes, 'status', v.status,
    'created_by', v.created_by, 'approved_by', v.approved_by, 'reject_reason', v.reject_reason,
    'created_at', v.created_at, 'decided_at', v.decided_at,
    'payload_hash', public.rule_content_hash(v.id), 'cases_hash', public.rule_cases_hash(v.rule_id),
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'competence', c.competence,
        'inputs', c.inputs, 'expected', c.expected) order by c.id)
      from public.rule_reference_cases c where c.rule_id = v.rule_id), '[]'::jsonb),
    'evaluation', (select jsonb_build_object('passed', e.passed, 'payload_hash', e.payload_hash, 'cases_hash', e.cases_hash,
        'results', e.results, 'created_at', e.created_at)
      from public.rule_evaluations e where e.version_id = v.id order by e.created_at desc limit 1));
end;
$$;

create function public.admin_rule_case_add(p_rule text, p_name text, p_competence text, p_inputs jsonb, p_expected jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.rules_admin_guard('admin_rule_case_add', p_rule);
  v_id uuid;
begin
  insert into public.rule_reference_cases (rule_id, name, competence, inputs, expected, created_by)
  values (p_rule, p_name, p_competence, p_inputs, p_expected, v_uid) returning id into v_id;
  return v_id;
end;
$$;

create function public.admin_rule_case_remove(p_case uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.rules_admin_guard('admin_rule_case_remove', p_case::text);
  delete from public.rule_reference_cases where id = p_case;
end;
$$;

create function public.admin_rule_propose(
  p_rule text, p_name text, p_jurisdiction text, p_payload jsonb, p_source_url text,
  p_valid_from text, p_valid_until text, p_confidence text, p_requires_validation boolean default true, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.rules_admin_guard('admin_rule_propose', p_rule);
  v_id uuid;
begin
  insert into public.rule_versions (rule_id, version, name, jurisdiction, payload, source_url, valid_from, valid_until,
    confidence, requires_validation, notes, status, created_by)
  values (p_rule, coalesce((select max(version) from public.rule_versions where rule_id = p_rule), 0) + 1, p_name,
    p_jurisdiction, p_payload, p_source_url, p_valid_from, p_valid_until, p_confidence, p_requires_validation, p_notes,
    'proposed', v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- Records what the engine said about this exact content and these exact cases. Refused when the caller's hashes are
-- not the current ones (the payload or the cases changed since the API read them).
create function public.admin_rule_record_evaluation(p_version uuid, p_payload_hash text, p_cases_hash text, p_passed boolean, p_results jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.rules_admin_guard('admin_rule_record_evaluation', p_version::text);
  v public.rule_versions;
begin
  select * into v from public.rule_versions where id = p_version for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status <> 'proposed' then raise exception 'not_proposed' using errcode = 'P0001'; end if;
  if p_payload_hash is distinct from public.rule_content_hash(p_version)
     or p_cases_hash is distinct from public.rule_cases_hash(v.rule_id) then
    raise exception 'hash_mismatch' using errcode = 'P0001';
  end if;
  insert into public.rule_evaluations (version_id, payload_hash, cases_hash, passed, results, evaluated_by)
  values (p_version, p_payload_hash, p_cases_hash, p_passed, coalesce(p_results, '[]'), v_uid);
end;
$$;

create function public.admin_rule_approve(p_version uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.rules_admin_guard('admin_rule_approve', p_version::text);
  v public.rule_versions;
  v_hash text;
begin
  select * into v from public.rule_versions where id = p_version for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status <> 'proposed' then raise exception 'not_proposed' using errcode = 'P0001'; end if;
  if v.created_by = v_uid then raise exception 'same_person' using errcode = '42501'; end if;
  v_hash := public.rule_content_hash(p_version);
  if not exists (
    select 1 from public.rule_evaluations e
    where e.version_id = p_version and e.passed and e.payload_hash = v_hash
      and e.cases_hash = public.rule_cases_hash(v.rule_id)
      and (select count(*) from public.rule_reference_cases where rule_id = v.rule_id) > 0
      and e.id = (select id from public.rule_evaluations where version_id = p_version order by created_at desc, id limit 1)
  ) then
    raise exception 'evaluation_missing' using errcode = 'P0001'; -- none, failing, stale (hash mismatch) or no cases
  end if;
  if exists (
    select 1 from public.rule_versions o
    where o.rule_id = v.rule_id and o.status = 'approved' and o.id <> v.id
      and o.valid_from <= coalesce(v.valid_until, '9999-12') and v.valid_from <= coalesce(o.valid_until, '9999-12')
  ) then
    raise exception 'overlaps_approved' using errcode = 'P0001';
  end if;
  update public.rule_versions
    set status = 'approved', approved_by = v_uid, approved_hash = v_hash, decided_at = now()
    where id = p_version;
end;
$$;

create function public.admin_rule_reject(p_version uuid, p_reason text) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := public.rules_admin_guard('admin_rule_reject', p_version::text);
  v public.rule_versions;
begin
  select * into v from public.rule_versions where id = p_version for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v.status not in ('draft', 'proposed') then raise exception 'not_proposed' using errcode = 'P0001'; end if;
  update public.rule_versions
    set status = 'rejected', reject_reason = left(p_reason, 500), decided_at = now()
    where id = p_version;
end;
$$;

revoke all on function public.admin_rules_list(), public.admin_rule_get(uuid),
  public.admin_rule_case_add(text, text, text, jsonb, jsonb), public.admin_rule_case_remove(uuid),
  public.admin_rule_propose(text, text, text, jsonb, text, text, text, text, boolean, text),
  public.admin_rule_record_evaluation(uuid, text, text, boolean, jsonb), public.admin_rule_approve(uuid),
  public.admin_rule_reject(uuid, text) from public, anon;
grant execute on function public.admin_rules_list(), public.admin_rule_get(uuid),
  public.admin_rule_case_add(text, text, text, jsonb, jsonb), public.admin_rule_case_remove(uuid),
  public.admin_rule_propose(text, text, text, jsonb, text, text, text, text, boolean, text),
  public.admin_rule_record_evaluation(uuid, text, text, boolean, jsonb), public.admin_rule_approve(uuid),
  public.admin_rule_reject(uuid, text) to authenticated;
