-- #162: full-text search inside documents. `search_text` holds the text read at upload (xml/txt today; PDF and images
-- once #141 lands) with CPF/CNPJ already masked by the API, so identifiers are never indexed in clear.
-- Access is the table's own RLS: members read, so a search only sees documents of workspaces the caller belongs to.
alter table public.documents add column search_text text;

alter table public.documents
  add column search_tsv tsvector generated always as (
    to_tsvector('portuguese', coalesce(name, '') || ' ' || coalesce(search_text, ''))
  ) stored;

create index documents_search_idx on public.documents using gin (search_tsv);
