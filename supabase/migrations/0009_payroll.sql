-- Phase 6: payroll runs, incentive, advance carry-forward, payslips.

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  branch_id uuid not null references public.branches(id),
  month date not null check (month = date_trunc('month', month)::date),
  status text not null default 'draft' check (status in ('draft','final')),
  finalized_at timestamptz,
  finalized_by uuid,
  unique (branch_id, month)
);

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id uuid not null references public.payroll_runs(id),
  staff_id uuid not null references public.staff(id),
  salary bigint not null,
  expected_days_full int not null,           -- working days in the whole month (day-rate base)
  expected_days int not null,                -- working days from the joining date
  day_rate bigint not null,
  present_days int not null default 0,
  absent_days int not null default 0,
  half_days int not null default 0,
  extra_days numeric(5,1) not null default 0,
  leave_days int not null default 0,
  short_minutes int not null default 0,
  absent_deduction bigint not null default 0,
  extra_pay bigint not null default 0,
  short_deduction bigint not null default 0,
  base_pay bigint not null,
  credit bigint not null default 0,
  salon_sales bigint not null default 0,
  target bigint not null default 0,
  incentive bigint not null default 0,
  advances bigint not null default 0,
  carry_in bigint not null default 0,
  net_pay bigint not null,
  carry_out bigint not null default 0,
  paid_at timestamptz,
  paid_mode text check (paid_mode in ('cash','upi')),
  unique (run_id, staff_id)
);

create trigger audit_payroll_runs after insert or update or delete on public.payroll_runs
  for each row execute function public.audit_row();
create trigger audit_payroll_lines after insert or update or delete on public.payroll_lines
  for each row execute function public.audit_row();
create trigger payroll_runs_no_delete before delete on public.payroll_runs
  for each row execute function public.block_mutation();
create trigger payroll_lines_no_delete before delete on public.payroll_lines
  for each row execute function public.block_mutation();

-- once the run is final every number is frozen; only payment details may change
create or replace function public.payroll_freeze() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select status from public.payroll_runs where id = old.run_id) = 'final'
     and (to_jsonb(new) - 'paid_at' - 'paid_mode') is distinct from (to_jsonb(old) - 'paid_at' - 'paid_mode') then
    raise exception 'This payroll is final and locked';
  end if;
  return new;
end $$;
create trigger payroll_lines_freeze before update on public.payroll_lines
  for each row execute function public.payroll_freeze();

alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;
create policy runs_read on public.payroll_runs for select using (public.is_manager());
create policy runs_read_own on public.payroll_runs for select
  using (status = 'final' and exists (select 1 from public.payroll_lines l where l.run_id = payroll_runs.id));
create policy lines_read_manager on public.payroll_lines for select using (public.is_manager());
create or replace function public.payroll_run_is_final(p_run uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.payroll_runs where id = p_run and status = 'final')
$$;
create policy lines_read_own on public.payroll_lines for select
  using (staff_id = (select id from public.me()) and public.payroll_run_is_final(run_id));

-- ---------------------------------------------------------------- the maths (PRD 7.1 and 7.3)
create or replace function public.payroll_math(
  p_salary bigint, p_expected_full int, p_expected_window int, p_absent int, p_half int, p_extra numeric,
  p_short_min int, p_incentive bigint, p_advances bigint, p_carry_in bigint)
returns table (day_rate bigint, absent_deduction bigint, extra_pay bigint, short_deduction bigint,
               base_pay bigint, net_pay bigint, carry_out bigint)
language plpgsql stable security definer set search_path = public as $$
declare dr numeric; hr numeric; req numeric := coalesce(public.setting_num('required_hours'), 9);
        ded numeric; ext numeric; sht numeric; base numeric; raw numeric;
begin
  dr := p_salary::numeric / greatest(p_expected_full, 1);
  hr := dr / req;
  ded := dr * (p_absent + 0.5 * p_half);
  ext := dr * p_extra;
  sht := hr * p_short_min / 60.0;
  base := greatest(0, dr * p_expected_window - ded + ext - sht);
  raw := base + p_incentive - p_advances - p_carry_in;
  return query select round(dr)::bigint, round(ded)::bigint, round(ext)::bigint, round(sht)::bigint, round(base)::bigint,
                      case when raw > 0 then (round(raw / 100) * 100)::bigint else 0::bigint end,
                      case when raw < 0 then round(-raw)::bigint else 0::bigint end;
end $$;

