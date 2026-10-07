// page-designer-instrumented
import { PageWord } from "./PageDesign"
import { ScreenText } from "./ScreenText"
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
 return <div data-design-block="copy.a18a22258b1392dd.1" className="auth-page"><section data-design-block="copy.634b2a068bce5a29.1" className="auth-card">
  <h1 data-design-block="copy.d40a89e27ace23c9.1">{status?.verified ? <PageWord id="copy.706d40931b46b31f.1">{"Account awaiting approval"}</PageWord> : <PageWord id="copy.9dcb87e41f3424a5.1">{"Account access"}</PageWord>}</h1>
  {!status && !error && <p data-design-block="copy.c4bbc1965d491c86.1"><ScreenText id="SignupGate.d52193e0ca026e4c">Checking your account…</ScreenText></p>}
  {status && !status.verified && <p data-design-block="copy.c4bbc1965d491c86.2"><ScreenText id="SignupGate.3b3e3f47f4ed1470">Confirm your email, then sign in again to request access.</ScreenText></p>}
  {status?.verified && status.requests.length===0 && <p data-design-block="copy.c4bbc1965d491c86.3"><ScreenText id="SignupGate.ae7887eeffcd78ce">Open the registration link from your GM to request access to your location.</ScreenText></p>}
  {status?.requests.map(r=><p data-design-block="copy.355fb4308d51b8a8.1" key={r.id}>{r.location}<PageWord id="copy.f1681c56ccd01b1a.1">: </PageWord>{r.status==='pending' ? <PageWord id="copy.a46152aed2046c9d.1">{"Waiting for GM approval."}</PageWord> : r.status==='declined' ? <PageWord id="copy.417d0afa75990ac7.1">{"Request declined. Contact your GM."}</PageWord> : <PageWord id="copy.0858f2b0f52cc002.1">{"Access needs GM review."}</PageWord>}</p>)}
  {error && <p data-design-block="copy.a20a6a88b883180e.1" role="alert">{error}</p>}
  <button data-design-block="copy.a417a9cbf126208f.1" type="button" disabled={busy} onClick={()=>void refresh()}>{busy ? <PageWord id="copy.10e28a4542cac4a2.1">{"Checking…"}</PageWord> : <PageWord id="copy.595e52cf86bb9964.1">{"Check approval"}</PageWord>}</button>
  <button data-design-block="copy.ca93b80597d237cf.1" type="button" onClick={()=>void supabase.auth.signOut()}><ScreenText id="SignupGate.01e2b13809a92be9">Sign out</ScreenText></button>
 </section></div>
}
