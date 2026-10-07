// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
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
    <div data-design-block="copy.8ae503244a6652a1.1" className="auth-page">
      <form data-design-block="copy.af82841b591cb2d9.1" className="auth-card" onSubmit={submit}>
        <p data-design-block="copy.0d4d7eb9ee5f6f7e.1" className="eyebrow"><ScreenText id="LoginPage.262da4df982b420d">LNX Systems</ScreenText></p>
        <h1 data-design-block="copy.1e8e41bc62d95308.1"><ScreenText id="LoginPage.3148730a11c9bc5a">Restaurant Operations</ScreenText></h1>
        <p data-design-block="copy.0d1ff4ea27de07af.1" className="muted"><ScreenText id="LoginPage.52160d77f0dfc05a">Floor, cash, tasks, rewards, and reporting.</ScreenText></p>

        {mode === 'signup' && <p data-design-block="copy.60252d15d462e4e3.1"><ScreenText id="LoginPage.aa65239e06fea8f7">Your GM must approve location access after signup.</ScreenText></p>}
        {mode === 'signup' && (
          <label data-design-block="copy.09d513ec68a5798b.1"><ScreenText id="LoginPage.cd3c2c8d0734931c">Full name
            </ScreenText><input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
        )}

        <label data-design-block="copy.09d513ec68a5798b.2"><ScreenText id="LoginPage.8289cea56ff0acd8">Email
          </ScreenText><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label data-design-block="copy.09d513ec68a5798b.3"><ScreenText id="LoginPage.09ac59f7c65f1dec">Password
          </ScreenText><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>

        <button data-design-block="copy.0addb840ed393ffc.1" className="primary-button" disabled={submitting}>
          {submitting ? <PageWord id="copy.2a91e5d5966d123e.1">{"Working…"}</PageWord> : mode === 'signin' ? <PageWord id="copy.78cce8f742ae8334.1">{"Sign in"}</PageWord> : <PageWord id="copy.121a2c8ec5c45c06.1">{"Create account"}</PageWord>}
        </button>

        <button data-design-block="copy.107e01a56a9ccaf7.1" type="button" className="text-button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? <PageWord id="copy.738bef181af17873.1">{"Create an account"}</PageWord> : <PageWord id="copy.7793a86aac0872c3.1">{"Already have an account? Sign in"}</PageWord>}
        </button>

        {message && <p data-design-block="copy.a43a9bfaddb8b824.1" className="form-message">{message}</p>}
      </form>
    </div>
  )
}