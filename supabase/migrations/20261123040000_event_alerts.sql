-- Alerts by event (#144): a rule `{"event": "document_uploaded", "docType": "nota_fiscal"}` writes one notice per occurrence.
-- `event_key` identifies the occurrence (e.g. the document id): the unique index makes a repeated hook or a racing worker a no-op.
alter table public.alert_events add column event_key text;
create unique index alert_events_alert_event on public.alert_events (alert_id, event_key)
  where event_key is not null;
