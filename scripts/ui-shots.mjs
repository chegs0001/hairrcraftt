// Renders the real app against fake data and saves phone-sized screenshots.
//   node scripts/ui-shots.mjs [outDir] [filter]
// Starts its own dev server on :5199. Screenshots are for looking at, not committed.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { ids, rpc, tables } from './ui-fixtures.mjs'

const out = process.argv[2] ?? 'ui-shots'
const only = process.argv[3]
mkdirSync(out, { recursive: true })
const PORT = 5199
const SB = 'https://mock.supabase.co'

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  env: { ...process.env, VITE_SUPABASE_URL: SB, VITE_SUPABASE_ANON_KEY: 'sb_publishable_mock' }, stdio: 'ignore' })
const up = async () => { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) return } catch { /* wait */ } await new Promise((r) => setTimeout(r, 500)) } throw new Error('dev server did not start') }
await up()

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-IN', timezoneId: 'Asia/Kolkata',
  geolocation: { latitude: 19.076, longitude: 72.8777, accuracy: 20 }, permissions: ['geolocation'] })

const user = { id: ids.admin, aud: 'authenticated', role: 'authenticated', email: 'cheragverma0001@gmail.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
const session = { access_token: 'mock', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'mock', user }
await ctx.addInitScript(([s, on]) => { if (on) localStorage.setItem('sb-mock-auth-token', JSON.stringify(s)); localStorage.setItem('install-prompt-dismissed', '1') }, [session, true])

const filterRows = (rows, params) => {
  let r = rows
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'or', 'offset'].includes(k)) continue
    const m = v.match(/^(eq|neq|is|in|not\.is)\.(.*)$/)
    if (!m) continue
    const [, op, val] = m
    if (op === 'eq') r = r.filter((x) => String(x[k]) === val)
    else if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); r = r.filter((x) => set.includes(String(x[k]))) }
  }
  return r
}
await ctx.route(`${SB}/**`, async (route) => {
  const req = route.request(); const url = new URL(req.url())
  const json = (body, headers = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) })
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  if (url.pathname.startsWith('/auth/v1/user')) return json(user)
  if (url.pathname.startsWith('/auth/v1/')) return json({ ...session, user })
  const fn = url.pathname.match(/\/rest\/v1\/rpc\/(.+)$/)
  if (fn) { const v = rpc[fn[1]]; return json(v ?? []) }
  const t = url.pathname.match(/\/rest\/v1\/(.+)$/)
  if (t) {
    const rows = filterRows(tables[t[1]] ?? [], url.searchParams)
    const single = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object')
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `0-0/${rows.length}`, 'access-control-allow-origin': '*' } })
    if (req.method() !== 'GET') return json([], {})
    return single ? json(rows[0] ?? null) : json(rows, { 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` })
  }
  return route.fulfill({ status: 404, body: '{}' })
})

const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const shot = async (name, path, act) => {
  if (only && !name.includes(only)) return
  await page.goto(`http://localhost:${PORT}${path}`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(250)
  if (act) { await act(page); await page.waitForTimeout(250) }
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false })
  console.log('shot', name)
}
const full = async (name, path, act) => {
  if (only && !name.includes(only)) return
  await page.goto(`http://localhost:${PORT}${path}`)
  await page.waitForLoadState('networkidle'); await page.waitForTimeout(250)
  if (act) { await act(page); await page.waitForTimeout(250) }
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); console.log('full', name)
}
const type = (sel, text) => async (p) => { await p.locator(sel).first().fill(text) }

await shot('01-home', '/')
await shot('02-visit-new-empty', '/visit/new')
await shot('03-visit-new-existing', '/visit/new', type('input', '9000000001'))
await shot('04-visit-new-newclient', '/visit/new', type('input', '9000000099'))
await shot('05-visits', '/visits')
await full('06-visit-detail', `/visit/${ids.visit}`)
await shot('07-add-service', `/visit/${ids.visit}`, async (p) => { await p.getByText('+ Add service').click() })
await full('08-billing', `/visit/${ids.visit}/bill`)
await full('09-client', `/client/${ids.meera}`)
await shot('10-more', '/more')
await full('11-close-day', '/close-day')
await full('12-expense', '/expense')
await full('13-advance', '/advance')
await full('14-my-attendance', '/attendance/me')
await full('15-attendance', '/attendance')
await full('16-dashboard', '/dashboard')
await full('17-flags', '/flags')
await full('18-reports', '/reports')
await full('19-payroll', '/payroll', async (p) => { await p.getByText('Riya Sharma').first().click() })
await full('20-payslip', `/payslip/${ids.pl1}`)
await full('21-staff', '/staff')
await full('22-staff-form', '/staff', async (p) => { await p.getByText('Edit').first().click() })
await full('23-services', '/services')
await full('24-products', '/products')
await full('25-stock', '/stock')
await full('26-bills', '/bills')
await full('27-settings', '/settings')
await full('28-salons', '/salons')
await full('29-clients', '/clients', type('input', 'Meera'))
await full('30-payslips', '/payslips')

console.log(errors.length ? 'PAGE ERRORS:\n' + [...new Set(errors)].join('\n') : 'no page errors')
await browser.close(); server.kill()
