import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
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
          options: { data: { full_name: fullName } },
        })
      : await supabase.auth.signInWithPassword({ email, password })

    setMessage(result.error?.message ?? (mode === 'signup'
      ? 'Account created. Check your email if confirmation is enabled.'
      : 'Signed in.'))
    setSubmitting(false)
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">LNX Systems</p>
        <h1>Restaurant Operations</h1>
        <p className="muted">Floor, cash, tasks, rewards, and reporting.</p>

        {mode === 'signup' && (
          <label>Full name
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
        )}

        <label>Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
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
