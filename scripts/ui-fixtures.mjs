// Fake Supabase data for the screenshot harness (scripts/ui-shots.mjs). Not used by the app.
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const now = new Date().toISOString()
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const ids = { hc1: uid(1), hc2: uid(2), admin: uid(10), riya: uid(11), aman: uid(12), dee: uid(13),
  meera: uid(20), test: uid(21), visit: uid(30), visit2: uid(31), line1: uid(40), line2: uid(41), line3: uid(42),
  svc1: uid(50), svc2: uid(51), svc3: uid(52), prod1: uid(60), bill1: uid(70), run: uid(80), pl1: uid(81) }

const branches = [
  { id: ids.hc1, name: 'HairrCraftt Salon 1', code: 'HC1', address: 'Andheri West', lat: 19.076, lng: 72.8777, geofence_radius_m: 100 },
  { id: ids.hc2, name: 'HairrCraftt Salon 2', code: 'HC2', address: 'Bandra', lat: null, lng: null, geofence_radius_m: 100 },
]
const mkStaff = (id, name, email, role, branch, extra = {}) => ({ id, auth_user_id: id, email, name, phone: null, role, is_admin: false, branch_id: branch,
  status: 'active', shift_start: '11:00:00', shift_end: '20:00:00', joined_on: '2026-01-10', last_working_on: null, ...extra })
const staff = [
  mkStaff(ids.admin, 'Cherag Verma', 'cheragverma0001@gmail.com', 'manager', ids.hc1, { is_admin: true }),
  mkStaff(ids.riya, 'Riya Sharma', 'riya@gmail.com', 'member', ids.hc1),
  mkStaff(ids.aman, 'Aman Gupta', 'aman@gmail.com', 'member', ids.hc1),
  mkStaff(ids.dee, 'Dee Kapoor', 'dee@gmail.com', 'manager', ids.hc2),
  { ...mkStaff(uid(14), '', 'newjoiner@gmail.com', 'member', null), status: 'pending' },
]
const clients = [
  { id: ids.meera, phone: '9000000001', name: 'Meera Nair', gender: 'female', birthday: `1994-${today.slice(5)}`, notes: 'Prefers Riya. Allergic to ammonia.' },
  { id: ids.test, phone: '9000000002', name: 'Test Client', gender: null, birthday: null, notes: null },
]
const categories = [
  { id: uid(100), name: 'Haircut', gender: 'men', sort: 0 }, { id: uid(101), name: 'Facial', gender: 'both', sort: 1 },
  { id: uid(102), name: 'Hair Color - Global', gender: 'women', sort: 2 },
]
const services = [
  { id: ids.svc1, category_id: uid(100), name: 'Haircut', gender: 'men', standard_price: 25000, prime_price: null, unit_label: null, price_hint: null, is_package: false, active: true, sort: 0 },
  { id: ids.svc2, category_id: uid(101), name: 'CleanUp', gender: 'both', standard_price: 60000, prime_price: 48000, unit_label: null, price_hint: null, is_package: false, active: true, sort: 1 },
  { id: ids.svc3, category_id: uid(102), name: 'Base Shade', gender: 'women', standard_price: null, prime_price: null, unit_label: null, price_hint: '₹2,500 onwards', is_package: false, active: true, sort: 2 },
]
const products = [{ id: ids.prod1, name: 'L\'Oreal Shampoo 250ml', sku: 'LS250', selling_price: 55000, prime_price: 49500, low_stock_at: 2, active: true }]
const lineStaff = (s) => [{ staff_id: s, share: 1 }]
const lines = [
  { id: ids.line1, visit_id: ids.visit, kind: 'service', item_id: ids.svc1, name: 'Haircut', qty: 1, list_price: 25000, price: 25000, net_price: null, flagged: false, flag_reason: null, status: 'active', done_at: now, created_by: ids.riya, visit_line_staff: lineStaff(ids.riya) },
  { id: ids.line2, visit_id: ids.visit, kind: 'service', item_id: ids.svc2, name: 'CleanUp', qty: 1, list_price: 48000, price: 40000, net_price: null, flagged: true, flag_reason: 'Regular client', status: 'active', done_at: null, created_by: ids.riya, visit_line_staff: [{ staff_id: ids.riya, share: 0.5 }, { staff_id: ids.aman, share: 0.5 }] },
  { id: ids.line3, visit_id: ids.visit, kind: 'product', item_id: ids.prod1, name: 'L\'Oreal Shampoo 250ml', qty: 1, list_price: 49500, price: 49500, net_price: null, flagged: false, flag_reason: null, status: 'active', done_at: now, created_by: ids.aman, visit_line_staff: lineStaff(ids.aman) },
]
const visit = { id: ids.visit, branch_id: ids.hc1, client_id: ids.meera, status: 'open', business_date: today, created_at: now, clients: clients[0],
  branches: { code: 'HC1' }, visit_lines: lines.map((l) => ({ id: l.id, status: l.status, done_at: l.done_at, kind: l.kind })) }
