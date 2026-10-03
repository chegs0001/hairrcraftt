import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Card, Screen } from '../components/ui'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

export default function Home() {
  const { staff } = useAuth()
  const open = useQuery({
    queryKey: ['open-visit-count'],
    queryFn: async () => (await supabase.from('visits').select('id', { count: 'exact', head: true }).eq('status', 'open')).count ?? 0,
  })
  return (
    <Screen title="Home">
      <Card>
        <div className="text-sm text-gray-500">Signed in as</div>
        <div className="text-lg font-semibold">{staff?.name || staff?.email}</div>
      </Card>
      <Link to="/visit/new" className="flex min-h-16 w-full items-center justify-center rounded-2xl bg-violet-600 text-lg font-bold text-white">New visit</Link>
      <Link to="/visits"><Card className="flex items-center justify-between"><span>Open visits</span><span className="text-xl font-bold">{open.data ?? '…'}</span></Card></Link>
      <p className="text-sm text-gray-500">Attendance, cash and the dashboard arrive in the next phases.</p>
    </Screen>
  )
}
