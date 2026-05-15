-- RLS para tabelas novas de clientes
-- Idempotente: pode rodar mais de uma vez sem quebrar

alter table if exists public.client_records enable row level security;
alter table if exists public.client_states enable row level security;

drop policy if exists client_records_select_authenticated on public.client_records;
drop policy if exists client_records_insert_authenticated on public.client_records;
drop policy if exists client_records_update_authenticated on public.client_records;
drop policy if exists client_records_delete_authenticated on public.client_records;

create policy client_records_select_authenticated
  on public.client_records
  for select
  to authenticated
  using (true);

create policy client_records_insert_authenticated
  on public.client_records
  for insert
  to authenticated
  with check (true);

create policy client_records_update_authenticated
  on public.client_records
  for update
  to authenticated
  using (true)
  with check (true);

create policy client_records_delete_authenticated
  on public.client_records
  for delete
  to authenticated
  using (true);

drop policy if exists client_states_select_authenticated on public.client_states;
drop policy if exists client_states_insert_authenticated on public.client_states;
drop policy if exists client_states_update_authenticated on public.client_states;
drop policy if exists client_states_delete_authenticated on public.client_states;

create policy client_states_select_authenticated
  on public.client_states
  for select
  to authenticated
  using (true);

create policy client_states_insert_authenticated
  on public.client_states
  for insert
  to authenticated
  with check (true);

create policy client_states_update_authenticated
  on public.client_states
  for update
  to authenticated
  using (true)
  with check (true);

create policy client_states_delete_authenticated
  on public.client_states
  for delete
  to authenticated
  using (true);
