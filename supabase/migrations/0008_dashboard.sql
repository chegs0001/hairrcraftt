-- Phase 5: manager dashboard, flags inbox, reports. All numbers are computed here, once.

create or replace function public.require_manager() returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare s public.staff := public.require_staff();
begin
  if s.role <> 'manager' then raise exception 'Managers only'; end if;
  return s;
end $$;

-- incentive = rate% x max(0, credit - multiple x salary), only if the salon cleared the gate (PRD 7.2)
create or replace function public.incentive_amount(p_credit bigint, p_salary bigint, p_salon_sales bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select case when p_salon_sales >= coalesce(public.setting_num('incentive_gate_paise'), 25000000)
    then round(greatest(0, p_credit - coalesce(public.setting_num('incentive_multiple'), 3) * p_salary)
               * coalesce(public.setting_num('incentive_rate_pct'), 5) / 100)::bigint
    else 0 end
$$;

create or replace function public.salary_on(p_staff uuid, p_date date) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select monthly_salary from public.staff_terms
                    where staff_id = p_staff and effective_from <= p_date order by effective_from desc limit 1), 0)
$$;

-- ---------------------------------------------------------------- today (one salon, or both when p_branch is null)
create or replace function public.dashboard_today(p_branch uuid default null, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d date := coalesce(p_date, public.business_date());
  svc bigint; prod bigint; mem bigint; nbills int; nnew int; nret int;
  cash bigint; upi bigint; due_created bigint; due_collected bigint; exp bigint; adv bigint; open_v int;
  cashs jsonb; staff_t jsonb;
begin
  perform public.require_manager();

  select coalesce(sum(l.net_price) filter (where l.kind = 'service'), 0),
         coalesce(sum(l.net_price) filter (where l.kind = 'product'), 0),
         coalesce(sum(l.net_price) filter (where l.kind = 'membership'), 0)
    into svc, prod, mem
    from public.bills b join public.visit_lines l on l.visit_id = b.visit_id and l.status = 'active'
   where b.status = 'final' and b.business_date = d and (p_branch is null or b.branch_id = p_branch);

  select count(*), coalesce(sum(new_due), 0) into nbills, due_created
    from public.bills b where b.status = 'final' and b.business_date = d and (p_branch is null or b.branch_id = p_branch);

  select count(*) filter (where not exists (select 1 from public.bills o where o.client_id = x.client_id
                                              and o.status = 'final' and o.business_date < d)),
         count(*) filter (where exists (select 1 from public.bills o where o.client_id = x.client_id
                                          and o.status = 'final' and o.business_date < d))
    into nnew, nret
    from (select distinct client_id from public.bills b
           where b.status = 'final' and b.business_date = d and (p_branch is null or b.branch_id = p_branch)) x;

  select coalesce(sum(amount) filter (where mode = 'cash'), 0), coalesce(sum(amount) filter (where mode = 'upi'), 0),
         coalesce(sum(amount) filter (where kind = 'due_collection'), 0)
    into cash, upi, due_collected
    from public.payments p where p.business_date = d and (p_branch is null or p.branch_id = p_branch);

  select coalesce(sum(amount), 0) into exp from public.expenses e
   where e.business_date = d and e.status = 'active' and (p_branch is null or e.branch_id = p_branch);
  select coalesce(sum(amount), 0) into adv from public.salary_advances a
   where a.business_date = d and a.status = 'active' and (p_branch is null or a.branch_id = p_branch);
  select count(*) into open_v from public.visits v
   where v.status = 'open' and (p_branch is null or v.branch_id = p_branch);

  select coalesce(jsonb_agg(jsonb_build_object('branch_id', br.id, 'code', br.code, 'closed', sm.closed,
           'expected', sm.expected, 'counted', c.counted, 'difference', c.difference, 'open_visits', sm.open_visits)
           order by br.code), '[]')
    into cashs
    from public.branches br
    cross join lateral public.day_summary(br.id, d) sm
    left join public.day_closings c on c.branch_id = br.id and c.business_date = d and c.status = 'closed'
   where p_branch is null or br.id = p_branch;

  select coalesce(jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.name, 'branch_id', s.branch_id,
           'status', g.status, 'in_at', g.in_at, 'services', coalesce(c.n, 0), 'credit', coalesce(c.credit, 0))
           order by s.name), '[]')
    into staff_t
    from public.staff s
    left join lateral (select * from public.attendance_grid(d, d, s.branch_id, s.id) limit 1) g on true
    left join lateral (
      select count(*) n, sum(round(vl.net_price * vls.share))::bigint credit
        from public.visit_line_staff vls
        join public.visit_lines vl on vl.id = vls.line_id and vl.kind = 'service' and vl.status = 'active'
        join public.bills bb on bb.visit_id = vl.visit_id and bb.status = 'final' and bb.business_date = d
       where vls.staff_id = s.id) c on true
   where s.status = 'active' and (p_branch is null or s.branch_id = p_branch);

  return jsonb_build_object('date', d, 'services', svc, 'products', prod, 'memberships', mem,
    'net_sales', svc + prod + mem, 'bills', nbills, 'clients_new', nnew, 'clients_returning', nret,
    'cash', cash, 'upi', upi, 'dues_created', due_created, 'dues_collected', due_collected,
    'expenses', exp, 'advances', adv, 'open_visits', open_v, 'cash_status', cashs, 'staff', staff_t);
end $$;

-- ---------------------------------------------------------------- month
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
          'staff_id', s.id, 'name', s.name, 'salary', public.salary_on(s.id, last),
          'credit', cr.v,
          'target', public.salary_on(s.id, last) * coalesce(public.setting_num('incentive_multiple'), 3)::bigint,
          'incentive', public.incentive_amount(cr.v, public.salary_on(s.id, last), ns.v),
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

-- ---------------------------------------------------------------- flags
create or replace function public.see_flag(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_manager();
begin
  update public.flags set seen_at = coalesce(seen_at, now()), seen_by = auth.uid(),
         note = case when nullif(btrim(coalesce(p_note, '')), '') is null then note
                     when note is null then 'Manager: ' || btrim(p_note)
                     else note || E'\nManager: ' || btrim(p_note) end
   where id = p_id;
end $$;

-- ---------------------------------------------------------------- reports (rows come back as JSON objects; the app renders and exports CSV)
create or replace function public.report(p_name text, p_from date, p_to date, p_branch uuid default null)
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
declare f date := coalesce(p_from, public.business_date() - 30); t date := coalesce(p_to, public.business_date());
begin
  perform public.require_manager();

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
