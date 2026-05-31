create extension if not exists pgcrypto;

create table if not exists public.farm_states (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Mi finca',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.farm_states enable row level security;

drop policy if exists "farm_states_select_own" on public.farm_states;
create policy "farm_states_select_own"
on public.farm_states for select
using (auth.uid() = owner_id);

drop policy if exists "farm_states_insert_own" on public.farm_states;
create policy "farm_states_insert_own"
on public.farm_states for insert
with check (auth.uid() = owner_id);

drop policy if exists "farm_states_update_own" on public.farm_states;
create policy "farm_states_update_own"
on public.farm_states for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create or replace function public.set_farm_states_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists farm_states_updated_at on public.farm_states;
create trigger farm_states_updated_at
before update on public.farm_states
for each row
execute function public.set_farm_states_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.farm_states;
exception
  when duplicate_object then null;
end;
$$;
