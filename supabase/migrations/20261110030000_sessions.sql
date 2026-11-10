-- Lets a person see and end their own sign-in sessions. Both functions only ever touch rows of auth.uid().

create function public.my_sessions()
returns table (id uuid, created_at timestamptz, refreshed_at timestamptz, user_agent text, ip text, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.created_at,
         s.refreshed_at at time zone 'utc',
         s.user_agent,
         host(s.ip),
         s.id::text = coalesce((select auth.jwt() ->> 'session_id'), '')
  from auth.sessions s
  where s.user_id = (select auth.uid())
  order by coalesce(s.refreshed_at at time zone 'utc', s.created_at) desc;
$$;

-- Ends one session (its refresh tokens go with it). Returns whether a session was ended.
create function public.revoke_session(p_session uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from auth.sessions where id = p_session and user_id = (select auth.uid());
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.my_sessions(), public.revoke_session(uuid) from public, anon;
grant execute on function public.my_sessions(), public.revoke_session(uuid) to authenticated;
