-- Liveness probe for /api/health: proves the API and the database answer, exposes nothing.
create function public.health_check() returns boolean
language sql stable security invoker set search_path = ''
as $$ select true; $$;
revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated;
