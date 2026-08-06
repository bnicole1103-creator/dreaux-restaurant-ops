
-- JUS TINI'S STRIPPED-DOWN CLOUD APP
-- Run this entire script in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'employee',
  phone text,
  photo_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.floor_tables (
  id text primary key,
  room text not null,
  table_name text not null,
  seat_count integer not null default 2,
  x numeric not null,
  y numeric not null,
  w numeric not null,
  h numeric not null,
  shape text not null default 'round',
  assigned_server text,
  party_name text,
  guest_count integer,
  seated_at timestamptz,
  service_status text not null default 'ready',
  status_started_at timestamptz,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_drawer_entries (
  id uuid primary key default gen_random_uuid(),
  drawer_name text not null,
  bartender_name text not null,
  start_time time not null,
  start_count numeric(12,2) not null,
  opening_notes text,
  end_time time,
  end_count numeric(12,2),
  closing_notes text,
  confirmed_count numeric(12,2),
  confirmed_by text,
  confirmed_as text,
  confirmation_notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  confirmed_at timestamptz
);

create table if not exists public.cash_deposits (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  time_in time not null,
  time_out time,
  net_sales numeric(12,2) not null,
  cash_deposit numeric(12,2) not null,
  comp_total numeric(12,2) not null default 0,
  void_total numeric(12,2) not null default 0,
  turned_in_to text not null,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.cash_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  adjustment_type text not null check (adjustment_type in ('comp','void')),
  amount numeric(12,2) not null,
  check_number text,
  reason text not null,
  verified_by text not null,
  code_owner text not null,
  receipt_path text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.manager_cashouts (
  id uuid primary key default gen_random_uuid(),
  manager_name text not null,
  shift_date date not null,
  shift_name text not null,
  cash_collected numeric(12,2) not null,
  expected_deposit numeric(12,2) not null,
  actual_deposit numeric(12,2) not null,
  paid_outs numeric(12,2) not null default 0,
  paid_ins numeric(12,2) not null default 0,
  deposit_location text not null,
  deposit_reference text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  user_name text not null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.floor_tables enable row level security;
alter table public.cash_drawer_entries enable row level security;
alter table public.cash_deposits enable row level security;
alter table public.cash_adjustments enable row level security;
alter table public.manager_cashouts enable row level security;
alter table public.activity_log enable row level security;

-- TEMPORARY ONE-RESTAURANT POLICIES:
-- Any authenticated employee can read/write operational records.
-- Tighten by role after today's launch.
create policy "profiles authenticated read" on public.profiles for select to authenticated using (true);
create policy "profiles own insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles own update" on public.profiles for update to authenticated using (auth.uid() = id);

create policy "floor authenticated all" on public.floor_tables for all to authenticated using (true) with check (true);
create policy "drawers authenticated all" on public.cash_drawer_entries for all to authenticated using (true) with check (true);
create policy "deposits authenticated all" on public.cash_deposits for all to authenticated using (true) with check (true);
create policy "adjustments authenticated all" on public.cash_adjustments for all to authenticated using (true) with check (true);
create policy "cashouts authenticated all" on public.manager_cashouts for all to authenticated using (true) with check (true);
create policy "activity authenticated all" on public.activity_log for all to authenticated using (true) with check (true);

-- Create receipt-photo bucket.
insert into storage.buckets (id, name, public)
values ('cash-receipts', 'cash-receipts', false)
on conflict (id) do nothing;

create policy "receipt authenticated insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'cash-receipts');

create policy "receipt authenticated read"
on storage.objects for select to authenticated
using (bucket_id = 'cash-receipts');

-- Enable Realtime for the shared floor.
alter publication supabase_realtime add table public.floor_tables;

-- Seed floor plan. Re-running is safe.
insert into public.floor_tables (id,room,table_name,seat_count,x,y,w,h,shape) values
('Main Dining|B1','Main Dining','B1',2,4,4,10,12,'round'),
('Main Dining|B2','Main Dining','B2',2,18,4,10,12,'round'),
('Main Dining|B3','Main Dining','B3',2,32,4,10,12,'round'),
('Main Dining|B4','Main Dining','B4',2,46,4,10,12,'round'),
('Main Dining|B5','Main Dining','B5',2,60,4,10,12,'round'),
('Main Dining|B6','Main Dining','B6',2,74,4,10,12,'round'),
('Main Dining|H1','Main Dining','H1',3,17,28,10,12,'round'),
('Main Dining|H2','Main Dining','H2',3,34,28,10,12,'round'),
('Main Dining|H3','Main Dining','H3',3,51,28,10,12,'round'),
('Main Dining|H4','Main Dining','H4',3,68,28,10,12,'round'),
('Main Dining|H5','Main Dining','H5',3,17,52,10,12,'round'),
('Main Dining|H6','Main Dining','H6',3,34,52,10,12,'round'),
('Main Dining|H7','Main Dining','H7',3,51,52,10,12,'round'),
('Main Dining|H8','Main Dining','H8',3,68,52,10,12,'round'),
('Main Dining|T1','Main Dining','T1',2,4,77,10,12,'round'),
('Main Dining|T2','Main Dining','T2',2,21,77,10,12,'round'),
('Main Dining|T3','Main Dining','T3',2,38,77,10,12,'round'),
('Main Dining|T4','Main Dining','T4',2,55,77,10,12,'round'),
('Main Dining|T5','Main Dining','T5',2,72,77,10,12,'round'),
('Main Dining|T6','Main Dining','T6',2,88,77,10,12,'round'),
('Courtyard|C1','Courtyard','C1',4,2,63,11,13,'round'),
('Courtyard|C2','Courtyard','C2',4,25,75,11,13,'round'),
('Courtyard|C3','Courtyard','C3',4,51,75,11,13,'round'),
('Courtyard|C4','Courtyard','C4',4,87,65,11,13,'round'),
('Courtyard|C5','Courtyard','C5',4,86,17,11,13,'round'),
('Courtyard|C6','Courtyard','C6',6,65,12,16,18,'round'),
('Courtyard|C7','Courtyard','C7',4,38,14,12,14,'round'),
('Courtyard|C8','Courtyard','C8',4,13,14,12,14,'round'),
('Brut Bar|L12','Brut Bar','L12',2,3,6,11,9,'square'),
('Brut Bar|L11','Brut Bar','L11',2,18,18,9,13,'square'),
('Brut Bar|L10','Brut Bar','L10',2,30,18,9,13,'square'),
('Brut Bar|L9','Brut Bar','L9',2,42,18,9,13,'square'),
('Brut Bar|L8','Brut Bar','L8',2,54,18,9,13,'square'),
('Brut Bar|L7','Brut Bar','L7',2,66,18,9,13,'square'),
('Brut Bar|L6','Brut Bar','L6',2,86,6,11,9,'square'),
('Brut Bar|L13','Brut Bar','L13',2,3,40,11,9,'square'),
('Brut Bar|L5','Brut Bar','L5',2,86,38,11,9,'square'),
('Brut Bar|BB1','Brut Bar','BB1',2,18,70,10,12,'round'),
('Brut Bar|BB2','Brut Bar','BB2',2,31,70,10,12,'round'),
('Brut Bar|BB3','Brut Bar','BB3',2,44,70,10,12,'round'),
('Brut Bar|BB4','Brut Bar','BB4',2,57,70,10,12,'round'),
('Great Room|G1','Great Room','G1',12,24,30,52,26,'rect')
on conflict (id) do nothing;
