-- Last working date + on-demand exit settlement, editable joining date (guarded), leave make-up tracking.

alter table public.staff add column last_working_on date;

alter table public.payroll_runs
  add column kind text not null default 'monthly' check (kind in ('monthly','exit')),
  add column staff_id uuid references public.staff(id);
alter table public.payroll_runs drop constraint payroll_runs_branch_id_month_key;
create unique index payroll_runs_monthly on public.payroll_runs(branch_id, month) where kind = 'monthly';
create unique index payroll_runs_exit on public.payroll_runs(staff_id, month) where kind = 'exit';

alter table public.payroll_lines
  add column void boolean not null default false,          -- superseded by an exit settlement while still a draft
  add column makeup_days numeric(5,1) not null default 0,  -- absence days still to be covered by extra working days
  add column window_end date;

drop policy lines_read_own on public.payroll_lines;
create policy lines_read_own on public.payroll_lines for select
  using (staff_id = (select id from public.me()) and not void and public.payroll_run_is_final(run_id));

-- ---------------------------------------------------------------- staff guard: leaver goes inactive; joining date cannot move into settled pay
create or replace function public.staff_guard() returns trigger
language plpgsql as $$
begin
  new.email := lower(new.email);
  if tg_op = 'UPDATE' and new.status = 'active' and new.branch_id is null and new.role = 'member' then
    raise exception 'A team member needs a home salon before activation';
  end if;
  if new.last_working_on is not null and new.last_working_on < public.business_date() and new.status = 'active' then
    new.status := 'inactive';
  end if;
  if tg_op = 'UPDATE' and new.joined_on is distinct from old.joined_on and exists (
       select 1 from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id
        where l.staff_id = new.id and r.status = 'final' and not l.void
          and (r.month + interval '1 month - 1 day')::date >= new.joined_on) then
    raise exception 'Pay for that period is already settled. Choose a joining date after the last settled month.';
  end if;
  return new;
end $$;

create or replace function public.deactivate_departed() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.staff set status = 'inactive' where status = 'active' and last_working_on < public.business_date();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.deactivate_departed() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('deactivate-departed', '20 18 * * *', 'select public.deactivate_departed()'); -- 23:50 IST
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%): schedule public.deactivate_departed() daily', sqlerrm;
end $$;

-- ---------------------------------------------------------------- attendance grid: a named staff member is shown even if inactive, never past their last day
create or replace function public.attendance_grid(
  p_from date, p_to date, p_branch uuid default null, p_staff uuid default null)
returns table (
  staff_id uuid, name text, branch_id uuid, date date, status text, in_at timestamptz, out_at timestamptz,
  worked_minutes int, short_minutes int, auto_closed boolean, corrected boolean, in_photo text, out_photo text, in_accuracy double precision)
language plpgsql stable security definer set search_path = public as $$
declare me public.staff := public.require_staff(); last_day date := least(p_to, public.business_date());
begin
  return query
  select s.id, s.name, s.branch_id, d::date,
    case when a.id is not null then a.status
         when h.id is not null then 'holiday'
         when l.id is not null then 'leave'
         when o.off is not null and extract(dow from d)::int = o.off then 'off'
         when d::date = public.business_date() then 'pending'
         else 'absent' end,
    a.in_at, a.out_at,
    case when a.out_at is not null then floor(extract(epoch from (a.out_at - a.in_at)) / 60)::int end,
    coalesce(a.short_minutes, 0), coalesce(a.auto_closed, false), a.corrected_reason is not null,
    a.in_photo, a.out_photo, a.in_accuracy
  from public.staff s
  cross join generate_series(p_from, last_day, interval '1 day') d
  left join public.attendance a on a.staff_id = s.id and a.date = d::date
  left join public.holidays h on h.branch_id = s.branch_id and h.date = d::date and h.status = 'active'
  left join public.leaves l on l.staff_id = s.id and l.date = d::date and l.status = 'active'
  left join lateral (select t.weekly_off_day as off from public.staff_terms t
                      where t.staff_id = s.id and t.effective_from <= d::date
                      order by t.effective_from desc limit 1) o on true
  where (s.status = 'active' or (p_staff is not null and s.id = p_staff))
    and d::date >= s.joined_on and d::date <= coalesce(s.last_working_on, d::date)
    and (case when me.role = 'manager' then (p_branch is null or s.branch_id = p_branch) and (p_staff is null or s.id = p_staff)
              else s.id = me.id end)
  order by s.name, d;
