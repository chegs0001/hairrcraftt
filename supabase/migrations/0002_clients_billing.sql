-- Phase 2: clients, catalogue, visits, split credit, billing, dues, prime.
-- Every write to visits/bills/payments/ledger goes through the security definer functions below.

-- ---------------------------------------------------------------- tables
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  phone text not null unique check (phone ~ '^[0-9]{10}$'),
  name text not null check (btrim(name) <> ''),
  gender text check (gender in ('male','female','other')),
  birthday date,
  notes text
);

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  name text not null,
  gender text not null default 'both' check (gender in ('men','women','both')),
  sort int not null default 0,
  unique (name, gender)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  category_id uuid not null references public.service_categories(id),
  name text not null,
  gender text not null default 'both' check (gender in ('men','women','both')),
  standard_price bigint check (standard_price >= 0),   -- null = open price, staff types the amount
  prime_price bigint check (prime_price >= 0),
  unit_label text,                                     -- e.g. 'finger': qty is the unit count
  price_hint text,                                     -- e.g. '₹5,000–5,500', '₹2,500 onwards'
  is_package boolean not null default false,           -- bundle with one offer price
  active boolean not null default true,
  sort int not null default 0
);
create index services_category on public.services(category_id);

create table public.package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.services(id),
  label text not null,
  sort int not null default 0
);

create table public.staff_favourites (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  service_id uuid not null references public.services(id),
  unique (staff_id, service_id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  client_id uuid not null references public.clients(id),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  fee bigint not null default 0,
  bill_id uuid,
  source text not null default 'sold' check (source in ('sold','manual'))
);
create index memberships_client on public.memberships(client_id);

create table public.visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  branch_id uuid not null references public.branches(id),
  client_id uuid not null references public.clients(id),
  status text not null default 'open' check (status in ('open','billed','cancelled')),
  cancel_reason text,
  business_date date not null default public.business_date()
);
create unique index visits_one_open_per_client on public.visits(client_id) where status = 'open';
create index visits_branch_status on public.visits(branch_id, status);

create table public.visit_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  visit_id uuid not null references public.visits(id),
  kind text not null check (kind in ('service','product','membership')),
  item_id uuid,
  name text not null,                       -- snapshot of the item name
  qty int not null default 1 check (qty > 0),
  list_price bigint not null,
  price bigint not null check (price >= 0), -- unit price actually charged
  net_price bigint,                         -- line total after bill discount, set at bill close
  flagged boolean not null default false,
  flag_reason text,
  status text not null default 'active' check (status in ('active','removed')),
  done_at timestamptz,
  done_by uuid
);
create index visit_lines_visit on public.visit_lines(visit_id);

create table public.visit_line_staff (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.visit_lines(id),
  staff_id uuid not null references public.staff(id),
  share numeric(7,6) not null check (share > 0 and share <= 1),
  unique (line_id, staff_id)
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  bill_no text not null unique,
  branch_id uuid not null references public.branches(id),
  visit_id uuid not null unique references public.visits(id),
  client_id uuid not null references public.clients(id),
  business_date date not null default public.business_date(),
  subtotal bigint not null,
  discount bigint not null default 0,
  discount_reason text,
  membership_fee bigint not null default 0,
  previous_due bigint not null default 0,
  total_payable bigint not null,
  paid bigint not null,
  new_due bigint not null,
  status text not null default 'final' check (status in ('final','void')),
  void_reason text
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  branch_id uuid not null references public.branches(id),
  client_id uuid not null references public.clients(id),
  bill_id uuid references public.bills(id),
  mode text not null check (mode in ('cash','upi')),
  amount bigint not null check (amount > 0),
  upi_ref_last4 text,
  kind text not null check (kind in ('bill','due_collection')),
  business_date date not null default public.business_date()
);

-- signed ledger: positive = client owes, negative = client credit. Balance = sum(amount).
create table public.client_ledger (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  client_id uuid not null references public.clients(id),
  branch_id uuid references public.branches(id),
  bill_id uuid references public.bills(id),
  type text not null check (type in ('due_added','due_paid','credit_added','adjustment')),
  amount bigint not null,
  reason text
);
create index client_ledger_client on public.client_ledger(client_id);

