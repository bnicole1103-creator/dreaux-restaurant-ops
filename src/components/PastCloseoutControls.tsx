import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { closeoutDate } from '../lib/closeoutNavigation'
import { usePastCloseoutAccess } from '../lib/pastCloseoutAccess'
import { serviceDateLabel } from '../lib/serviceDay'
import { useManagementAccess } from './ManagementAccess'

export function PastCloseoutControls({location,today,initialDay}:{location:string;today:string;initialDay:string}){
 const management=useManagementAccess()
 const [open,setOpen]=useState(false)
 const {access,error:accessError,loading}=usePastCloseoutAccess(open?location:'')
 const [day,setDay]=useState(initialDay<today?initialDay:'')
 const [apply,setApply]=useState(true)
 const [reason,setReason]=useState('')
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [busy,setBusy]=useState(false)
 const lock=useRef(false)
 const lastPastDay=new Date(today+'T12:00:00Z')
 lastPastDay.setUTCDate(lastPastDay.getUTCDate()-1)
 const latestDate=lastPastDay.toISOString().slice(0,10)

 async function permit(active:boolean){
  if(lock.current||!access?.manager)return
  setError('')
  setNotice('')
  if(!closeoutDate(day,latestDate)){setError('Choose a past service date.');return}
  if(reason.trim().length<3){setError('Enter a brief reason for this approval or revocation.');return}
  lock.current=true
  setBusy(true)
  try{
   const result=await supabase.rpc('operations_closeout_date_permission',{
    p_location_id:location,p_day:day,p_apply_points:apply,p_reason:reason.trim(),p_active:active,
   }).abortSignal(AbortSignal.timeout(25000))
   if(result.error)throw result.error
   const staff=Number(result.data?.staff_permissions_updated??0)
   const date=serviceDateLabel(day)
   setNotice(active
    ? `${date} opened for ${staff} staff account${staff===1?'':'s'}. Staff can choose this date under Closeout.`
    : `Staff submissions are closed for ${date}.`)
   setReason('')
   window.dispatchEvent(new Event('past-closeout-access-changed'))
  }catch(caught){
   setError(String((caught as Error).message??caught))
  }finally{
   lock.current=false
   setBusy(false)
  }
 }

 if(!management.manager)return null
 return <section className="page closeout-summary-toolbar" aria-label="Past-date staff closeouts">
  <details onToggle={event=>setOpen(event.currentTarget.open)}>
   <summary>Open a past-date closeout</summary>
   {loading&&<p role="status">Loading approval access…</p>}
   {accessError&&<p role="alert">Approval access could not load. {accessError}</p>}
   {access&&!access.manager&&<p role="alert">Management closeout approval access is required.</p>}
   {access?.manager&&<fieldset disabled={busy}>
    <label>Past service date<input type="date" max={latestDate} value={day}
     onChange={event=>{setDay(event.target.value);setError('');setNotice('')}}/></label>
    <label><input type="checkbox" checked={apply} onChange={event=>setApply(event.target.checked)}/>
     Apply closeout points and clear the matching missing-closeout deduction</label>
    <label>Reason<textarea required minLength={3} maxLength={1000} rows={2} value={reason}
     onChange={event=>setReason(event.target.value)} placeholder="Why are staff submitting late?"/></label>
    <button type="button" className="primary-button" onClick={()=>void permit(true)}>Allow staff submissions</button>
    <button type="button" onClick={()=>void permit(false)}>Revoke date permissions</button>
   </fieldset>}
   {notice&&<p role="status">{notice}</p>}
   {error&&<p role="alert">{error}</p>}
  </details>
 </section>
}
