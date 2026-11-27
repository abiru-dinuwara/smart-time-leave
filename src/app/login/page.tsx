import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Icon } from '@/components/Icon'
import { Notice, one, type SP } from '@/components/ui'
import SubmitButton from '@/components/SubmitButton'

export const metadata = { title: 'Sign in' }

async function signIn(formData: FormData) {
  'use server'
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!email || !password) redirect('/login?error=' + encodeURIComponent('Enter your email and password.'))

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) redirect('/login?error=' + encodeURIComponent('Wrong email or password.'))
  redirect('/')
}

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams
  const error = one(sp.error)
  return (
    <div className="login">
      <form className="card" action={signIn}>
        <span className="logo"><Icon name="logo" size={20} /></span>
        <h1>Smart Time &amp; Leave</h1>
        <p className="muted" style={{ marginBottom: 18 }}>Sign in with your work account.</p>
        {error && <Notice kind="bad">{error}</Notice>}
        <div className="fld">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </div>
        <div className="fld">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton className="btn primary login-btn" pendingLabel="Signing in…">Sign in</SubmitButton>
        <p className="hint-line" style={{ marginTop: 14 }}>No account? Ask your administrator to invite you.</p>
      </form>
    </div>
  )
}
