import { ScreenText } from "../components/ScreenText"
import { registrationToken } from '../components/SignupGate'
import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>(registrationToken() ? 'signup' : 'signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')

    const result = mode === 'signup'
      ? await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName.trim(), registration_token: registrationToken() },
            emailRedirectTo: window.location.origin + '/',
          },
        })
      : await supabase.auth.signInWithPassword({ email, password })

    setMessage(result.error?.message ?? (mode === 'signup'
      ? 'Check your email to confirm your account. Then sign in and wait for GM approval.'
      : 'Signed in.'))
    setSubmitting(false)
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow"><ScreenText id="LoginPage.262da4df982b420d">LNX Systems</ScreenText></p>
        <h1><ScreenText id="LoginPage.3148730a11c9bc5a">Restaurant Operations</ScreenText></h1>
        <p className="muted"><ScreenText id="LoginPage.52160d77f0dfc05a">Floor, cash, tasks, rewards, and reporting.</ScreenText></p>

        {mode === 'signup' && <p><ScreenText id="LoginPage.aa65239e06fea8f7">Your GM must approve location access after signup.</ScreenText></p>}
        {mode === 'signup' && (
          <label><ScreenText id="LoginPage.cd3c2c8d0734931c">Full name
            </ScreenText><input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
        )}

        <label><ScreenText id="LoginPage.8289cea56ff0acd8">Email
          </ScreenText><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label><ScreenText id="LoginPage.09ac59f7c65f1dec">Password
          </ScreenText><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>

        <button className="primary-button" disabled={submitting}>
          {submitting ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button type="button" className="text-button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}
        </button>

        {message && <p className="form-message">{message}</p>}
      </form>
    </div>
  )
}