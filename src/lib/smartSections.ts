export type SmartRecommendation={employeeId:string;employeeName:string;score:number;avgNetSales:number;avgSalesPerHour:number|null;timedUses:number;historicalUses:number;currentSeats:number;exactHistory:boolean;lastCloseoutDate:string|null;reason:string;scheduled?:boolean;exactUses?:number;seatUses?:number}
export type CloseoutPerformance={employee_id:string;net_sales:number|null;table_match:boolean;hours_worked:number|null;closeout_date?:string;closeout_id?:string;seats?:number;job_role?:string;assignment_match?:boolean}
export type SmartCandidate={id:string;name:string;scheduled?:boolean;role?:string}
// Rankings are evidence-weighted suggestions, never a promise of sales or availability.
export function recommendSections(candidates:SmartCandidate[],performance:CloseoutPerformance[],loads:Record<string,number>,targetSeats=0):SmartRecommendation[]{
 const stats=candidates.map(c=>{
  const rows=performance.filter(r=>r.employee_id===c.id&&r.net_sales!==null&&Number.isFinite(Number(r.net_sales))&&Number(r.net_sales)>=0)
  const exact=rows.filter(r=>r.table_match),similar=rows.filter(r=>targetSeats>0&&!!r.seats&&Math.abs(r.seats-targetSeats)<=Math.max(2,targetSeats*.25))
  const selected=exact.length>=3?exact:similar.length>=3?similar:rows
  const weighted=selected.map(r=>{const distance=targetSeats&&r.seats?Math.abs(r.seats-targetSeats)/Math.max(targetSeats,r.seats):.5;return {r,w:(r.table_match?3:r.assignment_match?1.5:1)*(1-distance*.5)}})
  const sum=weighted.reduce((s,x)=>s+x.w,0)||1,avg=weighted.reduce((s,x)=>s+Number(x.r.net_sales)*x.w,0)/sum
  const timed=weighted.filter(x=>x.r.hours_worked!==null&&Number(x.r.hours_worked)>0&&Number(x.r.hours_worked)<=18)
  const hourly=timed.length?timed.reduce((s,x)=>s+Number(x.r.net_sales)/Number(x.r.hours_worked)*x.w,0)/timed.reduce((s,x)=>s+x.w,0):null
  const perSeat=weighted.filter(x=>!!x.r.seats&&x.r.seats>0)
  const rate=perSeat.length?perSeat.reduce((s,x)=>s+Number(x.r.net_sales)/(x.r.seats||1)*x.w,0)/perSeat.reduce((s,x)=>s+x.w,0):null
  return {c,rows,exact,similar,selected,avg,hourly,timed,rate}
 })
 const useHourly=stats.filter(s=>s.rows.length).every(s=>s.hourly!==null),useSeat=!useHourly&&stats.filter(s=>s.rows.length).every(s=>s.rate!==null)
 const metric=(s:typeof stats[number])=>useHourly?s.hourly??0:useSeat?s.rate??0:s.avg
 const positive=stats.filter(s=>s.rows.length).map(metric).sort((a,b)=>a-b),prior=positive.length?positive[Math.floor(positive.length/2)]:0
 const adjusted=(s:typeof stats[number])=>(metric(s)*s.selected.length+prior*3)/(s.selected.length+3)
 const max=Math.max(1,...stats.map(adjusted)),maxLoad=Math.max(1,...candidates.map(c=>(loads[c.id]??0)+targetSeats))
 return stats.map(s=>{const currentSeats=loads[s.c.id]??0,confidence=Math.min(1,s.selected.length/8),fit=s.exact.length?1:s.similar.length?.65:0
 return {employeeId:s.c.id,employeeName:s.c.name,scheduled:s.c.scheduled,score:Math.round(Math.min(100,50*adjusted(s)/max+20*fit+15*confidence+15*(1-(currentSeats+targetSeats)/maxLoad))),avgNetSales:s.avg,avgSalesPerHour:s.hourly,timedUses:s.timed.length,historicalUses:s.selected.length,currentSeats,exactHistory:!!s.exact.length,exactUses:s.exact.length,seatUses:s.similar.length,lastCloseoutDate:s.rows.map(r=>r.closeout_date??'').sort().reverse()[0]||null,
 reason:`${s.c.scheduled?'Scheduled that day.':'Potential option — availability must be confirmed.'} ${s.exact.length} closeouts with this combination; ${s.similar.length} with similar seat counts. ${s.selected.length?`Compares ${useHourly?'sales per hour':useSeat?'sales per assigned seat':'sales per closeout'} with a three-closeout confidence adjustment.`:'No eligible closeout history; capacity-only suggestion.'} ${s.selected.length<3?'Limited evidence. ':''}Sales reflect the whole closeout, not separately measured table sales.`}
 }).sort((a,b)=>Number(!!b.scheduled)-Number(!!a.scheduled)||b.score-a.score||a.currentSeats-b.currentSeats||a.employeeName.localeCompare(b.employeeName))
}
