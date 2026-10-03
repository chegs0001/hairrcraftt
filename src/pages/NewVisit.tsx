import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ClientCard from '../components/ClientCard'
import { ActionBar, BackLink, Button, inputCls, Screen } from '../components/ui'
import { rpc } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { Client, Visit } from '../lib/types'

export default function NewVisit() {
  const nav = useNavigate()
  const [phone, setPhone] = useState('')
  const ready = phone.length === 10

  const found = useQuery({
    queryKey: ['client-by-phone', phone],
    enabled: ready,
    queryFn: async () => (await supabase.from('clients').select('*').eq('phone', phone).maybeSingle()).data as Client | null,
  })
  const openVisit = useQuery({
    queryKey: ['open-visit', found.data?.id],
    enabled: !!found.data,
    queryFn: async () =>
      (await supabase.from('visits').select('id').eq('client_id', found.data!.id).eq('status', 'open').maybeSingle()).data as { id: string } | null,
  })

  const [name, setName] = useState('')
  const [gender, setGender] = useState('')
  const [birthday, setBirthday] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const start = useMutation({
    mutationFn: async () => {
      let client = found.data
      if (!client) {
        const { data, error } = await supabase.from('clients')
          .insert({ phone, name: name.trim(), gender: gender || null, birthday: birthday || null, notes: notes.trim() || null })
          .select('*').single()
        if (error) throw new Error(error.message)
        client = data as Client
      }
      return rpc<Visit>('start_visit', { p_client: client.id })
    },
    onSuccess: (v) => nav(`/visit/${v.id}`, { replace: true }),
    onError: (e: Error) => setError(e.message),
  })

  return (
    <Screen title="New visit" back={<BackLink to="/" />}>
      <label className="block text-sm">Client phone (10 digits)
        <input className={`${inputCls} text-2xl tracking-widest`} inputMode="numeric" autoFocus value={phone}
          onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError('') }} />
      </label>

      {ready && found.isSuccess && found.data && <ClientCard client={found.data} />}

      {ready && found.isSuccess && !found.data && (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">New client. Add their details.</p>
          <label className="block text-sm">Name
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">Gender
              <select className={inputCls} value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option>
              </select>
            </label>
            <label className="block text-sm">Birthday
              <input className={inputCls} type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            </label>
          </div>
          <label className="block text-sm">Notes
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <ActionBar>
        {openVisit.data ? (
          <Link to={`/visit/${openVisit.data.id}`} className="flex min-h-12 w-full items-center justify-center rounded-xl bg-violet-600 font-semibold text-white">
            Open existing visit
          </Link>
        ) : (
          <Button disabled={!ready || found.isLoading || start.isPending || (!found.data && !name.trim())} onClick={() => start.mutate()}>
            Start visit
          </Button>
        )}
      </ActionBar>
    </Screen>
  )
}
