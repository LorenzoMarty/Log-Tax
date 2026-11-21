-- Extensible workspace kinds (#177): prestador, patrimonio and inventario join empresa and pessoal.
-- Only the allowed values widen; existing rows keep their kind and RLS (by owner/member) does not look at it.
alter table workspaces drop constraint if exists workspaces_kind_check;
alter table workspaces add constraint workspaces_kind_check
  check (kind in ('empresa', 'pessoal', 'prestador', 'patrimonio', 'inventario'));
