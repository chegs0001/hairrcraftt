// Parses pasted rows (from Excel/Sheets or a CSV) into services.
// Columns: Category, Service, For (men/women/both), Price, Prime price, Note. Price blank = open price.
export type Gender = 'men' | 'women' | 'both'

export interface ImportRow {
  line: number
  category: string
  name: string
  gender: Gender
  price: number | null   // paise; null = open price
  prime: number | null   // paise
  hint: string | null
}
export interface ParseResult { rows: ImportRow[]; errors: { line: number; message: string }[] }

function split(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { out.push(cur.trim()); cur = '' }
    else cur += ch
  }
  out.push(cur.trim())
  return out
}

const money = (v: string): number | null | 'bad' => {
  const t = v.replace(/[₹,\s]/g, '')
  if (t === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'bad'
  return Math.round(Number(t) * 100)
}

const gender = (v: string): Gender | null => {
  const t = v.trim().toLowerCase()
  if (['', 'both', 'all', 'unisex', 'b'].includes(t)) return 'both'
  if (['men', 'man', 'male', 'gents', 'm'].includes(t)) return 'men'
  if (['women', 'woman', 'female', 'ladies', 'w', 'f'].includes(t)) return 'women'
  return null
}

export function parseServiceRows(text: string): ParseResult {
  const rows: ImportRow[] = []
  const errors: ParseResult['errors'] = []
  const delim = text.includes('\t') ? '\t' : ','
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = idx + 1
    if (!raw.trim()) return
    const c = split(raw, delim)
    if (idx === 0 && /^category$/i.test(c[0])) return          // header row
    const [category = '', name = '', forWho = '', priceRaw = '', primeRaw = '', note = ''] = c
    if (!category || !name) return void errors.push({ line, message: 'Category and service name are both needed' })
    const g = gender(forWho)
    if (!g) return void errors.push({ line, message: `"${forWho}" is not men, women or both` })
    const price = money(priceRaw)
    const prime = money(primeRaw)
    if (price === 'bad') return void errors.push({ line, message: `Price "${priceRaw}" is not a number` })
    if (prime === 'bad') return void errors.push({ line, message: `Prime price "${primeRaw}" is not a number` })
    if (prime !== null && price === null) return void errors.push({ line, message: 'A prime price needs a normal price too' })
    if (prime !== null && price !== null && prime > price) return void errors.push({ line, message: 'Prime price is higher than the normal price' })
    rows.push({ line, category, name, gender: g, price, prime, hint: note || null })
  })
  return { rows, errors }
}

export const TEMPLATE_CSV = [
  'Category,Service,For,Price,Prime price,Note',
  'Hair Treatment,Scalp Detox,both,1200,1080,',
  'Hair Color - Global,Fashion Shade,women,,,"4,000 onwards"',
].join('\n')
