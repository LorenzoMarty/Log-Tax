-- Daily model-token budget per user (#112). No policies: the table is reachable only through the two functions below,
-- and each one only ever touches the caller's own row.
create table public.token_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  tokens bigint not null default 0,
  primary key (user_id, day)
);
alter table public.token_usage enable row level security;

-- Tokens still available today under `p_limit` (never negative).
create function public.token_budget_left(p_limit bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select tokens into v_used from public.token_usage where user_id = auth.uid() and day = current_date;
  return greatest(0, p_limit - coalesce(v_used, 0));
end;
$$;

-- Adds the tokens a turn spent to today's total.
create function public.token_usage_add(p_tokens integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_tokens < 0 then
    raise exception 'negative usage';
  end if;
  insert into public.token_usage as u (user_id, day, tokens)
  values (auth.uid(), current_date, p_tokens)
  on conflict (user_id, day) do update set tokens = u.tokens + excluded.tokens;
end;
$$;

revoke all on function public.token_budget_left(bigint) from public, anon;
revoke all on function public.token_usage_add(integer) from public, anon;
grant execute on function public.token_budget_left(bigint) to authenticated;
grant execute on function public.token_usage_add(integer) to authenticated;
