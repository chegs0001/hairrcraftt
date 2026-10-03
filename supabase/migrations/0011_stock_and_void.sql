-- Phase 7: retail products and stock, product lines on bills, voiding a bill.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  name text not null check (btrim(name) <> ''),
  sku text,
  selling_price bigint not null check (selling_price >= 0),
  prime_price bigint check (prime_price >= 0),
  low_stock_at int not null default 2,
  active boolean not null default true
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  type text not null check (type in ('purchase','sale','adjustment','transfer','void_return')),
  qty int not null check (qty <> 0),            -- signed: + adds stock, - removes it
  ref uuid,                                     -- bill id or transfer id
  note text
);
create index stock_movements_pb on public.stock_movements(product_id, branch_id);

do $$
declare t text;
begin
  foreach t in array array['products','stock_movements'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row()', t);
    execute format('create trigger %1$s_no_delete before delete on public.%1$s
                    for each row execute function public.block_mutation()', t);
  end loop;
end $$;

alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
create policy products_read on public.products for select using (public.is_active_staff());
create policy products_write on public.products for all using (public.is_manager()) with check (public.is_manager());
create policy movements_read_stock on public.stock_movements for select
  using (public.is_active_staff() and (public.is_manager() or branch_id = public.my_branch()));

-- memberships can be voided together with their bill
alter table public.memberships add column void boolean not null default false;
create or replace function public.prime_end(p_client uuid) returns date
language sql stable security definer set search_path = public as $$
  select max(end_date) from public.memberships
  where client_id = p_client and not void and public.business_date() between start_date and end_date
$$;

alter table public.payments drop constraint payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('bill','due_collection','refund'));

-- ---------------------------------------------------------------- stock
create or replace function public.stock_levels(p_branch uuid default null)
returns table (branch_id uuid, product_id uuid, name text, sku text, qty bigint, low_at int, low boolean)
language sql stable security definer set search_path = public as $$
  select b.id, p.id, p.name, p.sku, coalesce(sum(m.qty), 0)::bigint, p.low_stock_at,
         coalesce(sum(m.qty), 0) <= p.low_stock_at
    from public.branches b
    cross join public.products p
    left join public.stock_movements m on m.branch_id = b.id and m.product_id = p.id
   where p.active and public.is_active_staff()
     and (case when public.is_manager() then (p_branch is null or b.id = p_branch) else b.id = public.my_branch() end)
   group by b.id, p.id
   order by b.code, p.name
$$;

create or replace function public.add_stock(p_branch uuid, p_product uuid, p_qty int, p_type text, p_note text default null)
returns public.stock_movements language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_manager(); m public.stock_movements;
begin
  if p_type not in ('purchase','adjustment') then raise exception 'Choose purchase or adjustment'; end if;
  if coalesce(p_qty, 0) = 0 then raise exception 'Enter a quantity'; end if;
  if p_type = 'purchase' and p_qty < 0 then raise exception 'A purchase must add stock'; end if;
  if p_type = 'adjustment' and coalesce(btrim(p_note), '') = '' then raise exception 'A reason is needed for a stock adjustment'; end if;
  insert into public.stock_movements(branch_id, product_id, type, qty, note, created_by)
  values (p_branch, p_product, p_type, p_qty, p_note, auth.uid()) returning * into m;
  if p_type = 'adjustment' then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('stock_adjusted', p_branch, s.id, p_qty, 'stock_movements', m.id, p_note, auth.uid());
  end if;
  return m;
end $$;

create or replace function public.transfer_stock(p_from uuid, p_to uuid, p_product uuid, p_qty int, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_manager(); ref uuid := gen_random_uuid(); have bigint;
begin
  if p_from = p_to then raise exception 'Choose two different salons'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Enter a quantity'; end if;
  select coalesce(sum(qty), 0) into have from public.stock_movements where branch_id = p_from and product_id = p_product;
  if have < p_qty then raise exception 'Only % in stock at the source salon', have; end if;
  insert into public.stock_movements(branch_id, product_id, type, qty, ref, note, created_by)
  values (p_from, p_product, 'transfer', -p_qty, ref, p_note, auth.uid()),
         (p_to,   p_product, 'transfer',  p_qty, ref, p_note, auth.uid());
  return ref;
end $$;

-- ---------------------------------------------------------------- product lines on a visit (same rules as services)
create or replace function public.add_product_line(
  p_visit uuid, p_product uuid, p_qty int default 1, p_price bigint default null, p_reason text default null)
returns public.visit_lines language plpgsql security definer set search_path = public as $$
declare
  s public.staff := public.require_staff(); v public.visits; pr public.products; l public.visit_lines;
  list_p bigint; unit_p bigint; is_flagged boolean := false;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  perform public.require_branch(v.branch_id);
  if v.status <> 'open' then raise exception 'Visit is not open'; end if;
  select * into pr from public.products where id = p_product and active;
  if not found then raise exception 'Product not found'; end if;
  if coalesce(p_qty, 0) < 1 then raise exception 'Quantity must be at least 1'; end if;

  list_p := case when pr.prime_price is not null and public.prime_end(v.client_id) is not null then pr.prime_price else pr.selling_price end;
  unit_p := coalesce(p_price, list_p);
  if unit_p < list_p then
    if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is needed to charge below the list price'; end if;
    is_flagged := true;
  end if;

  insert into public.visit_lines(visit_id, kind, item_id, name, qty, list_price, price, flagged, flag_reason, created_by, done_at, done_by)
  values (p_visit, 'product', pr.id, pr.name, p_qty, list_p, unit_p, is_flagged,
          case when is_flagged then p_reason end, auth.uid(), now(), auth.uid())      -- products need no completed tick
  returning * into l;
  insert into public.visit_line_staff(line_id, staff_id, share) values (l.id, s.id, 1);   -- the seller
  if is_flagged then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('price_below_list', v.branch_id, s.id, (list_p - unit_p) * p_qty, 'visit_lines', l.id, p_reason, auth.uid());
  end if;
  return l;
end $$;

-- ---------------------------------------------------------------- bill closing (services and products) and day totals that understand refunds
create or replace function public.close_bill(
  p_visit uuid,
  p_cash bigint default 0,
  p_upi bigint default 0,
  p_discount bigint default 0,
  p_discount_reason text default null,
  p_sell_prime boolean default false,
  p_upi_ref text default null)
returns public.bills language plpgsql security definer set search_path = public as $$
declare
  s public.staff := public.require_staff();
  v public.visits; b public.branches; bill public.bills;
  svc_total bigint; prod_total bigint; lines_total bigint; n_svc int; n_prod int; pl record; stk bigint; disc bigint; manual bigint; bday_disc bigint := 0; bday_pct numeric; disc_reason text; fee bigint := 0; bal bigint; payable bigint; paid bigint;
  new_bal bigint; remaining bigint; allocated bigint := 0; n_lines int; i int := 0; line_val bigint; d bigint;
  l record; svc public.services; prime_until date; start_d date; end_d date; validity int; mem_line uuid;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  perform public.require_branch(v.branch_id);
  if v.status <> 'open' then raise exception 'Visit is already closed'; end if;
  if coalesce(p_cash, 0) < 0 or coalesce(p_upi, 0) < 0 or coalesce(p_discount, 0) < 0 then
    raise exception 'Amounts cannot be negative';
  end if;

  select count(*) filter (where kind = 'service'), count(*) filter (where kind = 'product')
    into n_svc, n_prod from public.visit_lines where visit_id = v.id and status = 'active';
  n_lines := n_svc + n_prod;
  if n_lines = 0 then raise exception 'Add at least one service or product before billing'; end if;
  if exists (select 1 from public.visit_lines where visit_id = v.id and status = 'active' and kind = 'service' and done_at is null) then
    raise exception 'Mark every service as completed before billing';
  end if;

  -- selling Prime reprices this visit's unlowered lines to prime prices
  if p_sell_prime then
    update public.visit_lines vl
       set price = case when vl.price = vl.list_price then sv.prime_price else vl.price end,
           list_price = sv.prime_price
      from public.services sv
     where vl.visit_id = v.id and vl.status = 'active' and vl.kind = 'service'
       and sv.id = vl.item_id and sv.prime_price is not null and sv.standard_price is not null
       and sv.prime_price < vl.list_price;
    update public.visit_lines vl
       set price = case when vl.price = vl.list_price then pr.prime_price else vl.price end,
           list_price = pr.prime_price
      from public.products pr
     where vl.visit_id = v.id and vl.status = 'active' and vl.kind = 'product'
       and pr.id = vl.item_id and pr.prime_price is not null and pr.prime_price < vl.list_price;
    fee := public.setting_num('prime_fee_paise')::bigint;
    validity := public.setting_num('prime_validity_days')::int;
  end if;

  select coalesce(sum(price * qty) filter (where kind = 'service'), 0), coalesce(sum(price * qty) filter (where kind = 'product'), 0)
    into svc_total, prod_total from public.visit_lines where visit_id = v.id and status = 'active';
  lines_total := svc_total + prod_total;
  manual := coalesce(p_discount, 0);
  if manual > lines_total then raise exception 'Discount cannot exceed the bill'; end if;

  -- birthday: automatic percentage off SERVICES (not products) on the client's birthday (never stacks with a manual discount)
  bday_pct := coalesce(public.setting_num('birthday_discount_pct'), 0);
  if bday_pct > 0 and public.is_birthday(v.client_id) then
    bday_disc := round(svc_total * bday_pct / 100)::bigint;
  end if;
  disc := greatest(manual, bday_disc);
  disc_reason := case when bday_disc > 0 and bday_disc >= manual
                      then 'Birthday ' || bday_pct::text || '% off'
                      else nullif(btrim(coalesce(p_discount_reason, '')), '') end;

  -- spread discount over service and product lines in proportion to value; remainder on the last line
  for l in select id, price * qty as val from public.visit_lines
            where visit_id = v.id and status = 'active' and kind in ('service','product') order by created_at, id loop
    i := i + 1;
    d := case when i = n_lines then disc - allocated
              when lines_total = 0 then 0
              else round(disc::numeric * l.val / lines_total)::bigint end;
    allocated := allocated + d;
    update public.visit_lines set net_price = l.val - d where id = l.id;
  end loop;

  bal := public.client_balance(v.client_id);
  payable := greatest(0, lines_total - disc + fee + bal);
  paid := coalesce(p_cash, 0) + coalesce(p_upi, 0);
  new_bal := bal + (lines_total - disc + fee) - paid;

  select * into b from public.branches where id = v.branch_id for update;
  update public.branches set next_bill_no = next_bill_no + 1 where id = b.id;

  insert into public.bills(bill_no, branch_id, visit_id, client_id, business_date, subtotal, discount, discount_reason,
                           membership_fee, previous_due, total_payable, paid, new_due, created_by)
  values (b.code || '-' || lpad(b.next_bill_no::text, 6, '0'), v.branch_id, v.id, v.client_id, public.business_date(),
          lines_total, disc, disc_reason, fee, greatest(bal, 0), payable, paid, greatest(new_bal, 0), auth.uid())
  returning * into bill;

  if p_sell_prime then
    prime_until := public.prime_end(v.client_id);
    start_d := coalesce(prime_until + 1, public.business_date());
    end_d := coalesce(prime_until, public.business_date()) + validity;
    insert into public.memberships(client_id, start_date, end_date, fee, bill_id, source, created_by)
    values (v.client_id, start_d, end_d, fee, bill.id, 'sold', auth.uid());
    insert into public.visit_lines(visit_id, kind, name, qty, list_price, price, net_price, created_by, done_at, done_by)
    values (v.id, 'membership', 'Prime Membership', 1, fee, fee, fee, auth.uid(), now(), auth.uid());
  end if;

  if coalesce(p_cash, 0) > 0 then
    insert into public.payments(branch_id, client_id, bill_id, mode, amount, kind, created_by)
    values (v.branch_id, v.client_id, bill.id, 'cash', p_cash, 'bill', auth.uid());
  end if;
  if coalesce(p_upi, 0) > 0 then
    insert into public.payments(branch_id, client_id, bill_id, mode, amount, upi_ref_last4, kind, created_by)
    values (v.branch_id, v.client_id, bill.id, 'upi', p_upi, nullif(right(coalesce(p_upi_ref, ''), 4), ''), 'bill', auth.uid());
  end if;

  insert into public.client_ledger(client_id, branch_id, bill_id, type, amount, reason, created_by)
  values (v.client_id, v.branch_id, bill.id, 'due_added', lines_total - disc + fee, 'Bill ' || bill.bill_no, auth.uid());
  if paid > 0 then
    insert into public.client_ledger(client_id, branch_id, bill_id, type, amount, reason, created_by)
    values (v.client_id, v.branch_id, bill.id, 'due_paid', -paid, 'Payment on ' || bill.bill_no, auth.uid());
  end if;

  -- retail stock leaves this salon's shelf; selling more than is on hand is allowed but flagged
  for pl in select item_id, name, sum(qty)::int qty from public.visit_lines
             where visit_id = v.id and status = 'active' and kind = 'product' group by item_id, name loop
    insert into public.stock_movements(branch_id, product_id, type, qty, ref, created_by)
    values (v.branch_id, pl.item_id, 'sale', -pl.qty, bill.id, auth.uid());
    select coalesce(sum(qty), 0) into stk from public.stock_movements where branch_id = v.branch_id and product_id = pl.item_id;
    if stk < 0 then
      insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
      values ('stock_negative', v.branch_id, s.id, stk, 'bills', bill.id, pl.name || ' is now ' || stk, auth.uid());
    end if;
  end loop;

  update public.visits set status = 'billed' where id = v.id;

  if manual > bday_disc then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('bill_discount', v.branch_id, s.id, manual, 'bills', bill.id, disc_reason, auth.uid());
  end if;
  return bill;
end $$;


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
  select coalesce(sum(case when kind = 'refund' then -amount else amount end) filter (where mode = 'cash' and kind in ('bill','refund')), 0),
         coalesce(sum(amount) filter (where mode = 'cash' and kind = 'due_collection'), 0),
         coalesce(sum(case when kind = 'refund' then -amount else amount end) filter (where mode = 'upi'), 0)
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

  select coalesce(sum(case when kind = 'refund' then -amount else amount end) filter (where mode = 'cash'), 0),
         coalesce(sum(case when kind = 'refund' then -amount else amount end) filter (where mode = 'upi'), 0),
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


-- ---------------------------------------------------------------- void a closed bill (manager, reason required; the bill number stays)
create or replace function public.void_bill(p_bill uuid, p_reason text) returns public.bills
language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_manager(); b public.bills; net bigint; p record; pl record;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is needed to void a bill'; end if;
  select * into b from public.bills where id = p_bill for update;
  if not found then raise exception 'Bill not found'; end if;
  if b.status = 'void' then raise exception 'This bill is already void'; end if;

  select coalesce(sum(amount), 0) into net from public.client_ledger where bill_id = b.id;
  if net <> 0 then
    insert into public.client_ledger(client_id, branch_id, bill_id, type, amount, reason, created_by)
    values (b.client_id, b.branch_id, b.id, 'adjustment', -net, 'Void ' || b.bill_no || ': ' || p_reason, auth.uid());
  end if;

  for p in select mode, sum(amount) amt from public.payments where bill_id = b.id and kind = 'bill' group by mode loop
    insert into public.payments(branch_id, client_id, bill_id, mode, amount, kind, created_by)
    values (b.branch_id, b.client_id, b.id, p.mode, p.amt, 'refund', auth.uid());
  end loop;

  for pl in select item_id, sum(qty)::int qty from public.visit_lines
             where visit_id = b.visit_id and status = 'active' and kind = 'product' group by item_id loop
    insert into public.stock_movements(branch_id, product_id, type, qty, ref, note, created_by)
    values (b.branch_id, pl.item_id, 'void_return', pl.qty, b.id, 'Void ' || b.bill_no, auth.uid());
  end loop;

  update public.memberships set void = true where bill_id = b.id;
  update public.bills set status = 'void', void_reason = p_reason where id = b.id returning * into b;
  insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
  values ('bill_voided', b.branch_id, s.id, b.total_payable, 'bills', b.id, b.bill_no || ': ' || p_reason, auth.uid());
  return b;
end $$;
