-- Comments with replies, a resolved state and a notice to the owner (#155).
alter table public.comments
  add column parent_id uuid references public.comments (id) on delete cascade,
  add column resolved_at timestamptz,
  add column resolved_by uuid references auth.users (id) on delete set null;
create index on public.comments (parent_id);

-- A reply must live in the same workspace as the comment it answers.
drop policy comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (
    author_id = (select auth.uid()) and public.can_comment(workspace_id)
    and (comments.parent_id is null or exists (
      select 1 from public.comments p where p.id = comments.parent_id and p.workspace_id = comments.workspace_id))
  );

-- Resolving: whoever may comment, and only the two resolution columns (the text of a comment is never edited).
revoke update on public.comments from authenticated;
grant update (resolved_at, resolved_by) on public.comments to authenticated;
create policy comments_resolve on public.comments for update to authenticated
  using (public.can_comment(workspace_id))
  with check (public.can_comment(workspace_id) and (resolved_by is null or resolved_by = (select auth.uid())));

-- A notice is not always about an alert now: it can point at a comment instead.
alter table public.alert_events alter column alert_id drop not null;
alter table public.alert_events add column comment_id uuid references public.comments (id) on delete cascade;

-- The owner is told when someone else comments or replies (written here, since users have no insert policy on notices).
create function public.notify_owner_of_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(new.workspace_id) then
    insert into public.alert_events (workspace_id, comment_id, text, current_text)
    values (new.workspace_id, new.id,
      case when new.parent_id is null then 'Novo comentário' else 'Nova resposta' end || ' de ' || new.author_email,
      left(new.body, 140));
  end if;
  return new;
end;
$$;
revoke execute on function public.notify_owner_of_comment() from public, anon, authenticated;
create trigger comments_notify_owner after insert on public.comments
  for each row execute function public.notify_owner_of_comment();