const visit2 = { ...visit, id: ids.visit2, client_id: ids.test, clients: clients[1], visit_lines: [] }
const bills = [
  { id: ids.bill1, bill_no: 'HC1-000042', business_date: today, total_payable: 112000, paid: 100000, new_due: 12000, status: 'final', void_reason: null, clients: { name: 'Meera Nair' }, branch_id: ids.hc1 },
  { id: uid(71), bill_no: 'HC1-000041', business_date: today, total_payable: 25000, paid: 25000, new_due: 0, status: 'void', void_reason: 'Wrong client', clients: { name: 'Test Client' }, branch_id: ids.hc1 },
]
const flags = [
  { id: uid(90), created_at: now, type: 'price_below_list', branch_id: ids.hc1, staff_id: ids.riya, amount: 8000, ref_table: 'visits', ref_id: ids.visit, note: 'Regular client', seen_at: null },
  { id: uid(91), created_at: now, type: 'cash_difference', branch_id: ids.hc1, staff_id: ids.aman, amount: -5000, ref_table: 'day_closings', ref_id: uid(5), note: 'Short, tea money', seen_at: null },
  { id: uid(92), created_at: now, type: 'attendance_corrected', branch_id: ids.hc2, staff_id: ids.dee, amount: null, ref_table: 'attendance', ref_id: uid(6), note: 'Phone died\nManager: ok', seen_at: now },
]
const line = (id, staffId, name, over = {}) => ({ id, run_id: ids.run, staff_id: staffId, salary: 1200000, expected_days_full: 27, expected_days: 27, day_rate: 44444, present_days: 24, absent_days: 2, half_days: 0, extra_days: 1, leave_days: 0, short_minutes: 90, absent_deduction: 88889, extra_pay: 44444, short_deduction: 7407, base_pay: 1148148, credit: 4000000, salon_sales: 28000000, target: 3600000, incentive: 60000, advances: 200000, carry_in: 0, net_pay: 1008100, carry_out: 0, makeup_days: 1, void: false, window_end: today, paid_at: null, paid_mode: null, staff: { name }, payroll_runs: { month: `${today.slice(0, 7)}-01`, branches: { name: 'HairrCraftt Salon 1' } }, ...over })
const payroll_lines = [line(ids.pl1, ids.riya, 'Riya Sharma'), line(uid(82), ids.aman, 'Aman Gupta', { net_pay: 0, carry_out: 350000, advances: 900000, incentive: 0 })]
const settings = [
  ['incentive_multiple', 3], ['incentive_rate_pct', 5], ['incentive_gate_paise', 25000000], ['grace_minutes', 15], ['required_hours', 9], ['half_day_pct', 50],
  ['min_hours_for_half_day', 2], ['geofence_default_m', 100], ['geofence_max_accuracy_m', 150], ['prime_fee_paise', 80000], ['birthday_discount_pct', 20],
  ['prime_validity_days', 365], ['selfie_retention_days', 90],
].map(([key, value]) => ({ key, value }))

export const tables = {
  staff, branches, clients, service_categories: categories, services, products, visits: [visit, visit2], visit_lines: lines, bills, flags, settings,
  payroll_runs: [{ id: ids.run, branch_id: ids.hc1, month: `${today.slice(0, 7)}-01`, status: 'draft', kind: 'monthly', staff_id: null }],
  payroll_lines, staff_favourites: [{ service_id: ids.svc1 }],
  attendance: [{ id: uid(95), date: today, in_at: now, out_at: null, status: 'open' }],
  expenses: [{ id: uid(96), amount: 45000, category: 'Cleaning', title: 'Mop and cleaner', paid_from: 'drawer', receipt_path: null, created_by: ids.admin }],
  salary_advances: [{ id: uid(97), staff_id: ids.riya, business_date: today, amount: 200000, paid_from: 'drawer', note: 'Festival' }],
  client_ledger: [{ id: uid(98), created_at: now, type: 'due_added', amount: 12000, reason: 'Bill HC1-000042' }, { id: uid(99), created_at: now, type: 'due_paid', amount: -5000, reason: 'Dues collected' }],
  stock_movements: [{ id: uid(110), created_at: now, branch_id: ids.hc1, type: 'purchase', qty: 6, note: 'Opening stock', products: { name: 'L\'Oreal Shampoo 250ml' } }],
  staff_terms: [{ id: uid(111), staff_id: ids.riya, monthly_salary: 1200000, weekly_off_day: 1, effective_from: '2026-01-01' }],
  memberships: [], leaves: [], holidays: [],
}

