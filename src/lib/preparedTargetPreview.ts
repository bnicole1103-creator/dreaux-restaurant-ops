import type {SalesShift,TargetInputs,TargetGroup} from './salesTargets'
type Entry={operation:string;selected:boolean;args:Record<string,unknown>}
type Row={id:string;user_id?:string;name?:string;employee_key?:string;role:string;start_time:string;end_time?:string;hours?:number;group?:TargetGroup}
const nextDay=(date:string)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)}
export function serviceTime(date:string,time:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Queued hours need a valid date and start/end times.')
 const day=time<'04:00'?nextDay(date):date,target=Date.parse(day+'T'+time+':00Z');let instant=target+6*3600000
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
 for(let i=0;i<4;i++){const p=Object.fromEntries(fmt.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);if(local===target)return new Date(instant).toISOString();instant+=target-local}
 throw Error('A queued time falls in a daylight-saving clock change. Choose an actual local time.')
}
function queuedRows(rows:Row[],date:string,base:SalesShift[],snapshot:Record<string,unknown>[]=[],roster=false){
 return rows.map(r=>{const prior=snapshot.find(s=>s.id===r.id&&s.user_id===r.user_id)??(r.user_id?snapshot.find(s=>s.user_id===r.user_id):undefined),old=base.find(s=>s.id===r.id),start=serviceTime(date,r.start_time);let end=roster?new Date(Date.parse(start)+Number(r.hours)*3600000).toISOString():serviceTime(date,r.end_time??'')
  if(Date.parse(end)<Date.parse(start))end=new Date(Date.parse(end)+86400000).toISOString()
  const hours=(Date.parse(end)-Date.parse(start))/3600000;if(!Number.isFinite(hours)||hours<=0||hours>24||Date.parse(end)>Date.parse(serviceTime(nextDay(date),'04:00')))throw Error('Queued schedule hours must fit the 4 AM service-day cutoff.')
  return {id:r.id,employee_key:String(r.employee_key??prior?.employee_key??(r.user_id?'app:'+r.user_id:old?.employee_key??'unlinked:'+r.id)),assigned:true,name:String(r.name??prior?.name??old?.name??'Selected employee'),role:r.role,station:'',start,end,close:false,business_decline:false} as SalesShift
 })
}
export function normalizeQueuedTargetHours<T extends Entry>(entries:T[],date:string):T[]{
 const crew=entries.find(e=>e.selected&&e.operation==='crew_schedule_save'),roster=entries.find(e=>e.selected&&e.operation==='sales_target_roster_save'),source=roster??crew;if(!source)return entries
 const rows=queuedRows(source.args.p_rows as Row[],date,[],(crew?.args.p_snapshot??[]) as Record<string,unknown>[],!!roster)
 return entries.map(e=>e.operation!=='sales_target_save_weekday_totals'?e:{...e,args:{...e.args,p_overrides:Object.fromEntries(rows.map(r=>{const prev=(e.args.p_overrides as TargetInputs['overrides']??{})[r.id],raw=(source.args.p_rows as Row[]).find(x=>x.id===r.id)!;return [r.id,{group:roster?raw.group:prev?.group??(e.args.p_role_groups as Record<string,TargetGroup>??{})[r.role.trim().toLowerCase()]??(/\bbartender\b/i.test(r.role)?'bar':/\bserver\b/i.test(r.role)?'floor':'exclude'),hours:(Date.parse(r.end)-Date.parse(r.start))/3600000}]}))}})
}
export function preparedTargetPreview(inputs:TargetInputs,shifts:SalesShift[],date:string,entries:Entry[]){
 let next={...inputs,settings:{...inputs.settings},overrides:{...inputs.overrides},personal_targets:{...inputs.personal_targets}},rows=shifts,queued=false
 const selected=entries.filter(e=>e.selected&&(e.args.p_day===date||e.args.p_date===date))
 if(inputs.locked_day?.ready&&selected.some(e=>['crew_schedule_save','sales_target_roster_save'].includes(e.operation)))throw Error('The target day is locked. Release cannot replace its confirmed schedule here.')
 const normalized=normalizeQueuedTargetHours(selected,date),crew=selected.find(e=>e.operation==='crew_schedule_save'),roster=selected.find(e=>e.operation==='sales_target_roster_save')
 if(crew||roster){const source=roster??crew!;rows=queuedRows(source.args.p_rows as Row[],date,shifts,(crew?.args.p_snapshot??[]) as Record<string,unknown>[],!!roster);queued=true;next.overrides=Object.fromEntries(rows.map(r=>{const raw=(source.args.p_rows as Row[]).find(x=>x.id===r.id)!;return [r.id,{group:roster?raw.group!:next.overrides[r.id]?.group??next.settings.role_groups[r.role.trim().toLowerCase()]??(/\bbartender\b/i.test(r.role)?'bar':/\bserver\b/i.test(r.role)?'floor':'exclude'),hours:(Date.parse(r.end)-Date.parse(r.start))/3600000}]}))}
 const settings=normalized.find(e=>e.operation==='sales_target_save_weekday_totals')
 if(settings){const a=settings.args;queued=true;next={...next,settings:{...next.settings,bar_percent:Number(a.p_bar_percent),growth_percent:Number(a.p_growth_percent),role_groups:a.p_role_groups as Record<string,TargetGroup>},overrides:a.p_overrides as TargetInputs['overrides'],weekday_totals:(a.p_totals as {weekday:number;total:number|null}[]).map(x=>({...x,through_date:String(a.p_through)}))}}
 for(const e of selected.filter(e=>e.operation==='personal_sales_target_save')){queued=true;const key=String(e.args.p_pool)+':'+String(e.args.p_employee_key);if(e.args.p_target==null)delete next.personal_targets[key];else next.personal_targets[key]=Number(e.args.p_target)}
 return {inputs:next,shifts:rows,queued}
}
