import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseServiceRows } from '../src/lib/serviceImport.ts'

test('parses tab-separated rows pasted from a spreadsheet, with a header row', () => {
  const r = parseServiceRows('Category\tService\tFor\tPrice\tPrime price\tNote\nHair Treatment\tScalp Detox\tboth\t1200\t1080\t\nFacial\tGlow\tWomen\t₹2,500\t\t')
  assert.deepEqual(r.errors, [])
  assert.equal(r.rows.length, 2)
  assert.deepEqual(r.rows[0], { line: 2, category: 'Hair Treatment', name: 'Scalp Detox', gender: 'both', price: 120000, prime: 108000, hint: null })
  assert.equal(r.rows[1].gender, 'women')
  assert.equal(r.rows[1].price, 250000)          // ₹ sign and thousands comma are accepted
  assert.equal(r.rows[1].prime, null)
})

test('parses comma-separated rows, quoted notes with commas, and open prices', () => {
  const r = parseServiceRows('Hair Color - Global,Fashion Shade,women,,,"4,000 onwards"')
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.rows[0], { line: 1, category: 'Hair Color - Global', name: 'Fashion Shade', gender: 'women', price: null, prime: null, hint: '4,000 onwards' })
})

test('gender words are forgiving; a blank means everyone', () => {
  const r = parseServiceRows('A,One,male,100\nA,Two,Ladies,100\nA,Three,,100\nA,Four,UNISEX,100')
  assert.deepEqual(r.rows.map((x) => x.gender), ['men', 'women', 'both', 'both'])
})

test('reports each bad line without losing the good ones', () => {
  const r = parseServiceRows('A,Good,both,100\n,NoCategory,both,100\nA,BadGender,kids,100\nA,BadPrice,both,12abc\nA,PrimeNoPrice,both,,50\nA,PrimeHigh,both,100,150\n\nA,AlsoGood,men,50.5')
  assert.equal(r.rows.length, 2)
  assert.deepEqual(r.errors.map((e) => e.line), [2, 3, 4, 5, 6])
  assert.equal(r.rows[1].price, 5050)
})

test('empty input gives nothing', () => {
  assert.deepEqual(parseServiceRows('  \n \n'), { rows: [], errors: [] })
})
