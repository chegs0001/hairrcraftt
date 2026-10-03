import { useAuth } from '../lib/auth'
import { isConfigured } from '../lib/supabase'
import { Button, Card } from '../components/ui'

export default function Login() {
  const { signIn } = useAuth()
  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="text-center">
        <div className="text-3xl font-extrabold text-violet-700">HairrCraftt</div>
        <div className="text-gray-500">Salon Manager</div>
      </div>
      {!isConfigured && (
        <Card className="border-amber-300 bg-amber-50 text-sm">
          Supabase is not configured. Copy <b>.env.example</b> to <b>.env</b> and fill in the project URL and anon key.
        </Card>
      )}
      <Button onClick={signIn} disabled={!isConfigured}>Continue with Google</Button>
    </div>
  )
}
