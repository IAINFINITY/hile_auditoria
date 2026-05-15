-- RLS para timeline operacional
alter table if exists public.conversation_timeline_events enable row level security;

drop policy if exists conversation_timeline_events_select_authenticated on public.conversation_timeline_events;
drop policy if exists conversation_timeline_events_insert_authenticated on public.conversation_timeline_events;
drop policy if exists conversation_timeline_events_update_authenticated on public.conversation_timeline_events;
drop policy if exists conversation_timeline_events_delete_authenticated on public.conversation_timeline_events;

create policy conversation_timeline_events_select_authenticated
  on public.conversation_timeline_events
  for select
  to authenticated
  using (true);

create policy conversation_timeline_events_insert_authenticated
  on public.conversation_timeline_events
  for insert
  to authenticated
  with check (true);

create policy conversation_timeline_events_update_authenticated
  on public.conversation_timeline_events
  for update
  to authenticated
  using (true)
  with check (true);

create policy conversation_timeline_events_delete_authenticated
  on public.conversation_timeline_events
  for delete
  to authenticated
  using (true);
