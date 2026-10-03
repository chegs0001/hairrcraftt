-- Phase 3: expenses, salary advances, owner cash movements, day-end closing and day lock.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  branch_id uuid not null references public.branches(id),
  business_date date not null default public.business_date(),
  amount bigint not null check (amount > 0),
  category text not null check (category in ('Tea/snacks','Cleaning','Salon supplies','Repairs','Transport','Other')),
  title text not null check (btrim(title) <> ''),
  receipt_path text,
  paid_from text not null default 'drawer' check (paid_from in ('drawer','owner')),
  status text not null default 'active' check (status in ('active','void'))
);
create index expenses_branch_date on public.expenses(branch_id, business_date);

create table public.salary_advances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  staff_id uuid not null references public.staff(id),
  branch_id uuid not null references public.branches(id),
  business_date date not null default public.business_date(),
  amount bigint not null check (amount > 0),
  paid_from text not null default 'drawer' check (paid_from in ('drawer','owner','upi')),
  note text,
  status text not null default 'active' check (status in ('active','void'))
);
create index advances_staff_date on public.salary_advances(staff_id, business_date);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  branch_id uuid not null references public.branches(id),
  business_date date not null default public.business_date(),
  type text not null check (type in ('owner_withdrawal','float_added')),
  amount bigint not null check (amount > 0),
  note text
);

create table public.day_closings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  branch_id uuid not null references public.branches(id),
  business_date date not null,
  opening bigint not null,
  cash_in bigint not null,
  cash_out bigint not null,
  expected bigint not null,
  counted bigint not null,
  difference bigint not null,
  upi_expected bigint not null,
  denominations jsonb,
  note text,
  status text not null default 'closed' check (status in ('closed','reopened')),
  reopen_reason text,
  unique (branch_id, business_date)
);

