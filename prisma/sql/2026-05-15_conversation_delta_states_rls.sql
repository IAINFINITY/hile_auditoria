-- RLS for conversation_delta_states
alter table if exists public.conversation_delta_states enable row level security;

drop policy if exists conversation_delta_states_select_authenticated on public.conversation_delta_states;
drop policy if exists conversation_delta_states_insert_authenticated on public.conversation_delta_states;
drop policy if exists conversation_delta_states_update_authenticated on public.conversation_delta_states;
drop policy if exists conversation_delta_states_delete_authenticated on public.conversation_delta_states;

create policy conversation_delta_states_select_authenticated
  on public.conversation_delta_states
  for select
  to authenticated
  using (true);

create policy conversation_delta_states_insert_authenticated
  on public.conversation_delta_states
  for insert
  to authenticated
  with check (true);

create policy conversation_delta_states_update_authenticated
  on public.conversation_delta_states
  for update
  to authenticated
  using (true)
  with check (true);

create policy conversation_delta_states_delete_authenticated
  on public.conversation_delta_states
  for delete
  to authenticated
  using (true);
