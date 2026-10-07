import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
type Reservation={id:string;name:string;time:string|null;party:number;table:string|null;occasion:string|null;birthday:boolean;notes:string|null;vip:boolean}
function minutes(value:string|null){if(!value)return null;const m=value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);if(!m)return null;let h=Number(m[1]);if(m[3])h=h%12+(m[3].toUpperCase()==='PM'?12:0);return h*60+Number(m[2])}
function timeLabel(value:string|null){const n=minutes(value);if(n===null)return value||'Time not recorded';return `${Math.floor(n/60)%12||12}:${String(n%60).padStart(2,'0')} ${n<720?'AM':'PM'}`}
export function reservationNotes(rows:Reservation[],date:string,window:string){
 const selected=rows.filter(r=>{const t=minutes(r.time);return t===null||window==='all'||(window==='am'?t<960:t>=960)})
 const line=(r:Reservation)=>`${timeLabel(r.time)} · ${r.name} · ${r.party} guests${r.table?' · Table '+r.table:''}${r.occasion?' · '+r.occasion:''}${r.vip?' · VIP':''}${r.notes?.trim()?'\n  Notes: '+r.notes.trim():''}`
 const birthday=(r:Reservation)=>r.birthday||/\b(birthday|b[ -]?day)\b/i.test(r.occasion??'')||/\b(birthday|b[ -]?day)\b/i.test(r.notes??'')
 const sections=[['Large parties (8+)',selected.filter(r=>r.party>=8)],['Birthdays & celebrations',selected.filter(r=>birthday(r)||Boolean(r.occasion?.trim()))],['Guest requests & notes',selected.filter(r=>Boolean(r.notes?.trim())||r.vip)]] as const
 return `Reservations · ${date} · ${window==='all'?'All day':window==='am'?'Before 4 PM':'4 PM onward'}\n\n${sections.map(([title,list])=>title+'\n'+(list.length?list.map(line).join('\n\n'):'None listed.')).join('\n\n')}\n\nConfirm reservation notes with the host before service.`
}
const begin='--- Reservation notes ---',end='--- End reservation notes ---'
export function mergeReservationNotes(body:string,text:string){
 const first=body.indexOf(begin),last=body.indexOf(end,first)
 const block=text?begin+'\n'+text+'\n'+end:''
 const next=first>=0&&last>=first?body.slice(0,first)+block+body.slice(last+end.length):[body.trim(),block].filter(Boolean).join('\n\n')
 if(next.length>12000)throw Error('Reservation notes exceed the post limit. Shorten the post or select a service window.')
 return next.trim()
}
export function ReservationPostNotes({location,date,disabled,editing,onChange,onLoading}:{location:string;date:string;disabled:boolean;editing:boolean;onChange:(text:string)=>void;onLoading:(busy:boolean)=>void}){
 const callback=useRef(onChange);callback.current=onChange;const applied=useRef('')
 const [include,setInclude]=useState(!editing),[insertError,setInsertError]=useState('')
 const [rows,setRows]=useState<Reservation[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[window,setWindow]=useState('all'),[refresh,setRefresh]=useState(0)
 useEffect(()=>{let live=true;setRows([]);setLoading(true);setError('');if(include){try{callback.current('');applied.current=''}catch(e){setInsertError((e as Error).message)}}if(!location||!date){setLoading(false);return}void supabase.rpc('preshift_reservation_context',{p_location_id:location,p_date:date}).then(r=>{if(!live)return;if(r.error)setError(r.error.message);else setRows(r.data??[]);setLoading(false)});return()=>{live=false}},[location,date,refresh])
 useEffect(()=>{onLoading(include&&(loading||!!error||!!insertError));return()=>onLoading(false)},[include,loading,error,insertError,onLoading])
 const body=reservationNotes(rows,date,window)
 useEffect(()=>{if(loading||error||disabled||!include||applied.current===body)return;try{callback.current(body);applied.current=body;setInsertError('')}catch(e){setInsertError((e as Error).message)}},[body,loading,error,include,disabled])
 return <section className="feed-card"><h3>Reservations for this shift</h3><p>Loads the app’s reservation list for the selected date, including manually added reservations and CSV imports. New posts include these notes automatically. Review and edit the wording in the post before publishing.</p><label style={{display:'flex',flexDirection:'row',gap:12,alignItems:'center'}}><input style={{width:22,height:22,flex:'0 0 22px'}} type="checkbox" disabled={disabled} checked={include} onChange={e=>{setInclude(e.target.checked);if(!e.target.checked){applied.current='';callback.current('')}}}/>Include reservation notes in this post</label>{insertError&&<p role="alert">{insertError}</p>}<label>Service window<select disabled={disabled||loading} value={window} onChange={e=>setWindow(e.target.value)}><option value="all">All day</option><option value="am">Before 4 PM</option><option value="pm">4 PM onward</option></select></label><button type="button" disabled={disabled||loading} onClick={()=>setRefresh(v=>v+1)}>Refresh reservations</button>{loading?<p role="status">Loading reservations…</p>:error?<p role="alert">{error}</p>:<><p>{rows.length} reservations on the selected date.{!rows.length?' Add or import reservations on the Floor page first.':''}</p><pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',overflowWrap:'anywhere'}}>{body}</pre></>}</section>
}
