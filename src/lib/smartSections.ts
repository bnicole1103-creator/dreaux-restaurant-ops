export type SmartRecommendation = {employeeId:string;employeeName:string;score:number;avgNetSales:number;historicalUses:number;currentSeats:number;exactHistory:boolean;reason:string}
type Candidate = {id:string;name:string}
export type CloseoutPerformance = {employee_id:string;net_sales:number|null;table_match:boolean}
export function recommendSections(candidates:Candidate[], performance:CloseoutPerformance[], loads:Record<string,number>):SmartRecommendation[] {
  const stats = new Map<string,{net:number;count:number;exact:boolean}>()
  for (const row of performance) {
    const net = Number(row.net_sales)
    if (row.net_sales === null || !Number.isFinite(net) || net <= 0) continue
    const s = stats.get(row.employee_id) ?? {net:0,count:0,exact:true}
    s.net += net; s.count++; s.exact = s.exact && row.table_match
    stats.set(row.employee_id,s)
  }
  const maxSales = Math.max(1,...candidates.map(c=>{const s=stats.get(c.id);return s?s.net/s.count:0}))
  const maxLoad = Math.max(1,...candidates.map(c=>loads[c.id]??0))
  return candidates.map(c=>{
    const s=stats.get(c.id), uses=s?.count??0, avg=uses?s!.net/uses:0, currentSeats=loads[c.id]??0
    return {employeeId:c.id,employeeName:c.name,score:Math.round((uses?70*avg/maxSales:35)+30*(1-currentSeats/maxLoad)),avgNetSales:avg,historicalUses:uses,currentSeats,exactHistory:!!s?.exact,
      reason:uses?(s?.exact?'Submitted server closeouts for this table combination plus current assigned capacity.':'Submitted server closeouts across sections plus current assigned capacity.'):'No eligible server closeouts yet; suggestion uses current assigned capacity.'}
  }).sort((a,b)=>b.score-a.score||a.currentSeats-b.currentSeats||a.employeeName.localeCompare(b.employeeName)).slice(0,5)
}
