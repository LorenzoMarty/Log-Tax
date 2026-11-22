-- API and webhooks for accountants (#176).
-- api_keys: a key per accountant; only the SHA-256 hash is stored. It covers a fixed list of client workspaces and
-- read-only scopes. The public read goes through one narrow security-definer RPC (anon key), never the service role.
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null check (scopes <> '{}' and scopes <@ array['clients:read']),
  workspace_ids uuid[] not null check (cardinality(workspace_ids) between 1 and 100),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '366 days')
);
create index on public.api_keys (user_id, created_at desc);

revoke all on public.api_keys from anon, authenticated;
grant select (id, user_id, name, scopes, workspace_ids, created_at, expires_at, revoked_at, last_used_at) on public.api_keys to authenticated;
grant insert (name, token_hash, scopes, workspace_ids, expires_at) on public.api_keys to authenticated;
grant update (revoked_at) on public.api_keys to authenticated;
alter table public.api_keys enable row level security;

create policy api_keys_select on public.api_keys for select to authenticated using (user_id = (select auth.uid()));
-- A key may only list workspaces where the creator is a member and not the owner (their clients).
create policy api_keys_insert on public.api_keys for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and not exists (
      select 1 from unnest(workspace_ids) w
      where not exists (
        select 1 from public.workspace_members m
        where m.workspace_id = w and m.user_id = (select auth.uid()) and m.role <> 'owner'
      )
    )
  );
create policy api_keys_update on public.api_keys for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The only anonymous door of the API: null (unknown, expired, revoked or without the scope: the same answer on purpose),
-- {"wait": n} when the IP spent its budget, or {"clients": [...]}: the key's workspaces that the accountant STILL serves.
create function public.read_api_clients(p_hash text, p_ip text) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_rate text := 'api:ip:' || left(coalesce(p_ip, 'unknown'), 64);
  v_hits integer;
  v_start timestamptz;
  v_key public.api_keys;
  v_clients jsonb;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (v_rate, v_now, 1)
  on conflict (key) do update set
    window_start = case when r.window_start + interval '60 seconds' <= v_now then v_now else r.window_start end,
    hits = case when r.window_start + interval '60 seconds' <= v_now then 1 else r.hits + 1 end
  returning r.hits, r.window_start into v_hits, v_start;
  if v_hits > 60 then
    return jsonb_build_object('wait', greatest(1, ceil(extract(epoch from (v_start + interval '60 seconds' - v_now)))::integer));
  end if;

  select * into v_key from public.api_keys
  where token_hash = p_hash and revoked_at is null and expires_at > v_now and 'clients:read' = any (scopes);
  if not found then
    return null;
  end if;
  update public.api_keys set last_used_at = v_now where id = v_key.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'workspaceId', w.id, 'name', w.name, 'kind', w.kind, 'role', m.role) order by w.name), '[]'::jsonb)
  into v_clients
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id and m.user_id = v_key.user_id and m.role <> 'owner'
  where w.id = any (v_key.workspace_ids);
  return jsonb_build_object('clients', v_clients);
end;
$$;

revoke all on function public.read_api_clients(text, text) from public;
grant execute on function public.read_api_clients(text, text) to anon, authenticated;

-- Webhook endpoints: the signing secret is stored sealed by the API (AES-GCM, DATA_ENCRYPTION_KEY) and is never
-- selectable by a signed-in user; only the service role (the delivery job) reads it.
create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  url text not null check (url ~ '^https://' and char_length(url) <= 500),
  events text[] not null check (events <> '{}' and events <@ array['document_uploaded', 'member_joined', 'regime_changed', 'rule_changed']),
  secret_enc text not null check (secret_enc like 'enc:%'),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index on public.webhook_endpoints (user_id, created_at desc);

revoke all on public.webhook_endpoints from anon, authenticated;
grant select (id, user_id, url, events, created_at, disabled_at) on public.webhook_endpoints to authenticated;
grant insert (url, events, secret_enc) on public.webhook_endpoints to authenticated;
grant delete on public.webhook_endpoints to authenticated;
alter table public.webhook_endpoints enable row level security;

create policy webhook_endpoints_select on public.webhook_endpoints for select to authenticated using (user_id = (select auth.uid()));
create policy webhook_endpoints_insert on public.webhook_endpoints for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy webhook_endpoints_delete on public.webhook_endpoints for delete to authenticated using (user_id = (select auth.uid()));
