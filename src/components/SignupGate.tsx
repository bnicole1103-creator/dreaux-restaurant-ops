import { useEffect, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { supabase } from '../lib/supabase'

type Status = { active: boolean; verified: boolean; requests: {id: string; location: string; status: string}[] }
export function registrationToken() {
 const token = new URLSearchParams(window.location.search).get('join')
 if (token) localStorage.setItem('lnx-registration-link', token)
 return token || localStorage.getItem('lnx-registration-link') || ''
}
export function SignupGate({userId, children}: PropsWithChildren<{userId: string}>) {
 const [status,setStatus]=useState<Status | null>(null)
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 async function refresh() {
  setBusy(true);setError('')
  try {
   let result=await supabase.rpc('staff_signup_status')
   if(result.error) throw result.error
   let next=result.data as Status
   if(!next.active && next.verified && next.requests.length===0) {
    const {data,error}=await supabase.auth.getUser()
    if(error) throw error
    const token=registrationToken() || String(data.user?.user_metadata?.registration_token || '')
    if(token) {
     const request=await supabase.rpc('staff_signup_request',{p_token:token})
     if(request.error) throw request.error
     result=await supabase.rpc('staff_signup_status')
     if(result.error) throw result.error
     next=result.data as Status
    }
   }
   setStatus(next)
   if(next.active) localStorage.removeItem('lnx-registration-link')
  } catch(e) {setError(String((e as {message?:string}).message ?? e))}
  finally {setBusy(false)}
 }
 useEffect(()=>{setStatus(null);void refresh()},[userId])
 if(status?.active) return <>{children}</>
 return <div className="auth-page"><section className="auth-card">
  <h1>{status?.verified ? 'Account awaiting approval' : 'Account access'}</h1>
  {!status && !error && <p>Checking your account…</p>}
  {status && !status.verified && <p>Confirm your email, then sign in again to request access.</p>}
  {status?.verified && status.requests.length===0 && <p>Open the registration link from your GM to request access to your location.</p>}
  {status?.requests.map(r=><p key={r.id}>{r.location}: {r.status==='pending' ? 'Waiting for GM approval.' : r.status==='declined' ? 'Request declined. Contact your GM.' : 'Access needs GM review.'}</p>)}
  {error && <p role="alert">{error}</p>}
  <button type="button" disabled={busy} onClick={()=>void refresh()}>{busy ? 'Checking…' : 'Check approval'}</button>
  <button type="button" onClick={()=>void supabase.auth.signOut()}>Sign out</button>
 </section></div>
}
