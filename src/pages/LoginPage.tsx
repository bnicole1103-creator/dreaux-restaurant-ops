import { ForgotPassword } from '../components/PasswordTools'
import '../components/AppPolish.css'
// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
import { ScreenText } from "../components/ScreenText"
import { registrationToken } from '../components/SignupGate'
import { type FormEvent, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

function authMessage(error: {code?:string;message:string}) {
  switch (error.code) {
    case 'email_not_confirmed':
      return 'Confirm your email before signing in. Use Resend confirmation email if you need another link.'
    case 'email_address_not_authorized':
      return 'The app’s email provider does not allow this address. Ask Management to check sign-up email delivery.'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'The email service has reached its sending limit. Wait before requesting another link.'
    default:
      return error.message
  }
}

export function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>(registrationToken() ? 'signup' : 'signin')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const emailField = useRef<HTMLInputElement>(null)
  const busy = submitting || resending

  async function resendConfirmation() {
    if (busy || !emailField.current?.reportValidity()) return
    setResending(true)
    setMessage('')
    try {
      const {error} = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: {emailRedirectTo: window.location.origin + '/'},
      })
      // Keep confirmation requests neutral for unknown or already verified accounts.
      if (error && !['user_not_found', 'email_exists'].includes(error.code ?? '')) {
        setMessage(authMessage(error))
        return
      }
      setMessage('If this address has a pending sign-up, a new confirmation link was requested. Check your inbox and Junk folder for the newest message.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not request a confirmation link. Please try again.')
    } finally {
      setResending(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setSubmitting(true)
    setMessage('')

    try {
    const result = mode === 'signup'
      ? await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim(), registration_token: registrationToken() },
            emailRedirectTo: window.location.origin + '/',
          },
        })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })

    setMessage(result.error ? authMessage(result.error) : (mode === 'signup'
      ? 'If this address needs confirmation, check your inbox and Junk folder. You can request a new link below.'
      : 'Signed in.'))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not connect. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div data-design-block="copy.8ae503244a6652a1.1" className="auth-page polished-auth">
      <form data-design-block="copy.af82841b591cb2d9.1" className="auth-card" onSubmit={submit}>
        <p data-design-block="copy.0d4d7eb9ee5f6f7e.1" className="eyebrow"><ScreenText id="LoginPage.262da4df982b420d">LNX Systems</ScreenText></p>
        <h1 data-design-block="copy.1e8e41bc62d95308.1"><ScreenText id="LoginPage.3148730a11c9bc5a">Restaurant Operations</ScreenText></h1>
        <p data-design-block="copy.0d1ff4ea27de07af.1" className="muted"><ScreenText id="LoginPage.52160d77f0dfc05a">Floor, cash, tasks, rewards, and reporting.</ScreenText></p>

        {mode === 'signup' && <p data-design-block="copy.60252d15d462e4e3.1"><ScreenText id="LoginPage.aa65239e06fea8f7">Your Management must approve location access after signup.</ScreenText></p>}
        {mode === 'signup' && (
          <label data-design-block="copy.09d513ec68a5798b.1"><ScreenText id="LoginPage.cd3c2c8d0734931c">Full name
            </ScreenText><input autoComplete="name" disabled={busy} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
        )}

        <label data-design-block="copy.09d513ec68a5798b.2"><ScreenText id="LoginPage.8289cea56ff0acd8">Email
          </ScreenText><input ref={emailField} type="email" autoComplete="email" disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>

        <label data-design-block="copy.09d513ec68a5798b.3"><ScreenText id="LoginPage.09ac59f7c65f1dec">Password
          </ScreenText><input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} minLength={mode === 'signup' ? 8 : undefined} required />
        </label>

        <button data-design-block="copy.0addb840ed393ffc.1" type="submit" className="primary-button" disabled={busy}>
          {submitting ? <PageWord id="copy.2a91e5d5966d123e.1">{"Working…"}</PageWord> : mode === 'signin' ? <PageWord id="copy.78cce8f742ae8334.1">{"Sign in"}</PageWord> : <PageWord id="copy.121a2c8ec5c45c06.1">{"Create account"}</PageWord>}
        </button>

        <button data-design-block="copy.107e01a56a9ccaf7.1" disabled={busy} type="button" className="text-button" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage('') }}>
          {mode === 'signin' ? <PageWord id="copy.738bef181af17873.1">{"Create an account"}</PageWord> : <PageWord id="copy.7793a86aac0872c3.1">{"Already have an account? Sign in"}</PageWord>}
        </button>

        <button type="button" className="text-button" disabled={busy} onClick={()=>void resendConfirmation()}>
          {resending ? 'Requesting confirmation…' : 'Resend confirmation email'}
        </button>
        <ForgotPassword/>
        {message && <p data-design-block="copy.a43a9bfaddb8b824.1" className="form-message" role="status">{message}</p>}
      </form>
    </div>
  )
}
// app-polish-v2
