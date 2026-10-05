// Forgiving search: tolerates typos, missing or extra spaces, partial words and dropped letters.
// Every word of the query must match something; better matches rank first.

export const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').replace(/\s+/g, ' ').trim()

// Edit distance counting a swapped pair of letters as one edit; gives up (returns max + 1) past `max`.
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

const isSubsequence = (q: string, t: string) => {
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length
}

// How well one query word matches a name (0 = not at all)
function wordScore(q: string, words: string[], compact: string): number {
  let best = 0
  for (const t of words) {
    let s = 0
    if (t === q) s = 100
    else if (t.startsWith(q)) s = 85
    else if (q.length >= 2 && t.includes(q)) s = 65
    else {
      const allow = q.length <= 3 ? 0 : q.length <= 5 ? 1 : 2
      if (allow > 0) {
        const d = Math.min(distance(q, t, allow), distance(q, t.slice(0, q.length), allow))
        if (d <= allow) s = 55 - d * 10
      }
      if (!s && q.length >= 4 && t.length <= q.length * 2.5 && isSubsequence(q, t)) s = 25   // "hcut" finds haircut
    }
    best = Math.max(best, s)
  }
  if (q.length >= 3 && compact.includes(q)) best = Math.max(best, 60)                          // spaces ignored
  return best
}

function fieldScore(query: string, text: string): number {
  const name = normalize(text)
  if (!name) return 0
  const words = name.split(' ')
  const compact = name.replace(/ /g, '')
  const parts = query.split(' ')
  let total = 0
  for (const p of parts) {
    const s = wordScore(p, words, compact)
    if (!s) {
      // the whole query with its spaces removed may match the name ("hair cut" vs "haircut")
      const squashed = query.replace(/ /g, '')
      if (parts.length > 1 && squashed.length >= 4) {
        if (compact.includes(squashed)) return 70
        const d = distance(squashed, compact.slice(0, squashed.length), 2)
        if (d <= 1) return 50
      }
      return 0
    }
    total += s
  }
  let score = total / parts.length
  if (name.startsWith(query)) score += 10
  else if (name.includes(query)) score += 5
  return score
}

/** 0 = no match. The first field is the main name; later fields (category, note) count for less. */
export function searchScore(query: string, fields: string[]): number {
  const q = normalize(query)
  if (!q) return 1
  let best = 0
  fields.forEach((f, i) => { best = Math.max(best, fieldScore(q, f) * (i === 0 ? 1 : 0.6)) })
  return best
}

export function fuzzyFilter<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!normalize(query)) return items
  return items
    .map((item, i) => ({ item, i, score: searchScore(query, fields(item)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item)
}
