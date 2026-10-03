import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Card, Screen } from '../components/ui'
import { supabase } from '../lib/supabase'

interface Row {
  id: string
  created_at: string
  clients: { name: string; phone: string }
  branches: { code: string }
  visit_lines: { id: string; status: string; done_at: string | null; kind: string }[]
}

export default function Visits() {
  const { data, isLoading } = useQuery({
    queryKey: ['open-visits'],
    refetchInterval: 20_000,
    queryFn: async () =>
      (await supabase.from('visits')
        .select('id,created_at,clients(name,phone),branches(code),visit_lines(id,status,done_at,kind)')
        .eq('status', 'open').order('created_at')).data as unknown as Row[],
  })
  return (
    <Screen title="Open visits">
      {isLoading && <p className="text-gray-500">Loading…</p>}
      {data?.length === 0 && <p className="text-gray-500">No open visits.</p>}
      {data?.map((v) => {
        const lines = v.visit_lines.filter((l) => l.status === 'active' && l.kind === 'service')
        const done = lines.filter((l) => l.done_at).length
        return (
          <Link key={v.id} to={`/visit/${v.id}`}>
            <Card className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-semibold">{v.clients.name}</div>
                <div className="text-sm text-gray-500">
                  {v.branches.code} · {new Date(v.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                </div>
              </div>
              <div className="text-sm text-gray-600">{done}/{lines.length} done</div>
            </Card>
          </Link>
        )
      })}
      <Link to="/visit/new"><Button className="mt-2">New visit</Button></Link>
    </Screen>
  )
}
