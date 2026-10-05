import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import CheckInCard from '../components/CheckInCard'
import InstallPrompt from '../components/InstallPrompt'
import { Card, Screen } from '../components/ui'
import { useBranches } from '../lib/api'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

const greeting = () => {
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Home() {
  const { staff, isManager } = useAuth()
  const salon = useBranches().data?.find((b) => b.id === staff?.branch_id)
  const flags = useQuery({
    queryKey: ['flag-count'], enabled: isManager,
    queryFn: async () => (await supabase.from('flags').select('id', { count: 'exact', head: true }).is('seen_at', null)).count ?? 0,
  })
  const open = useQuery({
    queryKey: ['open-visit-count'],
    queryFn: async () => (await supabase.from('visits').select('id', { count: 'exact', head: true }).eq('status', 'open')).count ?? 0,
  })
  const first = (staff?.name || staff?.email || '').split(' ')[0]
  return (
    <Screen title="HairrCraftt">
      <div className="flex items-center gap-3 px-1">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-violet-100 text-lg font-bold text-violet-700">{first.charAt(0).toUpperCase()}</div>
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold leading-tight">{greeting()}, {first}</div>
          {salon && <div className="text-sm text-gray-500">{salon.code} · {salon.name}</div>}
        </div>
      </div>
      <InstallPrompt />
      <CheckInCard />
      <Link to="/visit/new" className="flex min-h-16 w-full items-center justify-center rounded-2xl bg-violet-600 text-lg font-bold text-white shadow-sm active:bg-violet-700">+ New visit</Link>
      <div className="grid grid-cols-2 gap-3">
        <Link to="/visits" className="block"><Card className="h-full"><div className="text-sm text-gray-500">Open visits</div><div className="text-3xl font-bold">{open.data ?? '…'}</div></Card></Link>
        {isManager && (
          <Link to="/dashboard" className="block"><Card className="h-full"><div className="text-sm text-gray-500">Dashboard</div>
            <div className={`text-lg font-bold ${flags.data ? 'text-red-600' : 'text-green-700'}`}>{flags.data ? `${flags.data} new flag${flags.data > 1 ? 's' : ''}` : 'All clear'}</div></Card></Link>
        )}
      </div>
    </Screen>
  )
}
