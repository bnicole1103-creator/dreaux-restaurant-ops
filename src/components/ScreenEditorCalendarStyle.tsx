import {useEffect,useState} from 'react'
import {CalendarLookEditor} from './CalendarLookEditor'
import {calendarToday,monthDays,validDay} from '../lib/calendarDates'
import {loadTenantData} from '../lib/tenant'
import {supabase} from '../lib/supabase'
import type {CalendarLook} from '../lib/calendarLook'
import './CalendarStudio.css'
export function ScreenEditorCalendarStyle(){
 const [month,setMonth]=useState(()=>calendarToday().slice(0,7)),[location,setLocation]=useState(''),[saved,setSaved]=useState<{config:CalendarLook;version:number}|undefined>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 useEffect(()=>{let live=true;setLoading(true);setError('');void(async()=>{try{const t=await loadTenantData(),id=t.locations[0]?.id;if(!id)throw Error('No active location.');const range=monthDays(month),r=await supabase.rpc('calendar_read',{p_location_id:id,p_from:range.first,p_to:range.last});if(r.error)throw r.error;if(live){setLocation(id);setSaved(r.data.styles?.[month])}}catch(e){if(live)setError(String((e as Error).message??e))}finally{if(live)setLoading(false)}})();return()=>{live=false}},[month,refresh])
 return <details className="studio-classic"><summary>Calendar month themes, fonts & backgrounds</summary><label>Calendar month<input type="month" value={month} onChange={e=>{const next=e.target.value;if(validDay(next+'-01')&&next!==month&&window.confirm('Switch months? Save your current month style first to keep any changes.'))setMonth(next)}}/></label>{error&&<p role="alert">{error} <button type="button" onClick={()=>setRefresh(n=>n+1)}>Retry loading month style</button></p>}{loading?<p role="status">Loading saved month style…</p>:!error&&location&&<CalendarLookEditor location={location} month={month} saved={saved} onSaved={()=>setRefresh(n=>n+1)}/>}</details>
}
