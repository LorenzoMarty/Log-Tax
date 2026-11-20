-- One row per model call (#194): who, which workspace, how many tokens and the estimated cost. No message content.
-- Written only through `ai_usage_record` (which also feeds the daily budget in `token_usage`); a user reads only their own rows.
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  created_at timestamptz not null default now()
);
create index on public.ai_usage_events (user_id, created_at desc);

revoke all on public.ai_usage_events from anon;
alter table public.ai_usage_events enable row level security;
create policy ai_usage_events_own on public.ai_usage_events for select to authenticated
  using (user_id = auth.uid());

create function public.ai_usage_record(p_workspace uuid, p_input integer, p_output integer, p_cost_micro_usd bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_input < 0 or p_output < 0 or p_cost_micro_usd < 0 then
    raise exception 'negative usage';
  end if;
  insert into public.ai_usage_events (user_id, workspace_id, input_tokens, output_tokens, cost_micro_usd)
  values (auth.uid(), case when p_workspace is not null and public.is_member(p_workspace) then p_workspace end,
          p_input, p_output, p_cost_micro_usd);
  insert into public.token_usage as u (user_id, day, tokens)
  values (auth.uid(), current_date, p_input + p_output)
  on conflict (user_id, day) do update set tokens = u.tokens + excluded.tokens;
end;
$$;

revoke all on function public.ai_usage_record(uuid, integer, integer, bigint) from public, anon;
grant execute on function public.ai_usage_record(uuid, integer, integer, bigint) to authenticated;
