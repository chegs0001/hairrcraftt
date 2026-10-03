import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Card, GhostButton, Screen } from '../components/ui'

export default function More() {
  const { isManager, signOut } = useAuth()
  const link = 'block min-h-12 py-3 text-violet-700'
  return (
    <Screen title="More">
      <Card>
        <Link className={link} to="/clients">Clients</Link>
        <Link className={link} to="/expense">Expenses</Link>
        <Link className={link} to="/advance">Salary advance</Link>
        <Link className={link} to="/close-day">Close day</Link>
      </Card>
      {isManager && (
        <Card>
          <div className="font-semibold">Manager</div>
          <Link className={link} to="/services">Services and prices</Link>
          <Link className={link} to="/staff">Staff</Link>
          <Link className={link} to="/salons">Salons</Link>
          <Link className={link} to="/settings">Settings</Link>
        </Card>
      )}
      <GhostButton onClick={signOut} className="w-full">Sign out</GhostButton>
    </Screen>
  )
}
