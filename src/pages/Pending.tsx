import { useAuth } from '../lib/auth'
import { Button, GhostButton } from '../components/ui'

export default function Pending() {
  const { staff, session, refresh, signOut } = useAuth()
  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-bold">Waiting for approval</h1>
      <p className="text-gray-600">
        {staff?.email ?? session?.user.email} has been sent to the manager. You can use the app once they approve you.
      </p>
      <Button onClick={refresh}>Check again</Button>
      <GhostButton onClick={signOut}>Sign out</GhostButton>
    </div>
  )
}
