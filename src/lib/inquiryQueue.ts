import {normalizeInquiryStatus} from './inquiryDisplay'
type Item={name:string;email:string;phone:string;status:string;notes:string;date:string;received:string;source:string}
export function inquiryNeedsAction(row:Item){return !['Confirmed','Closed'].includes(normalizeInquiryStatus(row.status))}
export function inquiryQueue<T extends Item>(rows:T[],source:string,query:string,view:string,dateView:string,today:string){
 const day=(r:T)=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)?r.date:''
 return rows.filter(r=>(source==='All'||r.source===source)&&(view==='all'||view==='open'&&inquiryNeedsAction(r)||normalizeInquiryStatus(r.status)===view)&&(dateView==='all'||dateView==='upcoming'&&!!day(r)&&day(r)>=today||dateView==='undated'&&!day(r))&&[r.name,r.email,r.phone,normalizeInquiryStatus(r.status),r.notes,r.date].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>Number(inquiryNeedsAction(b))-Number(inquiryNeedsAction(a))||(day(a)||'9999').localeCompare(day(b)||'9999')||a.received.localeCompare(b.received))
}
