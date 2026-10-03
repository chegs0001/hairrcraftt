# HairrCraftt Salon Manager — PRD

Oct 3, 2026 · @Cherag

## 1. Overview

HairrCraftt Salon Manager is a free-to-run, mobile-first web app that records every client visit, service, rupee and staff hour across both HairrCraftt salons, so nothing leaks. Staff open it on their own phones from a link; the owner sees everything live.

**Problems it solves today**

- Cash and GPay are written in a paper register, so missed or altered entries cannot be traced.
- Client-specific prices, dues and prime benefits live in staff memory.
- There is no attendance record, so salary cuts and extra-day pay are guesswork.
- Incentives, advances and daily expenses are worked out by hand at month end.

**Goals for v1**

1. Zero leakage: every service sits on a visit, every visit ends in a numbered bill or a cancelled-with-reason record, and every day ends with a cash count against the system.
2. Staff log their own work in under 3 taps per service.
3. Monthly salary, incentive and advance deductions are calculated by the app, not by hand.
4. Running cost of ₹0 per month on free tiers.

**In scope (v1):** clients and dues, service and product logging, split credit, billing with split payments, prime membership, retail stock, expenses, salary advances, day-end cash closing, geo-fenced selfie attendance, payroll with incentives, owner dashboard, audit log.

**Not in v1:** appointments and online booking, Play Store / App Store apps, SMS or paid WhatsApp API, GST invoicing, multiple languages (English only), offline billing.

## 2. Tech stack and architecture

The app is a static React PWA on Cloudflare Pages talking directly to Supabase; there is no custom server to host or pay for. All money maths and permissions live in Postgres (functions + Row Level Security), so a tampered phone cannot change a bill.

| Layer | Choice | Why | Free-tier limit that matters |
| --- | --- | --- | --- |
| Frontend | Vite + React + TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, React Router | Fast on cheap Android phones; simple static build | none |
| Installable app | PWA via `vite-plugin-pwa` (manifest, icons, cached app shell) | "Add to Home Screen", opens full-screen like an app | none |
| Hosting | Cloudflare Pages | Static requests unlimited, commercial use allowed, free HTTPS (needed for camera + GPS) | 500 builds/month |
| Database + API | Supabase Postgres, auto REST + RPC functions | Relational data, transactions for billing, RLS per role and branch | 500 MB database |
| Login | Supabase Auth with Google sign-in | No passwords for staff to forget | 50,000 monthly users |
| Photos | Supabase Storage (selfies, expense receipts), compressed to \~50 KB on the phone | Private buckets with signed URLs | 1 GB storage |
| Scheduled jobs | `pg_cron` inside Supabase | Auto check-out, photo cleanup, daily flags | none |
| Backups | GitHub Actions nightly `pg_dump` to a private repo | Supabase free has no automatic backups | 2,000 Actions minutes/month |
| Client receipts | WhatsApp `wa.me` share link with a text bill | Free; no SMS or WhatsApp API cost | none |

**Risks and how the design handles them**

- Supabase pauses a free project after 7 days without activity. Daily salon use prevents this; the nightly backup job also queries the database.
- 1 GB photo storage: about 15 staff × 2 selfies × 30 days × 50 KB ≈ 45 MB/month. A nightly job deletes selfies older than 90 days.
- 500 MB database: text records for two salons stay well under 100 MB a year.
- If the business outgrows this, Supabase Pro is $25/month with no code changes.

**Engineering rules for Claude Code**

- Money stored as integer paise; display in rupees, rounded to ₹1 on bills.
- All dates and day boundaries in Asia/Kolkata.
- Bill closing, day closing and payroll run as single Postgres functions inside one transaction.
- Prices, flags and totals are recalculated on the server; values sent by the phone are never trusted.
- No hard deletes on money or attendance tables; use status fields and the audit log.