end $$;

-- ---------------------------------------------------------------- one calculation used by monthly runs and exit settlements
create or replace function public.payroll_calc_line(p_run uuid, p_staff uuid, p_ms date, p_end date, p_exit boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.staff; me date := (date_trunc('month', p_ms) + interval '1 month - 1 day')::date;
  sales bigint; credit bigint; adv bigint; carry bigint; sal bigint; e_full int; e_win int; a record; inc bigint;
  calc record; prev_makeup numeric; mk numeric;
begin
  select * into s from public.staff where id = p_staff;
  sal := public.salary_on(p_staff, p_end);
  e_full := public.payroll_expected_days(p_staff, s.branch_id, p_ms, me);
  e_win := public.payroll_expected_days(p_staff, s.branch_id, greatest(p_ms, s.joined_on), p_end);

  select coalesce(sum(l.net_price), 0) into sales
    from public.bills b join public.visit_lines l on l.visit_id = b.visit_id and l.status = 'active' and l.kind in ('service','product')
   where b.status = 'final' and b.branch_id = s.branch_id and b.business_date between p_ms and p_end;

  select count(*) filter (where g.status in ('present','present_short')) present,
         count(*) filter (where g.status = 'absent') absent,
         count(*) filter (where g.status = 'half_day') half,
         coalesce(sum(case g.status when 'extra_day' then 1 when 'extra_half' then 0.5 else 0 end), 0) extra,
         count(*) filter (where g.status in ('leave','holiday')) leave,
         coalesce(sum(g.short_minutes), 0)::int short
    into a from public.attendance_grid(p_ms, p_end, null, p_staff) g;

  select coalesce(sum(round(vl.net_price * vls.share)), 0)::bigint into credit
    from public.visit_line_staff vls
    join public.visit_lines vl on vl.id = vls.line_id and vl.kind = 'service' and vl.status = 'active'
    join public.bills bb on bb.visit_id = vl.visit_id and bb.status = 'final' and bb.business_date between p_ms and p_end
   where vls.staff_id = p_staff;

  select coalesce(sum(amount), 0) into adv from public.salary_advances
   where staff_id = p_staff and status = 'active' and business_date between p_ms and p_end;

  select coalesce(pl.carry_out, 0), coalesce(pl.makeup_days, 0) into carry, prev_makeup
    from public.payroll_lines pl join public.payroll_runs pr on pr.id = pl.run_id
   where pl.staff_id = p_staff and pr.status = 'final' and not pl.void and pr.month < p_ms
   order by pr.month desc limit 1;
  carry := coalesce(carry, 0); prev_makeup := coalesce(prev_makeup, 0);

  -- leavers get no incentive (agreed rule for settlements)
  inc := case when p_exit or s.last_working_on is not null then 0 else public.incentive_amount(credit, sal, sales) end;
  select * into calc from public.payroll_math(sal, e_full, e_win, a.absent::int, a.half::int, a.extra, a.short, inc, adv, carry);
  mk := greatest(0, prev_makeup + a.absent + 0.5 * a.half - a.extra);

  insert into public.payroll_lines(run_id, staff_id, salary, expected_days_full, expected_days, day_rate, present_days,
      absent_days, half_days, extra_days, leave_days, short_minutes, absent_deduction, extra_pay, short_deduction, base_pay,
      credit, salon_sales, target, incentive, advances, carry_in, net_pay, carry_out, makeup_days, window_end)
  values (p_run, p_staff, sal, e_full, e_win, calc.day_rate, a.present, a.absent, a.half, a.extra, a.leave, a.short,
      calc.absent_deduction, calc.extra_pay, calc.short_deduction, calc.base_pay, credit, sales,
      sal * coalesce(public.setting_num('incentive_multiple'), 3)::bigint, inc, adv, carry, calc.net_pay, calc.carry_out, mk, p_end)
  on conflict (run_id, staff_id) do update set
      salary = excluded.salary, expected_days_full = excluded.expected_days_full, expected_days = excluded.expected_days,
      day_rate = excluded.day_rate, present_days = excluded.present_days, absent_days = excluded.absent_days,
      half_days = excluded.half_days, extra_days = excluded.extra_days, leave_days = excluded.leave_days,
      short_minutes = excluded.short_minutes, absent_deduction = excluded.absent_deduction, extra_pay = excluded.extra_pay,
      short_deduction = excluded.short_deduction, base_pay = excluded.base_pay, credit = excluded.credit,
      salon_sales = excluded.salon_sales, target = excluded.target, incentive = excluded.incentive,
      advances = excluded.advances, carry_in = excluded.carry_in, net_pay = excluded.net_pay, carry_out = excluded.carry_out,
      makeup_days = excluded.makeup_days, window_end = excluded.window_end, void = false;
end $$;

create or replace function public.run_payroll(p_branch uuid, p_month date)
returns public.payroll_runs language plpgsql security definer set search_path = public as $$
declare
  m public.staff := public.require_manager();
  ms date := date_trunc('month', p_month)::date;
  me date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  run public.payroll_runs; s record;
begin
  if ms > public.business_date() then raise exception 'That month has not started'; end if;
  select * into run from public.payroll_runs where branch_id = p_branch and month = ms and kind = 'monthly' for update;
  if found and run.status = 'final' then raise exception 'This payroll is final and locked'; end if;
  if not found then
    insert into public.payroll_runs(branch_id, month, created_by) values (p_branch, ms, auth.uid()) returning * into run;
  end if;
  for s in select st.id, st.last_working_on from public.staff st
            where st.branch_id = p_branch and st.joined_on <= me
              and (st.status = 'active' or exists (select 1 from public.attendance x where x.staff_id = st.id and x.date between ms and me))
              and (st.last_working_on is null or st.last_working_on >= ms)
              and not exists (select 1 from public.payroll_runs er where er.kind = 'exit' and er.staff_id = st.id and er.month = ms)
              and not exists (select 1 from public.payroll_lines pl join public.payroll_runs pr on pr.id = pl.run_id   -- already paid in a settlement
                               where pl.staff_id = st.id and pr.month = ms and pr.id <> run.id and pr.status = 'final' and not pl.void) loop
    perform public.payroll_calc_line(run.id, s.id, ms, least(me, coalesce(s.last_working_on, me)), false);
  end loop;
  return run;
end $$;

-- pay what is owed up to the last working date, right now or whenever the owner wants
create or replace function public.settle_exit(p_staff uuid, p_through date default null)
returns public.payroll_runs language plpgsql security definer set search_path = public as $$
declare m public.staff := public.require_manager(); s public.staff; thru date; ms date; run public.payroll_runs;
begin
  select * into s from public.staff where id = p_staff;
  if not found then raise exception 'Staff member not found'; end if;
  thru := coalesce(p_through, s.last_working_on);
  if thru is null then raise exception 'Set the last working date first'; end if;
  if thru > public.business_date() + 31 then raise exception 'That date is too far ahead'; end if;
  if thru < s.joined_on then raise exception 'Last working date is before the joining date'; end if;
  ms := date_trunc('month', thru)::date;
  if exists (select 1 from public.payroll_lines pl join public.payroll_runs pr on pr.id = pl.run_id
              where pl.staff_id = p_staff and pr.kind = 'monthly' and pr.month = ms and pr.status = 'final' and not pl.void) then
    raise exception 'This month was already paid in the monthly payroll';
  end if;
  select * into run from public.payroll_runs where staff_id = p_staff and month = ms and kind = 'exit' for update;
  if found and run.status = 'final' then raise exception 'This settlement is final and locked'; end if;
  if not found then
    insert into public.payroll_runs(branch_id, month, kind, staff_id, created_by)
    values (s.branch_id, ms, 'exit', p_staff, auth.uid()) returning * into run;
  end if;
  update public.payroll_lines set void = true
   where staff_id = p_staff and not void and run_id in
         (select id from public.payroll_runs where kind = 'monthly' and month = ms and status = 'draft');
  perform public.payroll_calc_line(run.id, p_staff, ms, thru, true);
  return run;
end $$;

create or replace function public.finalize_payroll(p_run uuid) returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare m public.staff := public.require_manager(); run public.payroll_runs; prev date;
begin
  select * into run from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if run.status = 'final' then raise exception 'Already final'; end if;
  select max(r.month) into prev from public.payroll_runs r
   where r.branch_id = run.branch_id and r.month < run.month and r.status = 'draft'
     and (r.kind = 'monthly' or r.staff_id = run.staff_id);
  if prev is not null then raise exception 'Finalise the % payroll first', to_char(prev, 'Mon YYYY'); end if;
  update public.payroll_runs set status = 'final', finalized_at = now(), finalized_by = auth.uid()
   where id = p_run returning * into run;
  return run;
end $$;
