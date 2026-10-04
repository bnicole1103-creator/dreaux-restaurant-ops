import { ClockTime } from './ClockTime'
import { closeoutHours } from '../lib/closeoutHours'
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Question } from './CloseoutConfig'
export type EditableCloseout={id:string;edit_version?:number;scheduled_start:string|null;clock_in:string|null;clock_out?:string|null;job_role:string;shift_type?:string|null;net_sales:number;sales_target:number;cash_deposit:number;void_count:number;void_value:number;discount_value:number;notes:string|null;custom_answers?:Record<string,string>;question_snapshot?:Question[];zero_sales_confirmed?:boolean;zero_sales_reason?:string|null;completion_points_withheld?:boolean}
const amounts=[['net_sales','Net sales ($)'],['sales_target','Sales target ($)'],['cash_deposit','Cash deposit ($)'],['void_value','Voids ($)'],['discount_value','Discounts ($)'],['void_count','Number of voids']] as const
const roles={server:'Server',main_bartender:'Main Bartender',back_bartender_1:'Back Bartender 1',back_bar_service_bartender:'Back Bar Service Bartender',host:'Host',busser:'Busser',manager:'Manager',assistant_manager:'Assistant Manager',general_manager:'General Manager'}
export function CloseoutCorrectionEditor({closeout,locationId,name,onSaved,onCancel}:{closeout:EditableCloseout;locationId:string;name:string;onSaved:()=>void;onCancel:()=>void}){
 const [values,setValues]=useState(()=>Object.fromEntries(amounts.map(([key])=>[key,String(closeout[key] ?? '')])));const [scheduled,setScheduled]=useState(closeout.scheduled_start?.slice(0,5) ?? '');const [clock,setClock]=useState(closeout.clock_in?.slice(0,5) ?? '')
 const [clockOut,setClockOut]=useState(closeout.clock_out?.slice(0,5) ?? '')
 const [role,setRole]=useState(closeout.job_role);const [shift,setShift]=useState(closeout.shift_type ?? '');const [notes,setNotes]=useState(closeout.notes ?? '');const [answers,setAnswers]=useState(closeout.custom_answers ?? {})
 const [zeroConfirmed,setZeroConfirmed]=useState(closeout.zero_sales_confirmed ?? false);const [zeroReason,setZeroReason]=useState(closeout.zero_sales_reason ?? '')
 const [inaccurate,setInaccurate]=useState(true);const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('')
 async function save(){setBusy(true);setError('');try{
  const numbers:Record<string,number>={};for(const [key,label] of amounts){const raw=values[key]?.trim();if(!raw || !/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(Number(raw)))throw new Error('Enter a valid '+label.toLowerCase()+'.');numbers[key]=Number(raw)}
  if(!Number.isInteger(numbers.void_count))throw new Error('Void count must be a whole number.')
  if(clockOut && closeoutHours(clock,clockOut)===null)throw new Error('Shift length must be greater than zero and no more than 18 hours.')
  const r=await supabase.rpc('closeout_manager_correct',{p_location_id:locationId,p_closeout_id:closeout.id,p_version:closeout.edit_version ?? 1,p_values:{...numbers,scheduled_start:scheduled,clock_in:clock,clock_out:clockOut || null,job_role:role,shift_type:shift,notes:notes.trim() || null,custom_answers:answers,zero_sales_confirmed:zeroConfirmed,zero_sales_reason:zeroReason.trim() || null},p_reason:reason.trim(),p_inaccurate:inaccurate});if(r.error)throw r.error;onSaved()
 }catch(e){setError(String((e as {message?:string})?.message ?? e))}finally{setBusy(false)}}
 return <form className="closeout-correction card" onSubmit={e=>{e.preventDefault();void save()}}><h3>Edit / Review: {name}</h3><p>Correct the original record. Sales-related points and the recap update automatically.</p><fieldset disabled={busy}><div className="form-grid">
  <label>Scheduled time<ClockTime required label="Scheduled time" value={scheduled} onChange={setScheduled} /></label><label>Actual clock-in<ClockTime required label="Clock-in time" value={clock} onChange={setClock} /></label>
  <label>Actual clock-out<ClockTime required={!!closeout.clock_out} label="Clock-out time" value={clockOut} onChange={setClockOut} /><small>Older forms may have no recorded clock-out.</small></label>
  <label>Role worked<select value={role} onChange={e=>setRole(e.target.value)}>{Object.entries(roles).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  <label>Shift<select value={shift} onChange={e=>setShift(e.target.value)}><option value="">Not recorded</option><option value="AM">AM</option><option value="PM">PM</option><option value="TO_VOLUME">To volume</option></select></label>
  {amounts.map(([key,label])=><label key={key}>{label}<input type="text" inputMode={key==='void_count'?'numeric':'decimal'} required value={values[key]} onChange={e=>{setValues(v=>({...v,[key]:e.target.value}));if(key==='net_sales')setZeroConfirmed(false)}} /></label>)}
 </div>
 {Number(values.net_sales)===0 && <div className="closeout-warning"><label className="closeout-check"><input type="checkbox" checked={zeroConfirmed} onChange={e=>setZeroConfirmed(e.target.checked)} /><span>I verified that $0 sales is accurate.</span></label><label>Reason for zero sales<textarea rows={2} maxLength={2000} value={zeroReason} onChange={e=>setZeroReason(e.target.value)} /></label><p>If this is an incorrect zero that still needs correction, leave it unconfirmed and mark the original submission inaccurate below.</p></div>}
 {closeout.question_snapshot?.filter(q=>!q.builtin).map(q=><label key={q.id}>{q.label}{q.type==='yesno'?<select required={q.required} value={answers[q.id] ?? ''} onChange={e=>setAnswers(v=>({...v,[q.id]:e.target.value}))}><option value="">Choose an answer</option><option value="yes">Yes</option><option value="no">No</option></select>:<textarea required={q.required} rows={2} maxLength={2000} value={answers[q.id] ?? ''} onChange={e=>setAnswers(v=>({...v,[q.id]:e.target.value}))} />}</label>)}
 <label>Notes<textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} /></label>
 <label className="closeout-check"><input type="checkbox" checked={inaccurate || !!closeout.completion_points_withheld} disabled={!!closeout.completion_points_withheld} onChange={e=>setInaccurate(e.target.checked)} /><span>The original submission was inaccurate. Withhold its closeout completion bonus.</span></label>
 <p>Correcting the form does not automatically restore this bonus. The GM can restore it from the Points page. Leave this unchecked for a clarification to an otherwise accurate submission.</p>
 <label>Correction / review reason<textarea required maxLength={2000} rows={2} value={reason} onChange={e=>setReason(e.target.value)} /></label>
 {error && <p role="alert">{error}</p>}<div className="closeout-actions"><button className="primary-button" disabled={busy}>{busy?'Saving…':'Save correction / review'}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div></fieldset></form>
}

