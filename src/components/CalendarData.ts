import type { CalendarLook } from '../lib/calendarLook'
import type { CalendarAudience } from '../lib/calendarAudience'
import {useEffect,useState} from 'react'
import {supabase} from '../lib/supabase'
export type CalendarEvent={id:string;date:string;title:string;body:string;time:string|null;category:string;version:number;media?:CalendarFlyer[];style?:CalendarLook;audience?:CalendarAudience|null}
export type CalendarFlyer={path:string;name:string;caption:string;kind?:'image'|'video'}
export type CalendarShift={id:string;name:string;role:string;station:string;start:string;end:string;close:boolean;business_decline:boolean;employee_key?:string;assigned?:boolean}
export type CalendarDay={rows:CalendarShift[];synced_at:string|null;error:string|null;reservations:number;posts?:number}
export type CalendarData={events:CalendarEvent[];days:Record<string,CalendarDay>;styles?:Record<string,{config:CalendarLook;version:number}>}
export function useCalendarData(location:string,from:string,to:string){
 const [data,setData]=useState<CalendarData>({events:[],days:{}}),[loading,setLoading]=useState(true),[error,setError]=useState(''),[scheduleError,setScheduleError]=useState(''),[refresh,setRefresh]=useState(0)
 useEffect(()=>{let live=true,running=false;setData({events:[],days:{}});setError('');setScheduleError('');if(!location){setLoading(false);return}
  async function load(){if(running)return;running=true;setLoading(true)
   try{const first=await supabase.rpc('calendar_read',{p_location_id:location,p_from:from,p_to:to});if(first.error)throw first.error;if(live){setData(first.data);setError('')}
    const preview=new URLSearchParams(window.location.search);if(preview.has('staff-preview')||preview.has('wording-preview'))return
    const sync=await supabase.functions.invoke('calendar-schedule',{body:{location_id:location,from,to}})
    if(live)setScheduleError(sync.error?'Could not refresh 7shifts. Showing saved schedules.':sync.data?.error??'')
    const next=await supabase.rpc('calendar_read',{p_location_id:location,p_from:from,p_to:to});if(next.error)throw next.error;if(live)setData(next.data)
   }catch(e){if(live)setError(String((e as {message?:string}).message??e))}finally{running=false;if(live)setLoading(false)}
  }
  void load();const focus=()=>{if(document.visibilityState==='visible')void load()};const timer=setInterval(focus,300000);window.addEventListener('focus',focus)
  return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',focus)}
 },[location,from,to,refresh])
 return {data,loading,error,scheduleError,reload:()=>setRefresh(v=>v+1)}
}
