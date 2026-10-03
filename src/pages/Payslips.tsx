import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BackLink, Card, Screen } from '../components/ui'
import { rupees } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { PayrollLine } from '../lib/types'

export default function Payslips() {
  const { data } = useQuery({
    queryKey: ['my-payslips'],
    queryFn: async () => (await supabase.from('payroll_lines').select('*,payroll_runs(month)').order('created_at', { ascending: false })).data as unknown as (PayrollLine & { payroll_runs: { month: string } | null })[],
  })
  return (
    <Screen title="My payslips" back={<BackLink to="/more" />}>
      {data?.length === 0 && <p className="text-gray-500">No payslips yet. They appear after the manager finalises payroll.</p>}
      {data?.map((l) => (
        <Link key={l.id} to={`/payslip/${l.id}`}>
          <Card className="mb-3 flex items-center justify-between">
            <div><div className="font-semibold">{l.payroll_runs ? new Date(l.payroll_runs.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'Payslip'}</div>
              <div className="text-xs text-gray-500">{l.paid_at ? 'Paid' : 'Not paid yet'}</div></div>
            <div className="text-lg font-bold">{rupees(l.net_pay)}</div>
          </Card>
        </Link>
      ))}
    </Screen>
  )
}
