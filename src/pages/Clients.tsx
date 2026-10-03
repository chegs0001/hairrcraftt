import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import ClientCard from '../components/ClientCard'
import { BackLink, inputCls, Screen } from '../components/ui'
import { supabase } from '../lib/supabase'
import type { Client } from '../lib/types'

export default function Clients() {
  const [q, setQ] = useState('')
  const term = q.trim()
  const { data } = useQuery({
    queryKey: ['client-search', term],
    enabled: term.length >= 3,
    queryFn: async () => {
      const isNum = /^\d+$/.test(term)
      const query = supabase.from('clients').select('*').limit(20)
      return (await (isNum ? query.like('phone', `%${term}%`) : query.ilike('name', `%${term}%`))).data as Client[]
    },
  })
  return (
    <Screen title="Clients" back={<BackLink to="/more" />}>
      <input className={inputCls} placeholder="Search by name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      {data?.map((c) => <ClientCard key={c.id} client={c} link />)}
      {term.length >= 3 && data?.length === 0 && <p className="text-gray-500">No clients found.</p>}
    </Screen>
  )
}
