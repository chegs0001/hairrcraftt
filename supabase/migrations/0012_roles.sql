-- Roles: Admin > Manager > Staff.
-- Admin is a flag on top of role 'manager' so every existing "manager" check keeps working for admins.
-- This migration moves the admin-only powers up and hardens function access.

alter table public.staff add column is_admin boolean not null default false;
alter table public.staff add constraint staff_admin_is_manager check (not is_admin or role = 'manager');
update public.staff set is_admin = true where email = 'cheragverma0001@gmail.com' and role = 'manager';

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where auth_user_id = auth.uid() and status = 'active' and is_admin)
$$;

create or replace function public.require_admin() returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare s public.staff := public.require_staff();
begin
  if not s.is_admin then raise exception 'Admins only'; end if;
  return s;
end $$;

-- the first sign-in of the owner's email creates an Admin
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bootstrap_email constant text := 'cheragverma0001@gmail.com';
  nm text := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '');
begin
  update public.staff set auth_user_id = new.id, name = case when name = '' then nm else name end
   where lower(email) = lower(new.email) and auth_user_id is null;
  if found then return new; end if;
  if lower(new.email) = bootstrap_email then
    insert into public.staff(auth_user_id, email, name, role, is_admin, status, branch_id)
    values (new.id, lower(new.email), nm, 'manager', true, 'active', (select id from public.branches order by code limit 1));
  else
    insert into public.staff(auth_user_id, email, name, role, status) values (new.id, lower(new.email), nm, 'member', 'pending');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- staff changes: managers approve and schedule, admins do the rest
create or replace function public.staff_guard() returns trigger
language plpgsql as $$
begin
  new.email := lower(new.email);
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      if new.role <> 'member' or new.is_admin then raise exception 'Only an admin can create managers or admins'; end if;
    else
      if old.is_admin then raise exception 'Only an admin can change an admin'; end if;
      if new.role is distinct from old.role or new.is_admin is distinct from old.is_admin then
        raise exception 'Only an admin can change roles';
      end if;
      if new.last_working_on is distinct from old.last_working_on or new.joined_on is distinct from old.joined_on then
        raise exception 'Only an admin can change joining or last working dates';
      end if;
      if new.status = 'inactive' and old.status <> 'inactive' then raise exception 'Only an admin can deactivate staff'; end if;
      if old.status = 'inactive' and new.status <> 'inactive' then raise exception 'Only an admin can reactivate staff'; end if;
    end if;
  end if;
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

-- ---------------------------------------------------------------- admin-only data (row level security)
drop policy terms_manager on public.staff_terms;
create policy terms_admin on public.staff_terms for all using (public.is_admin()) with check (public.is_admin());

drop policy settings_write on public.settings;
create policy settings_write on public.settings for all using (public.is_admin()) with check (public.is_admin());

drop policy branches_write on public.branches;
create policy branches_write on public.branches for all using (public.is_admin()) with check (public.is_admin());

drop policy audit_manager on public.audit_log;
create policy audit_admin on public.audit_log for select using (public.is_admin());

drop policy movements_read on public.cash_movements;
create policy movements_read on public.cash_movements for select using (public.is_admin());

drop policy runs_read on public.payroll_runs;
create policy runs_read on public.payroll_runs for select using (public.is_admin());
drop policy lines_read_manager on public.payroll_lines;
create policy lines_read_admin on public.payroll_lines for select using (public.is_admin());

-- managers set the weekly off without ever seeing a salary
create or replace function public.staff_schedule() returns table (staff_id uuid, weekly_off_day smallint)
language sql stable security definer set search_path = public as $$
  select s.id, (select t.weekly_off_day from public.staff_terms t where t.staff_id = s.id
                 and t.effective_from <= public.business_date() order by t.effective_from desc limit 1)
    from public.staff s where public.is_manager()
$$;

create or replace function public.set_weekly_off(p_staff uuid, p_day int) returns void
language plpgsql security definer set search_path = public as $$
declare m public.staff := public.require_manager();
begin
  if p_day not between 0 and 6 then raise exception 'Choose a day of the week'; end if;
  if not exists (select 1 from public.staff where id = p_staff) then raise exception 'Staff member not found'; end if;
  insert into public.staff_terms(staff_id, monthly_salary, weekly_off_day, effective_from, created_by)
  values (p_staff, public.salary_on(p_staff, public.business_date()), p_day, public.business_date(), auth.uid())
  on conflict (staff_id, effective_from) do update set weekly_off_day = excluded.weekly_off_day;
end $$;

-- ---------------------------------------------------------------- functions that become admin-only
create or replace function public.run_payroll(p_branch uuid, p_month date)
returns public.payroll_runs language plpgsql security definer set search_path = public as $$
declare
  m public.staff := public.require_admin();
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

