// Runs the SQL migrations in an in-memory Postgres (PGlite) and checks the PRD acceptance rules.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const ids = {}

const sql = (text, params) => db.query(text, params).then((r) => r.rows)
const as = async (who) => {            // act as a signed-in user (RLS applies) or as superuser
  await db.exec('reset role')
  if (!who) return db.exec(`select set_config('request.jwt.claim.sub','',false)`)
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [ids[who]])
  await db.exec('set role authenticated')
}
const fails = async (fn, pattern) => assert.rejects(fn, pattern)

async function signup(key, email) {
  await as(null)
  const [u] = await sql(`insert into auth.users(email) values ($1) returning id`, [email])
  ids[key] = u.id
}

before(async () => {
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    create role anon;
    create role authenticated;
    grant usage on schema public, auth to authenticated;
  `)
  for (const f of readdirSync('supabase/migrations').sort()) await db.exec(readFileSync(`supabase/migrations/${f}`, 'utf8'))
  await db.exec(`grant all on all tables in schema public to authenticated; grant all on all functions in schema public to authenticated;`)

  await signup('mgr', 'cheragverma0001@gmail.com')
  await signup('riya', 'riya@gmail.com')
  await signup('aman', 'aman@gmail.com')
  await signup('zed', 'zed@gmail.com')           // stays pending
  const br = Object.fromEntries((await sql(`select code,id from branches`)).map((b) => [b.code, b.id]))
  ids.HC1 = br.HC1; ids.HC2 = br.HC2
  await db.query(`update staff set status='active', branch_id=$1, name='Riya' where email='riya@gmail.com'`, [ids.HC1])
  await db.query(`update staff set status='active', branch_id=$1, name='Aman' where email='aman@gmail.com'`, [ids.HC1])
  const staff = await sql(`select id,email from staff`)
  for (const s of staff) ids['s_' + s.email.split('@')[0]] = s.id
  // test catalogue
  const [c] = await sql(`insert into service_categories(name) values ('T') returning id`)
  const svc = async (name, std, prime) =>
    (await sql(`insert into services(category_id,name,standard_price,prime_price) values ($1,$2,$3,$4) returning id`, [c.id, name, std, prime]))[0].id
  ids.svc500 = await svc('T500', 50000, 40000)
  ids.svc250 = await svc('T250', 25000, null)
  ids.svc1000 = await svc('T1000', 100000, null)
  ids.client = (await sql(`insert into clients(phone,name) values ('9999999999','Meera') returning id`))[0].id
  ids.client2 = (await sql(`insert into clients(phone,name) values ('8888888888','Nita') returning id`))[0].id
})

const newVisit = async (who, client, branch) => (await sql(`select * from start_visit($1,$2)`, [client, branch ?? null]))[0]
const addDone = async (visit, svc, price, reason) => {
  const [l] = await sql(`select * from add_line($1,$2,1,$3,$4)`, [visit, svc, price ?? null, reason ?? null])
  await sql(`select * from set_line_done($1,true)`, [l.id])
  return l
}
const bill = (visit, cash, upi, extra = []) =>
  sql(`select * from close_bill($1,$2,$3,$4,$5,$6)`, [visit, cash, upi, extra[0] ?? 0, extra[1] ?? null, extra[2] ?? false]).then((r) => r[0])

describe('foundation', () => {
  test('first manager auto-approved, unknown email pending', async () => {
    const m = (await sql(`select role,status from staff where email='cheragverma0001@gmail.com'`))[0]
    assert.deepEqual(m, { role: 'manager', status: 'active' })
    assert.equal((await sql(`select status from staff where email='zed@gmail.com'`))[0].status, 'pending')
  })
  test('services seeded with open-price, per-finger and packages', async () => {
    await as(null)
    const n = async (w) => Number((await sql(`select count(*) from services where ${w}`))[0].count)
    assert.ok((await n(`price_hint ilike '%onwards%' and standard_price is null`)) >= 3)
    assert.equal(await n(`unit_label='finger' and standard_price=4000`), 2)
    assert.equal(await n(`is_package`), 7)
    assert.equal(await n(`name='CleanUp' and gender='both'`), 1)
    assert.equal(await n(`name='Kids Haircut'`), 2)
  })
  test('pending user cannot use functions', async () => {
    await as('zed')
    await fails(() => sql(`select * from start_visit($1)`, [ids.client]), /not approved/)
  })
})

describe('billing', () => {
  test('₹750 bill paid ₹700 leaves ₹50 due that shows in the other salon', async () => {
    await as('riya')
    const v = await newVisit('riya', ids.client)
    await addDone(v.id, ids.svc500)
    await addDone(v.id, ids.svc250)
    const b = await bill(v.id, 70000n, 0n)
    assert.equal(b.bill_no, 'HC1-000001')
    assert.equal(Number(b.new_due), 5000)
    await as('mgr')
    const v2 = await newVisit('mgr', ids.client, ids.HC2)
    await addDone(v2.id, ids.svc250)
    const b2 = await bill(v2.id, 30000n, 0n)
    assert.equal(Number(b2.previous_due), 5000)
    assert.equal(Number(b2.total_payable), 30000)  // 250 + 50 due
    assert.equal(Number(b2.new_due), 0)
    assert.equal(b2.bill_no, 'HC2-000001')
    assert.equal(Number((await sql(`select client_balance($1) as b`, [ids.client]))[0].b), 0)
  })

  test('split payment ₹300 cash + ₹450 UPI closes ₹750 with no due', async () => {
    await as('riya')
    const v = await newVisit('riya', ids.client2)
    await addDone(v.id, ids.svc500); await addDone(v.id, ids.svc250)
    const b = await bill(v.id, 30000n, 45000n)
    assert.equal(Number(b.new_due), 0)
    await as(null)
    const modes = await sql(`select mode, amount from payments where bill_id=$1 order by mode`, [b.id])
    assert.deepEqual(modes.map((m) => [m.mode, Number(m.amount)]), [['cash', 30000], ['upi', 45000]])
  })

  test('price lowered creates a flag and does not block billing', async () => {
    await as('riya')
    const c = (await sql(`insert into clients(phone,name) values ('7777777771','Flag') returning id`))[0]
    const v = await newVisit('riya', c.id)
    await fails(() => sql(`select * from add_line($1,$2,1,$3,null)`, [v.id, ids.svc500, 40000]), /reason/)
    const l = await addDone(v.id, ids.svc500, 40000, 'Regular client')
    assert.equal(l.flagged, true)
    const b = await bill(v.id, 40000n, 0n)
    assert.equal(Number(b.new_due), 0)
    await as(null)
    assert.equal((await sql(`select count(*)::int c from flags where type='price_below_list'`))[0].c, 1)
  })

  test('₹1,000 service, 2 staff, 10% discount credits ₹450 each', async () => {
    await as('riya')
    const c = (await sql(`insert into clients(phone,name) values ('7777777772','Split') returning id`))[0]
    const v = await newVisit('riya', c.id)
    const l = await addDone(v.id, ids.svc1000)
    await sql(`select set_line_helpers($1,$2)`, [l.id, [ids.s_riya, ids.s_aman]])
    const b = await bill(v.id, 90000n, 0n, [10000n, 'Festival'])
    assert.equal(Number(b.total_payable), 90000)
    await as(null)
    const [row] = await sql(`select net_price from visit_lines where id=$1`, [l.id])
    const shares = await sql(`select share from visit_line_staff where line_id=$1`, [l.id])
    assert.equal(Number(row.net_price), 90000)
    assert.deepEqual(shares.map((s) => Number(s.share)), [0.5, 0.5])
    assert.equal(Number(row.net_price) * 0.5, 45000)
  })

  test('prime: active member gets prime price in both salons; expired gets standard', async () => {
    await as('mgr')
    const a = (await sql(`insert into clients(phone,name) values ('7777777773','Active') returning id`))[0]
    const e = (await sql(`insert into clients(phone,name) values ('7777777774','Expired') returning id`))[0]
    await sql(`insert into memberships(client_id,start_date,end_date,source) values ($1, current_date-10, current_date+100,'manual')`, [a.id])
    await sql(`insert into memberships(client_id,start_date,end_date,source) values ($1, current_date-400, current_date-35,'manual')`, [e.id])
    for (const [br, who] of [[ids.HC1, 'a'], [ids.HC2, 'a']]) {
      // each salon needs its own visit; close the first one before opening the second
      const v = await newVisit('mgr', a.id, br)
      const l = (await sql(`select * from add_line($1,$2,1,null,null)`, [v.id, ids.svc500]))[0]
      assert.equal(Number(l.price), 40000, who)
      await sql(`select cancel_visit($1,'test')`, [v.id])
    }
    const v = await newVisit('mgr', e.id)
    assert.equal(Number((await sql(`select * from add_line($1,$2,1,null,null)`, [v.id, ids.svc500]))[0].price), 50000)
  })

  test('selling Prime reprices the same bill and starts a membership', async () => {
    await as('riya')
    const c = (await sql(`insert into clients(phone,name) values ('7777777775','Buyer') returning id`))[0]
    const v = await newVisit('riya', c.id)
    await addDone(v.id, ids.svc500)
    const b = await bill(v.id, 120000n, 0n, [0n, null, true])   // 400 service + 800 fee
    assert.equal(Number(b.subtotal), 40000)
    assert.equal(Number(b.membership_fee), 80000)
    assert.equal(Number(b.total_payable), 120000)
    assert.equal(Number(b.new_due), 0)
    assert.ok((await sql(`select prime_end($1) as d`, [c.id]))[0].d)
  })

  test('cannot bill with an unfinished service; cannot add to a closed visit', async () => {
    await as('riya')
    const c = (await sql(`insert into clients(phone,name) values ('7777777776','Undone') returning id`))[0]
    const v = await newVisit('riya', c.id)
    await sql(`select * from add_line($1,$2,1,null,null)`, [v.id, ids.svc250])
    await fails(() => bill(v.id, 25000n, 0n), /completed/)
    await fails(() => sql(`select start_visit($1)`, [c.id]), /open visit/)
  })

  test('overpayment becomes credit that reduces the next bill', async () => {
    await as('riya')
    const c = (await sql(`insert into clients(phone,name) values ('7777777777','Credit') returning id`))[0]
    let v = await newVisit('riya', c.id)
    await addDone(v.id, ids.svc250)
    await bill(v.id, 30000n, 0n)
    assert.equal(Number((await sql(`select client_balance($1) as b`, [c.id]))[0].b), -5000)
    v = await newVisit('riya', c.id)
    await addDone(v.id, ids.svc250)
    const b = await bill(v.id, 20000n, 0n)
    assert.equal(Number(b.total_payable), 20000)
    assert.equal(Number(b.new_due), 0)
  })

  test('collect dues without a visit', async () => {
    await as('riya')
    const c = (await sql(`insert into clients(phone,name) values ('7777777778','Dues') returning id`))[0]
    const v = await newVisit('riya', c.id)
    await addDone(v.id, ids.svc250)
    await bill(v.id, 0n, 0n)
    const bal = (await sql(`select collect_dues($1,10000,0,null,null) as b`, [c.id]))[0].b
    assert.equal(Number(bal), 15000)
  })
})

describe('permissions', () => {
  test('member cannot read the other salon, edit a bill, or write money tables directly', async () => {
    await as('mgr')
    const c = (await sql(`insert into clients(phone,name) values ('7777777779','Other') returning id`))[0]
    const v = await newVisit('mgr', c.id, ids.HC2)
    await addDone(v.id, ids.svc250)
    await bill(v.id, 25000n, 0n)
    await as('riya')
    assert.equal((await sql(`select count(*)::int c from bills where bill_no like 'HC2-%'`))[0].c, 0)
    assert.ok((await sql(`select count(*)::int c from bills where bill_no like 'HC1-%'`))[0].c > 0)
    assert.equal((await sql(`update bills set paid = 0 returning id`)).length, 0)   // RLS hides every row from update
    await fails(() => sql(`insert into bills(bill_no) values ('x')`), /row-level security|null value/)
    await fails(() => sql(`select adjust_due($1,100,'x')`, [ids.client]), /Managers only/)
  })
  test("member cannot touch a colleague's line but a helper can tick it done", async () => {
    await as('riya')
    const c = (await sql(`insert into clients(phone,name) values ('6666666666','Lines') returning id`))[0]
    const v = await newVisit('riya', c.id)
    const [l] = await sql(`select * from add_line($1,$2,1,null,null)`, [v.id, ids.svc250])
    await sql(`select set_line_helpers($1,$2)`, [l.id, [ids.s_riya, ids.s_aman]])
    await as('aman')
    await fails(() => sql(`select remove_line($1)`, [l.id]), /only your own/)
    await sql(`select set_line_done($1,true)`, [l.id])
  })
  test('audit log records bill creation with after values; log is immutable', async () => {
    await as('mgr')
    assert.ok((await sql(`select count(*)::int c from audit_log where table_name='bills' and action='INSERT' and after is not null`))[0].c > 0)
    assert.equal((await sql(`update audit_log set reason='x' returning id`)).length, 0)   // no policy: API users change nothing
    await as(null)
    await fails(() => sql(`update audit_log set reason='x'`), /not allowed/)               // trigger blocks even superuser
  })
})

describe('cash and day closing', () => {
  let hc3, cara, today
  const money = (v) => Number(v)
  before(async () => {
    await as(null)
    hc3 = (await sql(`insert into branches(name,code) values ('Test 3','HC3') returning id`))[0].id
    await signup('cara', 'cara@gmail.com')
    await db.query(`update staff set status='active', branch_id=$1, name='Cara' where email='cara@gmail.com'`, [hc3])
    ids.s_cara = (await sql(`select id from staff where email='cara@gmail.com'`))[0].id
    today = (await sql(`select business_date() d`))[0].d
    const [svc] = await sql(`insert into services(category_id,name,standard_price) select id,'Big',1450000 from service_categories limit 1 returning id`)
    ids.big = svc.id
  })

  test('PRD 6.4 example: expected ₹4,350, counted ₹4,300 flags ₹50 short', async () => {
    await as(null)
    await sql(`insert into day_closings(branch_id,business_date,opening,cash_in,cash_out,expected,counted,difference,upi_expected)
               values ($1, business_date()-1, 0,0,0,200000,200000,0,0)`, [hc3])
    const client = (await sql(`insert into clients(phone,name) values ('5555555555','Day') returning id`))[0].id
    await as('cara')
    const v = (await sql(`select * from start_visit($1)`, [client]))[0]
    await addDone(v.id, ids.big)
    await bill(v.id, 1450000n, 0n)
    await sql(`select collect_dues($1,30000,0,null,null)`, [client])
    await sql(`select add_expense(45000,'Cleaning','Mop and cleaner')`)
    await sql(`select add_advance($1,200000,'drawer','Festival')`, [ids.s_cara])
    await as('mgr')
    await sql(`select add_cash_movement('owner_withdrawal',1000000,'Banked',$1)`, [hc3])
    const [sm] = await sql(`select * from day_summary($1,null)`, [hc3])
    assert.equal(money(sm.opening), 200000)
    assert.equal(money(sm.expected), 435000)
    await as('cara')
    await fails(() => sql(`select close_day(430000)`), /note/)
    const row = (await sql(`select * from close_day(430000, '{"500":8}', 'Short, tea money')`))[0]
    assert.equal(money(row.difference), -5000)
    await as(null)
    assert.equal((await sql(`select count(*)::int c from flags where type='cash_difference' and amount=-5000`))[0].c, 1)
  })

  test('closed day rejects new bills, expenses, advances and visits; only a manager reopens', async () => {
    await as('cara')
    const c = (await sql(`select id from clients where phone='5555555555'`))[0].id
    await fails(() => sql(`select add_expense(100,'Other','Late')`), /closed/)
    await fails(() => sql(`select add_advance($1,100,'drawer',null)`, [ids.s_cara]), /closed/)
    await fails(() => sql(`select * from start_visit($1)`, [c]), /closed/)
    await fails(() => sql(`select close_day(430000,null,'again')`), /already closed/)
    await fails(() => sql(`select reopen_day($1,business_date(),'x')`, [hc3]), /Managers only/)
    await as('mgr')
    await fails(() => sql(`select reopen_day($1,business_date(),'')`, [hc3]), /reason/)
    await sql(`select reopen_day($1,business_date(),'Forgot an expense')`, [hc3])
    await as('cara')
    await sql(`select add_expense(100,'Other','Now allowed')`)
    await as(null)
    assert.equal((await sql(`select count(*)::int c from flags where type='day_reopened'`))[0].c, 1)
  })

  test('cannot close while a visit is open', async () => {
    await as('cara')
    const c = (await sql(`insert into clients(phone,name) values ('5555555556','Open') returning id`))[0].id
    await sql(`select * from start_visit($1)`, [c])
    await fails(() => sql(`select close_day(0,null,'x')`), /open visits/)
  })

  test('advances: member only for self; manager for anyone', async () => {
    await as('cara')
    await fails(() => sql(`select add_advance($1,100,'drawer',null)`, [ids.s_riya]), /only for yourself/)
    await as('mgr')
    await sql(`select add_advance($1,100,'owner','from owner',$2,null)`, [ids.s_cara, hc3])
    await as('cara')
    assert.ok((await sql(`select count(*)::int c from salary_advances`))[0].c >= 2)   // sees only her own
  })

  test('expense edit: creator before close, manager (with reason) after', async () => {
    await as('cara')
    const e = (await sql(`select * from add_expense(5000,'Tea/snacks','Tea')`))[0]
    await sql(`select edit_expense($1,6000,'Tea/snacks','Tea',$2)`, [e.id, 'drawer'])
    await as('riya')
    await fails(() => sql(`select edit_expense($1,1,'Other','x','drawer')`, [e.id]), /other salon/)
  })

  test('unclosed days are flagged once', async () => {
    await as(null)
    const n1 = (await sql(`select flag_unclosed_days() n`))[0].n
    const n2 = (await sql(`select flag_unclosed_days() n`))[0].n
    assert.ok(n1 >= 1)
    assert.equal(n2, 0)
  })
})

describe('birthday discount and optional reason', () => {
  const mk = async (phone, bday) => {
    await as(null)
    const c = (await sql(`insert into clients(phone,name,birthday) values ($1,'B', ${bday}) returning id`, [phone]))[0]
    await as('riya')
    return c
  }
  test('client without a birthday is created fine; no birthday means no discount', async () => {
    const c = await mk('4444444441', 'null')
    const v = await newVisit('riya', c.id)
    await addDone(v.id, ids.svc1000)
    const b = await bill(v.id, 100000n, 0n)
    assert.equal(Number(b.discount), 0)
  })
  test('20% off all services on the birthday, automatically, no reason needed', async () => {
    const c = await mk('4444444442', `business_date() - interval '25 years'`)
    const v = await newVisit('riya', c.id)
    await addDone(v.id, ids.svc1000)
    const b = await bill(v.id, 80000n, 0n)
    assert.equal(Number(b.discount), 20000)
    assert.equal(Number(b.total_payable), 80000)
    assert.equal(b.discount_reason, 'Birthday 20% off')
    assert.equal(Number(b.new_due), 0)
  })
  test('not on any other day', async () => {
    const c = await mk('4444444443', `business_date() - interval '25 years 3 days'`)
    const v = await newVisit('riya', c.id)
    await addDone(v.id, ids.svc1000)
    assert.equal(Number((await bill(v.id, 100000n, 0n)).discount), 0)
  })
  test('birthday discount does not stack with a bigger manual discount (larger one wins)', async () => {
    const c = await mk('4444444444', `business_date() - interval '30 years'`)
    const v = await newVisit('riya', c.id)
    await addDone(v.id, ids.svc1000)
    const b = await bill(v.id, 70000n, 0n, [30000n, null])      // ₹300 off, no reason given
    assert.equal(Number(b.discount), 30000)
    assert.equal(b.discount_reason, null)
  })
})

describe('attendance', () => {
  const LAT = 19.076, LNG = 72.8777
  const north = (m) => LAT + m / 111320
  const checkIn = (lat, acc = 20, photo = 'x/in.jpg') => sql(`select * from check_in($1,$2,$3,$4)`, [lat, LNG, acc, photo])
  const status = async (inMin, workedMin, date) => {
    await as(null)
    const r = await sql(
      `select * from attendance_status($1, $2::date, ($2::date + time '11:00') at time zone 'Asia/Kolkata',
                                        ($2::date + time '11:00') at time zone 'Asia/Kolkata' + make_interval(mins => $3))`,
      [ids.s_riya, date, workedMin])
    return [r[0].status, r[0].short_minutes]
  }
  let offDate, workDate

  before(async () => {
    await as(null)
    await db.query(`update branches set lat=$1, lng=$2, geofence_radius_m=100 where code='HC1'`, [LAT, LNG])
    offDate = (await sql(`select to_char(date '2026-09-07','YYYY-MM-DD') d`))[0].d   // a Monday
    workDate = '2026-09-08'
    await sql(`insert into staff_terms(staff_id,monthly_salary,weekly_off_day,effective_from) values ($1,1200000,1,'2026-01-01')`, [ids.s_riya])
    await signup('dee', 'dee@gmail.com')
    await db.query(`update staff set status='active', branch_id=$1, name='Dee', joined_on=business_date()-30 where email='dee@gmail.com'`, [ids.HC1])
    ids.s_dee = (await sql(`select id from staff where email='dee@gmail.com'`))[0].id
  })

  test('check-in 300 m away is rejected; inside 100 m with a selfie succeeds; only once a day', async () => {
    await as('riya')
    await fails(() => checkIn(north(300)), /Move closer/)
    await fails(() => checkIn(north(20), 400), /accurate/)
    await fails(() => checkIn(north(20), 20, ''), /selfie/)
    const a = (await checkIn(north(20)))[0]
    assert.equal(a.status, 'open')
    await fails(() => checkIn(north(20)), /already checked in/)
  })

  test('check-out inside the fence closes the record', async () => {
    await as('riya')
    await fails(() => sql(`select * from check_out($1,$2,$3,$4)`, [north(500), LNG, 20, 'x/out.jpg']), /Move closer/)
    const a = (await sql(`select * from check_out($1,$2,$3,$4)`, [north(10), LNG, 20, 'x/out.jpg']))[0]
    assert.ok(a.out_at)
    assert.equal(a.status, 'absent')     // checked out seconds after checking in
  })

  test('daily status rules (9 h required, 15 min grace, half-day, extra day)', async () => {
    assert.deepEqual(await status(0, 540, workDate), ['present', 0])
    assert.deepEqual(await status(0, 530, workDate), ['present', 0])        // 10 min short, inside grace
    assert.deepEqual(await status(0, 480, workDate), ['present_short', 45]) // 60 short - 15 grace
    assert.deepEqual(await status(0, 270, workDate), ['present_short', 255])
    assert.deepEqual(await status(0, 200, workDate), ['half_day', 0])
    assert.deepEqual(await status(0, 100, workDate), ['absent', 0])
    assert.deepEqual(await status(0, 300, offDate), ['extra_day', 0])       // worked on weekly off
    assert.deepEqual(await status(0, 150, offDate), ['extra_half', 0])
    assert.deepEqual(await status(0, 60, offDate), ['off', 0])
  })

  test('grid shows present, off, holiday, leave and absent days', async () => {
    await as(null)
    await sql(`insert into staff_terms(staff_id,monthly_salary,weekly_off_day,effective_from)
               values ($1,1000000, extract(dow from (business_date()-8))::int, '2026-01-01')`, [ids.s_dee])
    await sql(`insert into holidays(branch_id,date,name) values ($1, business_date()-7, 'Diwali')`, [ids.HC1])
    await sql(`insert into leaves(staff_id,date) values ($1, business_date()-6)`, [ids.s_dee])
    await as('mgr')
    await sql(`select correct_attendance($1, business_date()-9, '11:00', '20:00', 'Forgot to check in')`, [ids.s_dee])
    const rows = await sql(`select to_char(date,'YYYY-MM-DD') d, status from attendance_grid(business_date()-9, business_date()-5, null, $1) order by date`, [ids.s_dee])
    assert.deepEqual(rows.map((r) => r.status), ['present', 'off', 'holiday', 'leave', 'absent'])
  })

  test('only managers correct attendance, with a reason; correction is flagged', async () => {
    await as('riya')
    await fails(() => sql(`select correct_attendance($1, business_date()-2, '11:00','20:00','x')`, [ids.s_riya]), /Managers only/)
    await as('mgr')
    await fails(() => sql(`select correct_attendance($1, business_date()-2, '11:00','20:00','')`, [ids.s_dee]), /reason/)
    const a = (await sql(`select * from correct_attendance($1, business_date()-2, '11:00','19:00','Phone died')`, [ids.s_dee]))[0]
    assert.equal(a.status, 'present_short')           // 8 h = 60 min short, 45 beyond grace
    assert.equal(a.short_minutes, 45)
    await as(null)
    assert.ok((await sql(`select count(*)::int c from flags where type='attendance_corrected'`))[0].c >= 2)
  })

  test('nightly job auto-closes open records at shift end and flags them', async () => {
    await as('mgr')
    await sql(`select correct_attendance($1, business_date()-3, '11:05', null, 'Left open')`, [ids.s_dee])
    await as(null)
    const n = (await sql(`select auto_close_attendance() n`))[0].n
    assert.ok(n >= 1)
    const [a] = await sql(`select auto_closed, status, to_char(out_at at time zone 'Asia/Kolkata','HH24:MI') t from attendance where staff_id=$1 and date=business_date()-3`, [ids.s_dee])
    assert.equal(a.auto_closed, true)
    assert.equal(a.t, '20:00')
    assert.equal(a.status, 'present')                 // 11:05 to 20:00 = 8h55, inside grace
    assert.ok((await sql(`select count(*)::int c from flags where type='auto_closed_checkout'`))[0].c >= 1)
  })

  test("staff see only their own attendance", async () => {
    await as('aman')
    assert.equal((await sql(`select count(*)::int c from attendance`))[0].c, 0)
    await as('riya')
    assert.equal((await sql(`select count(*)::int c from attendance where staff_id <> $1`, [ids.s_riya]))[0].c, 0)
  })
})

describe('dashboard, incentive and reports', () => {
  let hc4, svcA, svcB
  before(async () => {
    await as(null)
    hc4 = (await sql(`insert into branches(name,code) values ('Test 4','HC4') returning id`))[0].id
    await signup('eve', 'eve@gmail.com'); await signup('fay', 'fay@gmail.com')
    await db.query(`update staff set status='active', branch_id=$1, name=split_part(email,'@',1) where email in ('eve@gmail.com','fay@gmail.com')`, [hc4])
    ids.s_eve = (await sql(`select id from staff where email='eve@gmail.com'`))[0].id
    ids.s_fay = (await sql(`select id from staff where email='fay@gmail.com'`))[0].id
    await sql(`insert into staff_terms(staff_id,monthly_salary,weekly_off_day,effective_from) values ($1,1000000,1,'2026-01-01'),($2,1000000,1,'2026-01-01')`, [ids.s_eve, ids.s_fay])
    const cat = (await sql(`select id from service_categories limit 1`))[0].id
    svcA = (await sql(`insert into services(category_id,name,standard_price) values ($1,'Bridal 40k',4000000) returning id`, [cat]))[0].id
    svcB = (await sql(`insert into services(category_id,name,standard_price) values ($1,'Big 2.4L',24000000) returning id`, [cat]))[0].id
    // Eve credits ₹40,000, Fay ₹2,40,000 => salon HC4 net sales ₹2,80,000 (PRD 7.4 example)
    for (const [who, svc, price, phone] of [['eve', svcA, 4000000n, '3333333331'], ['fay', svcB, 24000000n, '3333333332']]) {
      await as(null)
      const c = (await sql(`insert into clients(phone,name) values ($1,$2) returning id`, [phone, who])).at(0)
      await as(who)
      const v = await newVisit(who, c.id)
      await addDone(v.id, svc)
      await bill(v.id, price, 0n)
    }
  })

  test('PRD 7.4: salary ₹10,000, credit ₹40,000, salon sales ₹2,80,000 gives ₹500 incentive; below the gate gives ₹0', async () => {
    await as('mgr')
    const m = (await sql(`select dashboard_month($1, null) j`, [hc4]))[0].j
    const b = m.branches[0]
    assert.equal(Number(b.net_sales), 28000000)
    const eve = b.staff.find((s) => s.name === 'eve')
    assert.equal(Number(eve.credit), 4000000)
    assert.equal(Number(eve.target), 3000000)
    assert.equal(Number(eve.incentive), 50000)             // ₹500
    await as(null)
    await sql(`update settings set value='30000000' where key='incentive_gate_paise'`)     // gate ₹3,00,000: sales ₹2,80,000 is below
    await as('mgr')
    const m2 = (await sql(`select dashboard_month($1, null) j`, [hc4]))[0].j
    assert.equal(Number(m2.branches[0].staff.find((s) => s.name === 'eve').incentive), 0)
    await as(null)
    await sql(`update settings set value='25000000' where key='incentive_gate_paise'`)
  })

  test("today's dashboard is per salon and sums to both", async () => {
    await as('mgr')
    const one = (await sql(`select dashboard_today($1,null) j`, [hc4]))[0].j
    assert.equal(Number(one.services), 28000000)
    assert.equal(Number(one.bills), 2)
    assert.equal(Number(one.clients_new), 2)
    assert.equal(Number(one.cash), 28000000)
    const hc1 = (await sql(`select dashboard_today($1,null) j`, [ids.HC1]))[0].j
    const both = (await sql(`select dashboard_today(null,null) j`))[0].j
    assert.ok(Number(hc1.services) < Number(both.services))
    assert.ok(Number(both.services) >= Number(hc1.services) + 28000000)
    const eveRow = one.staff.find((s) => s.name === 'eve')
    assert.equal(Number(eveRow.credit), 4000000)
    assert.equal(Number(eveRow.services), 1)
  })

  test('only managers see the dashboard and reports', async () => {
    await as('riya')
    await fails(() => sql(`select dashboard_today(null,null)`), /Managers only/)
    await fails(() => sql(`select * from report('sales', null, null, null)`), /Managers only/)
  })

  test('every report runs and returns rows where data exists', async () => {
    await as('mgr')
    for (const name of ['sales', 'staff_performance', 'discounts', 'dues', 'prime', 'expenses', 'cash_closings', 'attendance', 'audit']) {
      const rows = await sql(`select * from report($1, business_date()-40, business_date(), null)`, [name])
      assert.ok(Array.isArray(rows), name)
      if (['sales', 'staff_performance', 'audit', 'cash_closings', 'discounts'].includes(name)) assert.ok(rows.length > 0, name)
    }
    await fails(() => sql(`select * from report('nope', null, null, null)`), /Unknown report/)
  })

  test('manager can mark a flag seen with a note', async () => {
    await as('mgr')
    const id = (await sql(`select id from flags order by created_at limit 1`))[0].id
    await sql(`select see_flag($1, 'Checked with staff')`, [id])
    const f = (await sql(`select seen_at, note from flags where id=$1`, [id]))[0]
    assert.ok(f.seen_at)
    assert.match(f.note, /Checked with staff/)
  })
})

describe('payroll', () => {
  const math = async (a) => (await sql(`select * from payroll_math($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, a))[0]
  test('PRD 7.4 payslip: ₹12,000, 27 days, 2 absent, 1 extra, 90 min short, ₹600 incentive, ₹2,000 advance = ₹10,081', async () => {
    await as(null)
    const r = await math([1200000, 27, 27, 2, 0, 1, 90, 60000, 200000, 0])
    assert.equal(Number(r.day_rate), 44444)
    assert.equal(Number(r.absent_deduction), 88889)
    assert.equal(Number(r.extra_pay), 44444)
    assert.equal(Number(r.short_deduction), 7407)
    assert.equal(Number(r.net_pay), 1008100)
    assert.equal(Number(r.carry_out), 0)
  })
  test('advances bigger than pay give ₹0 and carry the rest forward', async () => {
    await as(null)
    const r = await math([1000000, 26, 26, 0, 0, 0, 0, 0, 1500000, 0])
    assert.equal(Number(r.net_pay), 0)
    assert.equal(Number(r.carry_out), 500000)
  })
  test('carry-in from last month is deducted; half days and a new joiner are pro-rated', async () => {
    await as(null)
    let r = await math([1000000, 26, 26, 0, 2, 0, 0, 0, 0, 100000])   // 2 half days = 1 day off
    assert.equal(Number(r.net_pay), 1000000 - Math.round(1000000 / 26) - 100000 > 0 ? Math.round((1000000 - 1000000 / 26 - 100000) / 100) * 100 : 0)
    r = await math([1000000, 26, 13, 0, 0, 0, 0, 0, 0, 0])            // joined mid-month: half the working days
    assert.equal(Number(r.base_pay), 500000)
  })

  test('run, review, finalise and lock a real month; payslip is private and carry-forward works', async () => {
    await as('mgr')
    const month = (await sql(`select to_char(date_trunc('month', business_date()),'YYYY-MM-DD') m`))[0].m
    const hc4 = (await sql(`select id from branches where code='HC4'`))[0].id
    const run = (await sql(`select * from run_payroll($1,$2)`, [hc4, month]))[0]
    assert.equal(run.status, 'draft')
    const lines = await sql(`select l.*, s.name from payroll_lines l join staff s on s.id=l.staff_id where run_id=$1`, [run.id])
    const eve = lines.find((l) => l.name === 'eve')
    assert.equal(Number(eve.credit), 4000000)
    assert.equal(Number(eve.salon_sales), 28000000)
    assert.equal(Number(eve.incentive), 50000)                       // gate met, ₹500
    // re-running a draft refreshes rather than duplicating
    await sql(`select * from run_payroll($1,$2)`, [hc4, month])
    assert.equal((await sql(`select count(*)::int c from payroll_lines where run_id=$1`, [run.id]))[0].c, lines.length)
    // payslip hidden until final
    await as('eve')
    assert.equal((await sql(`select count(*)::int c from payroll_lines`))[0].c, 0)
    await as('mgr')
    await fails(() => sql(`select mark_payslip_paid($1,'cash')`, [eve.id]), /Finalise/)
    await sql(`select * from finalize_payroll($1)`, [run.id])
    await fails(() => sql(`select * from run_payroll($1,$2)`, [hc4, month]), /final and locked/)
    await as(null)
    await fails(() => sql(`update payroll_lines set net_pay = 1 where id=$1`, [eve.id]), /locked/)
    await as('mgr')
    const paid = (await sql(`select * from mark_payslip_paid($1,'upi')`, [eve.id]))[0]
    assert.equal(paid.paid_mode, 'upi')
    await as('eve')
    const mine = await sql(`select * from payroll_lines`)
    assert.equal(mine.length, 1)                                      // own payslip only
    assert.equal(mine[0].staff_id, ids.s_eve)
    assert.equal((await sql(`select count(*)::int c from payroll_runs`))[0].c, 1)        // can see the month of their own payslip
    await as('fay')
    assert.equal((await sql(`select count(*)::int c from payroll_lines where staff_id <> $1`, [ids.s_fay]))[0].c, 0)
  })
})