do $$
declare t text;
begin
  foreach t in array array['expenses','salary_advances','cash_movements','day_closings'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row()', t);
    execute format('create trigger %1$s_no_delete before delete on public.%1$s
                    for each row execute function public.block_mutation()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- day lock
create or replace function public.day_is_closed(p_branch uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.day_closings where branch_id = p_branch and business_date = p_date and status = 'closed')
$$;

create or replace function public.enforce_day_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.day_is_closed(new.branch_id, new.business_date) then
    raise exception 'This day is closed for the salon. A manager must reopen it first.';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['visits','bills','payments','expenses','salary_advances','cash_movements'] loop
    execute format('create trigger %1$s_day_lock before insert on public.%1$s
                    for each row execute function public.enforce_day_open()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS (writes only via functions)
alter table public.expenses enable row level security;
alter table public.salary_advances enable row level security;
alter table public.cash_movements enable row level security;
alter table public.day_closings enable row level security;

create policy expenses_read on public.expenses for select
  using (public.is_active_staff() and (public.is_manager() or branch_id = public.my_branch()));
create policy advances_read on public.salary_advances for select
  using (public.is_manager() or staff_id = (select id from public.me()));
create policy movements_read on public.cash_movements for select using (public.is_manager());
create policy closings_read on public.day_closings for select
  using (public.is_active_staff() and (public.is_manager() or branch_id = public.my_branch()));

-- ---------------------------------------------------------------- helpers
-- Members work only in their own salon and only on today's date; managers may pick either.
create or replace function public.resolve_branch(p_branch uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare s public.staff := public.require_staff();
begin
  return case when s.role = 'manager' then coalesce(p_branch, s.branch_id) else s.branch_id end;
end $$;

create or replace function public.resolve_date(p_date date) returns date
language plpgsql stable security definer set search_path = public as $$
declare s public.staff := public.require_staff(); d date := coalesce(p_date, public.business_date());
begin
  if d > public.business_date() then raise exception 'Date cannot be in the future'; end if;
  if s.role <> 'manager' and d <> public.business_date() then raise exception 'Only today can be used'; end if;
  return d;
end $$;

-- ---------------------------------------------------------------- expenses
create or replace function public.add_expense(
  p_amount bigint, p_category text, p_title text, p_receipt text default null,
  p_paid_from text default 'drawer', p_branch uuid default null, p_date date default null)
returns public.expenses language plpgsql security definer set search_path = public as $$
declare e public.expenses; b uuid := public.resolve_branch(p_branch);
begin
  insert into public.expenses(branch_id, business_date, amount, category, title, receipt_path, paid_from, created_by)
  values (b, public.resolve_date(p_date), p_amount, p_category, p_title, p_receipt, p_paid_from, auth.uid())
  returning * into e;
  return e;
end $$;

create or replace function public.edit_expense(
  p_id uuid, p_amount bigint, p_category text, p_title text, p_paid_from text, p_reason text default null)
returns public.expenses language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); e public.expenses; closed boolean;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found or e.status <> 'active' then raise exception 'Expense not found'; end if;
  perform public.require_branch(e.branch_id);
  closed := public.day_is_closed(e.branch_id, e.business_date);
  if s.role <> 'manager' then
    if e.created_by is distinct from auth.uid() then raise exception 'You can edit only your own expenses'; end if;
    if closed then raise exception 'The day is closed. Ask a manager to edit this'; end if;
  elsif closed and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is needed to edit an expense on a closed day';
  end if;
  update public.expenses set amount = p_amount, category = p_category, title = p_title, paid_from = p_paid_from
   where id = p_id returning * into e;
  if closed then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('closed_day_edited', e.branch_id, s.id, e.amount, 'expenses', e.id, p_reason, auth.uid());
  end if;
  return e;
end $$;

create or replace function public.void_expense(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); e public.expenses; closed boolean;
begin
  select * into e from public.expenses where id = p_id for update;
  if not found or e.status <> 'active' then raise exception 'Expense not found'; end if;
  perform public.require_branch(e.branch_id);
  closed := public.day_is_closed(e.branch_id, e.business_date);
  if s.role <> 'manager' then
    if e.created_by is distinct from auth.uid() then raise exception 'You can remove only your own expenses'; end if;
    if closed then raise exception 'The day is closed. Ask a manager to remove this'; end if;
  elsif closed and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is needed on a closed day';
  end if;
  update public.expenses set status = 'void' where id = p_id;
  if closed then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('closed_day_edited', e.branch_id, s.id, e.amount, 'expenses', e.id, p_reason, auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------- advances and owner movements
create or replace function public.add_advance(
  p_staff uuid, p_amount bigint, p_paid_from text default 'drawer', p_note text default null,
  p_branch uuid default null, p_date date default null)
returns public.salary_advances language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); a public.salary_advances; b uuid := public.resolve_branch(p_branch);
begin
  if s.role <> 'manager' and p_staff is distinct from s.id then raise exception 'You can log an advance only for yourself'; end if;
  if not exists (select 1 from public.staff where id = p_staff and status = 'active') then raise exception 'Unknown staff member'; end if;
  insert into public.salary_advances(staff_id, branch_id, business_date, amount, paid_from, note, created_by)
  values (p_staff, b, public.resolve_date(p_date), p_amount, p_paid_from, p_note, auth.uid())
  returning * into a;
  return a;
end $$;

create or replace function public.add_cash_movement(p_type text, p_amount bigint, p_note text default null, p_branch uuid default null)
returns public.cash_movements language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); m public.cash_movements;
begin
  if s.role <> 'manager' then raise exception 'Managers only'; end if;
  insert into public.cash_movements(branch_id, type, amount, note, created_by)
  values (public.resolve_branch(p_branch), p_type, p_amount, p_note, auth.uid()) returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------- day summary and closing
create or replace function public.day_summary(p_branch uuid default null, p_date date default null)
returns table (
  branch_id uuid, business_date date, opening bigint, cash_bills bigint, cash_dues bigint, float_added bigint,
  cash_expenses bigint, cash_advances bigint, owner_taken bigint, expected bigint, upi_expected bigint,
  open_visits int, closed boolean)
language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.resolve_branch(p_branch); d date := coalesce(p_date, public.business_date());
        op bigint; cb bigint; cd bigint; fl bigint; ce bigint; ca bigint; ot bigint; up bigint;
begin
  perform public.require_branch(b);
  select coalesce((select counted from public.day_closings c
                    where c.branch_id = b and c.business_date < d and c.status = 'closed'
                    order by c.business_date desc limit 1), 0) into op;
  select coalesce(sum(amount) filter (where mode = 'cash' and kind = 'bill'), 0),
         coalesce(sum(amount) filter (where mode = 'cash' and kind = 'due_collection'), 0),
         coalesce(sum(amount) filter (where mode = 'upi'), 0)
    into cb, cd, up from public.payments p where p.branch_id = b and p.business_date = d;
  select coalesce(sum(amount) filter (where type = 'float_added'), 0),
         coalesce(sum(amount) filter (where type = 'owner_withdrawal'), 0)
    into fl, ot from public.cash_movements m where m.branch_id = b and m.business_date = d;
  select coalesce(sum(amount), 0) into ce from public.expenses e
   where e.branch_id = b and e.business_date = d and e.status = 'active' and e.paid_from = 'drawer';
  select coalesce(sum(amount), 0) into ca from public.salary_advances a
   where a.branch_id = b and a.business_date = d and a.status = 'active' and a.paid_from = 'drawer';
  return query select b, d, op, cb, cd, fl, ce, ca, ot, op + cb + cd + fl - ce - ca - ot, up,
    (select count(*)::int from public.visits v where v.branch_id = b and v.business_date = d and v.status = 'open'),
    public.day_is_closed(b, d);
end $$;

create or replace function public.close_day(
  p_counted bigint, p_denominations jsonb default null, p_note text default null,
  p_branch uuid default null, p_date date default null)
returns public.day_closings language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); b uuid := public.resolve_branch(p_branch); d date := public.resolve_date(p_date);
        sm record; row public.day_closings; diff bigint;
begin
  if p_counted is null or p_counted < 0 then raise exception 'Enter the counted cash'; end if;
  select * into sm from public.day_summary(b, d);
  if sm.closed then raise exception 'This day is already closed'; end if;
  if sm.open_visits > 0 then raise exception 'Bill or cancel all open visits before closing the day'; end if;
  diff := p_counted - sm.expected;
  if diff <> 0 and coalesce(btrim(p_note), '') = '' then raise exception 'Add a note explaining the cash difference'; end if;

  insert into public.day_closings(branch_id, business_date, opening, cash_in, cash_out, expected, counted, difference,
                                  upi_expected, denominations, note, status, created_by)
  values (b, d, sm.opening, sm.cash_bills + sm.cash_dues + sm.float_added,
          sm.cash_expenses + sm.cash_advances + sm.owner_taken, sm.expected, p_counted, diff,
          sm.upi_expected, p_denominations, p_note, 'closed', auth.uid())
  on conflict (branch_id, business_date) do update
    set opening = excluded.opening, cash_in = excluded.cash_in, cash_out = excluded.cash_out,
        expected = excluded.expected, counted = excluded.counted, difference = excluded.difference,
        upi_expected = excluded.upi_expected, denominations = excluded.denominations,
        note = excluded.note, status = 'closed'
  returning * into row;

  if diff <> 0 then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('cash_difference', b, s.id, diff, 'day_closings', row.id, p_note, auth.uid());
  end if;
  return row;
end $$;

create or replace function public.reopen_day(p_branch uuid, p_date date, p_reason text)
returns public.day_closings language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); row public.day_closings;
begin
  if s.role <> 'manager' then raise exception 'Managers only'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is needed to reopen a day'; end if;
  update public.day_closings set status = 'reopened', reopen_reason = p_reason
   where branch_id = p_branch and business_date = p_date and status = 'closed' returning * into row;
  if not found then raise exception 'That day is not closed'; end if;
  insert into public.flags(type, branch_id, staff_id, ref_table, ref_id, note, created_by)
  values ('day_reopened', p_branch, s.id, 'day_closings', row.id, p_reason, auth.uid());
  return row;
end $$;

-- 23:00 IST job: flag any salon that traded today but has not closed its day.
create or replace function public.flag_unclosed_days() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; d date := public.business_date();
begin
  for r in select b.id from public.branches b
            where (exists (select 1 from public.visits v where v.branch_id = b.id and v.business_date = d)
                   or exists (select 1 from public.payments p where p.branch_id = b.id and p.business_date = d))
              and not public.day_is_closed(b.id, d)
              and not exists (select 1 from public.flags f where f.type = 'day_not_closed' and f.branch_id = b.id
                               and f.note = d::text) loop
    insert into public.flags(type, branch_id, note) values ('day_not_closed', r.id, d::text);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- optional platform pieces (Supabase only)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('flag-unclosed-days', '30 17 * * *', 'select public.flag_unclosed_days()'); -- 23:00 IST
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%): enable it in the Supabase dashboard and re-run the schedule line', sqlerrm;
end $$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public) values ('receipts', 'receipts', false) on conflict do nothing;
    execute $p$create policy receipts_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'receipts' and public.is_active_staff())$p$;
    execute $p$create policy receipts_read on storage.objects for select to authenticated
               using (bucket_id = 'receipts' and public.is_active_staff())$p$;
  end if;
end $$;
