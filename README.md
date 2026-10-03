# HairrCraftt Salon Manager

See `HairrCraftt Salon Manager — PRD.md`. Price list source: `services.json` (imported in phase 2).

## Setup (phase 1)
1. Create a Supabase project. In the SQL editor run, in order, `supabase/migrations/0001_foundation.sql`, `0002_clients_billing.sql`, `0003_seed_services.sql`, `0004_cash.sql`, `0005_hardening.sql`, `0006_birthday_discount.sql`, `0007_attendance.sql`, `0008_dashboard.sql`, `0009_payroll.sql`. (0007 also creates the private `selfies` bucket and, if pg_cron is on, the 23:45 auto-close job.) (0004 also creates the private `receipts` storage bucket and, if pg_cron is enabled, the 23:00 unclosed-day job.)
2. Auth → Providers → enable Google. Add your site URL (and `http://localhost:5173`) to Auth → URL configuration.
3. `cp .env.example .env` and fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. `npm install && npm run dev`. Sign in as cheragverma0001@gmail.com: that email is auto-approved as the first manager.
5. Deploy: Cloudflare Pages, build command `npm run build`, output `dist`, set the two env vars.
6. Backups: add repo secret `SUPABASE_DB_URL` (the Postgres connection string) for `.github/workflows/backup.yml`.

## Tests
`npm test` runs every migration in an in-memory Postgres (PGlite) and checks the PRD billing, prime, dues, split-credit and permission rules. No Supabase needed.

`node scripts/gen-services-seed.mjs` regenerates `0003_seed_services.sql` from `services.json`.

## Conventions
Money is integer paise. Dates are Asia/Kolkata. No hard deletes on money or attendance. Server functions own all totals.
