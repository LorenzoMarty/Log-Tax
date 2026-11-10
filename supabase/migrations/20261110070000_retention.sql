-- Retention: what the database forgets on its own (see docs/retencao-de-dados.md).
-- Documents are handled by the retention job (their files live in Storage); this covers the rows.
create function public.purge_expired_data(p_conversation_days integer default 365, p_job_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_conv integer; n_agent integer; n_jobs integer;
begin
  -- Conversation transcripts are cleared after a year without activity; the workspace, dashboard and data stay.
  update public.conversations set history = '[]', messages = '[]'
   where updated_at < now() - make_interval(days => p_conversation_days) and (history <> '[]' or messages <> '[]');
  get diagnostics n_conv = row_count;
  update public.agent_conversations set history = '[]', messages = '[]'
   where updated_at < now() - make_interval(days => p_conversation_days) and (history <> '[]' or messages <> '[]');
  get diagnostics n_agent = row_count;
  -- Finished jobs are kept 30 days for debugging.
  delete from public.jobs where status in ('done', 'failed') and finished_at < now() - make_interval(days => p_job_days);
  get diagnostics n_jobs = row_count;
  return jsonb_build_object('conversations', n_conv, 'agent_conversations', n_agent, 'jobs', n_jobs);
end;
$$;
revoke all on function public.purge_expired_data(integer, integer) from public, anon, authenticated;
grant execute on function public.purge_expired_data(integer, integer) to service_role;
