export type DiningDay={closed:boolean;open:string;close:string}
export type DiningSettings={version:number;days:DiningDay[];closing_minutes:number;decline_minutes:number}
export type EndMode='scheduled'|'close'|'business_decline'|'manual'
export const diningWeekdays=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
export function clockMinutes(value:string):number|null{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return null;const [h,m]=value.split(':').map(Number);return h*60+m}
function serviceMinute(n:number){return n<240?n+1440:n}
export function estimateEnd(settings:DiningSettings,date:string,start:string,mode:EndMode,explicitEnd:string):{end:string;hours:number|null;error:string}{
 const s=clockMinutes(start);let end=explicitEnd;let error=''
 if(s===null)return {end,hours:null,error:'Enter a valid start time.'}
 const startMinute=serviceMinute(s)
 if(mode==='business_decline'){
  const e=startMinute+settings.decline_minutes
  if(e>1680||e<=startMinute)return {end:'',hours:null,error:'Estimated end falls outside this service day. Enter a manual end time.'}
  end=String(Math.floor((e%1440)/60)).padStart(2,'0')+':'+String(e%60).padStart(2,'0')
 }else if(mode==='close'){
  const weekday=new Date(date+'T12:00:00Z').getUTCDay(),day=settings.days[weekday],close=day?clockMinutes(day.close):null
  if(!day||day.closed||close===null)return {end:'',hours:null,error:'Dining is closed on this weekday. Enter a manual end time for this shift.'}
  const e=serviceMinute(close)+settings.closing_minutes
  if(e>1680||e<=startMinute)return {end:'',hours:null,error:'Closing estimate does not fit this shift. Enter a manual end time.'}
  end=String(Math.floor((e%1440)/60)).padStart(2,'0')+':'+String(e%60).padStart(2,'0')
 }
 const rawEnd=clockMinutes(end),endMinute=rawEnd===null?null:rawEnd===240&&startMinute>240?1680:serviceMinute(rawEnd)
 if(endMinute===null||endMinute<=startMinute)error='Enter an end time after the start, within the 4 AM service-day cutoff.'
 return {end,hours:error||endMinute===null?null:(endMinute-startMinute)/60,error}
}
