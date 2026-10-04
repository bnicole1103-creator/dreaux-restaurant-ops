export type SmartRecommendation = {employeeId:string;employeeName:string;score:number;avgNetSales:number;avgSalesPerHour:number|null;timedUses:number;historicalUses:number;currentSeats:number;exactHistory:boolean;reason:string}
type Candidate = {id:string;name:string}
export type CloseoutPerformance = {employee_id:string;net_sales:number|null;table_match:boolean;hours_worked:number|null}
export function recommendSections(candidates:Candidate[], performance:CloseoutPerformance[], loads:Record<string,number>):SmartRecommendation[] {
  const stats = new Map<string,{net:number;count:number;exact:boolean;hourly:number;timed:number}>()
  for (const row of performance) {
    const net = Number(row.net_sales)
    if (row.net_sales === null || !Number.isFinite(net) || net <= 0) continue
    const s = stats.get(row.employee_id) ?? {net:0,count:0,exact:true,hourly:0,timed:0}
    s.net += net; s.count++; s.exact = s.exact && row.table_match
    const hours=Number(row.hours_worked)
    if(row.hours_worked!==null && Number.isFinite(hours) && hours>0 && hours<=18){s.hourly+=net/hours;s.timed++}
    stats.set(row.employee_id,s)
  }
  const useHourly=candidates.some(c=>stats.has(c.id)) && candidates.every(c=>!stats.has(c.id)||stats.get(c.id)!.timed>0)
  const metric=(s:{net:number;count:number;hourly:number;timed:number})=>useHourly?s.hourly/s.timed:s.net/s.count
  const maxSales = Math.max(1,...candidates.map(c=>{const s=stats.get(c.id);return s?metric(s):0}))
  const maxLoad = Math.max(1,...candidates.map(c=>loads[c.id]??0))
  return candidates.map(c=>{
    const s=stats.get(c.id), uses=s?.count??0, avg=uses?s!.net/uses:0, currentSeats=loads[c.id]??0
    return {employeeId:c.id,employeeName:c.name,score:Math.round((uses?70*metric(s!)/maxSales:35)+30*(1-currentSeats/maxLoad)),avgNetSales:avg,avgSalesPerHour:s?.timed?s.hourly/s.timed:null,timedUses:s?.timed??0,historicalUses:uses,currentSeats,exactHistory:!!s?.exact,
      reason:uses?((useHourly?'Hourly sales comparisons. ':'Net sales comparisons until every server with history has a timed closeout. ')+(s?.exact?'Submitted server closeouts for this table combination plus current assigned capacity.':'Submitted server closeouts across sections plus current assigned capacity.')):'No eligible server closeouts yet; suggestion uses current assigned capacity.'}
  }).sort((a,b)=>b.score-a.score||a.currentSeats-b.currentSeats||a.employeeName.localeCompare(b.employeeName)).slice(0,5)
}