create or replace function public.settle_exit(p_staff uuid, p_through date default null)
returns public.payroll_runs language plpgsql security definer set search_path = public as $$
declare m public.staff := public.require_admin(); s public.staff; thru date; ms date; run public.payroll_runs;
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
declare m public.staff := public.require_admin(); run public.payroll_runs; prev date;
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

create or replace function public.mark_payslip_paid(p_line uuid, p_mode text) returns public.payroll_lines
language plpgsql security definer set search_path = public as $$
declare m public.staff := public.require_admin(); l public.payroll_lines;
begin
  if p_mode not in ('cash','upi') then raise exception 'Choose cash or GPay'; end if;
  if (select r.status from public.payroll_runs r join public.payroll_lines x on x.run_id = r.id where x.id = p_line) is distinct from 'final' then
    raise exception 'Finalise the payroll before marking it paid';
  end if;
  update public.payroll_lines set paid_at = coalesce(paid_at, now()), paid_mode = coalesce(paid_mode, p_mode)
   where id = p_line returning * into l;
  return l;
end $$;

create or replace function public.add_cash_movement(p_type text, p_amount bigint, p_note text default null, p_branch uuid default null)
returns public.cash_movements language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); m public.cash_movements;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  insert into public.cash_movements(branch_id, type, amount, note, created_by)
  values (public.resolve_branch(p_branch), p_type, p_amount, p_note, auth.uid()) returning * into m;
  return m;
end $$;

create or replace function public.dashboard_month(p_branch uuid default null, p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ms date := date_trunc('month', coalesce(p_month, public.business_date()))::date;
  me date := (date_trunc('month', coalesce(p_month, public.business_date())) + interval '1 month - 1 day')::date;
  last date; elapsed int; branches_j jsonb; daily_j jsonb; cats_j jsonb; top_j jsonb;
begin
  perform public.require_manager();
  last := least(me, public.business_date());
  elapsed := greatest(1, extract(day from last)::int);

  select coalesce(jsonb_agg(x order by x->>'code'), '[]') into branches_j from (
    select jsonb_build_object(
      'branch_id', br.id, 'code', br.code, 'name', br.name,
      'net_sales', ns.v,
      'gate', coalesce(public.setting_num('incentive_gate_paise'), 25000000)::bigint,
      'projected', case when last < me then round(ns.v::numeric / elapsed * extract(day from me))::bigint else ns.v end,
      'staff', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'staff_id', s.id, 'name', s.name, 'salary', case when public.is_admin() then public.salary_on(s.id, last) end,
          'credit', cr.v,
          'target', case when public.is_admin() then public.salary_on(s.id, last) * coalesce(public.setting_num('incentive_multiple'), 3)::bigint end,
          'incentive', case when public.is_admin() then public.incentive_amount(cr.v, public.salary_on(s.id, last), ns.v) end,
          'present', coalesce(a.present, 0), 'absent', coalesce(a.absent, 0), 'half', coalesce(a.half, 0), 'short', coalesce(a.short, 0))
          order by s.name), '[]')
        from public.staff s
        cross join lateral (
          select coalesce(sum(round(vl.net_price * vls.share)), 0)::bigint v
            from public.visit_line_staff vls
            join public.visit_lines vl on vl.id = vls.line_id and vl.kind = 'service' and vl.status = 'active'
            join public.bills bb on bb.visit_id = vl.visit_id and bb.status = 'final' and bb.business_date between ms and me
           where vls.staff_id = s.id) cr
        left join lateral (
          select count(*) filter (where g.status in ('present','present_short','extra_day','extra_half')) present,
                 count(*) filter (where g.status = 'absent') absent,
                 count(*) filter (where g.status = 'half_day') half,
                 count(*) filter (where g.short_minutes > 0) short
            from public.attendance_grid(ms, last, s.branch_id, s.id) g) a on true
        where s.status = 'active' and s.branch_id = br.id)
    ) x
    from public.branches br
    cross join lateral (
      select coalesce(sum(l.net_price), 0)::bigint v
        from public.bills b join public.visit_lines l on l.visit_id = b.visit_id and l.status = 'active' and l.kind in ('service','product')
       where b.status = 'final' and b.branch_id = br.id and b.business_date between ms and me) ns
    where p_branch is null or br.id = p_branch
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object('date', dd, 'amount', coalesce(t.v, 0)) order by dd), '[]') into daily_j
    from generate_series(ms, last, interval '1 day') dd
    left join (select b.business_date dte, sum(l.net_price)::bigint v
                 from public.bills b join public.visit_lines l on l.visit_id = b.visit_id and l.status = 'active' and l.kind in ('service','product')
                where b.status = 'final' and b.business_date between ms and me and (p_branch is null or b.branch_id = p_branch)
                group by 1) t on t.dte = dd::date;

  select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'amount', s.v) order by s.v desc), '[]') into cats_j from (
    select sv.category_id, sum(l.net_price)::bigint v
      from public.bills b join public.visit_lines l on l.visit_id = b.visit_id and l.status = 'active' and l.kind = 'service'
      join public.services sv on sv.id = l.item_id
     where b.status = 'final' and b.business_date between ms and me and (p_branch is null or b.branch_id = p_branch)
     group by 1) s join public.service_categories c on c.id = s.category_id;

  select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'count', t.n, 'amount', t.v) order by t.v desc), '[]') into top_j from (
    select l.name, sum(l.qty)::int n, sum(l.net_price)::bigint v
      from public.bills b join public.visit_lines l on l.visit_id = b.visit_id and l.status = 'active' and l.kind = 'service'
     where b.status = 'final' and b.business_date between ms and me and (p_branch is null or b.branch_id = p_branch)
     group by l.name order by v desc limit 10) t;

  return jsonb_build_object('month', ms, 'days_elapsed', elapsed, 'days_in_month', extract(day from me)::int,
    'branches', branches_j, 'daily', daily_j, 'categories', cats_j, 'top_services', top_j);