Sources: [Supabase pricing](https://supabase.com/pricing), [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits).

## 3. Roles, login and branches

There are two roles: **Manager** (the owner, plus anyone the owner promotes) and **Team member**. Everyone signs in with Google; nobody gets in until a manager approves their email and assigns a role and salon.

**Login flow**

1. Person opens the app link and taps "Continue with Google".
2. Unknown email → "Waiting for approval" screen; the request appears in the manager's Staff screen.
3. Manager approves, sets role, home salon, monthly salary, shift times and weekly off day.
4. Deactivated staff are signed out on their next request and cannot sign in again.

| Action | Team member | Manager |
| --- | --- | --- |
| Look up / add clients, see their dues and prime status | Both salons | Both salons |
| Open a visit, add services and products, change price | Own salon | Both salons |
| Bill a visit, take cash / GPay, record dues | Own salon | Both salons |
| Collect old dues without a visit | Own salon | Both salons |
| Cancel an unbilled visit | Own salon, reason required | Both salons |
| Edit or void a closed bill | No | Yes, reason required |
| Log expenses | Own salon | Both salons |
| Log salary advance | For self only | For anyone |
| Day-end cash closing | Own salon | Both salons; can reopen a closed day |
| Check in / check out | Self, inside geo-fence only | Self; can correct anyone's record with a reason |
| See own services, revenue credit, attendance, month target | Yes | Yes |
| See other staff's numbers, salon totals, reports, flags | No | Yes |
| Prices, products, stock, staff, salaries, settings, payroll | No | Yes |

**Branches**

- Each team member belongs to one home salon; a manager can switch between salons or view both combined.
- Clients, dues, prime membership and price history are shared across both salons.
- Bills, cash, expenses, stock and day closing are kept per salon.
- Each salon has its own GPS location, geo-fence radius and bill number series (e.g. `HC1-000123`, `HC2-000045`).

## 4. Core flows: visit, services, billing

Every client walk-in becomes a **visit**. Staff add their own lines to that visit as they work, and the visit ends in exactly one numbered bill or a cancellation with a reason.

&#91;embedded content: visit to day-end flow · 9 steps\]

Short payments become client dues that follow the client to either salon, and cash-out entries keep the day-end count honest.

### 4.1 Client check-in

1. Any team member taps **New visit** and types the 10-digit phone number; search starts automatically at 10 digits.
2. Existing client → card shows name, prime status and expiry, due balance (from either salon), last visit date and the last 3 services with prices.
3. New client → name (required), gender, birthday and notes (optional). Phone is unique across both salons.
4. Visit opens with status **Open** and appears in the salon's "Open visits" list for everyone on shift.
5. A client can have only one open visit at a time.

### 4.2 Logging services (by each team member)

1. Staff opens the visit from "Open visits" and taps **Add service**.
2. Picks a service from their favourites or searches the catalogue (grouped by category).
3. Price auto-fills: **prime price** if the client's membership is active today, otherwise **standard price**. Under the price, the app shows "Last charged ₹400 on 12 Sep" for this client and service, so staff know client-specific rates.
4. Staff can change the price. If it is below the auto-filled price, the line is **flagged** and staff pick a quick reason (Regular client, Combo, Correction, Other + note). No approval is needed.
5. The staff member adding the line is credited by default. **+ Add helper** adds more staff; the line's value is split equally among everyone on it (2 people = 50/50).
6. Staff can edit or remove only their own lines, and only while the visit is open. Every change is written to the audit log.

### 4.3 Retail products

- Added to a visit the same way as services, with quantity; price auto-fills from the product's selling price and can be lowered (flagged the same way).
- The staff member who adds it is recorded as the seller.
- Stock reduces for that salon only when the bill is closed. Stock cannot go below zero without a flag.

### 4.4 Billing counter

Any team member can bill. The billing screen shows:

| Part | Content |
| --- | --- |
| Lines by staff | Each service/product, who did it, price, flag icon if below list price |
| Subtotal | Sum of lines |
| Bill discount (optional) | Amount or %, reason required, flagged; spread across lines in proportion to their value |
| Prime membership (optional) | "Sell Prime" adds the yearly fee as a line; prime prices then apply to this same visit |
| Previous dues | Client's outstanding balance from either salon |
| **Total payable** | Subtotal − discount + membership fee + previous dues |
| Payment | Cash amount and GPay amount (either or both); GPay optionally takes the last 4 digits of the UPI reference |
| Balance | If paid < total payable, the difference becomes the client's new due |

On **Close bill**, one server function: assigns the next bill number, freezes all lines, applies the discount split, records payments, updates the client's due ledger, reduces stock and writes staff credit. A closed bill cannot be edited by team members.

After closing, a **Send on WhatsApp** button opens WhatsApp with a text receipt (salon, bill no, date, lines, paid, balance due) addressed to the client's number. Sending a receipt every time is the main defence against unrecorded cash.

### 4.5 Dues

- Each client has a running due ledger: "due added" (short payment on a bill), "due paid", and manager "adjustment / write-off" entries with a reason.
- Dues show on the client card and are added automatically to the next bill in either salon.
- **Collect dues** on the client card takes a payment without a visit (cash or GPay); it counts in that day's cash closing.
- If a client pays more than the total, the extra reduces older dues first; any remainder is stored as credit and subtracted from the next bill.

### 4.6 Prime membership

- Sold only at billing; fee and validity come from settings (default validity 365 days from the bill date).
- Existing prime members are entered manually by a manager with their start and expiry dates.
- Active membership switches every service to its prime price in both salons. Services without a prime price use the standard price.
- Renewal before expiry extends from the old expiry date; the client card shows "Expires in 12 days" when under 30 days.

### 4.7 Cancelling a visit

An open visit with lines can be cancelled only with a reason; it is flagged to the manager. Day closing is blocked while any visit from that day is still open.

## 5. Attendance

Staff check in and out from their own phone with a live selfie and GPS, and only when standing inside their salon's geo-fence. Worked minutes against each person's shift drive salary adjustments.

### 5.1 Check-in and check-out

1. Home screen shows one big **Check in** (or **Check out**) button.
2. App requests location with high accuracy. If the phone is more than the salon's radius away (default 100 m) or accuracy is worse than 150 m, the button stays disabled with "Move closer to HairrCraftt \<salon>".
3. Front camera opens inside the app (live capture only; gallery upload is not allowed). Photo is resized to 640 px and \~50 KB JPEG before upload.
4. Server stores time (server clock, not phone clock), latitude, longitude, accuracy and photo.
5. One check-in and one check-out per staff per day.

**Missed check-out:** a nightly job closes any open record at the staff's shift end time, marks it **Auto-closed** and flags it. A manager can correct it with a reason.

### 5.2 Daily status rules (all values editable in Settings)

| Situation | Status | Pay effect |
| --- | --- | --- |
| Worked at least 9 hours (e.g. 11:00–20:00) | Present | Full day |
| Late in or early out, total short time ≤ 15 min (one grace allowance per day) | Present | Full day |
| Short time > 15 min grace, worked ≥ 50% of shift | Present (short) | Short minutes beyond grace deducted at the hourly rate |
| Worked < 50% of shift but ≥ 2 h | Half day | 0.5 day paid |
| Worked < 2 h, or no check-in on a working day | Absent | Day not paid |
| Worked on own weekly off day (≥ 50% of shift) | Extra day | +1 day pay (+0.5 if half) |
| Manager marks paid leave or salon holiday | Leave / Holiday | Full day paid |

**Hours rule:** every staff member must work a minimum of 9 hours a day. Time beyond 9 hours earns no extra pay and does not make up for short time on another day.

**Days off:** each staff member gets one paid weekly off day. Any other day not worked is **Absent** and deducted at the day rate, unless a manager marks it as paid leave. Working on the weekly off day still earns an extra day's pay (section 7.1).

### 5.3 Staff schedule data

- Shift start and end per staff (default 11:00–20:00).
- Weekly off day per staff (Sunday to Saturday); can be changed by a manager with an effective date.
- Salon holidays (e.g. Diwali) entered by a manager per salon.

### 5.4 Anti-cheating checks

- Selfie thumbnails shown in the manager's daily attendance list for a quick visual check.
- Records with poor GPS accuracy, auto-closed check-outs or manager corrections are flagged.
- Selfies are deleted after 90 days; the attendance record itself stays.

## 6. Expenses, advances and day-end cash closing

Every rupee that leaves the drawer is logged by the person taking it, and at closing time the app tells staff exactly how much cash should be in the drawer.

### 6.1 Expenses

- Fields: amount, category (Tea/snacks, Cleaning, Salon supplies, Repairs, Transport, Other), title (required), optional receipt photo, paid from (Drawer cash / Owner).
- No approval needed. Creator can edit until the day is closed; after that only a manager.
- Drawer-cash expenses reduce that day's expected cash.

### 6.2 Salary advances

- Fields: staff, amount, date, paid from (Drawer cash / Owner / GPay), note.
- Team members can log advances only for themselves; managers for anyone.
- Drawer-cash advances reduce expected cash. All advances in a month are deducted in that month's payroll; any amount larger than the net salary carries to next month.

### 6.3 Owner cash movements

- **Cash taken by owner** (manager only) and **Float added** are separate entries, so removing cash for banking never shows as a shortage.

### 6.4 Day-end closing (per salon)

Any team member can close the day once every visit from that day is billed or cancelled.

| Line | Source |
| --- | --- |
| Opening cash | Previous day's counted cash |
| + Cash from bills | Cash part of today's bills |
| + Cash dues collected | "Collect dues" cash payments |
| + Float added | Owner entries |
| − Cash expenses | Drawer-cash expenses |
| − Cash advances | Drawer-cash salary advances |
| − Cash taken by owner | Owner entries |
| **= Expected cash** | Calculated |
| Counted cash | Staff enters, with optional note-by-note counter (₹500, ₹200, ₹100, ₹50, ₹20, ₹10, coins) |
| **Difference** | Counted − expected; any non-zero difference needs a note and is flagged |

The screen also shows **expected GPay total** for the day so the manager can match it against the GPay business app.

**Worked example:** opening ₹2,000 + bills ₹14,500 + dues ₹300 − expenses ₹450 − advance ₹2,000 − owner took ₹10,000 = expected ₹4,350. Counted ₹4,300 → short ₹50, flagged.

Closing **locks the day**: no new bills, expenses or advances can be dated to it. Only a manager can reopen a day, with a reason, and the reopening is logged.

## 7. Payroll and incentive

At month end a manager runs payroll per salon; the app calculates each person's pay from attendance, incentive from billed service credit, and subtracts advances. The run is saved as a draft, reviewed, then finalised and locked.

### 7.1 Base pay from attendance

- **Expected working days** = days in the month − the staff's weekly off days in that month − salon holidays (pro-rated from the joining date for new staff).
- **Day rate** = monthly salary ÷ expected working days. **Hourly rate** = day rate ÷ 9 required hours.

```latex
\text{Base pay} = \text{Salary} - \text{DayRate}\times(\text{absent} + 0.5\,\text{half days}) + \text{DayRate}\times\text{extra days} - \text{HourlyRate}\times\frac{\text{short minutes}}{60}
```

### 7.2 Incentive

- **Staff credit** = net value of every service line the person worked on in the month, after bill discounts, divided equally among staff on the line. Credit counts when the bill closes, whether or not the client paid in full.
- **Salon gate:** if the salon's net sales for the month are below ₹2,50,000, nobody in that salon gets an incentive.
- If the gate is met:

```latex
\text{Incentive} = 5\% \times \max(0,\ \text{Staff credit} - 3 \times \text{Monthly salary})
```

- Multiple (3×), rate (5%) and gate (₹2,50,000) are settings.

### 7.3 Net pay

```latex
\text{Net pay} = \text{Base pay} + \text{Incentive} - \text{Advances this month} - \text{Advance carried from last month}
```

Rounded to the nearest ₹1. If advances exceed pay, net pay is ₹0 and the rest carries forward.

### 7.4 Worked examples

**Incentive (your example):** salary ₹10,000, credit ₹40,000, salon sales ₹2,80,000. Target 3 × 10,000 = ₹30,000; excess ₹10,000; incentive 5% = **₹500**. If salon sales were ₹2,40,000, incentive = **₹0**.

**Split credit:** a ₹1,000 colour done by Riya with Aman as helper credits ₹500 to each. If the bill had a 10% discount, each gets ₹450.

**Full payslip (October 2026, 31 days, Monday off = 4 Mondays):**

| Item | Value |
| --- | --- |
| Monthly salary | ₹12,000 |
| Expected working days | 27 |
| Day rate | ₹444.44 |
| Absent 2 days | − ₹888.89 |
| Worked 1 weekly off | + ₹444.44 |
| Short time 90 min beyond grace (9 h shift, ₹49.38/h) | − ₹74.07 |
| Incentive | + ₹600 |
| Advance taken | − ₹2,000 |
| **Net pay** | **₹10,081** |

### 7.5 Payslip

Each finalised payroll line produces a payslip screen the staff member can see and share as an image: days present, absent, half, extra, leave, short minutes, credit vs target, incentive, advances, net pay. Marking it **Paid** (cash or GPay) records the payment date.

## 8. Manager dashboard, reports and leakage controls

The manager opens one screen and sees today's money, people and problems for each salon or both combined; every exception lands in a Flags inbox.

### 8.1 Today (live, per salon and combined)

- Net sales split into services, products and memberships; number of bills and clients (new vs returning).
- Collections by mode: cash, GPay; dues created today; dues collected today.
- Expenses and advances paid today.
- Cash status: day closed or open; expected vs counted; difference.
- Staff table: name, check-in time, status, services count, credit today.
- Open visits right now.

### 8.2 This month

- Salon net sales vs the ₹2,50,000 incentive gate (progress bar + projected month end).
- Each staff member's credit vs 3× salary target and projected incentive.
- Daily sales chart, sales by service category, top services.
- Attendance summary: present, absent, half, late count per staff.

### 8.3 Reports (date range, salon filter, CSV export)

| Report | What it shows |
| --- | --- |
| Sales | Bills with lines, staff, payment mode; totals by day |
| Staff performance | Credit, services, average ticket, discounts given per staff |
| Discounts and flags | Every below-list price and bill discount with staff and reason |
| Dues | All clients with outstanding dues, oldest first, with WhatsApp reminder link |
| Prime members | Active, expiring in 30 days, expired |
| Expenses | By category and by staff |
| Cash closings | Daily expected vs counted, differences, who closed |
| Attendance | Daily grid per staff with selfies on tap |
| Stock | Current stock per salon, low-stock list, movements |
| Audit log | Every create / edit / cancel / void with before and after values |

### 8.4 Flags inbox

Each flag has a type, salon, staff, amount and link to the record; the manager marks it **Seen** or adds a note.

- Price below list or bill discount
- Visit cancelled with lines on it
- Closed bill edited or voided, day reopened
- Cash difference at closing
- Due written off
- Stock adjusted or gone negative
- Auto-closed check-out, poor GPS accuracy, attendance corrected
- Day not closed by 23:00

### 8.5 Leakage controls built into the design

1. Work cannot be credited without a visit, and incentive only counts billed work, so staff are motivated to log every service.
2. Bill numbers are sequential per salon with no gaps; voided bills keep their number.
3. Closed bills and closed days are locked; changes need a manager and a reason, and are audited.
4. WhatsApp receipt for every bill lets clients see what was recorded.
5. Cash is reconciled daily, with owner withdrawals recorded separately.
6. Display the salon's own GPay QR at the counter so UPI money always reaches the owner's account.
7. Prices default from the catalogue and client history; anything lower is visible to the manager the same day.

No software can record a service that is never entered. The receipt habit, the incentive link and occasional manager spot checks (client count vs chairs used) cover that gap.

## 9. Data model

The schema below is the starting point for Claude Code; every table has `id uuid`, `created_at`, `created_by`, and money columns are `bigint` paise.

| Table | Key fields | Notes |
| --- | --- | --- |
| `branches` | name, code (HC1/HC2), address, lat, lng, geofence\_radius\_m, next\_bill\_no | 2 rows |
| `staff` | auth\_user\_id, email, name, phone, role (manager/member), branch\_id, status (pending/active/inactive), shift\_start, shift\_end, joined\_on |  |
| `staff_terms` | staff\_id, monthly\_salary, weekly\_off\_day, effective\_from | History keeps old payrolls correct |
| `clients` | phone (unique), name, gender, birthday, notes | Shared across salons |
| `client_ledger` | client\_id, branch\_id, bill\_id, type (due\_added/due\_paid/credit\_added/adjustment), amount, reason | Due balance = sum; never stored alone |
| `memberships` | client\_id, start\_date, end\_date, fee, bill\_id, source (sold/manual) | Active = today between dates |
| `service_categories`, `services` | name, category\_id, standard\_price, prime\_price, active, sort |  |
| `staff_favourites` | staff\_id, service\_id | Quick-add list |
| `products` | name, sku, selling\_price, prime\_price, active |  |
| `stock` / `stock_movements` | branch\_id, product\_id, qty / type (purchase/sale/adjustment/transfer), qty, ref | Stock = sum of movements |
| `visits` | branch\_id, client\_id, status (open/billed/cancelled), cancel\_reason, business\_date |  |
| `visit_lines` | visit\_id, kind (service/product/membership), item\_id, qty, list\_price, price, net\_price, flagged, flag\_reason, status (active/removed) | net\_price set at bill close |
| `visit_line_staff` | line\_id, staff\_id, share (e.g. 0.5) | Split credit |
| `bills` | bill\_no, branch\_id, visit\_id, client\_id, subtotal, discount, discount\_reason, membership\_fee, previous\_due, total\_payable, paid, new\_due, status (final/void), void\_reason |  |
| `payments` | branch\_id, client\_id, bill\_id (nullable), mode (cash/upi), amount, upi\_ref\_last4, kind (bill/due\_collection), business\_date |  |
| `expenses` | branch\_id, business\_date, amount, category, title, receipt\_path, paid\_from |  |
| `salary_advances` | staff\_id, branch\_id, business\_date, amount, paid\_from, note |  |
| `cash_movements` | branch\_id, business\_date, type (owner\_withdrawal/float\_added), amount, note |  |
| `day_closings` | branch\_id, business\_date, opening, cash\_in, cash\_out, expected, counted, difference, upi\_expected, denominations (json), note, status (closed/reopened) |  |
| `attendance` | staff\_id, branch\_id, date, in\_at, in\_lat, in\_lng, in\_accuracy, in\_photo, out\_\* , auto\_closed, status, short\_minutes, corrected\_reason | One row per staff per day |
| `leaves`, `holidays` | staff\_id or branch\_id, date, type (paid\_leave/holiday) |  |
| `payroll_runs` / `payroll_lines` | branch\_id, month, status (draft/final) / every number in 7.4 + paid\_at, paid\_mode | Frozen once final |
| `flags` | type, branch\_id, staff\_id, amount, ref\_table, ref\_id, seen\_at, note |  |
| `audit_log` | table\_name, row\_id, action, before (json), after (json), actor, reason | Written by triggers |
| `settings` | key, value | Incentive multiple, rate, gate, grace minutes, half-day %, geofence default, prime fee and validity, selfie retention days |

**Row Level Security:** members read/write only their branch's visits, bills, payments, expenses, closings and their own attendance, advances and payslips; clients, ledger and memberships are readable by all active staff; everything else is manager-only. Writes to bills, closings and payroll go only through `security definer` functions.

## 10. Screens and mobile UX

The app is designed for a team member holding a phone in one hand between clients: big buttons, few words, and no screen deeper than two taps from Home.

### 10.1 Team member screens (bottom tab bar: Home · Visits · Billing · More)

| Screen | Contents |
| --- | --- |
| Home | Check-in / check-out button, my services today, my credit this month vs 3× target bar, open visits shortcut |
| New visit | Phone keypad, client card or new-client form, Start visit |
| Open visits | Cards per open visit: client, time, lines count, staff avatars |
| Visit detail | Lines grouped by staff; Add service, Add product, Add helper; price with "last charged" hint |
| Billing | Section 4.4 layout, cash and GPay amount fields, Close bill, Send on WhatsApp |
| Client | Card, history, dues ledger, Collect dues |
| Expense | Amount, category chips, title, camera for receipt |
| Advance | Amount, paid from, note |
| Close day | Cash summary, note counter, counted cash, difference, Close |
| Me | Attendance calendar, payslips, advances |

### 10.2 Manager-only screens (in More)

Dashboard, Flags, Reports, Payroll, Staff (approve, salary, shift, off day, deactivate), Services and prices, Products and stock, Clients (edit, add prime manually, adjust dues), Salons (location, radius), Settings, Audit log.

### 10.3 UX rules

- Tap targets at least 48 px; primary action always a full-width button at the bottom.
- Numeric keypad for phone numbers and amounts; amounts in whole rupees.
- Adding a service takes at most 3 taps from the visit screen using favourites.
- Works on a 5-year-old Android phone in Chrome over 4G; first load under 3 s, later loads from cache.
- Light theme, high contrast, English, Indian number format (₹2,50,000), dates as "03 Oct".
- Every money action shows a confirmation sheet with the amount in large text before saving.
- Clear errors for no internet, location off and camera blocked, with how to fix them.
- "Add to Home Screen" prompt on first login, with instructions for Android and iPhone.

## 11. Build plan for Claude Code

Build in seven phases, each deployable and tested before the next; staff can start using billing after phase 2 while the rest is built.

1. **Foundation:** Vite + React PWA scaffold, Supabase project, Google sign-in, approval flow, roles, branches, settings, audit-log triggers, Cloudflare Pages deploy, nightly backup Action.
2. **Clients, visits and billing:** client lookup, visits, service lines with split credit and price flags, prime pricing, billing with split payment, dues ledger, bill numbers, WhatsApp receipt, CSV import for the price list.
3. **Cash:** expenses, salary advances, owner cash movements, day closing and day lock.
4. **Attendance:** geo-fenced selfie check-in/out, daily status rules, auto-close job, holidays and leave.
5. **Manager dashboard:** today, this month, flags inbox, reports with CSV export.
6. **Payroll:** payroll run, incentive gate, advances carry-forward, payslips.
7. **Products and stock:** catalogue, stock per salon, purchases, adjustments, low-stock list; selfie cleanup job; polish.

### 11.1 Acceptance tests (automated, must pass)

- [ ] Bill of ₹750 paid ₹700 creates a ₹50 due; next visit in the other salon shows ₹50 and adds it to the total.
- [ ] Active prime member gets prime prices in both salons; expired member gets standard prices.
- [ ] Selling prime on a bill applies prime prices to that same bill.
- [ ] Price lowered from ₹500 to ₹400 creates a flag; no approval blocks billing.
- [ ] ₹1,000 service with 2 staff and 10% bill discount credits ₹450 each.
- [ ] Split payment ₹300 cash + ₹450 GPay closes a ₹750 bill with no due.
- [ ] Team member cannot edit a closed bill, read another salon's bills, or see other staff's credit.
- [ ] Day closing example in 6.4 gives expected ₹4,350 and flags a ₹50 short.
- [ ] Day cannot close while a visit is open; closed day rejects new bills and expenses.
- [ ] Check-in from 300 m away is rejected; check-in inside 100 m with a selfie succeeds.
- [ ] Incentive example in 7.4 gives ₹500 above the gate and ₹0 below it.
- [ ] Payslip example in 7.4 gives net ₹10,081.
- [ ] Every edit, void, cancel and reopen appears in the audit log with before/after values.

### 11.2 Decisions to confirm (defaults used in this PRD)

Confirmed on 3 Oct 2026: the ₹2.5 lakh gate applies to each salon separately; every staff member works a minimum of 9 hours a day with no overtime pay; one paid weekly off, with every other day off deducted; 15-minute grace per day. The remaining rows are still defaults.

| Decision | Default |
| --- | --- |
| Day rate method | Salary ÷ expected working days in that month |
| Paid leaves per month | 0: one paid weekly off only, every other day off is deducted (manager can mark a day as paid leave) |
| Late / early grace | 15 min per day, late-in and early-out combined (confirmed) |
| Half day threshold | Worked < 50% of shift; under 2 h = absent |
| ₹2.5 lakh gate | Per salon, on net services + product sales, excluding membership fees (confirmed: each salon on its own) |
| Product sales in staff credit | No (tracked per seller, not in incentive) |
| Staff see their own credit and target | Yes |
| Geo-fence radius | 100 m |
| Selfie retention | 90 days |
| Prime fee | To be provided |

### 11.3 Data you need to provide before phase 2

- [ ] Price list: service, category, standard price, prime price
- [ ] Product list: name, selling price, opening stock per salon
- [ ] Staff list: name, Gmail, salon, monthly salary, shift times, weekly off day
- [ ] Both salons' addresses (the app captures exact GPS when a manager stands in each salon and taps "Set location")
- [ ] Prime membership fee; existing prime members with start and expiry dates
- [ ] Existing clients with pending dues (entered manually by phone number)
