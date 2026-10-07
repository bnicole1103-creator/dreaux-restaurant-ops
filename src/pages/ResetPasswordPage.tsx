// page-designer-instrumented
import { PageWord } from "../components/PageDesign"
import { ScreenText } from "../components/ScreenText"
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
    <main data-design-block="copy.ae498d5fa7d8f763.1" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--app-text)', color: '#fff' }}>
      <section data-design-block="copy.00b5848b9645bf4b.1" style={{ width: '100%', maxWidth: 420, padding: 28, borderRadius: 16, background: 'var(--app-text)' }}>
        <h1 data-design-block="copy.9108f926d94e8bae.1"><ScreenText id="ResetPasswordPage.1977ef6b7e4b5136">Set New Password</ScreenText></h1>
        {saved ? (
          <>
            <p data-design-block="copy.af36784e1982774d.1" role="status"><ScreenText id="ResetPasswordPage.fc77ca8d593536f3">Your password has been updated.</ScreenText></p>
            <button data-design-block="copy.af52eea6db3e2f0b.1" type="button" disabled={busy} onClick={() => void returnToLogin()}>
              {busy ? <PageWord id="copy.11dabca7e30de824.1">{"Please wait..."}</PageWord> : <PageWord id="copy.c57f0add6ce8c4e2.1">{"Return to Login"}</PageWord>}
            </button>
          </>
        ) : !hasSession ? (
          <>
            <p data-design-block="copy.a33ed6beda5b9477.1"><ScreenText id="ResetPasswordPage.1031abc00c092a13">This recovery link could not establish a session. Request a fresh recovery email and open its newest link.</ScreenText></p>
            <button data-design-block="copy.af52eea6db3e2f0b.2" type="button" disabled={busy} onClick={() => void returnToLogin()}><ScreenText id="ResetPasswordPage.193b9ba1376f0cb5">
              Return to Login
            </ScreenText></button>
          </>
        ) : (
          <form data-design-block="copy.2c9720cb98cb159d.1" onSubmit={savePassword} style={{ display: 'grid', gap: 16 }}>
            <p data-design-block="copy.a33ed6beda5b9477.2"><ScreenText id="ResetPasswordPage.b65d157e02c7ac2a">Enter and confirm your new password.</ScreenText></p>
            <label data-design-block="copy.9e77cfc4922449f5.1" htmlFor="new-password"><ScreenText id="ResetPasswordPage.85c79db2447a2702">New password</ScreenText></label>
            <input id="new-password" type="password" autoComplete="new-password"
              required minLength={8} value={password} disabled={busy}
              onChange={event => setPassword(event.target.value)}
              style={{ padding: 12, borderRadius: 8 }} />
            <label data-design-block="copy.c780181ca51ee065.1" htmlFor="confirm-password"><ScreenText id="ResetPasswordPage.c1cbf2e591dad8b4">Confirm new password</ScreenText></label>
            <input id="confirm-password" type="password" autoComplete="new-password"
              required minLength={8} value={confirm} disabled={busy}
              onChange={event => setConfirm(event.target.value)}
              style={{ padding: 12, borderRadius: 8 }} />
            <button data-design-block="copy.22ca6972ae436727.1" type="submit" disabled={busy} style={{ padding: 12 }}>
              {busy ? <PageWord id="copy.eed470c1a831b7cb.1">{"Saving..."}</PageWord> : <PageWord id="copy.d1274814686b738f.1">{"Save New Password"}</PageWord>}
            </button>
          </form>
        )}
        {error && <p data-design-block="copy.b9e676bcd0712fa3.1" role="alert" style={{ color: '#a32121' }}>{error}</p>}
      </section>
    </main>
  )
}