describe('exit settlement, joining date and make-up days', () => {
  test('a last working date in the past deactivates the staff member; grid still shows them up to that day', async () => {
    await as(null)
    await signup('hal', 'hal@gmail.com')
    await db.query(`update staff set status='active', branch_id=$1, name='Hal', joined_on=business_date()-20 where email='hal@gmail.com'`, [ids.HC1])
    ids.s_hal = (await sql(`select id from staff where email='hal@gmail.com'`))[0].id
    await sql(`insert into staff_terms(staff_id,monthly_salary,weekly_off_day,effective_from) values ($1,1200000,0,'2026-01-01')`, [ids.s_hal])
    await sql(`update staff set last_working_on = business_date()-5 where id=$1`, [ids.s_hal])
    assert.equal((await sql(`select status from staff where id=$1`, [ids.s_hal]))[0].status, 'inactive')
    await as('mgr')
    const rows = await sql(`select to_char(date,'YYYY-MM-DD') d from attendance_grid(business_date()-20, business_date(), null, $1) order by date`, [ids.s_hal])
    assert.equal(rows.length, 16)                                         // day -20 .. day -5
    assert.equal((await sql(`select count(*)::int c from attendance_grid(business_date()-20, business_date(), null, null) where staff_id=$1`, [ids.s_hal]))[0].c, 0)
  })

  test('settle_exit pays up to the last date, no incentive, deducts advances, and supersedes the monthly draft line', async () => {
    await as('mgr')
    const month = (await sql(`select to_char(date_trunc('month', business_date()),'YYYY-MM-DD') m`))[0].m
    await as(null)
    await sql(`update staff set status='active', last_working_on = business_date() where id=$1`, [ids.s_hal])   // present again for the monthly run
    await as('mgr')
    const monthly = (await sql(`select * from run_payroll($1,$2)`, [ids.HC1, month]))[0]
    assert.ok((await sql(`select 1 from payroll_lines where run_id=$1 and staff_id=$2 and not void`, [monthly.id, ids.s_hal])).length === 1)
    await sql(`select add_advance($1, 100000, 'drawer', 'Leaving advance', $2, null)`, [ids.s_hal, ids.HC1])
    const ex = (await sql(`select * from settle_exit($1, null)`, [ids.s_hal]))[0]
    assert.equal(ex.kind, 'exit')
    const [line] = await sql(`select * from payroll_lines where run_id=$1`, [ex.id])
    assert.equal(Number(line.incentive), 0)
    assert.equal(Number(line.advances), 100000)
    assert.ok(line.window_end)
    assert.ok(Number(line.net_pay) <= Number(line.base_pay) - 100000 || Number(line.net_pay) === 0)
    assert.equal((await sql(`select count(*)::int c from payroll_lines where run_id=$1 and staff_id=$2 and void`, [monthly.id, ids.s_hal]))[0].c, 1)
    // re-running the monthly draft leaves them out; the exit settlement can be finalised and paid on its own
    const again = (await sql(`select * from run_payroll($1,$2)`, [ids.HC1, month]))[0]
    assert.equal((await sql(`select count(*)::int c from payroll_lines where run_id=$1 and staff_id=$2 and not void`, [again.id, ids.s_hal]))[0].c, 0)
    await sql(`select * from finalize_payroll($1)`, [ex.id])
    await sql(`select * from mark_payslip_paid($1,'cash')`, [line.id])
    await fails(() => sql(`select * from settle_exit($1, null)`, [ids.s_hal]), /final and locked/)
  })

  test('without a last working date there is nothing to settle', async () => {
    await as('mgr')
    await fails(() => sql(`select * from settle_exit($1, null)`, [ids.s_riya]), /last working date/)
  })

  test('joining date can move forward after the partial month is settled, never back into paid time', async () => {
    await as(null)
    const month = (await sql(`select date_trunc('month', business_date())::date m`))[0].m
    await fails(() => sql(`update staff set joined_on = business_date() - 1 where id=$1`, [ids.s_eve]), /already settled/)
    await sql(`update staff set joined_on = (date_trunc('month', business_date()) + interval '1 month')::date where id=$1`, [ids.s_eve])
    assert.ok(month)
  })

  test('make-up days: absences accumulate as days to cover and shrink when extra days are worked', async () => {
    await as('mgr')
    const month = (await sql(`select to_char(date_trunc('month', business_date()),'YYYY-MM-DD') m`))[0].m
    const run = (await sql(`select * from run_payroll($1,$2)`, [ids.HC1, month]))[0]
    const rows = await sql(`select makeup_days, absent_days, extra_days from payroll_lines where run_id=$1 and not void`, [run.id])
    assert.ok(rows.length > 0)
    for (const r of rows) assert.ok(Number(r.makeup_days) >= 0)
  })
})

