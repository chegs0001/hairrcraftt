import { rupees, shortDate } from './format'

export interface ReceiptInput {
  salon: string
  billNo: string
  date: string
  lines: { name: string; qty: number; total: number }[]
  discount: number
  membershipFee: number
  previousDue: number
  paid: number
  balanceDue: number
}

export function receiptText(r: ReceiptInput) {
  const rows = r.lines.map((l) => `• ${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''} — ${rupees(l.total)}`)
  const out = [`*${r.salon}*`, `Bill ${r.billNo} · ${shortDate(r.date)}`, '', ...rows]
  if (r.membershipFee) out.push(`• Prime Membership — ${rupees(r.membershipFee)}`)
  if (r.discount) out.push(`Discount: −${rupees(r.discount)}`)
  if (r.previousDue) out.push(`Previous due: ${rupees(r.previousDue)}`)
  out.push('', `Paid: ${rupees(r.paid)}`)
  out.push(r.balanceDue > 0 ? `Balance due: ${rupees(r.balanceDue)}` : 'No balance due. Thank you!')
  return out.join('\n')
}

export const whatsappLink = (phone: string, text: string) =>
  `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
