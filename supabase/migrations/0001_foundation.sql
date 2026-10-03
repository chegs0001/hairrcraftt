-- Phase 1: foundation. Branches, staff, terms, settings, flags, audit log, RLS, signup approval.
-- Money = bigint paise. Business dates = Asia/Kolkata.


-- ---------------------------------------------------------------- helpers
create or replace function public.business_date(ts timestamptz default now())
returns date language sql immutable as $$
  select (ts at time zone 'Asia/Kolkata')::date
$$;

-- ---------------------------------------------------------------- tables
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  name text not null,
  code text not null unique,
  address text,
  lat double precision,
  lng double precision,
  geofence_radius_m int not null default 100,
  next_bill_no bigint not null default 1
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  name text not null default '',
  phone text,
  role text not null default 'member' check (role in ('manager','member')),
  branch_id uuid references public.branches(id),
  status text not null default 'pending' check (status in ('pending','active','inactive')),
  shift_start time not null default '11:00',
  shift_end time not null default '20:00',
  joined_on date not null default public.business_date()
);

create table public.staff_terms (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  staff_id uuid not null references public.staff(id),
  monthly_salary bigint not null check (monthly_salary >= 0),
  weekly_off_day smallint not null check (weekly_off_day between 0 and 6), -- 0 = Sunday
  effective_from date not null default public.business_date(),
  unique (staff_id, effective_from)
);

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.flags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  type text not null,
  branch_id uuid references public.branches(id),
  staff_id uuid references public.staff(id),
  amount bigint,
  ref_table text,
  ref_id uuid,
  note text,
  seen_at timestamptz,
  seen_by uuid
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  table_name text not null,
  row_id text,
  action text not null,
  before jsonb,
  after jsonb,
  actor uuid,
  reason text
);
create index audit_log_table_row on public.audit_log (table_name, row_id);
create index audit_log_created on public.audit_log (created_at desc);

-- ---------------------------------------------------------------- audit trigger
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rid text;
begin
  rid := coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id',
                  (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'key');
  insert into public.audit_log(table_name, row_id, action, before, after, actor, reason)
  values (tg_table_name, rid, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid(), nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;

create trigger audit_branches after insert or update or delete on public.branches
  for each row execute function public.audit_row();
create trigger audit_staff after insert or update or delete on public.staff
  for each row execute function public.audit_row();
create trigger audit_staff_terms after insert or update or delete on public.staff_terms
  for each row execute function public.audit_row();
create trigger audit_settings after insert or update or delete on public.settings
  for each row execute function public.audit_row();

-- audit log and money-adjacent tables cannot be edited or deleted by anyone through the API
create or replace function public.block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% on % is not allowed', tg_op, tg_table_name;
end $$;

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.block_mutation();
create trigger staff_no_delete before delete on public.staff
  for each row execute function public.block_mutation();
create trigger staff_terms_no_delete before delete on public.staff_terms
  for each row execute function public.block_mutation();

-- ---------------------------------------------------------------- identity helpers
create or replace function public.me() returns public.staff
language sql stable security definer set search_path = public as $$
  select * from public.staff where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.is_active_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where auth_user_id = auth.uid() and status = 'active')
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff
                 where auth_user_id = auth.uid() and status = 'active' and role = 'manager')
$$;

create or replace function public.my_branch() returns uuid
language sql stable security definer set search_path = public as $$
  select branch_id from public.staff where auth_user_id = auth.uid() and status = 'active' limit 1
$$;

-- ---------------------------------------------------------------- signup / approval
-- First manager is bootstrapped by email. A manager may pre-add staff by email;
-- on first Google sign-in that row is linked. Unknown emails land as 'pending'.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bootstrap_email constant text := 'cheragverma0001@gmail.com';
  nm text := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '');
begin
  update public.staff
     set auth_user_id = new.id,
         name = case when name = '' then nm else name end
   where lower(email) = lower(new.email) and auth_user_id is null;
  if found then return new; end if;

  if lower(new.email) = bootstrap_email then
    insert into public.staff(auth_user_id, email, name, role, status, branch_id)
    values (new.id, lower(new.email), nm, 'manager', 'active',
            (select id from public.branches order by code limit 1));
  else
    insert into public.staff(auth_user_id, email, name, role, status)
    values (new.id, lower(new.email), nm, 'member', 'pending');
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Protect against a member editing their own role/status/branch (RLS lets managers only write staff,
-- this is defence in depth) and keep emails lowercase.
create or replace function public.staff_guard() returns trigger
language plpgsql as $$
begin
  new.email := lower(new.email);
  if tg_op = 'UPDATE' and new.status = 'active' and new.branch_id is null and new.role = 'member' then
    raise exception 'A team member needs a home salon before activation';
  end if;
  return new;
end $$;
create trigger staff_guard before insert or update on public.staff
  for each row execute function public.staff_guard();

-- ---------------------------------------------------------------- RLS
alter table public.branches    enable row level security;
alter table public.staff       enable row level security;
alter table public.staff_terms enable row level security;
alter table public.settings    enable row level security;
alter table public.flags       enable row level security;
alter table public.audit_log   enable row level security;

-- branches: all active staff read; manager writes
create policy branches_read  on public.branches for select using (public.is_active_staff());
create policy branches_write on public.branches for all using (public.is_manager()) with check (public.is_manager());

-- staff: a person reads their own row (needed for the "waiting for approval" screen); manager reads/writes all
create policy staff_read_self on public.staff for select using (auth_user_id = auth.uid());
create policy staff_manager   on public.staff for all using (public.is_manager()) with check (public.is_manager());
-- active staff need teammates' names for helper selection
create policy staff_read_team on public.staff for select
  using (public.is_active_staff() and status = 'active' and (branch_id = public.my_branch()));

-- staff_terms: own rows readable; manager everything
create policy terms_read_self on public.staff_terms for select
  using (staff_id = (select id from public.me()));
create policy terms_manager on public.staff_terms for all
  using (public.is_manager()) with check (public.is_manager());

-- settings: read by active staff, write by manager
create policy settings_read  on public.settings for select using (public.is_active_staff());
create policy settings_write on public.settings for all using (public.is_manager()) with check (public.is_manager());

-- flags and audit log: manager only (flags are created by security definer functions)
create policy flags_manager on public.flags for all using (public.is_manager()) with check (public.is_manager());
create policy audit_manager on public.audit_log for select using (public.is_manager());

-- ---------------------------------------------------------------- seed
insert into public.branches(name, code) values
  ('HairrCraftt Salon 1', 'HC1'),
  ('HairrCraftt Salon 2', 'HC2');

insert into public.settings(key, value) values
  ('incentive_multiple',      '3'),
  ('incentive_rate_pct',      '5'),
  ('incentive_gate_paise',    '25000000'),     -- ₹2,50,000
  ('grace_minutes',           '15'),
  ('required_hours',          '9'),
  ('half_day_pct',            '50'),
  ('min_hours_for_half_day',  '2'),
  ('geofence_default_m',      '100'),
  ('geofence_max_accuracy_m', '150'),
  ('prime_fee_paise',         '80000'),        -- ₹800
  ('prime_validity_days',     '365'),
  ('selfie_retention_days',   '90');
