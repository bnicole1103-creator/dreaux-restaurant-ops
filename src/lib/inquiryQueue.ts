import {normalizeInquiryStatus} from './inquiryDisplay'
type Item={name:string;email:string;phone:string;status:string;notes:string;date:string;received:string;source:string}
export function inquiryNeedsAction(row:Item){return !['Booked','Confirmed','Closed'].includes(normalizeInquiryStatus(row.status))}
export type InquirySort = 'oldest' | 'newest' | 'event'
export function inquiryQueue<T extends Item>(rows:T[],source:string,query:string,view:string,dateView:string,today:string,sort:InquirySort='oldest'){
 const day=(r:T)=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)?r.date:''
 return rows.filter(r=>(source==='All'||r.source===source)&&(view==='all'||view==='open'&&inquiryNeedsAction(r)||normalizeInquiryStatus(r.status)===view)&&(dateView==='all'||dateView==='upcoming'&&!!day(r)&&day(r)>=today||dateView==='undated'&&!day(r)||!!day(r)&&day(r)===dateView)&&[r.name,r.email,r.phone,normalizeInquiryStatus(r.status),r.notes,r.date].join(' ').toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>{
  const left=Date.parse(a.received),right=Date.parse(b.received)
  const received=Number.isFinite(left)&&Number.isFinite(right)
   ? (sort==='newest'?right-left:left-right)
   : Number.isFinite(right)?1:Number.isFinite(left)?-1:0
  return (sort==='event'?(day(a)||'9999').localeCompare(day(b)||'9999'):0)||received
 })
}

// The saved conversion link is authoritative, including for external guest forms.
export function bookedInquiryRows<T extends {source:string;id:string;status:string}>(rows:T[],links:Record<string,string>):T[]{
 return rows.map(row=>links[row.source+':'+row.id]?{...row,status:'Booked'}:row)
}
