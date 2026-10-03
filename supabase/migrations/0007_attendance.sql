-- Phase 4: geo-fenced selfie attendance, daily status rules, auto-close, holidays and leave.

insert into public.settings(key, value) values ('gps_flag_accuracy_m', '100') on conflict do nothing;

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  staff_id uuid not null references public.staff(id),
  branch_id uuid not null references public.branches(id),
  date date not null,
  in_at timestamptz not null,
  in_lat double precision, in_lng double precision, in_accuracy double precision, in_photo text,
  out_at timestamptz,
  out_lat double precision, out_lng double precision, out_accuracy double precision, out_photo text,
  auto_closed boolean not null default false,
  status text not null default 'open'
    check (status in ('open','present','present_short','half_day','absent','extra_day','extra_half','off')),
  short_minutes int not null default 0,
  corrected_reason text,
  unique (staff_id, date)
);
create index attendance_branch_date on public.attendance(branch_id, date);

create table public.leaves (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  staff_id uuid not null references public.staff(id),
  date date not null,
  note text,
  status text not null default 'active' check (status in ('active','void')),
  unique (staff_id, date)
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid,
  branch_id uuid not null references public.branches(id),
  date date not null,
  name text not null,
  status text not null default 'active' check (status in ('active','void')),
  unique (branch_id, date)
);

