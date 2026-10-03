-- Birthday discount (setting-driven) and optional discount reason.

insert into public.settings(key, value) values ('birthday_discount_pct', '20') on conflict do nothing;

create or replace function public.is_birthday(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select (extract(month from c.birthday) = extract(month from public.business_date())
            and extract(day from c.birthday) = extract(day from public.business_date()))
        or (extract(month from c.birthday) = 2 and extract(day from c.birthday) = 29       -- 29 Feb babies: 28 Feb in common years
            and extract(month from public.business_date()) = 2 and extract(day from public.business_date()) = 28
            and extract(day from (date_trunc('year', public.business_date()) + interval '2 months - 1 day')) = 28)
    from public.clients c where c.id = p_client and c.birthday is not null), false)
$$;

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
  svc_total bigint; disc bigint; manual bigint; bday_disc bigint := 0; bday_pct numeric; disc_reason text; fee bigint := 0; bal bigint; payable bigint; paid bigint;
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
  manual := coalesce(p_discount, 0);
  if manual > svc_total then raise exception 'Discount cannot exceed the bill'; end if;

  -- birthday: automatic percentage off services on the client's birthday (never stacks with a manual discount)
  bday_pct := coalesce(public.setting_num('birthday_discount_pct'), 0);
  if bday_pct > 0 and public.is_birthday(v.client_id) then
    bday_disc := round(svc_total * bday_pct / 100)::bigint;
  end if;
  disc := greatest(manual, bday_disc);
  disc_reason := case when bday_disc > 0 and bday_disc >= manual
                      then 'Birthday ' || bday_pct::text || '% off'
                      else nullif(btrim(coalesce(p_discount_reason, '')), '') end;

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
          svc_total, disc, disc_reason, fee, greatest(bal, 0), payable, paid, greatest(new_bal, 0), auth.uid())
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

  if manual > bday_disc then
    insert into public.flags(type, branch_id, staff_id, amount, ref_table, ref_id, note, created_by)
    values ('bill_discount', v.branch_id, s.id, manual, 'bills', bill.id, disc_reason, auth.uid());
  end if;
  return bill;
end $$;

