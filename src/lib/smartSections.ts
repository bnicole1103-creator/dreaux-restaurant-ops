export type SmartRecommendation={employeeId:string;employeeName:string;score:number;avgSalesPerHour:number;avgNetSales:number;historicalUses:number;currentSeats:number;exactHistory:boolean;reason:string}
type Candidate={id:string;name:string}
type Performance={employee_id:string;net_sales:number|null;sales_per_hour:number|null}
export function recommendSections(candidates:Candidate[],performance:Performance[],loads:Record<string,number>,exact:boolean):SmartRecommendation[]{
 const stats=new Map<string,{sales:number;net:number;count:number}>()
 for(const row of performance){const sales=Number(row.sales_per_hour);if(row.sales_per_hour===null||!Number.isFinite(sales)||sales<0)continue;const s=stats.get(row.employee_id)??{sales:0,net:0,count:0};s.sales+=sales;s.net+=Number(row.net_sales)||0;s.count++;stats.set(row.employee_id,s)}
 const maxSales=Math.max(1,...candidates.map(c=>{const s=stats.get(c.id);return s?s.sales/s.count:0})),maxLoad=Math.max(1,...candidates.map(c=>loads[c.id]??0))
 return candidates.map(c=>{const s=stats.get(c.id),uses=s?.count??0,avg=uses?(s?.sales??0)/uses:0,currentSeats=loads[c.id]??0;
 return {employeeId:c.id,employeeName:c.name,score:Math.round((uses?70*avg/maxSales:35)+30*(1-currentSeats/maxLoad)),avgSalesPerHour:avg,avgNetSales:uses?(s?.net??0)/uses:0,historicalUses:uses,currentSeats,exactHistory:exact&&uses>0,reason:uses?(exact?'Sales history for this table combination plus current assigned capacity.':'Sales history across sections plus current assigned capacity.'):'No sales history available; suggestion uses current assigned capacity.'}
 }).sort((a,b)=>b.score-a.score||a.currentSeats-b.currentSeats||a.employeeName.localeCompare(b.employeeName)).slice(0,5)
}