-- ---------------------------------------------------------------- audit + immutability
do $$
declare t text;
begin
  foreach t in array array['clients','service_categories','services','package_items','memberships',
                           'visits','visit_lines','visit_line_staff','bills','payments','client_ledger']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row()', t);
  end loop;
  foreach t in array array['clients','memberships','visits','visit_lines','bills','payments','client_ledger']
  loop
    execute format('create trigger %1$s_no_delete before delete on public.%1$s
                    for each row execute function public.block_mutation()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.clients enable row level security;
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.package_items enable row level security;
alter table public.staff_favourites enable row level security;
alter table public.memberships enable row level security;
alter table public.visits enable row level security;
alter table public.visit_lines enable row level security;
alter table public.visit_line_staff enable row level security;
alter table public.bills enable row level security;
alter table public.payments enable row level security;
alter table public.client_ledger enable row level security;

create policy clients_read   on public.clients for select using (public.is_active_staff());
create policy clients_insert on public.clients for insert with check (public.is_active_staff());
create policy clients_update on public.clients for update using (public.is_active_staff()) with check (public.is_active_staff());

create policy cat_read  on public.service_categories for select using (public.is_active_staff());
create policy cat_write on public.service_categories for all using (public.is_manager()) with check (public.is_manager());
create policy svc_read  on public.services for select using (public.is_active_staff());
create policy svc_write on public.services for all using (public.is_manager()) with check (public.is_manager());
create policy pkg_read  on public.package_items for select using (public.is_active_staff());
create policy pkg_write on public.package_items for all using (public.is_manager()) with check (public.is_manager());

create policy fav_own on public.staff_favourites for all
  using (staff_id = (select id from public.me())) with check (staff_id = (select id from public.me()));

create policy mem_read  on public.memberships for select using (public.is_active_staff());
create policy mem_write on public.memberships for all using (public.is_manager()) with check (public.is_manager());
create policy ledger_read on public.client_ledger for select using (public.is_active_staff());

create policy visits_read on public.visits for select
  using (public.is_active_staff() and (public.is_manager() or branch_id = public.my_branch()));
create policy lines_read on public.visit_lines for select
  using (exists (select 1 from public.visits v where v.id = visit_id
                 and public.is_active_staff() and (public.is_manager() or v.branch_id = public.my_branch())));
create policy line_staff_read on public.visit_line_staff for select
  using (exists (select 1 from public.visit_lines l join public.visits v on v.id = l.visit_id
                 where l.id = line_id and public.is_active_staff()
                   and (public.is_manager() or v.branch_id = public.my_branch())));
create policy bills_read on public.bills for select
  using (public.is_active_staff() and (public.is_manager() or branch_id = public.my_branch()));
create policy payments_read on public.payments for select
  using (public.is_active_staff() and (public.is_manager() or branch_id = public.my_branch()));

-- ---------------------------------------------------------------- internals
create or replace function public.require_staff() returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare s public.staff;
begin
  select * into s from public.staff where auth_user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Not signed in or not approved'; end if;
  return s;
end $$;

create or replace function public.require_branch(p_branch uuid) returns public.staff
language plpgsql stable security definer set search_path = public as $$
declare s public.staff := public.require_staff();
begin
  if s.role <> 'manager' and s.branch_id is distinct from p_branch then
    raise exception 'That belongs to the other salon';
  end if;
  return s;
end $$;

create or replace function public.client_balance(p_client uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::bigint from public.client_ledger where client_id = p_client
$$;

create or replace function public.prime_end(p_client uuid) returns date
language sql stable security definer set search_path = public as $$
  select max(end_date) from public.memberships
  where client_id = p_client and public.business_date() between start_date and end_date
$$;

create or replace function public.setting_num(p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::numeric from public.settings where key = p_key
$$;

-- ---------------------------------------------------------------- visit functions
create or replace function public.start_visit(p_client uuid, p_branch uuid default null)
returns public.visits language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); b uuid; v public.visits;
begin
  b := case when s.role = 'manager' then coalesce(p_branch, s.branch_id) else s.branch_id end;
  if b is null then raise exception 'No salon selected'; end if;
  begin
    insert into public.visits(branch_id, client_id, created_by) values (b, p_client, auth.uid()) returning * into v;
  exception when unique_violation then
    raise exception 'This client already has an open visit';
  end;
  return v;
end $$;

create or replace function public.add_line(
  p_visit uuid, p_service uuid, p_qty int default 1, p_price bigint default null, p_reason text default null)
returns public.visit_lines language plpgsql security definer set search_path = public as $$
declare
  s public.staff := public.require_staff();
  v public.visits; svc public.services; l public.visit_lines;
  list_p bigint; unit_p bigint; is_flagged boolean := false;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  perform public.require_branch(v.branch_id);
  if v.status <> 'open' then raise exception 'Visit is not open'; end if;
  select * into svc from public.services where id = p_service and active;
  if not found then raise exception 'Service not found'; end if;
  if coalesce(p_qty, 0) < 1 then raise exception 'Quantity must be at least 1'; end if;

  if svc.standard_price is null then
    if coalesce(p_price, 0) <= 0 then raise exception 'Enter the price for %', svc.name; end if;
    list_p := p_price;
  elsif svc.prime_price is not null and public.prime_end(v.client_id) is not null then
    list_p := svc.prime_price;
  else
    list_p := svc.standard_price;
  end if;
  unit_p := coalesce(p_price, list_p);

  if unit_p < list_p then
    if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is needed to charge below the list price'; end if;
    is_flagged := true;
  end if;

  insert into public.visit_lines(visit_id, kind, item_id, name, qty, list_price, price, flagged, flag_reason, created_by)
  values (p_visit, 'service', svc.id, svc.name, p_qty, list_p, unit_p, is_flagged,
          case when is_flagged then p_reason end, auth.uid())
  returning * into l;
  insert into public.visit_line_staff(line_id, staff_id, share) values (l.id, s.id, 1);
  if is_flagged then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('price_below_list', v.branch_id, s.id, (list_p - unit_p) * p_qty, 'visit_lines', l.id, p_reason, auth.uid());
  end if;
  return l;
end $$;

-- own lines only (managers: any), only while the visit is open
create or replace function public.line_guard(p_line uuid, p_owner_only boolean)
returns public.visit_lines language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); l public.visit_lines; v public.visits;
begin
  select * into l from public.visit_lines where id = p_line for update;
  if not found then raise exception 'Line not found'; end if;
  select * into v from public.visits where id = l.visit_id;
  perform public.require_branch(v.branch_id);
  if v.status <> 'open' then raise exception 'Visit is not open'; end if;
  if l.status <> 'active' then raise exception 'Line was removed'; end if;
  if s.role <> 'manager' then
    if p_owner_only and l.created_by is distinct from auth.uid() then
      raise exception 'You can change only your own lines';
    elsif not p_owner_only and not exists (select 1 from public.visit_line_staff where line_id = l.id and staff_id = s.id) then
      raise exception 'You are not on this line';
    end if;
  end if;
  return l;
end $$;

create or replace function public.update_line(p_line uuid, p_qty int, p_price bigint, p_reason text default null)
returns public.visit_lines language plpgsql security definer set search_path = public as $$
declare l public.visit_lines := public.line_guard(p_line, true); v public.visits; s public.staff := public.require_staff();
        is_flagged boolean;
begin
  if p_qty < 1 or p_price < 0 then raise exception 'Invalid quantity or price'; end if;
  is_flagged := p_price < l.list_price;
  if is_flagged and coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is needed to charge below the list price';
  end if;
  update public.visit_lines set qty = p_qty, price = p_price, flagged = is_flagged,
         flag_reason = case when is_flagged then p_reason end
   where id = p_line returning * into l;
  if is_flagged then
    select * into v from public.visits where id = l.visit_id;
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('price_below_list', v.branch_id, s.id, (l.list_price - p_price) * p_qty, 'visit_lines', l.id, p_reason, auth.uid());
  end if;
  return l;
end $$;

create or replace function public.remove_line(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.line_guard(p_line, true);
  update public.visit_lines set status = 'removed' where id = p_line;
end $$;

create or replace function public.set_line_helpers(p_line uuid, p_staff uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare ids uuid[]; n int;
begin
  perform public.line_guard(p_line, false);
  select array_agg(distinct x) into ids from unnest(p_staff) x;
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then raise exception 'At least one staff member must be on a line'; end if;
  if (select count(*) from public.staff where id = any(ids) and status = 'active') <> n then
    raise exception 'Unknown or inactive staff member';
  end if;
  delete from public.visit_line_staff where line_id = p_line;  -- internal replace; audit trigger records it
  insert into public.visit_line_staff(line_id, staff_id, share)
  select p_line, x, round(1.0 / n, 6) from unnest(ids) x;
end $$;

create or replace function public.set_line_done(p_line uuid, p_done boolean) returns public.visit_lines
language plpgsql security definer set search_path = public as $$
declare l public.visit_lines := public.line_guard(p_line, false);
begin
  update public.visit_lines
     set done_at = case when p_done then now() end, done_by = case when p_done then auth.uid() end
   where id = p_line returning * into l;
  return l;
end $$;

create or replace function public.cancel_visit(p_visit uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); v public.visits; has_lines boolean;
begin
  select * into v from public.visits where id = p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  perform public.require_branch(v.branch_id);
  if v.status <> 'open' then raise exception 'Visit is not open'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is needed to cancel'; end if;
  select exists (select 1 from public.visit_lines where visit_id = v.id and status = 'active') into has_lines;
  update public.visits set status = 'cancelled', cancel_reason = p_reason where id = v.id;
  if has_lines then
    insert into public.flags(type, branch_id, staff_id, ref_table, ref_id, note, created_by)
    values ('visit_cancelled', v.branch_id, s.id, 'visits', v.id, p_reason, auth.uid());
  end if;
end $$;

-- ---------------------------------------------------------------- billing
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
  svc_total bigint; disc bigint; fee bigint := 0; bal bigint; payable bigint; paid bigint;
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

  select count(*) into n_lines from public.visit_lines where visit_id = v.id and status = 'active' and kind = 'service';
  if n_lines = 0 then raise exception 'Add at least one service before billing'; end if;
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
    fee := public.setting_num('prime_fee_paise')::bigint;
    validity := public.setting_num('prime_validity_days')::int;
  end if;

  select coalesce(sum(price * qty), 0) into svc_total
    from public.visit_lines where visit_id = v.id and status = 'active' and kind = 'service';
  disc := coalesce(p_discount, 0);
  if disc > svc_total then raise exception 'Discount cannot exceed the bill'; end if;
  if disc > 0 and coalesce(btrim(p_discount_reason), '') = '' then raise exception 'A reason is needed for a discount'; end if;

  -- spread discount over service lines in proportion to value; remainder on the last line
  for l in select id, price * qty as val from public.visit_lines
            where visit_id = v.id and status = 'active' and kind = 'service' order by created_at, id loop
    i := i + 1;
    d := case when i = n_lines then disc - allocated
              when svc_total = 0 then 0
              else round(disc::numeric * l.val / svc_total)::bigint end;
    allocated := allocated + d;
    update public.visit_lines set net_price = l.val - d where id = l.id;
  end loop;

  bal := public.client_balance(v.client_id);
  payable := greatest(0, svc_total - disc + fee + bal);
  paid := coalesce(p_cash, 0) + coalesce(p_upi, 0);
  new_bal := bal + (svc_total - disc + fee) - paid;

  select * into b from public.branches where id = v.branch_id for update;
  update public.branches set next_bill_no = next_bill_no + 1 where id = b.id;

  insert into public.bills(bill_no, branch_id, visit_id, client_id, business_date, subtotal, discount, discount_reason,
                           membership_fee, previous_due, total_payable, paid, new_due, created_by)
  values (b.code || '-' || lpad(b.next_bill_no::text, 6, '0'), v.branch_id, v.id, v.client_id, public.business_date(),
          svc_total, disc, p_discount_reason, fee, greatest(bal, 0), payable, paid, greatest(new_bal, 0), auth.uid())
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
  values (v.client_id, v.branch_id, bill.id, 'due_added', svc_total - disc + fee, 'Bill ' || bill.bill_no, auth.uid());
  if paid > 0 then
    insert into public.client_ledger(client_id, branch_id, bill_id, type, amount, reason, created_by)
    values (v.client_id, v.branch_id, bill.id, 'due_paid', -paid, 'Payment on ' || bill.bill_no, auth.uid());
  end if;

  update public.visits set status = 'billed' where id = v.id;

  if disc > 0 then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('bill_discount', v.branch_id, s.id, disc, 'bills', bill.id, p_discount_reason, auth.uid());
  end if;
  return bill;
end $$;

create or replace function public.collect_dues(
  p_client uuid, p_cash bigint default 0, p_upi bigint default 0, p_upi_ref text default null, p_branch uuid default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); b uuid; total bigint := coalesce(p_cash,0) + coalesce(p_upi,0);
begin
  b := case when s.role = 'manager' then coalesce(p_branch, s.branch_id) else s.branch_id end;
  if total <= 0 then raise exception 'Enter an amount to collect'; end if;
  if coalesce(p_cash,0) < 0 or coalesce(p_upi,0) < 0 then raise exception 'Amounts cannot be negative'; end if;
  if coalesce(p_cash,0) > 0 then
    insert into public.payments(branch_id, client_id, mode, amount, kind, created_by)
    values (b, p_client, 'cash', p_cash, 'due_collection', auth.uid());
  end if;
  if coalesce(p_upi,0) > 0 then
    insert into public.payments(branch_id, client_id, mode, amount, upi_ref_last4, kind, created_by)
    values (b, p_client, 'upi', p_upi, nullif(right(coalesce(p_upi_ref,''), 4), ''), 'due_collection', auth.uid());
  end if;
  insert into public.client_ledger(client_id, branch_id, type, amount, reason, created_by)
  values (p_client, b, 'due_paid', -total, 'Dues collected', auth.uid());
  return public.client_balance(p_client);
end $$;

create or replace function public.adjust_due(p_client uuid, p_amount bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff();
begin
  if s.role <> 'manager' then raise exception 'Managers only'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is needed'; end if;
  insert into public.client_ledger(client_id, type, amount, reason, created_by)
  values (p_client, 'adjustment', p_amount, p_reason, auth.uid());
  insert into public.flags(type, staff_id, amount, ref_table, ref_id, note, created_by)
  values ('due_adjusted', s.id, p_amount, 'clients', p_client, p_reason, auth.uid());
  return public.client_balance(p_client);
end $$;

-- ---------------------------------------------------------------- read helpers (cross-salon client history)
create or replace function public.client_card(p_client uuid)
returns table (balance bigint, prime_until date) language sql stable security definer set search_path = public as $$
  select public.client_balance(p_client), public.prime_end(p_client) where public.is_active_staff()
$$;

create or replace function public.client_history(p_client uuid, p_limit int default 3)
returns table (service_name text, price bigint, qty int, billed_on date, branch_code text)
language sql stable security definer set search_path = public as $$
  select l.name, l.price, l.qty, v.business_date, b.code
    from public.visit_lines l
    join public.visits v on v.id = l.visit_id and v.status = 'billed'
    join public.branches b on b.id = v.branch_id
   where v.client_id = p_client and l.kind = 'service' and l.status = 'active' and public.is_active_staff()
   order by v.business_date desc, l.created_at desc
   limit p_limit
$$;

create or replace function public.last_charged(p_client uuid, p_service uuid)
returns table (price bigint, billed_on date) language sql stable security definer set search_path = public as $$
  select l.price, v.business_date
    from public.visit_lines l join public.visits v on v.id = l.visit_id and v.status = 'billed'
   where v.client_id = p_client and l.item_id = p_service and l.status = 'active' and public.is_active_staff()
   order by v.business_date desc, l.created_at desc limit 1
$$;
