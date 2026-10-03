import { Link } from 'react-router-dom'
import { useBirthdayPct, useClientCard } from '../lib/api'
import { isBirthdayToday, rupees, shortDate } from '../lib/format'
import type { Client } from '../lib/types'
import { Card } from './ui'

const daysUntil = (d: string) =>
  Math.ceil((new Date(d + 'T00:00:00+05:30').getTime() - Date.now()) / 86_400_000)

export default function ClientCard({ client, link }: { client: Client; link?: boolean }) {
  const { data } = useClientCard(client)
  const bdayPct = useBirthdayPct().data ?? 20
  const prime = data?.card?.prime_until
  const balance = data?.card?.balance ?? 0
  const left = prime ? daysUntil(prime) : null
  const title = (
    <div>
      <div className="text-lg font-bold">{client.name}</div>
      <div className="text-sm text-gray-500">{client.phone}</div>
    </div>
  )
  return (
    <Card className="space-y-2">
      {link ? <Link to={`/client/${client.id}`}>{title}</Link> : title}
      <div className="flex flex-wrap gap-2 text-sm">
        {prime ? (
          <span className="rounded-full bg-violet-100 px-3 py-1 font-medium text-violet-800">
            Prime · {left !== null && left < 30 ? `expires in ${left} days` : `until ${shortDate(prime)}`}
          </span>
        ) : (
          <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-600">Not Prime</span>
        )}
        {isBirthdayToday(client.birthday) && <span className="rounded-full bg-pink-100 px-3 py-1 font-medium text-pink-700">🎂 Birthday today · {bdayPct}% off</span>}
        {balance > 0 && <span className="rounded-full bg-red-100 px-3 py-1 font-medium text-red-700">Due {rupees(balance)}</span>}
        {balance < 0 && <span className="rounded-full bg-green-100 px-3 py-1 font-medium text-green-700">Credit {rupees(-balance)}</span>}
      </div>
      {data && data.history.length > 0 && (
        <div className="text-sm text-gray-600">
          <div className="mb-1 text-gray-500">Last visit {shortDate(data.history[0].billed_on)}</div>
          {data.history.map((h, i) => (
            <div key={i} className="flex justify-between"><span>{h.service_name}</span><span>{rupees(h.price)}</span></div>
          ))}
        </div>
      )}
      {client.notes && <div className="text-sm text-gray-500">Note: {client.notes}</div>}
    </Card>
  )
}