do $$
declare t text;
begin
  foreach t in array array['attendance','leaves','holidays'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_row()', t);
    execute format('create trigger %1$s_no_delete before delete on public.%1$s
                    for each row execute function public.block_mutation()', t);
  end loop;
end $$;

alter table public.attendance enable row level security;
alter table public.leaves enable row level security;
alter table public.holidays enable row level security;

create policy attendance_read on public.attendance for select
  using (public.is_manager() or staff_id = (select id from public.me()));
create policy leaves_read on public.leaves for select
  using (public.is_manager() or staff_id = (select id from public.me()));
create policy leaves_write on public.leaves for all using (public.is_manager()) with check (public.is_manager());
create policy holidays_read on public.holidays for select
  using (public.is_active_staff() and (public.is_manager() or branch_id = public.my_branch()));
create policy holidays_write on public.holidays for all using (public.is_manager()) with check (public.is_manager());

-- ---------------------------------------------------------------- geometry
create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

create or replace function public.assert_in_fence(p_branch uuid, p_lat double precision, p_lng double precision, p_acc double precision)
returns void language plpgsql stable security definer set search_path = public as $$
declare b public.branches; d double precision; max_acc numeric := coalesce(public.setting_num('geofence_max_accuracy_m'), 150);
begin
  select * into b from public.branches where id = p_branch;
  if b.lat is null or b.lng is null then raise exception 'This salon''s location is not set yet. Ask the manager to set it.'; end if;
  if p_lat is null or p_lng is null or p_acc is null then raise exception 'Location not available. Turn on location and try again.'; end if;
  if p_acc > max_acc then raise exception 'GPS is not accurate enough (% m). Step outside or near a window and try again.', round(p_acc); end if;
  d := public.distance_m(p_lat, p_lng, b.lat, b.lng);
  if d > b.geofence_radius_m then
    raise exception 'You are % m from %. Move closer to the salon.', round(d), b.name;
  end if;
end $$;

-- ---------------------------------------------------------------- status rules (PRD 5.2)
create or replace function public.attendance_status(p_staff uuid, p_date date, p_in timestamptz, p_out timestamptz)
returns table (status text, short_minutes int)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.staff; worked int; shift_len int; req int; grace int; half_pct numeric; min_half int; off smallint; is_off boolean;
begin
  select * into s from public.staff where id = p_staff;
  worked := greatest(0, floor(extract(epoch from (p_out - p_in)) / 60)::int);
  shift_len := greatest(1, floor(extract(epoch from (s.shift_end - s.shift_start)) / 60)::int);
  req := (coalesce(public.setting_num('required_hours'), 9) * 60)::int;
  grace := coalesce(public.setting_num('grace_minutes'), 15)::int;
  half_pct := coalesce(public.setting_num('half_day_pct'), 50);
  min_half := (coalesce(public.setting_num('min_hours_for_half_day'), 2) * 60)::int;

  select weekly_off_day into off from public.staff_terms t
   where t.staff_id = p_staff and t.effective_from <= p_date order by t.effective_from desc limit 1;
  is_off := off is not null and extract(dow from p_date)::int = off;

  if is_off then
    return query select case when worked >= shift_len * half_pct / 100 then 'extra_day'
                             when worked >= min_half then 'extra_half' else 'off' end, 0;
  elsif worked >= req or req - worked <= grace then
    return query select 'present'::text, 0;
  elsif worked >= shift_len * half_pct / 100 then
    return query select 'present_short'::text, req - worked - grace;
  elsif worked >= min_half then
    return query select 'half_day'::text, 0;
  else
    return query select 'absent'::text, 0;
  end if;
end $$;

-- ---------------------------------------------------------------- check in / out
create or replace function public.check_in(p_lat double precision, p_lng double precision, p_accuracy double precision, p_photo text)
returns public.attendance language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); a public.attendance;
begin
  if coalesce(btrim(p_photo), '') = '' then raise exception 'A selfie is needed to check in'; end if;
  perform public.assert_in_fence(s.branch_id, p_lat, p_lng, p_accuracy);
  begin
    insert into public.attendance(staff_id, branch_id, date, in_at, in_lat, in_lng, in_accuracy, in_photo, created_by)
    values (s.id, s.branch_id, public.business_date(), now(), p_lat, p_lng, p_accuracy, p_photo, auth.uid())
    returning * into a;
  exception when unique_violation then
    raise exception 'You have already checked in today';
  end;
  if p_accuracy > coalesce(public.setting_num('gps_flag_accuracy_m'), 100) then
    insert into public.flags(type, branch_id, staff_id, ref_table, ref_id, note, created_by)
    values ('poor_gps', s.branch_id, s.id, 'attendance', a.id, 'Check-in accuracy ' || round(p_accuracy) || ' m', auth.uid());
  end if;
  return a;
end $$;

create or replace function public.check_out(p_lat double precision, p_lng double precision, p_accuracy double precision, p_photo text)
returns public.attendance language plpgsql security definer set search_path = public as $$
declare s public.staff := public.require_staff(); a public.attendance; st record;
begin
  if coalesce(btrim(p_photo), '') = '' then raise exception 'A selfie is needed to check out'; end if;
  perform public.assert_in_fence(s.branch_id, p_lat, p_lng, p_accuracy);
  select * into a from public.attendance
   where staff_id = s.id and out_at is null and date >= public.business_date() - 1
   order by date desc limit 1 for update;
  if not found then raise exception 'You have not checked in'; end if;
  select * into st from public.attendance_status(s.id, a.date, a.in_at, now());
  update public.attendance set out_at = now(), out_lat = p_lat, out_lng = p_lng, out_accuracy = p_accuracy,
         out_photo = p_photo, status = st.status, short_minutes = st.short_minutes
   where id = a.id returning * into a;
  if p_accuracy > coalesce(public.setting_num('gps_flag_accuracy_m'), 100) then
    insert into public.flags(type, branch_id, staff_id, ref_table, ref_id, note, created_by)
    values ('poor_gps', s.branch_id, s.id, 'attendance', a.id, 'Check-out accuracy ' || round(p_accuracy) || ' m', auth.uid());
  end if;
  return a;
end $$;

-- ---------------------------------------------------------------- manager correction
create or replace function public.correct_attendance(
  p_staff uuid, p_date date, p_in time, p_out time, p_reason text)
returns public.attendance language plpgsql security definer set search_path = public as $$
declare m public.staff := public.require_staff(); t public.staff; a public.attendance; st record;
        in_ts timestamptz; out_ts timestamptz; v_status text := 'open'; v_short int := 0;
begin
  if m.role <> 'manager' then raise exception 'Managers only'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is needed to correct attendance'; end if;
  if p_in is null then raise exception 'Check-in time is needed'; end if;
  if p_date > public.business_date() then raise exception 'Date cannot be in the future'; end if;
  select * into t from public.staff where id = p_staff;
  in_ts := (p_date + p_in) at time zone 'Asia/Kolkata';
  out_ts := case when p_out is null then null else (p_date + p_out) at time zone 'Asia/Kolkata' end;
  if out_ts is not null and out_ts <= in_ts then raise exception 'Check-out must be after check-in'; end if;
  if out_ts is not null then
    select * into st from public.attendance_status(p_staff, p_date, in_ts, out_ts);
    v_status := st.status; v_short := st.short_minutes;
  end if;

  insert into public.attendance(staff_id, branch_id, date, in_at, out_at, status, short_minutes, corrected_reason, created_by)
  values (p_staff, coalesce(t.branch_id, m.branch_id), p_date, in_ts, out_ts,
          v_status, v_short, p_reason, auth.uid())
  on conflict (staff_id, date) do update
    set in_at = excluded.in_at, out_at = excluded.out_at, status = excluded.status,
        short_minutes = excluded.short_minutes, corrected_reason = excluded.corrected_reason,
        auto_closed = false
  returning * into a;
  insert into public.flags(type, branch_id, staff_id, ref_table, ref_id, note, created_by)
  values ('attendance_corrected', a.branch_id, p_staff, 'attendance', a.id, p_reason, auth.uid());
  return a;
end $$;

-- ---------------------------------------------------------------- nightly auto-close
create or replace function public.auto_close_attendance() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record; st record; out_ts timestamptz;
begin
  for r in select a.*, s.shift_end from public.attendance a join public.staff s on s.id = a.staff_id
            where a.out_at is null and a.date <= public.business_date() loop
    out_ts := greatest(r.in_at, (r.date + r.shift_end) at time zone 'Asia/Kolkata');
    select * into st from public.attendance_status(r.staff_id, r.date, r.in_at, out_ts);
    update public.attendance set out_at = out_ts, auto_closed = true, status = st.status, short_minutes = st.short_minutes
     where id = r.id;
    insert into public.flags(type, branch_id, staff_id, ref_table, ref_id, note)
    values ('auto_closed_checkout', r.branch_id, r.staff_id, 'attendance', r.id, 'Closed at shift end');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.auto_close_attendance() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('auto-close-attendance', '15 18 * * *', 'select public.auto_close_attendance()'); -- 23:45 IST
  end if;
exception when others then
  raise notice 'pg_cron not scheduled (%): enable pg_cron and schedule public.auto_close_attendance() at 23:45 IST', sqlerrm;
end $$;

-- ---------------------------------------------------------------- daily grid (managers: whole salon; members: self)
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
  where s.status = 'active' and d::date >= s.joined_on
    and (case when me.role = 'manager' then (p_branch is null or s.branch_id = p_branch) and (p_staff is null or s.id = p_staff)
              else s.id = me.id end)
  order by s.name, d;
end $$;

-- ---------------------------------------------------------------- selfie storage (Supabase only)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id, name, public) values ('selfies', 'selfies', false) on conflict do nothing;
    execute $p$create policy selfies_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'selfies' and public.is_active_staff()
                           and (storage.foldername(name))[1] = (select id::text from public.me()))$p$;
    execute $p$create policy selfies_read on storage.objects for select to authenticated
               using (bucket_id = 'selfies' and (public.is_manager()
                      or (storage.foldername(name))[1] = (select id::text from public.me())))$p$;
  end if;
end $$;
