import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import CheckInCard from '../components/CheckInCard'
import InstallPrompt from '../components/InstallPrompt'
import { Card, Screen } from '../components/ui'
import { useBranches } from '../lib/api'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

export default function Home() {
  const { staff, isManager } = useAuth()
  const flags = useQuery({
    queryKey: ['flag-count'], enabled: isManager,
    queryFn: async () => (await supabase.from('flags').select('id', { count: 'exact', head: true }).is('seen_at', null)).count ?? 0,
  })
  const salon = useBranches().data?.find((b) => b.id === staff?.branch_id)
  const open = useQuery({
    queryKey: ['open-visit-count'],
    queryFn: async () => (await supabase.from('visits').select('id', { count: 'exact', head: true }).eq('status', 'open')).count ?? 0,
  })
  return (
    <Screen title="Home">
      <Card>
        <div className="text-sm text-gray-500">Signed in as</div>
        <div className="text-lg font-semibold">{staff?.name || staff?.email}</div>
        {salon && <div className="mt-1 inline-block rounded-md bg-violet-100 px-2 py-0.5 text-sm font-medium text-violet-800">{salon.code} · {salon.name}</div>}
      </Card>
      <InstallPrompt />
      <CheckInCard />
      {isManager && (
        <Link to="/dashboard"><Card className="flex items-center justify-between"><span className="font-semibold">Dashboard</span><span className="text-sm text-gray-600">{flags.data ? <b className="text-red-600">{flags.data} new flags</b> : 'all clear'}</span></Card></Link>
      )}
      <Link to="/visit/new" className="flex min-h-16 w-full items-center justify-center rounded-2xl bg-violet-600 text-lg font-bold text-white">New visit</Link>
      <Link to="/visits"><Card className="flex items-center justify-between"><span>Open visits</span><span className="text-xl font-bold">{open.data ?? '…'}</span></Card></Link>
    </Screen>
  )
}