-- working days = days minus the staff's weekly offs minus salon holidays
create or replace function public.payroll_expected_days(p_staff uuid, p_branch uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') g(d)
   where not exists (select 1 from (select weekly_off_day w from public.staff_terms t
                                     where t.staff_id = p_staff and t.effective_from <= g.d::date
                                     order by t.effective_from desc limit 1) o
                      where o.w = extract(dow from g.d)::int)
     and not exists (select 1 from public.holidays h where h.branch_id = p_branch and h.date = g.d::date and h.status = 'active')
$$;

-- ---------------------------------------------------------------- run, finalise, pay
create or replace function public.run_payroll(p_branch uuid, p_month date)
returns public.payroll_runs language plpgsql security definer set search_path = public as $$
declare
  m public.staff := public.require_manager();
  ms date := date_trunc('month', p_month)::date;
  me date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  run public.payroll_runs; s record; sales bigint; credit bigint; adv bigint; carry bigint; sal bigint;
  e_full int; e_win int; a record; inc bigint; calc record;
begin
  if ms > public.business_date() then raise exception 'That month has not started'; end if;
  select * into run from public.payroll_runs where branch_id = p_branch and month = ms for update;
  if found and run.status = 'final' then raise exception 'This payroll is final and locked'; end if;
  if not found then
    insert into public.payroll_runs(branch_id, month, created_by) values (p_branch, ms, auth.uid()) returning * into run;
  end if;

  select coalesce(sum(l.net_price), 0) into sales
    from public.bills b join public.visit_lines l on l.visit_id = b.visit_id and l.status = 'active' and l.kind in ('service','product')
   where b.status = 'final' and b.branch_id = p_branch and b.business_date between ms and me;

  for s in select * from public.staff st
            where st.branch_id = p_branch
              and (st.status = 'active' or exists (select 1 from public.attendance x where x.staff_id = st.id and x.date between ms and me))
              and st.joined_on <= me loop
    sal := public.salary_on(s.id, me);
    e_full := public.payroll_expected_days(s.id, p_branch, ms, me);
    e_win := public.payroll_expected_days(s.id, p_branch, greatest(ms, s.joined_on), me);

    select count(*) filter (where g.status in ('present','present_short')) present,
           count(*) filter (where g.status = 'absent') absent,
           count(*) filter (where g.status = 'half_day') half,
           coalesce(sum(case g.status when 'extra_day' then 1 when 'extra_half' then 0.5 else 0 end), 0) extra,
           count(*) filter (where g.status in ('leave','holiday')) leave,
           coalesce(sum(g.short_minutes), 0)::int short
      into a from public.attendance_grid(ms, me, null, s.id) g;

    select coalesce(sum(round(vl.net_price * vls.share)), 0)::bigint into credit
      from public.visit_line_staff vls
      join public.visit_lines vl on vl.id = vls.line_id and vl.kind = 'service' and vl.status = 'active'
      join public.bills bb on bb.visit_id = vl.visit_id and bb.status = 'final' and bb.business_date between ms and me
     where vls.staff_id = s.id;

    select coalesce(sum(amount), 0) into adv from public.salary_advances
     where staff_id = s.id and status = 'active' and business_date between ms and me;

    select coalesce((select pl.carry_out from public.payroll_lines pl join public.payroll_runs pr on pr.id = pl.run_id
                      where pl.staff_id = s.id and pr.status = 'final' and pr.month < ms
                      order by pr.month desc limit 1), 0) into carry;

    inc := public.incentive_amount(credit, sal, sales);
    select * into calc from public.payroll_math(sal, e_full, e_win, a.absent::int, a.half::int, a.extra, a.short, inc, adv, carry);

    insert into public.payroll_lines(run_id, staff_id, salary, expected_days_full, expected_days, day_rate, present_days,
        absent_days, half_days, extra_days, leave_days, short_minutes, absent_deduction, extra_pay, short_deduction, base_pay,
        credit, salon_sales, target, incentive, advances, carry_in, net_pay, carry_out)
    values (run.id, s.id, sal, e_full, e_win, calc.day_rate, a.present, a.absent, a.half, a.extra, a.leave, a.short,
        calc.absent_deduction, calc.extra_pay, calc.short_deduction, calc.base_pay, credit, sales,
        sal * coalesce(public.setting_num('incentive_multiple'), 3)::bigint, inc, adv, carry, calc.net_pay, calc.carry_out)
    on conflict (run_id, staff_id) do update set
        salary = excluded.salary, expected_days_full = excluded.expected_days_full, expected_days = excluded.expected_days,
        day_rate = excluded.day_rate, present_days = excluded.present_days, absent_days = excluded.absent_days,
        half_days = excluded.half_days, extra_days = excluded.extra_days, leave_days = excluded.leave_days,
        short_minutes = excluded.short_minutes, absent_deduction = excluded.absent_deduction, extra_pay = excluded.extra_pay,
        short_deduction = excluded.short_deduction, base_pay = excluded.base_pay, credit = excluded.credit,
        salon_sales = excluded.salon_sales, target = excluded.target, incentive = excluded.incentive,
        advances = excluded.advances, carry_in = excluded.carry_in, net_pay = excluded.net_pay, carry_out = excluded.carry_out;
  end loop;
  return run;
end $$;

create or replace function public.finalize_payroll(p_run uuid) returns public.payroll_runs
language plpgsql security definer set search_path = public as $$
declare m public.staff := public.require_manager(); run public.payroll_runs; prev date;
begin
  select * into run from public.payroll_runs where id = p_run for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if run.status = 'final' then raise exception 'Already final'; end if;
  -- carry-forward needs earlier months settled first
  select max(r.month) into prev from public.payroll_runs r where r.branch_id = run.branch_id and r.month < run.month and r.status = 'draft';
  if prev is not null then raise exception 'Finalise the % payroll first', to_char(prev, 'Mon YYYY'); end if;
  update public.payroll_runs set status = 'final', finalized_at = now(), finalized_by = auth.uid()
   where id = p_run returning * into run;
  return run;
end $$;

create or replace function public.mark_payslip_paid(p_line uuid, p_mode text) returns public.payroll_lines
language plpgsql security definer set search_path = public as $$
declare m public.staff := public.require_manager(); l public.payroll_lines;
begin
  if p_mode not in ('cash','upi') then raise exception 'Choose cash or GPay'; end if;
  if (select r.status from public.payroll_runs r join public.payroll_lines x on x.run_id = r.id where x.id = p_line) is distinct from 'final' then
    raise exception 'Finalise the payroll before marking it paid';
  end if;
  update public.payroll_lines set paid_at = coalesce(paid_at, now()), paid_mode = coalesce(paid_mode, p_mode)
   where id = p_line returning * into l;
  return l;
end $$;
