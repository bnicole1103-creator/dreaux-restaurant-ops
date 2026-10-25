export type TargetGroup='bar'|'floor'|'exclude'
export type SalesShift={id:string;employee_key?:string;assigned?:boolean;name:string;role:string;station:string;start:string;end:string;close:boolean;business_decline:boolean}
export type DiningDay={closed:boolean;open:string;close:string}
export type TargetInputs={personal_targets?:Record<string,number>;dining_day?:DiningDay;locked_day?:{ready:boolean;date:string;through_date:string;weekday_total:number;team_target:number;bar_target:number;floor_target:number;rows:{employee_key:string;name?:string;group:TargetGroup;hours:number;target:number}[]}|null;weekday_totals?:{weekday:number;total:number|null;through_date:string}[];settings:{version:number;bar_percent:number;growth_percent:number;role_groups:Record<string,TargetGroup>};history:{date:string;amount:number}[];overrides:Record<string,{group:TargetGroup;hours?:number|null}>}
export const salesMoney=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n)
export function precedingDays(date:string){const at=new Date(date+'T12:00:00Z');return Array.from({length:42},(_,i)=>{const d=new Date(at);d.setUTCDate(d.getUTCDate()-42+i);return d.toISOString().slice(0,10)})}
export function shiftGroup(s:SalesShift,inputs:TargetInputs):TargetGroup {return inputs.overrides[s.id]?.group??inputs.settings.role_groups[s.role.trim().toLowerCase()]??(/\bbartender\b/i.test(s.role)?'bar':/\bserver\b/i.test(s.role)?'floor':'exclude')}
export function scheduledHours(s:SalesShift,inputs:TargetInputs){const hours=inputs.overrides[s.id]?.hours;if(hours!=null)return hours;if(s.close||s.business_decline)return null;const h=(Date.parse(s.end)-Date.parse(s.start))/3600000;return Number.isFinite(h)&&h>0&&h<=24?h:null}
export function shiftHours(s:SalesShift,inputs:TargetInputs){
 const duration=scheduledHours(s,inputs),day=inputs.dining_day;if(!day)return null;if(day.closed)return 0;if(duration==null)return null;
 const start=new Date(s.start);if(!Number.isFinite(start.getTime()))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(start).map(p=>[p.type,p.value]));
 const at=Number(parts.hour)*60+Number(parts.minute)+Number(parts.second)/60;
 const minutes=(t:string)=>{const [h,m]=t.split(':').map(Number);return h*60+m};
 let op=minutes(day.open),cl=minutes(day.close);if(op<240)op+=1440;if(cl<240)cl+=1440;
 const from=at<240?at+1440:at;
 return Math.max(0,Math.min(from+duration*60,cl)-Math.max(from,op))/60;
}
function splitCents(total:number,weights:number[]){const sum=weights.reduce((a,b)=>a+b,0);const raw=weights.map(h=>total*h/sum),allocated=raw.map(Math.floor);let left=total-allocated.reduce((a,b)=>a+b,0);const order=raw.map((n,i)=>({i,remainder:n-allocated[i]})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);for(const x of order){if(left--<=0)break;allocated[x.i]++}return allocated}
export function calculateTargets(date:string,inputs:TargetInputs,shifts:SalesShift[]){
 const fixed=inputs.locked_day
 if(fixed?.ready&&fixed.date===date){
  const people=new Map<string,{key:string;name:string;group:TargetGroup;hours:number;target:number}>()
  for(const s of fixed.rows){const id=s.group+':'+s.employee_key;const p=people.get(id)??{key:s.employee_key,name:s.name??shifts.find(x=>x.employee_key===s.employee_key)?.name??'Employee '+s.employee_key,group:s.group,hours:0,target:0};p.hours+=Number(s.hours);p.target=Math.round((p.target+Number(s.target))*100)/100;people.set(id,p)}
  return {days:precedingDays(date).filter((_,i)=>i%7===0),missing:[],average:Number(fixed.weekday_total)/6,basisThrough:fixed.through_date,total:Number(fixed.team_target),bar:Number(fixed.bar_target),floor:Number(fixed.floor_target),rows:[...people.values()].map(r=>({...r,target:inputs.personal_targets?.[r.group+':'+r.key]??r.target})),issues:[],ready:true}
 }
 const weekday=new Date(date+'T12:00:00Z').getUTCDay(),entry=inputs.weekday_totals?.find(t=>t.weekday===weekday&&t.total!=null);
 const days=precedingDays(date).filter((_,i)=>i%7===0),byDate=new Map((inputs.weekday_totals?[]:inputs.history).map(h=>[h.date,Number(h.amount)])),missing=entry?[]:days.filter(d=>!byDate.has(d));
 const issues:string[]=[];if(!inputs.dining_day)issues.push('Dining hours unavailable. Reload after installing the dining-hours update.');if(missing.length)issues.push('Enter the six-week total for this weekday in Sales target setup.');
 if(!shifts.length)issues.push('No published shifts available for this date.');
 if((entry&&(!Number.isFinite(Number(entry.total))||Number(entry.total)<0||entry.through_date>=date))||(!entry&&inputs.history.some(h=>!Number.isFinite(Number(h.amount))||Number(h.amount)<0)))issues.push('Enter a valid past six-week net sales total.');
 if(!Number.isFinite(Number(inputs.settings.bar_percent))||Number(inputs.settings.bar_percent)<0||Number(inputs.settings.bar_percent)>100||!Number.isFinite(Number(inputs.settings.growth_percent))||Number(inputs.settings.growth_percent)<-100||Number(inputs.settings.growth_percent)>300)issues.push('Enter valid allocation and growth percentages.');
 const average=entry?Number(entry.total)/6:missing.length?0:days.reduce((n,d)=>n+byDate.get(d)!,0)/6;
 const totalCents=Math.round(average*(1+Number(inputs.settings.growth_percent)/100)*100);
 const barCents=Math.round(totalCents*Number(inputs.settings.bar_percent)/100),floorCents=totalCents-barCents;
 const eligible=shifts.filter(s=>shiftGroup(s,inputs)!=='exclude');
 for(const s of eligible){if(shiftHours(s,inputs)===0)continue;if(s.assigned!==true||!s.employee_key)issues.push(`${s.name}: this shift is unassigned or needs the updated schedule connection.`);if(shiftHours(s,inputs)==null)issues.push(`${s.name}: enter expected hours for this shift.`)}
 const rows:{key:string;name:string;group:TargetGroup;hours:number;target:number}[]=[];
 for(const [group,cents] of [['bar',barCents],['floor',floorCents]] as const){
  const people=new Map<string,{key:string;name:string;group:TargetGroup;hours:number}>();
  for(const s of eligible.filter(s=>shiftGroup(s,inputs)===group)){const hours=shiftHours(s,inputs);if(hours==null||hours<=0||s.assigned!==true||!s.employee_key)continue;const p=people.get(s.employee_key)??{key:s.employee_key,name:s.name,group,hours:0};p.hours+=hours;people.set(s.employee_key,p)}
  const list=[...people.values()].sort((a,b)=>a.key.localeCompare(b.key));if(cents>0&&!list.length)issues.push(`No assigned ${group} staff with usable hours for the ${salesMoney(cents/100)} ${group} pool.`);
  const amounts=list.length?splitCents(cents,list.map(p=>p.hours)):[];rows.push(...list.map((p,i)=>({...p,target:amounts[i]/100})));
 }
 return {days,missing,average,basisThrough:entry?.through_date??null,total:totalCents/100,bar:barCents/100,floor:floorCents/100,rows:rows.map(r=>({...r,target:inputs.personal_targets?.[r.group+':'+r.key]??r.target})),issues:[...new Set(issues)],ready:issues.length===0&&shifts.length>0};
}
export function targetsChunk(date:string,inputs:TargetInputs,shifts:SalesShift[]){const t=calculateTargets(date,inputs,shifts);if(!t.ready)throw Error(t.issues.join(' ')||'No published schedule available.');return `Sales targets · ${date}\nTeam net sales goal: ${salesMoney(t.total)}\nBar: ${salesMoney(t.bar)} · Floor: ${salesMoney(t.floor)}\n\n${t.rows.map(r=>`${r.name} · ${r.group==='bar'?'Bar':'Floor'} · ${salesMoney(r.target)}`).join('\n')}\n\nBased on the six-week weekday total divided by six; individual targets weighted by scheduled hours overlapping dining hours; prep and closing duties are excluded. ${Number(inputs.settings.growth_percent)?`Growth adjustment: ${inputs.settings.growth_percent}%.`:''}`.trim()}
