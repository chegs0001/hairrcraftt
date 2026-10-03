// Money is integer paise everywhere; display as whole rupees in Indian grouping.
export const rupees = (paise: number) =>
  '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(paise / 100))

export const toPaise = (rupeesInput: number) => Math.round(rupeesInput * 100)

export const shortDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// True on the client's birthday (IST). 29 Feb birthdays count on 28 Feb in common years.
export function isBirthdayToday(birthday: string | null | undefined) {
  if (!birthday) return false
  const [, bm, bd] = birthday.split('-').map(Number)
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).split('-').map(Number)
  if (bm === m && bd === d) return true
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  return bm === 2 && bd === 29 && m === 2 && d === 28 && !leap
}
