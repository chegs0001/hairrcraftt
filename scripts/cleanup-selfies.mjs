// Deletes attendance selfies older than the retention setting (default 90 days) and clears their paths.
// The attendance records themselves stay. Run nightly by .github/workflows/selfie-cleanup.yml.
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Add --dry-run to only list what would be removed.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const dry = process.argv.includes('--dry-run')
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const sb = createClient(url, key, { auth: { persistSession: false } })

const { data: setting } = await sb.from('settings').select('value').eq('key', 'selfie_retention_days').maybeSingle()
const days = Number(setting?.value ?? 90)
const cutoff = new Date(Date.now() - days * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

const { data: rows, error } = await sb.from('attendance').select('id,in_photo,out_photo')
  .lt('date', cutoff).or('in_photo.not.is.null,out_photo.not.is.null').limit(1000)
if (error) { console.error(error.message); process.exit(1) }

const paths = rows.flatMap((r) => [r.in_photo, r.out_photo]).filter(Boolean)
console.log(`${paths.length} selfies older than ${days} days (before ${cutoff})`)
if (dry || paths.length === 0) process.exit(0)

for (let i = 0; i < paths.length; i += 100) {
  const { error: rmErr } = await sb.storage.from('selfies').remove(paths.slice(i, i + 100))
  if (rmErr) { console.error('Storage delete failed:', rmErr.message); process.exit(1) }
}
const { error: upErr } = await sb.from('attendance').update({ in_photo: null, out_photo: null }).in('id', rows.map((r) => r.id))
if (upErr) { console.error(upErr.message); process.exit(1) }
console.log('Done')