const gridRow = (s, status, extra = {}) => ({ staff_id: s.id, name: s.name, branch_id: s.branch_id, date: today, status, in_at: now, out_at: null, worked_minutes: null, short_minutes: 0, auto_closed: false, corrected: false, in_photo: null, out_photo: null, in_accuracy: 20, ...extra })

export const rpc = {
  client_card: [{ balance: 12000, prime_until: new Date(Date.now() + 12 * 86400000).toISOString().slice(0, 10) }],
  client_history: [{ service_name: 'Haircut', price: 25000, qty: 1, billed_on: '2026-09-12', branch_code: 'HC1' }, { service_name: 'CleanUp', price: 48000, qty: 1, billed_on: '2026-09-12', branch_code: 'HC1' }],
  last_charged: [{ price: 40000, billed_on: '2026-09-12' }],
  day_summary: [{ branch_id: ids.hc1, business_date: today, opening: 200000, cash_bills: 1450000, cash_dues: 30000, float_added: 0, cash_expenses: 45000, cash_advances: 200000, owner_taken: 1000000, expected: 435000, upi_expected: 320000, open_visits: 0, closed: false }],
  staff_schedule: staff.map((s) => ({ staff_id: s.id, weekly_off_day: 1 })),
  stock_levels: [{ branch_id: ids.hc1, product_id: ids.prod1, name: 'L\'Oreal Shampoo 250ml', sku: 'LS250', qty: 6, low_at: 2, low: false }, { branch_id: ids.hc1, product_id: uid(61), name: 'Argan Hair Serum', sku: null, qty: 1, low_at: 2, low: true }],
  attendance_grid: [gridRow(staff[1], 'open'), gridRow(staff[2], 'present', { out_at: now, in_accuracy: 140, auto_closed: true }), gridRow(staff[3], 'absent', { in_at: null }), gridRow(staff[0], 'pending', { in_at: null })],
  dashboard_today: { date: today, services: 2850000, products: 165000, memberships: 160000, net_sales: 3175000, bills: 18, clients_new: 5, clients_returning: 13, cash: 1480000, upi: 1320000, dues_created: 45000, dues_collected: 30000, expenses: 45000, advances: 200000, open_visits: 2,
    cash_status: [{ branch_id: ids.hc1, code: 'HC1', closed: false, expected: 435000, counted: null, difference: null, open_visits: 2 }, { branch_id: ids.hc2, code: 'HC2', closed: true, expected: 210000, counted: 205000, difference: -5000, open_visits: 0 }],
    staff: [{ staff_id: ids.riya, name: 'Riya Sharma', status: 'open', in_at: now, services: 7, credit: 1450000 }, { staff_id: ids.aman, name: 'Aman Gupta', status: 'present', in_at: now, services: 5, credit: 980000 }, { staff_id: ids.dee, name: 'Dee Kapoor', status: 'absent', in_at: null, services: 0, credit: 0 }] },
  dashboard_month: { month: `${today.slice(0, 7)}-01`, days_elapsed: 5, days_in_month: 31,
    branches: [{ branch_id: ids.hc1, code: 'HC1', name: 'HairrCraftt Salon 1', net_sales: 18400000, gate: 25000000, projected: 114080000, staff: [
      { staff_id: ids.riya, name: 'Riya Sharma', salary: 1200000, credit: 4200000, target: 3600000, incentive: 30000, present: 4, absent: 0, half: 0, short: 1 },
      { staff_id: ids.aman, name: 'Aman Gupta', salary: 1000000, credit: 1800000, target: 3000000, incentive: 0, present: 4, absent: 1, half: 0, short: 0 }] }],
    daily: Array.from({ length: 5 }, (_, i) => ({ date: `${today.slice(0, 8)}0${i + 1}`, amount: [3200000, 4100000, 2800000, 5200000, 3175000][i] })),
    categories: [{ category: 'Facial', amount: 6200000 }, { category: 'Haircut', amount: 4100000 }, { category: 'Hair Color - Global', amount: 3900000 }],
    top_services: [{ name: 'Haircut', count: 42, amount: 1050000 }, { name: 'CleanUp', count: 21, amount: 1008000 }] },
  report: [{ bill_no: 'HC1-000042', date: today, salon: 'HC1', client: 'Meera Nair', services: 'Haircut, CleanUp', staff: 'Riya Sharma', subtotal: 1120, discount: 0, total_payable: 1120, cash: 1000, gpay: 0, due_left: 120 }],
  check_in: [], close_bill: [],
}
