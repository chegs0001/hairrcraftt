import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fuzzyFilter, searchScore } from '../src/lib/search.ts'

const services = ['Haircut', 'Kids Haircut', 'Haircut (with Wash)', 'Facial', 'Basic Facial (Fruit, Lotus, Vlcc, Shahnaz)', 'CleanUp', 'Keratin Treatment',
  'Basic Manicure', 'Crystal Pedicure', 'Hair Color - Global', 'Loreal Hair Spa', 'Head Massage (with Hairwash)', 'Full Body Bleach', 'DeTan', 'O3 Shine & Glow']
const find = (q) => fuzzyFilter(services, q, (s) => [s])

test('exact and partial words still work, best match first', () => {
  assert.equal(find('haircut')[0], 'Haircut')
  for (const s of ['Haircut', 'Kids Haircut', 'Haircut (with Wash)', 'Hair Color - Global', 'Loreal Hair Spa']) assert.ok(find('hair').includes(s), s)
  assert.ok(find('pedi').includes('Crystal Pedicure'))
  assert.ok(find('FACIAL').includes('Facial'))
})

test('misspellings and swapped letters are forgiven', () => {
  assert.ok(find('facail').includes('Facial'))
  assert.ok(find('keretin').includes('Keratin Treatment'))
  assert.ok(find('mnicure').includes('Basic Manicure'))
  assert.ok(find('pedicur').includes('Crystal Pedicure'))
  assert.ok(find('haircutt').includes('Haircut'))
  assert.ok(find('colour').includes('Hair Color - Global'))
  assert.ok(find('blech').includes('Full Body Bleach'))
})

test('extra or missing spaces are forgiven', () => {
  assert.ok(find('hair cut').includes('Haircut'))
  assert.ok(find('clean up').includes('CleanUp'))
  assert.ok(find('hair wash').includes('Head Massage (with Hairwash)'))
  assert.ok(find('de tan').includes('DeTan'))
})

test('dropped letters and abbreviations help', () => {
  assert.ok(find('hcut').includes('Haircut'))
  assert.ok(find('o3').includes('O3 Shine & Glow'))
})

test('every word must match, and unrelated text finds nothing', () => {
  assert.deepEqual(find('zzzz'), [])
  assert.ok(!find('kids facial').includes('Kids Haircut'))
  assert.deepEqual(find('xyz abc'), [])
})

test('ranking puts exact matches before fuzzy ones; empty query returns everything in order', () => {
  const r = find('facial')
  assert.ok(r.indexOf('Facial') < r.indexOf('Basic Facial (Fruit, Lotus, Vlcc, Shahnaz)'))
  assert.deepEqual(find('  '), services)
})

test('secondary fields (category) match but rank below the name', () => {
  const items = [{ n: 'Wash', c: 'Haircut' }, { n: 'Haircut', c: 'Basic' }]
  const r = fuzzyFilter(items, 'haircut', (x) => [x.n, x.c])
  assert.equal(r[0].n, 'Haircut')
  assert.equal(r.length, 2)
  assert.ok(searchScore('haircut', ['Wash', 'Haircut']) < searchScore('haircut', ['Haircut', 'Wash']))
})
