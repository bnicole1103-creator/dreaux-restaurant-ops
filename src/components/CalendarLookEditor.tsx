import {PageWord} from './PageDesign'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
import {PosterStyleControls} from './PosterStyleControls'
import {defaultCalendarLook,type CalendarLook} from '../lib/calendarLook'
export function CalendarLookEditor({location,month,saved,onSaved}:{location:string;month:string;saved?:{config:CalendarLook;version:number};onSaved:()=>void}){
 const [look,setLook]=useState(saved?.config??defaultCalendarLook),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 useEffect(()=>{setLook(saved?.config??defaultCalendarLook);setError('');setNotice('')},[month,saved?.version])
 async function save(){setBusy(true);setError('');setNotice('');try{const r=await supabase.rpc('calendar_month_style_save',{p_location_id:location,p_month:month+'-01',p_config:look,p_version:saved?.version??0});if(r.error)throw r.error;setNotice('Month style saved for everyone.');onSaved()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 return <details className="calendar-look-editor"><summary><PageWord id="sectioncopy.3e8c073b385a82518eee">{"Style this month ✨"}</PageWord></summary><fieldset data-design-block="section.6a728813b43fbbac2eac" disabled={busy}><legend><PageWord id="sectioncopy.444451e52e13e830930f">{"Colors & fonts · "}</PageWord>{month}</legend><PosterStyleControls month={month} look={look} onChange={setLook}/><button type="button" onClick={()=>void save()}>{busy?'Saving…':'Save month style'}</button></fieldset>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</details>
}
