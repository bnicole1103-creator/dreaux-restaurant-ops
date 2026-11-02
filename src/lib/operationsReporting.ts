import {numberCell,type DataRow} from './customReports'
export const reportSources=[['closeouts','Staff closeouts'],['manager_closeouts','Manager closeouts'],['quizzes','Quiz results'],['tasks','Assigned tasks'],['points','Points ledger'],['ranks','Published weekly ranks'],['profiles','Employee profiles'],['receipts','Attached void / comp receipts'],['disposal','Bottle & ingredient disposal'],['games','Games & challenges'],['preshift','Pre-shift viewing'],['reservations','Reservations'],['seating','Seating & rotation'],['sections','Section assignments'],['training','Recipe library'],['86','86-board activity'],['reviews','Manager staff ratings'],['schedule','Synced employee schedule'],['goals','Monthly plan · daily goals']] as const
export type Coverage={category:string;status:string;rows?:number}
export type ReportResult={rows:DataRow[];coverage:Coverage[];truncated:boolean;generated_at:string}
export const averageMetrics=new Set(['quiz_percent','manager_rating','combined_score'])
export const aggregateKey=(key:string)=>averageMetrics.has(key)?'average_'+key:key
export function groupOperations(rows:DataRow[],groups:string[],sums:string[]):DataRow[]{
 if(!groups.length)return rows
 const result=new Map<string,DataRow>()
 for(const row of rows){const key=JSON.stringify(groups.map(g=>row[g]??null));let current=result.get(key);if(!current){current=Object.fromEntries(groups.map(g=>[g,row[g]??null]));current.records=0;for(const s of sums)current[aggregateKey(s)]=null;result.set(key,current)}current.records=Number(current.records)+1;for(const s of sums){const value=numberCell(row[s]);if(value!==null)current[aggregateKey(s)]=Math.round((Number(current[aggregateKey(s)]??0)+value)*1000000)/1000000}}
 for(const current of result.values()){for(const s of sums.filter(s=>averageMetrics.has(s))){const matching=rows.filter(r=>groups.every(g=>(r[g]??null)===(current[g]??null))&&numberCell(r[s])!==null);if(matching.length)current[aggregateKey(s)]=Math.round(Number(current[aggregateKey(s)])/matching.length*100)/100}}
 return [...result.values()]
}
export function filterOperations(rows:DataRow[],filters:{column:string;value:string;op:string}[]){return rows.filter(row=>filters.every(f=>{const value=row[f.column];if(f.op==='contains')return String(value??'').toLowerCase().includes(f.value.toLowerCase());if(f.op==='equals')return String(value??'').toLowerCase()===f.value.toLowerCase();const a=numberCell(value),b=numberCell(f.value);return a!==null&&b!==null&&(f.op==='gte'?a>=b:a<=b)}))}
export function saveCSV(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export const label=(key:string)=>key.replace(/_/g,' ')
