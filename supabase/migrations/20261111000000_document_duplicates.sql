-- #164: the same file, or the same NF-e under another name, must not be stored twice in a workspace
-- (it would double the revenue read from the invoices). Existing rows keep null and are not compared.
alter table public.documents
  add column content_hash text,
  add column nfe_key text;

create unique index documents_unique_content on public.documents (workspace_id, content_hash) where content_hash is not null;
create unique index documents_unique_nfe_key on public.documents (workspace_id, nfe_key) where nfe_key is not null;
