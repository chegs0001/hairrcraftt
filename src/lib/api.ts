import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Branch, Category, Client, Service, Staff } from './types'

// Call a Postgres function; money and permission rules live there.
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const useCatalogue = () =>
  useQuery({
    queryKey: ['catalogue'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [c, s] = await Promise.all([
        supabase.from('service_categories').select('*').order('sort'),
        supabase.from('services').select('*').order('sort'),
      ])
      if (c.error) throw c.error
      if (s.error) throw s.error
      return { categories: c.data as Category[], services: s.data as Service[] }
    },
  })

export const useTeam = () =>
  useQuery({
    queryKey: ['team'],
    queryFn: async () =>
      (await supabase.from('staff').select('*').eq('status', 'active').order('name')).data as Staff[],
  })

export const useBranches = () =>
  useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await supabase.from('branches').select('*').order('code')).data as Branch[],
  })

export interface ClientCardData {
  balance: number
  prime_until: string | null
}
export interface HistoryRow { service_name: string; price: number; qty: number; billed_on: string; branch_code: string }

export const useClientCard = (client?: Client | null) =>
  useQuery({
    queryKey: ['client-card', client?.id],
    enabled: !!client,
    queryFn: async () => {
      const [card, history] = await Promise.all([
        rpc<ClientCardData[]>('client_card', { p_client: client!.id }),
        rpc<HistoryRow[]>('client_history', { p_client: client!.id, p_limit: 3 }),
      ])
      return { card: card[0], history }
    },
  })

export const useBirthdayPct = () =>
  useQuery({
    queryKey: ['birthday-pct'],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      Number((await supabase.from('settings').select('value').eq('key', 'birthday_discount_pct').maybeSingle()).data?.value ?? 20),
  })
