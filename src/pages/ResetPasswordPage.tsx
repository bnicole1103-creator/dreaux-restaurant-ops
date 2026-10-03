import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function ResetPasswordPage({ hasSession }: { hasSession: boolean }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (password !== confirm) {
      setError('Your passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setPassword('')
      setConfirm('')
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function returnToLogin() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      sessionStorage.removeItem('lnx-password-recovery')
      window.location.replace('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to return to login.')
      setBusy(false)
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#493024', color: '#fff' }}>
      <section style={{ width: '100%', maxWidth: 420, padding: 28, borderRadius: 16, background: '#493024' }}>
        <h1>Set New Password</h1>
        {saved ? (
          <>
            <p role="status">Your password has been updated.</p>
            <button type="button" disabled={busy} onClick={() => void returnToLogin()}>
              {busy ? 'Please wait...' : 'Return to Login'}
            </button>
          </>
        ) : !hasSession ? (
          <>
            <p>This recovery link could not establish a session. Request a fresh recovery email and open its newest link.</p>
            <button type="button" disabled={busy} onClick={() => void returnToLogin()}>
              Return to Login
            </button>
          </>
        ) : (
          <form onSubmit={savePassword} style={{ display: 'grid', gap: 16 }}>
            <p>Enter and confirm your new password.</p>
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoComplete="new-password"
              required minLength={8} value={password} disabled={busy}
              onChange={event => setPassword(event.target.value)}
              style={{ padding: 12, borderRadius: 8 }} />
            <label htmlFor="confirm-password">Confirm new password</label>
            <input id="confirm-password" type="password" autoComplete="new-password"
              required minLength={8} value={confirm} disabled={busy}
              onChange={event => setConfirm(event.target.value)}
              style={{ padding: 12, borderRadius: 8 }} />
            <button type="submit" disabled={busy} style={{ padding: 12 }}>
              {busy ? 'Saving...' : 'Save New Password'}
            </button>
          </form>
        )}
        {error && <p role="alert" style={{ color: '#a32121' }}>{error}</p>}
      </section>
    </main>
  )
}