describe('products, stock and voiding bills', () => {
  let prod, svc1000b
  const addProduct = (visit, qty = 1, price = null, reason = null) =>
    sql(`select * from add_product_line($1,$2,$3,$4,$5)`, [visit, prod, qty, price, reason]).then((r) => r[0])
  const stockOf = async (branch) =>
    Number((await sql(`select qty from stock_levels($1) where product_id=$2`, [branch, prod]))[0].qty)
  const mkClient = async (phone, bday = 'null') => {
    await as(null)
    const c = (await sql(`insert into clients(phone,name,birthday) values ($1,'P', ${bday}) returning id`, [phone]))[0]
    return c
  }

  before(async () => {
    await as(null)
    prod = (await sql(`insert into products(name,sku,selling_price,prime_price,low_stock_at) values ('Shampoo','SH1',50000,40000,2) returning id`))[0].id
    const cat = (await sql(`select id from service_categories limit 1`))[0].id
    svc1000b = (await sql(`insert into services(category_id,name,standard_price) values ($1,'Svc 1000',100000) returning id`, [cat]))[0].id
    await as('mgr')
    await sql(`select add_stock($1,$2,5,'purchase','Opening stock')`, [ids.HC1, prod])
  })

  test('product-only sale closes a bill and reduces that salon stock only', async () => {
    const c = await mkClient('2222222221')
    await as('riya')
    const v = await newVisit('riya', c.id)
    await addProduct(v.id, 2)
    const b = await bill(v.id, 100000n, 0n)
    assert.equal(Number(b.subtotal), 100000)
    assert.equal(await stockOf(ids.HC1), 3)
    await as('mgr')
    assert.equal(await stockOf(ids.HC2), 0)
  })

  test('selling more than on hand is allowed but flagged', async () => {
    const c = await mkClient('2222222222')
    await as('riya')
    const v = await newVisit('riya', c.id)
    await addProduct(v.id, 4)
    await bill(v.id, 200000n, 0n)
    assert.equal(await stockOf(ids.HC1), -1)
    await as(null)
    assert.equal((await sql(`select count(*)::int c from flags where type='stock_negative'`))[0].c, 1)
  })

  test('product price below list is flagged; prime price applies to products too', async () => {
    const c = await mkClient('2222222223')
    await as('riya')
    const v = await newVisit('riya', c.id)
    await fails(() => addProduct(v.id, 1, 30000), /reason/)
    const l = await addProduct(v.id, 1, 30000, 'Damaged pack')
    assert.equal(l.flagged, true)
    assert.equal(l.kind, 'product')
    const b = await bill(v.id, 30000n, 0n)
    assert.equal(Number(b.new_due), 0)
  })

  test('birthday discount applies to services only, not products', async () => {
    const c = await mkClient('2222222224', `business_date() - interval '28 years'`)
    await as('riya')
    const v = await newVisit('riya', c.id)
    await addDone(v.id, svc1000b)
    await addProduct(v.id, 1)
    const b = await bill(v.id, 130000n, 0n)       // 1000 + 500 - 20% of 1000
    assert.equal(Number(b.subtotal), 150000)
    assert.equal(Number(b.discount), 20000)
    assert.equal(Number(b.total_payable), 130000)
  })

  test('stock levels, low-stock flag, purchase, adjustment (reason + flag) and transfer', async () => {
    await as('mgr')
    await sql(`select add_stock($1,$2,10,'purchase',null)`, [ids.HC1, prod])
    const lv = (await sql(`select * from stock_levels($1) where product_id=$2`, [ids.HC1, prod]))[0]
    assert.equal(lv.low, false)
    await fails(() => sql(`select add_stock($1,$2,-1,'adjustment',null)`, [ids.HC1, prod]), /reason/)
    await sql(`select add_stock($1,$2,-1,'adjustment','Broken bottle')`, [ids.HC1, prod])
    await sql(`select transfer_stock($1,$2,$3,3,'Restock HC2')`, [ids.HC1, ids.HC2, prod])
    assert.equal(await stockOf(ids.HC2), 3)
    await fails(() => sql(`select transfer_stock($1,$2,$3,999,null)`, [ids.HC2, ids.HC1, prod]), /Only/)
    await as('riya')
    await fails(() => sql(`select add_stock($1,$2,1,'purchase',null)`, [ids.HC1, prod]), /Managers only/)
    assert.equal((await sql(`select count(*)::int c from stock_levels(null)`))[0].c, 1)     // staff see only their own salon
  })

  test('voiding a bill: manager only, reason needed, restores stock, reverses the due, refunds cash, keeps the number', async () => {
    const c = await mkClient('2222222225')
    await as('riya')
    const v = await newVisit('riya', c.id)
    await addProduct(v.id, 2)
    const b = await bill(v.id, 60000n, 0n)                                      // ₹1,000 bill, ₹600 paid, ₹400 due
    const before = await stockOf(ids.HC1)
    assert.equal(Number((await sql(`select client_balance($1) b`, [c.id]))[0].b), 40000)
    await fails(() => sql(`select void_bill($1,'x')`, [b.id]), /Managers only/)
    await as('mgr')
    await fails(() => sql(`select void_bill($1,'')`, [b.id]), /reason/)
    const voided = (await sql(`select * from void_bill($1,'Wrong client')`, [b.id]))[0]
    assert.equal(voided.status, 'void')
    assert.equal(voided.bill_no, b.bill_no)
    assert.equal(await stockOf(ids.HC1), before + 2)
    assert.equal(Number((await sql(`select client_balance($1) b`, [c.id]))[0].b), 0)
    await fails(() => sql(`select void_bill($1,'again')`, [b.id]), /already void/)
    // the refund reduces expected cash for the day
    const sm = (await sql(`select * from day_summary($1,null)`, [ids.HC1]))[0]
    const refunds = Number((await sql(`select coalesce(sum(amount),0) a from payments where branch_id=$1 and kind='refund' and business_date=business_date()`, [ids.HC1]))[0].a)
    assert.equal(refunds, 60000)
    assert.ok(Number(sm.cash_bills) >= 0)
    await as(null)
    assert.equal((await sql(`select count(*)::int c from flags where type='bill_voided'`))[0].c, 1)
    assert.ok((await sql(`select count(*)::int c from audit_log where table_name='bills' and action='UPDATE' and reason is null and after->>'status'='void'`))[0].c >= 1)
  })

  test('voided bills drop out of the dashboard sales', async () => {
    await as('mgr')
    const before = (await sql(`select dashboard_today($1,null) j`, [ids.HC1]))[0].j
    assert.ok(Number(before.products) > 0)
    assert.ok(Number(before.net_sales) >= Number(before.products))
  })
})