end $$;

create or replace function public.report(p_name text, p_from date, p_to date, p_branch uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare f date := coalesce(p_from, public.business_date() - 30); t date := coalesce(p_to, public.business_date());
begin
  perform public.require_manager();
  if p_name = 'audit' then perform public.require_admin(); end if;

  if p_name = 'sales' then
    return query
    select jsonb_build_object('bill_no', b.bill_no, 'date', b.business_date, 'salon', br.code, 'client', c.name,
             'services', (select string_agg(l.name || case when l.qty > 1 then ' x' || l.qty else '' end, ', ' order by l.created_at)
                            from public.visit_lines l where l.visit_id = b.visit_id and l.status = 'active' and l.kind = 'service'),
             'staff', (select string_agg(distinct st.name, ', ')
                         from public.visit_lines l join public.visit_line_staff vs on vs.line_id = l.id
                         join public.staff st on st.id = vs.staff_id where l.visit_id = b.visit_id and l.status = 'active'),
             'subtotal', b.subtotal / 100.0, 'discount', b.discount / 100.0, 'membership', b.membership_fee / 100.0,
             'total_payable', b.total_payable / 100.0,
             'cash', coalesce((select sum(amount) from public.payments p where p.bill_id = b.id and p.mode = 'cash'), 0) / 100.0,
             'gpay', coalesce((select sum(amount) from public.payments p where p.bill_id = b.id and p.mode = 'upi'), 0) / 100.0,
             'due_left', b.new_due / 100.0)
      from public.bills b join public.branches br on br.id = b.branch_id join public.clients c on c.id = b.client_id
     where b.status = 'final' and b.business_date between f and t and (p_branch is null or b.branch_id = p_branch)
     order by b.business_date, b.bill_no limit 2000;

  elsif p_name = 'staff_performance' then
    return query
    select jsonb_build_object('staff', s.name, 'salon', br.code, 'services', x.n, 'bills_worked', x.bills,
             'credit', x.credit / 100.0, 'avg_per_bill', case when x.bills > 0 then round(x.credit / 100.0 / x.bills) else 0 end,
             'discounted_bills', x.disc_bills)
      from public.staff s join public.branches br on br.id = s.branch_id
      cross join lateral (
        select count(*) n, count(distinct b.id) bills, coalesce(sum(round(l.net_price * vs.share)), 0)::bigint credit,
               count(distinct b.id) filter (where b.discount > 0) disc_bills
          from public.visit_line_staff vs
          join public.visit_lines l on l.id = vs.line_id and l.kind = 'service' and l.status = 'active'
          join public.bills b on b.visit_id = l.visit_id and b.status = 'final' and b.business_date between f and t
         where vs.staff_id = s.id) x
     where s.status = 'active' and (p_branch is null or s.branch_id = p_branch)
     order by x.credit desc;

  elsif p_name = 'discounts' then
    return query
    select u.j from (
      select jsonb_build_object('type', 'Price below list', 'date', v.business_date, 'salon', br.code, 'client', c.name,
               'staff', coalesce(st.name, ''), 'item', l.name, 'amount', (l.list_price - l.price) * l.qty / 100.0, 'reason', l.flag_reason) j, v.business_date d
        from public.visit_lines l join public.visits v on v.id = l.visit_id join public.branches br on br.id = v.branch_id
        join public.clients c on c.id = v.client_id left join public.staff st on st.auth_user_id = l.created_by
       where l.flagged and l.status = 'active' and v.business_date between f and t and (p_branch is null or v.branch_id = p_branch)
      union all
      select jsonb_build_object('type', 'Bill discount', 'date', b.business_date, 'salon', br.code, 'client', c.name,
               'staff', coalesce(st.name, ''), 'item', b.bill_no, 'amount', b.discount / 100.0, 'reason', b.discount_reason), b.business_date
        from public.bills b join public.branches br on br.id = b.branch_id join public.clients c on c.id = b.client_id
        left join public.staff st on st.auth_user_id = b.created_by
       where b.discount > 0 and b.status = 'final' and b.business_date between f and t and (p_branch is null or b.branch_id = p_branch)
    ) u order by u.d limit 2000;

  elsif p_name = 'dues' then
    return query
    select jsonb_build_object('client', c.name, 'phone', c.phone, 'due', bal.v / 100.0, 'since', bal.since)
      from public.clients c
      cross join lateral (select sum(amount) v, (min(created_at) filter (where type = 'due_added'))::date since
                            from public.client_ledger where client_id = c.id) bal
     where bal.v > 0 order by bal.since nulls last limit 2000;

  elsif p_name = 'prime' then
    return query
    select jsonb_build_object('client', c.name, 'phone', c.phone, 'start', m.start_date, 'end', m.end_date,
             'status', case when m.end_date < public.business_date() then 'Expired'
                            when m.end_date <= public.business_date() + 30 then 'Expiring in 30 days' else 'Active' end)
      from (select distinct on (client_id) * from public.memberships order by client_id, end_date desc) m
      join public.clients c on c.id = m.client_id
     order by m.end_date limit 2000;

  elsif p_name = 'expenses' then
    return query
    select jsonb_build_object('date', e.business_date, 'salon', br.code, 'category', e.category, 'title', e.title,
             'amount', e.amount / 100.0, 'paid_from', e.paid_from, 'by', coalesce(st.name, ''), 'receipt', e.receipt_path is not null)
      from public.expenses e join public.branches br on br.id = e.branch_id left join public.staff st on st.auth_user_id = e.created_by
     where e.status = 'active' and e.business_date between f and t and (p_branch is null or e.branch_id = p_branch)
     order by e.business_date limit 2000;

  elsif p_name = 'cash_closings' then
    return query
    select jsonb_build_object('date', d.business_date, 'salon', br.code, 'opening', d.opening / 100.0, 'expected', d.expected / 100.0,
             'counted', d.counted / 100.0, 'difference', d.difference / 100.0, 'gpay_expected', d.upi_expected / 100.0,
             'closed_by', coalesce(st.name, ''), 'status', d.status, 'note', d.note)
      from public.day_closings d join public.branches br on br.id = d.branch_id left join public.staff st on st.auth_user_id = d.created_by
     where d.business_date between f and t and (p_branch is null or d.branch_id = p_branch)
     order by d.business_date limit 2000;

  elsif p_name = 'attendance' then
    return query
    select jsonb_build_object('staff', g.name, 'date', g.date, 'status', g.status,
             'in', to_char(g.in_at at time zone 'Asia/Kolkata', 'HH24:MI'), 'out', to_char(g.out_at at time zone 'Asia/Kolkata', 'HH24:MI'),
             'worked_min', g.worked_minutes, 'short_min', g.short_minutes, 'auto_closed', g.auto_closed, 'corrected', g.corrected)
      from public.attendance_grid(f, t, p_branch, null) g order by g.date, g.name limit 5000;

  elsif p_name = 'audit' then
    return query
    select jsonb_build_object('when', to_char(a.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'),
             'who', coalesce(st.name, st.email, ''), 'table', a.table_name, 'action', a.action,
             'reason', a.reason, 'before', a.before, 'after', a.after)
      from public.audit_log a left join public.staff st on st.auth_user_id = a.actor
     where (a.created_at at time zone 'Asia/Kolkata')::date between f and t
     order by a.created_at desc limit 500;

  else
    raise exception 'Unknown report %', p_name;
  end if;
end $$;

-- ---------------------------------------------------------------- nobody calls internal helpers, or anything while signed out
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema public to service_role';
    execute 'alter default privileges in schema public grant execute on functions to service_role';
  end if;
end $$;
-- internal only: these would leak salaries or write payroll rows if callable from the API
revoke execute on function public.salary_on(uuid, date) from authenticated;
revoke execute on function public.payroll_calc_line(uuid, uuid, date, date, boolean) from authenticated;
revoke execute on function public.flag_unclosed_days() from authenticated;
revoke execute on function public.auto_close_attendance() from authenticated;
revoke execute on function public.deactivate_departed() from authenticated;
